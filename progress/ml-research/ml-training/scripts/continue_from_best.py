"""Resume from the latest saved continuation checkpoint."""
from pathlib import Path
from ultralytics import YOLOE

ROOT = Path(__file__).resolve().parents[2]


def find_latest_checkpoint() -> Path:
    candidates = sorted(
        ROOT.glob("runs/bin_overflow/yoloe26s_public_v1_continued*/weights/last.pt"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError("No continuation checkpoint found under runs/bin_overflow")
    return candidates[0]


if __name__ == "__main__":
    checkpoint = find_latest_checkpoint()
    YOLOE(str(checkpoint)).train(resume=True)
