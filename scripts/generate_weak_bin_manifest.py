#!/usr/bin/env python3
"""Create event-level weak bin-state labels without frame-by-frame review.

The input is an operational event export. It deliberately labels only fixed
bin crops and records the event as weak evidence; it never touches
``mock-data`` and never claims a human-reviewed ground truth label.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "ml-training/data/specialists/manifest.json"
DEFAULT_OUTPUT = ROOT / "ml-training/data/specialists/images/weak-bin"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _split(event_id: str) -> str:
    value = int(hashlib.sha256(event_id.encode()).hexdigest()[:8], 16) % 100
    return "train" if value < 70 else "valid" if value < 85 else "test"


def _crop_frame(frame: dict[str, Any], root: Path, destination: Path, context: float) -> Path:
    source_value = frame.get("cropPath") or frame.get("path")
    if not isinstance(source_value, str) or not source_value.strip():
        raise ValueError("frame.path or frame.cropPath is required")
    source = Path(source_value)
    source = source if source.is_absolute() else root / source
    if not source.is_file():
        raise FileNotFoundError(source)
    with Image.open(source) as image:
        image = image.convert("RGB")
        region = frame.get("region")
        if not frame.get("cropPath") and not isinstance(region, dict):
            raise ValueError("frame.region is required when frame.cropPath is absent")
        if not frame.get("cropPath") and isinstance(region, dict):
            required = {"x1", "y1", "x2", "y2"}
            if set(region) != required or not all(0 <= float(region[key]) <= 1 for key in required):
                raise ValueError("frame.region must contain normalized x1/y1/x2/y2")
            x1, y1 = float(region["x1"]) * image.width, float(region["y1"]) * image.height
            x2, y2 = float(region["x2"]) * image.width, float(region["y2"]) * image.height
            width, height = x2 - x1, y2 - y1
            image = image.crop((
                max(0, x1 - width * context), max(0, y1 - height * context),
                min(image.width, x2 + width * context), min(image.height, y2 + height * context),
            ))
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, quality=95)
    return destination


def _frames(event: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = event.get(key, [])
    return [frame for frame in value if isinstance(frame, dict)] if isinstance(value, list) else []


def generate(events_path: Path, manifest_path: Path, output_root: Path, project_root: Path = ROOT, context: float = .15) -> dict[str, Any]:
    payload = json.loads(events_path.read_text(encoding="utf-8"))
    events = payload.get("events", payload) if isinstance(payload, dict) else payload
    if not isinstance(events, list):
        raise ValueError("Events input must be an array or an object containing events.")
    existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {"schemaVersion": 1, "samples": []}
    rows = [row for row in existing.get("samples", []) if row.get("pipeline") != "bin_state"]
    generated: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for event in events:
        if not isinstance(event, dict):
            skipped.append({"eventId": "<invalid>", "reason": "event must be an object"})
            continue
        event_id = str(event.get("eventId", "")).strip()
        kind = str(event.get("kind", "")).strip().lower()
        bin_id = str(event.get("binId", "")).strip()
        if not event_id or not bin_id or kind not in {"bin_overflow", "overflow", "normal", "clean", "bin_full"}:
            skipped.append({"eventId": event_id or "<missing>", "reason": "eventId, binId and supported kind are required"})
            continue
        state = "overflow" if kind in {"bin_overflow", "overflow"} else "full" if kind == "bin_full" else "normal"
        frame_sets = [("pre", _frames(event, "preFrames"), state)]
        if event.get("postStable"):
            frame_sets.append(("post", _frames(event, "postFrames"), "normal"))
        for phase, frames, phase_state in frame_sets:
            for index, frame in enumerate(frames):
                try:
                    destination = output_root / event_id / phase / f"{index:04d}.jpg"
                    _crop_frame(frame, project_root, destination, context)
                except (OSError, ValueError) as exc:
                    skipped.append({"eventId": event_id, "reason": str(exc)})
                    continue
                relative_image = str(destination.resolve().relative_to(project_root.resolve())).replace("\\", "/")
                known_state = phase_state in {"normal", "full", "overflow"}
                generated.append({
                    "sampleId": f"weak-{event_id}-{phase}-{index:04d}",
                    "pipeline": "bin_state", "path": relative_image,
                    "captureGroup": f"weak-event-{event_id}", "split": _split(event_id),
                    "source": {"id": "project-operational-event", "url": "project-owned", "license": "project-owned", "eventId": event_id},
                    "sha256": _sha256(destination),
                    "review": {"status": "weak_label", "reviewer": "system", "method": f"{phase}_task_event", "reviewedAt": datetime.now(UTC).date().isoformat()},
                    "edgeTags": ["weak_label", phase, kind],
                    "label": {
                        "binId": bin_id, "state": phase_state, "binPresent": True,
                        "presenceKnown": True, "fullnessKnown": phase_state == "full" or bool(event.get("fullnessConfirmed")),
                        "overflowKnown": phase_state in {"normal", "overflow"},
                    },
                })
    output = {"schemaVersion": 1, "samples": rows + generated}
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    report = {"generatedAt": datetime.now(UTC).isoformat(), "events": len(events), "importedRows": len(generated), "skipped": len(skipped), "skippedRows": skipped, "weakOnly": True}
    (manifest_path.parent / "weak-bin-import-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--context", type=float, default=.15)
    args = parser.parse_args()
    if not 0 <= args.context <= .5:
        parser.error("--context must be between 0 and 0.5")
    report = generate(args.events.resolve(), args.manifest.resolve(), args.output_root.resolve(), ROOT, args.context)
    print(json.dumps({key: report[key] for key in ("events", "importedRows", "skipped", "weakOnly")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
