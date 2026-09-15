from pathlib import Path
import os

import torch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
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
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
_requested_device = os.getenv("DEVICE", "cpu")
# A numeric Ultralytics device selects a CUDA GPU. Local development may still
# request GPU 0 through the launcher on a CPU-only machine, so resolve that to
# CPU once for every inference component instead of only in the state model.
DEVICE = "cpu" if (_requested_device.isdigit() and not torch.cuda.is_available()) else _requested_device
MAX_IMAGE_BYTES = 10 * 1024 * 1024
