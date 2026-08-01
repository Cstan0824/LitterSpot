"""Validate a trained YOLO segmentation checkpoint on the prepared dataset."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parents[2]
    default_weights = repo_root / "ml-training" / "floor_rubbish" / "runs" / "theme_park_hazards" / "yolo26s_seg_v1" / "weights" / "best.pt"
    parser.add_argument("--weights", default=str(default_weights))
    parser.add_argument("--device", default=0, help='Validation device. Use "cpu" if no CUDA GPU is available.')
    args = parser.parse_args()
    data_yaml = repo_root / "dataset" / "floor_rubbish" / "prepared_dataset" / "data.yaml"
    os.chdir(repo_root)

    model = YOLO(args.weights)
    model.val(data=str(data_yaml), imgsz=960, batch=8, device=args.device, split="test")


if __name__ == "__main__":
    main()
