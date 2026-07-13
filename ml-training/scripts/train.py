"""Reproducible YOLOE-26S public-dataset baseline."""
from pathlib import Path
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEPETrainer

ROOT = Path(__file__).resolve().parents[2]

def main() -> None:
    model = YOLOE("yoloe-26s.yaml")
    model.load("yoloe-26s-seg.pt")
    model.train(
    data=str(ROOT / "ml-training/configs/bin_overflow.yaml"), trainer=YOLOEPETrainer,
    epochs=100, patience=20, imgsz=768, batch=2, device=0, workers=2,
    optimizer="AdamW", lr0=0.001, weight_decay=0.0005,
    degrees=5.0, translate=0.10, scale=0.30, perspective=0.0005, fliplr=0.5,
    mosaic=0.5, close_mosaic=10, amp=True, seed=42, deterministic=True,
    plots=True, save=True, exist_ok=True, project=str(ROOT / "runs/bin_overflow"), name="yoloe26s_public_v1",
    )

if __name__ == "__main__":
    main()
