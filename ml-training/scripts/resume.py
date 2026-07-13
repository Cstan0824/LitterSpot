"""Resume the public baseline from its latest saved training state."""
from pathlib import Path
from ultralytics import YOLOE

ROOT = Path(__file__).resolve().parents[2]
checkpoint = ROOT / "runs/bin_overflow/yoloe26s_public_v1/weights/last.pt"

if __name__ == "__main__":
    if not checkpoint.exists():
        raise FileNotFoundError(f"No resumable checkpoint found: {checkpoint}")
    YOLOE(str(checkpoint)).train(resume=str(checkpoint))
