#!/usr/bin/env python3
"""Evaluate a YOLO floor specialist on an untouched split and write JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("--data", type=Path, default=ROOT / "dataset/floor_rubbish/prepared_dataset/data.yaml")
    parser.add_argument("--split", choices=("val", "test"), default="test")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--device", default="0")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    model = YOLO(str(args.model.resolve()))
    metrics = model.val(
        data=str(args.data.resolve()), split=args.split, imgsz=args.imgsz,
        batch=args.batch, device=args.device, workers=0, plots=False, verbose=False,
    )
    payload = {
        "model": str(args.model.resolve()), "data": str(args.data.resolve()),
        "split": args.split, "box": {
            "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
            "map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
        }, "mask": {
            "precision": float(metrics.seg.mp), "recall": float(metrics.seg.mr),
            "map50": float(metrics.seg.map50), "map50_95": float(metrics.seg.map),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
