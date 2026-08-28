"""Run short, reproducible floor-hazard segmentation loops."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("dataset/floor_hazards/loop1/data.yaml"))
    parser.add_argument("--loop", type=int, choices=(1, 2), default=1)
    parser.add_argument("--model", type=Path, default=Path("yolo11n-seg.pt"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", default="0")
    parser.add_argument("--project", type=Path, default=Path("ml-training/floor_hazards/runs"))
    parser.add_argument("--fraction", type=float, default=1.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    run_name = f"loop{args.loop}_yolo11n_seg"
    model = YOLO(str(args.model))
    results = model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=str(args.project),
        name=run_name,
        exist_ok=False,
        pretrained=True,
        amp=True,
        workers=0,
        cache=False,
        patience=max(3, args.epochs // 2),
        seed=42,
        deterministic=True,
        fraction=args.fraction,
        plots=True,
        verbose=False,
    )
    save_dir = Path(results.save_dir)
    summary = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "loop": args.loop,
        "data": str(args.data.resolve()),
        "model": str(args.model.resolve()),
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "device": args.device,
        "fraction": args.fraction,
        "runDir": str(save_dir.resolve()),
        "weights": str((save_dir / "weights" / "best.pt").resolve()),
    }
    (save_dir / "controlled_run.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
