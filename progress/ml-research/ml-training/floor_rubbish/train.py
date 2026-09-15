"""Train YOLO26s-Seg on the prepared litter/spill segmentation dataset.

This file is intentionally not run by the dataset-preparation workflow.
Use `--device cpu` for a CPU-safe run, or keep the default `0` for the first CUDA GPU.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default=0, help='Training device. Use "cpu" if no CUDA GPU is available.')
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    data_yaml = repo_root / "dataset" / "floor_rubbish" / "prepared_dataset" / "data.yaml"
    project_dir = repo_root / "ml-training" / "floor_rubbish" / "runs" / "theme_park_hazards"
    os.chdir(repo_root)

    model = YOLO("yolo26s-seg.pt")
    model.train(
        data=str(data_yaml),
        epochs=100,
        imgsz=960,
        batch=8,
        device=args.device,
        patience=20,
        seed=42,
        project=str(project_dir),
        name="yolo26s_seg_v1",
    )


if __name__ == "__main__":
    main()
