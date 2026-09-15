"""Evaluate each floor-hazard loop and emit a stable JSON benchmark."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ultralytics import YOLO


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("dataset/floor_hazards/loop1/data.yaml"))
    parser.add_argument("--split", default="test", choices=("val", "test"))
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", default="0")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    model = YOLO(str(args.model))
    metrics = model.val(data=str(args.data), split=args.split, imgsz=args.imgsz, batch=args.batch, device=args.device, plots=True, verbose=False)
    result = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": str(args.model.resolve()),
        "data": str(args.data.resolve()),
        "split": args.split,
        "imgsz": args.imgsz,
        "metrics": {
            "boxMap50": float(metrics.box.map50),
            "boxMap50_95": float(metrics.box.map),
            "maskMap50": float(metrics.seg.map50),
            "maskMap50_95": float(metrics.seg.map),
        },
        "perClass": {
            "boxMap50": [float(value) for value in getattr(metrics.box, "maps", [])],
            "maskMap50": [float(value) for value in getattr(metrics.seg, "maps", [])],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
