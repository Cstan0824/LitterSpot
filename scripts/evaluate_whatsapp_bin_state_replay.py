"""Replay locked WhatsApp stills through the bin-state runtime adapter.

The ROI boxes below are operator-provided diagnostic boxes, not detector output
or training labels.  Ambiguous/staged cases remain review-only.  This command
exists to expose domain transfer; it must never be used to tune thresholds.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


# Normalized manual diagnostic boxes, measured from the five locked stills.
# The second fixture is a small basket and is intentionally retained because
# it is a useful wrong-object/unknown test for a bin-state classifier.
CASES = [
    {
        "caseId": "local-recycling-bins-two-people",
        "file": "WhatsApp Image 2026-07-27 at 5.59.58 PM (3).jpeg",
        "expected": ["normal", "normal", "normal"],
        "boxes": [
            {"x1": .24, "y1": .46, "x2": .37, "y2": .79},
            {"x1": .34, "y1": .46, "x2": .47, "y2": .79},
            {"x1": .44, "y1": .46, "x2": .58, "y2": .80},
        ],
    },
    {
        "caseId": "local-office-basket-floor-panel",
        "file": "WhatsApp Image 2026-07-27 at 6.00.00 PM.jpeg",
        "expected": ["normal"],
        "boxes": [{"x1": .45, "y1": .40, "x2": .68, "y2": .69}],
    },
    {
        "caseId": "local-black-bin-bags-outside",
        "file": "WhatsApp Image 2026-07-27 at 5.59.59 PM (2).jpeg",
        "expected": ["review_overflow_vs_staged"],
        "boxes": [{"x1": .22, "y1": .45, "x2": .57, "y2": .80}],
    },
    {
        "caseId": "local-green-bin-overflow",
        "file": "WhatsApp Image 2026-07-27 at 5.59.59 PM (1).jpeg",
        "expected": ["overflow"],
        "boxes": [{"x1": .30, "y1": .48, "x2": .64, "y2": .82}],
    },
    {
        "caseId": "local-bags-loose-foam",
        "file": "WhatsApp Image 2026-07-27 at 5.59.59 PM.jpeg",
        "expected": [],
        "boxes": [],
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/whatsapp_replay.json")
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    checkpoint = resolve(args.checkpoint)
    os.environ["STATE_CLASSIFIER_PATH"] = str(checkpoint)
    os.environ["DEVICE"] = args.device
    os.environ["STATE_CLASSIFIER_VERSION"] = "multi-angle-mobilenet-v3-small-v1-presence-fix"
    sys.path.insert(0, str(ROOT / "ai-service"))
    from app.multi_state_classifier import MultiStateClassifier
    from app.schemas import BoundingBox

    classifier = MultiStateClassifier()
    classifier.load()
    if not classifier.ready:
        raise RuntimeError(classifier.load_error or "runtime classifier failed to load")
    rows: list[dict] = []
    for case in CASES:
        path = ROOT / "mock-data/internvl-evaluation/images" / case["file"]
        with Image.open(path) as opened:
            image = opened.convert("RGB")
        case_rows: list[dict] = []
        for index, normalized in enumerate(case["boxes"], start=1):
            region = BoundingBox(
                x1=normalized["x1"] * image.width, y1=normalized["y1"] * image.height,
                x2=normalized["x2"] * image.width, y2=normalized["y2"] * image.height,
            )
            response = classifier.classify(
                image=image,
                region=region,
                camera_id=case["caseId"],
                bin_id=f"manual-bin-{index}",
                confirmation_frames=1,
                profile_used=False,
                localizer_used=False,
                profile_enabled=False,
            )
            case_rows.append({
                "binIndex": index,
                "expectedState": case["expected"][index - 1],
                "actualState": response.state,
                "signals": response.signals.model_dump(),
                "unknownReasons": response.unknownReasons,
                "processingTimeMs": response.processingTimeMs,
                "roiNormalized": normalized,
            })
        rows.append({
            "caseId": case["caseId"],
            "input": str(path),
            "expectedBinCount": len(case["boxes"]),
            "actualBinCountEvaluated": len(case_rows),
            "expectedStates": case["expected"],
            "manualRoi": True,
            "note": "No boxes means no bin candidate was evaluated; this is the expected no-bin negative.",
            "results": case_rows,
        })
    evaluated = [item for row in rows for item in row["results"]]
    strict = [item for item in evaluated if item["expectedState"] in {"normal", "overflow"}]
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "checkpoint": str(checkpoint),
        "suite": "locked_whatsapp_stills_manual_roi_diagnostic",
        "trainingUse": False,
        "thresholdSelectionUse": False,
        "rows": rows,
        "strictComparable": {
            "count": len(strict),
            "matches": sum(item["expectedState"] == item["actualState"] for item in strict),
            "accuracy": (sum(item["expectedState"] == item["actualState"] for item in strict) / len(strict)) if strict else None,
        },
        "ambiguousCasesExcluded": ["review_overflow_vs_staged"],
        "productionReady": False,
        "conclusion": "Diagnostic only: the public/synthetic checkpoint is not a validated model for the WhatsApp domain or manual ROIs.",
    }
    output = resolve(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
