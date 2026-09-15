"""Evaluate a trained bin localizer on the untouched YOLO test split."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--data", type=Path, default=ROOT / "ml-training/configs/bin_localizer.yaml")
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-precision", type=float, default=.80)
    parser.add_argument("--min-recall", type=float, default=.80)
    parser.add_argument("--min-map50", type=float, default=.80)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint = args.checkpoint.resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")
    if not args.data.is_file():
        raise SystemExit(f"Dataset configuration not found: {args.data}")

    run_name = f"{checkpoint.parents[1].name}_test"
    metrics = YOLO(str(checkpoint)).val(
        data=str(args.data),
        split="test",
        batch=args.batch,
        imgsz=args.imgsz,
        device=args.device,
        workers=args.workers,
        plots=True,
        project=str(ROOT / "runs/bin-localizer"),
        name=run_name,
    )
    precision = float(metrics.box.mp)
    recall = float(metrics.box.mr)
    map50 = float(metrics.box.map50)
    map50_95 = float(metrics.box.map)
    gates = {
        "precision": {"value": precision, "minimum": args.min_precision, "passed": precision >= args.min_precision},
        "recall": {"value": recall, "minimum": args.min_recall, "passed": recall >= args.min_recall},
        "map50": {"value": map50, "minimum": args.min_map50, "passed": map50 >= args.min_map50},
    }
    report = {
        "checkpoint": str(checkpoint),
        "dataset": str(args.data.resolve()),
        "split": "test",
        "metrics": {
            "precision": precision,
            "recall": recall,
            "map50": map50,
            "map50_95": map50_95,
        },
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates.values()),
        "scope": "Generic GCO+GBS baseline; not a Malaysia-domain acceptance test.",
    }
    output = args.output or checkpoint.parents[1] / "test-report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report written to {output}")
    if not report["passed"]:
        raise SystemExit("Localizer did not pass the configured generic test gates.")


if __name__ == "__main__":
    main()
