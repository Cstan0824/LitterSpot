"""Run prediction with a trained YOLO segmentation checkpoint."""
from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parents[2]
    default_weights = repo_root / "ml-training" / "floor_rubbish" / "runs" / "theme_park_hazards" / "yolo26s_seg_v1" / "weights" / "best.pt"
    parser.add_argument("source", type=Path, help="Image, video, folder, or stream source.")
    parser.add_argument("--weights", default=str(default_weights))
    parser.add_argument("--device", default=0, help='Prediction device. Use "cpu" if no CUDA GPU is available.')
    args = parser.parse_args()

    model = YOLO(args.weights)
    model.predict(source=str(args.source), imgsz=960, device=args.device, save=True, conf=0.25)


if __name__ == "__main__":
    main()
