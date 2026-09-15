#!/usr/bin/env python3
"""Evaluate the public wet-surface detector without treating it as site evidence.

The Mendeley source labels generic ``water`` and ``wet_surface`` regions.  It
can establish whether a compact detector learns useful wet-floor features, but
it contains neither project cameras nor verified F&B spills.  Consequently the
report can pass a public-diagnostic gate while remaining permanently ineligible
for detection-stability qualification and cleaner-task dispatch.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
CLASS_NAMES = ("water", "wet_surface")


def _number(value: object) -> float:
    return float(value.item()) if hasattr(value, "item") else float(value)


def build_report(
    *,
    checkpoint: Path,
    data: Path,
    metrics: Any,
    min_map50: float,
    min_recall: float,
) -> dict[str, Any]:
    per_class: dict[str, dict[str, float]] = {}
    for class_id, name in enumerate(CLASS_NAMES):
        precision, recall, map50, map50_95 = metrics.class_result(class_id)
        per_class[name] = {
            "precision": _number(precision),
            "recall": _number(recall),
            "map50": _number(map50),
            "map50_95": _number(map50_95),
        }
    overall = {
        "precision": _number(metrics.box.mp),
        "recall": _number(metrics.box.mr),
        "map50": _number(metrics.box.map50),
        "map50_95": _number(metrics.box.map),
    }
    speed = {
        str(name): _number(value)
        for name, value in getattr(metrics, "speed", {}).items()
    }
    gates = {
        "overall_map50": {
            "value": overall["map50"],
            "minimum": min_map50,
            "passed": overall["map50"] >= min_map50,
        },
        "water_recall": {
            "value": per_class["water"]["recall"],
            "minimum": min_recall,
            "passed": per_class["water"]["recall"] >= min_recall,
        },
        "wet_surface_recall": {
            "value": per_class["wet_surface"]["recall"],
            "minimum": min_recall,
            "passed": per_class["wet_surface"]["recall"] >= min_recall,
        },
    }
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "checkpoint": str(checkpoint.resolve()),
        "dataset": str(data.resolve()),
        "split": "test",
        "evidenceTier": "public",
        "sourceTask": ["water", "wet_surface"],
        "targetTask": ["f_and_b_spill"],
        "overall": overall,
        "perClass": per_class,
        "speedMillisecondsPerImage": speed,
        "publicDiagnosticGates": gates,
        "publicDiagnosticPassed": all(gate["passed"] for gate in gates.values()),
        "qualificationEligible": False,
        "dispatchEligible": False,
        "limitations": [
            "The source is not captured by project cameras.",
            "Water and wet-surface labels are only spill surrogates, not verified F&B spills.",
            "Passing this diagnostic never satisfies real-camera qualification gates.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument(
        "--data", type=Path,
        default=ROOT / "dataset/floor_spill/wet_surface_v4/data.yaml",
    )
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--device", default="0")
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--min-map50", type=float, default=.30)
    parser.add_argument("--min-recall", type=float, default=.30)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checkpoint = args.checkpoint.resolve()
    data = args.data.resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")
    if not data.is_file():
        raise SystemExit(f"Dataset configuration not found: {data}")

    metrics = YOLO(str(checkpoint)).val(
        data=str(data), split="test", imgsz=args.imgsz, batch=args.batch,
        device=args.device, workers=args.workers, plots=False, verbose=False,
        project=str(ROOT / "artifacts/detection-stability/current/diagnostics"),
        name="wet-surface-public-test", exist_ok=True,
    )
    report = build_report(
        checkpoint=checkpoint, data=data, metrics=metrics,
        min_map50=args.min_map50, min_recall=args.min_recall,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
