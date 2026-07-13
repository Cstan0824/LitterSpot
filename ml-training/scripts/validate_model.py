"""Evaluate a selected LitterSpot checkpoint on the held-out test split."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ultralytics import YOLOE

ROOT = Path(__file__).resolve().parents[2]
CLASS_NAMES = ["normal trash bin", "full trash bin", "overflowing trash bin"]

def value(item: object) -> float:
    return float(item.item()) if hasattr(item, "item") else float(item)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=ROOT / "runs/bin_overflow/yoloe26s_fused_tune20_v1/weights/best.pt")
    parser.add_argument("--min-overflow-precision", type=float, default=0.85)
    parser.add_argument("--min-overflow-recall", type=float, default=0.80)
    parser.add_argument("--min-overall-map50", type=float, default=0.65)
    args = parser.parse_args()
    model_path = args.model if args.model.is_absolute() else ROOT / args.model
    model = YOLOE(str(model_path))
    output = ROOT / "runs/bin_overflow/yoloe26s_fused_tune20_v1/heldout_test"
    metrics = model.val(data=str(ROOT / "ml-training/configs/bin_overflow.yaml"), split="test", imgsz=768, batch=2, device=0, plots=True, project=str(output.parent), name=output.name, exist_ok=True)
    per_class = {}
    for index, name in enumerate(CLASS_NAMES):
        precision, recall, map50, map50_95 = metrics.class_result(index)
        per_class[name] = {"precision": value(precision), "recall": value(recall), "map50": value(map50), "map50_95": value(map50_95)}
    overall = {key: value(metric) for key, metric in metrics.results_dict.items()}
    overflow = per_class["overflowing trash bin"]
    acceptance = {
        "thresholds": {"overflow_precision": args.min_overflow_precision, "overflow_recall": args.min_overflow_recall, "overall_map50": args.min_overall_map50},
        "observed": {"overflow_precision": overflow["precision"], "overflow_recall": overflow["recall"], "overall_map50": overall["metrics/mAP50(B)"]},
    }
    acceptance["passed"] = all((overflow["precision"] >= args.min_overflow_precision, overflow["recall"] >= args.min_overflow_recall, overall["metrics/mAP50(B)"] >= args.min_overall_map50))
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "checkpoint": str(model_path), "split": "test", "overall": overall, "per_class": per_class, "acceptance": acceptance}
    report_path = ROOT / "ml-training/logs/yoloe26s_fused_tune20_v1/heldout-test-report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not acceptance["passed"]:
        raise SystemExit("Deployment acceptance gate failed; do not enable unattended overflow alerts.")

if __name__ == "__main__":
    main()
