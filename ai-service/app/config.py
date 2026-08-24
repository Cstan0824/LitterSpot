from pathlib import Path
import os

import torch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATHS = [
    PROJECT_ROOT / "runs/bin_overflow/yoloe26s_gco_gbs_domain_balanced_v1-2/weights/epoch6.pt",
    PROJECT_ROOT / "runs/bin_overflow/yoloe26s_fused_tune20_v1/weights/best.pt",
    PROJECT_ROOT / "models/production/bin_overflow_themepark_v3.pt",
]
configured_model = os.getenv("MODEL_PATH")
MODEL_PATH = Path(configured_model) if configured_model else next((path for path in DEFAULT_MODEL_PATHS if path.exists()), DEFAULT_MODEL_PATHS[-1])

MODEL_VERSION = os.getenv("MODEL_VERSION", "yoloe26s-gco-gbs-domain-balanced-v1-2-epoch6")
STATE_CLASSIFIER_PATH = Path(os.getenv(
    "STATE_CLASSIFIER_PATH",
    PROJECT_ROOT / "runs/state_classifier/multitask_gco_gbs_v2/production.pt",
))
STATE_CLASSIFIER_VERSION = os.getenv("STATE_CLASSIFIER_VERSION", "multitask-mobilenet-gco-gbs-v2")
BIN_LOCALIZER_PATH = Path(os.getenv("BIN_LOCALIZER_PATH", PROJECT_ROOT / "models/production/bin_localizer_yolo11n.pt"))
BIN_LOCALIZER_VERSION = os.getenv("BIN_LOCALIZER_VERSION", "bin-localizer-yolo11n-gco-gbs-um-v2")
FLOOR_HAZARD_PATH = Path(os.getenv("FLOOR_HAZARD_PATH", PROJECT_ROOT / "runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt"))
FLOOR_HAZARD_VERSION = os.getenv("FLOOR_HAZARD_VERSION", "floor-hazard-yolo26s-seg-v1")
PEOPLE_COUNT_PATH = Path(os.getenv("PEOPLE_COUNT_PATH", PROJECT_ROOT / "yolo26s.pt"))
PEOPLE_COUNT_VERSION = os.getenv("PEOPLE_COUNT_VERSION", "yolo26s-coco")
BIN_LOCALIZER_CONFIDENCE = float(os.getenv("BIN_LOCALIZER_CONFIDENCE", ".80"))
BIN_PROFILE_PATH = Path(os.getenv("BIN_PROFILE_PATH", PROJECT_ROOT / "config/bin-profiles.json"))
ENABLE_LEGACY_DETECTOR = os.getenv("ENABLE_LEGACY_DETECTOR", "false").lower() in {"1", "true", "yes"}
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
_requested_device = os.getenv("DEVICE", "cpu")
# A numeric Ultralytics device selects a CUDA GPU. Local development may still
# request GPU 0 through the launcher on a CPU-only machine, so resolve that to
# CPU once for every inference component instead of only in the state model.
DEVICE = "cpu" if (_requested_device.isdigit() and not torch.cuda.is_available()) else _requested_device
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALERT_CONFIRMATION_FRAMES = int(os.getenv("ALERT_CONFIRMATION_FRAMES", "3"))
ALERT_TRACK_IOU = float(os.getenv("ALERT_TRACK_IOU", "0.50"))
ALERT_TRACK_TTL_SECONDS = int(os.getenv("ALERT_TRACK_TTL_SECONDS", "120"))
ALERT_MIN_FRAME_INTERVAL_SECONDS = float(os.getenv("ALERT_MIN_FRAME_INTERVAL_SECONDS", "0.5"))
CLASS_NAMES = ["normal trash bin", "full trash bin", "overflowing trash bin"]
