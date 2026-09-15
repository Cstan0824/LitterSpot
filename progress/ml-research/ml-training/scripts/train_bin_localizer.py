"""Train a small one-class detector for full-frame bin localization."""
from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "ml-training/configs/bin_localizer.yaml")
    parser.add_argument("--model", default="yolo11n.pt", help="Small pretrained detector; downloaded by Ultralytics if absent")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--lr0", type=float, default=.001)
    parser.add_argument("--warmup-epochs", type=float, default=3.0)
    parser.add_argument("--warmup-bias-lr", type=float, default=.1)
    parser.add_argument("--name", default="bin_localizer_yolo11n_v1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.data.is_file():
        raise SystemExit(f"Dataset configuration not found: {args.data}")
    model = YOLO(args.model)
    model.train(
        data=str(args.data), epochs=args.epochs, batch=args.batch, imgsz=args.imgsz, device=args.device,
        optimizer="AdamW", lr0=args.lr0, weight_decay=.0005, patience=20, workers=args.workers,
        warmup_epochs=args.warmup_epochs, warmup_bias_lr=args.warmup_bias_lr,
        degrees=5, translate=.10, scale=.35, fliplr=.5, mosaic=.35, close_mosaic=10,
        seed=42, deterministic=True, project=str(ROOT / "runs/bin-localizer"), name=args.name,
    )


if __name__ == "__main__":
    main()
