"""Load the prototype checkpoint through the ai-service runtime adapter.

This is a small balanced smoke replay, not a replacement for the evaluator's
held-out metrics.  It verifies the production crop/normalization, decision
policy, and response schema using the same checkpoint that the service loads.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/multi-angle-prototype/manifest.json")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/runtime_smoke.json")
    parser.add_argument("--per-state", type=int, default=4)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    if args.per_state < 1:
        raise SystemExit("--per-state must be positive")
    checkpoint = resolve(args.checkpoint)
    manifest = resolve(args.manifest)
    os.environ["STATE_CLASSIFIER_PATH"] = str(checkpoint)
    os.environ["DEVICE"] = args.device
    os.environ["STATE_CLASSIFIER_VERSION"] = "multi-angle-mobilenet-v3-small-v1-presence-fix"
    sys.path.insert(0, str(ROOT / "ai-service"))
    from app.multi_state_classifier import MultiStateClassifier
    from app.schemas import BoundingBox

    payload = json.loads(manifest.read_text(encoding="utf-8"))
    selected: list[dict] = []
    counts: Counter[tuple[str, str]] = Counter()
    for row in payload.get("samples", []):
        if row.get("pipeline") != "bin_state" or row.get("split") != "test":
            continue
        source = row.get("source", {})
        angle = str(source.get("viewAngle", "unknown"))
        state = str(row.get("label", {}).get("state", "unknown"))
        kind = "weak_base" if row["sampleId"].endswith("-base") else "synthetic_variant"
        if kind != "synthetic_variant" or counts[(angle, state)] >= args.per_state:
            continue
        counts[(angle, state)] += 1
        selected.append({"row": row, "angle": angle, "expected": state})
    classifier = MultiStateClassifier()
    classifier.load()
    if not classifier.ready:
        raise RuntimeError(classifier.load_error or "runtime classifier failed to load")
    rows: list[dict] = []
    for item in selected:
        row = item["row"]
        with Image.open(resolve(row["path"])) as opened:
            image = opened.convert("RGB")
        region = BoundingBox(x1=0, y1=0, x2=image.width, y2=image.height)
        response = classifier.classify(
            image=image,
            region=region,
            camera_id="prototype-camera",
            bin_id="prototype-bin",
            confirmation_frames=1,
            profile_used=False,
            localizer_used=False,
            profile_enabled=False,
        )
        rows.append({
            "sampleId": row["sampleId"],
            "angleBand": item["angle"],
            "expectedState": item["expected"],
            "actualState": response.state,
            "stableState": response.stableState,
            "confirmed": response.confirmed,
            "signals": response.signals.model_dump(),
            "unknownReasons": response.unknownReasons,
            "processingTimeMs": response.processingTimeMs,
        })
    if not rows:
        raise RuntimeError("No balanced synthetic test rows selected")
    matched = sum(row["expectedState"] == row["actualState"] for row in rows)
    by_angle = {
        angle: {
            "count": len(angle_rows),
            "matches": sum(row["expectedState"] == row["actualState"] for row in angle_rows),
            "accuracy": sum(row["expectedState"] == row["actualState"] for row in angle_rows) / len(angle_rows),
        }
        for angle in sorted({row["angleBand"] for row in rows})
        for angle_rows in [[row for row in rows if row["angleBand"] == angle]]
    }
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "checkpoint": str(checkpoint),
        "manifest": str(manifest),
        "runtime": "ai-service.app.multi_state_classifier.MultiStateClassifier",
        "sampleCount": len(rows),
        "matched": matched,
        "accuracy": matched / len(rows),
        "byAngle": by_angle,
        "meanProcessingTimeMs": sum(row["processingTimeMs"] for row in rows) / len(rows),
        "productionReady": False,
        "note": "Balanced synthetic smoke replay; production promotion remains blocked by absent reviewed oblique/side/overflow data.",
        "rows": rows,
    }
    output = resolve(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
