from pathlib import Path
import os

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATHS = [
    PROJECT_ROOT / "runs/bin_overflow/yoloe26s_fused_tune20_v1/weights/best.pt",
    PROJECT_ROOT / "models/production/bin_overflow_themepark_v3.pt",
]
configured_model = os.getenv("MODEL_PATH")
MODEL_PATH = Path(configured_model) if configured_model else next((path for path in DEFAULT_MODEL_PATHS if path.exists()), DEFAULT_MODEL_PATHS[-1])

MODEL_VERSION = os.getenv("MODEL_VERSION", "yoloe26s-fused-tune20-v1")
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
DEVICE = os.getenv("DEVICE", "0")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALERT_CONFIRMATION_FRAMES = int(os.getenv("ALERT_CONFIRMATION_FRAMES", "3"))
ALERT_TRACK_IOU = float(os.getenv("ALERT_TRACK_IOU", "0.50"))
ALERT_TRACK_TTL_SECONDS = int(os.getenv("ALERT_TRACK_TTL_SECONDS", "120"))
CLASS_NAMES = ["normal trash bin", "full trash bin", "overflowing trash bin"]
