from __future__ import annotations

import json
from dataclasses import dataclass
from threading import Lock
from time import monotonic, perf_counter

import cv2
import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
from torchvision.transforms import v2

from .config import ALERT_MIN_FRAME_INTERVAL_SECONDS, ALERT_TRACK_TTL_SECONDS, BIN_PROFILE_PATH, DEVICE, STATE_CLASSIFIER_PATH, STATE_CLASSIFIER_VERSION
from .schemas import BoundingBox, ImageInfo, StateClassificationResponse, StateSignals


def resolve_device(value: str) -> torch.device:
    if value.isdigit():
        return torch.device(f"cuda:{value}" if torch.cuda.is_available() else "cpu")
    requested = torch.device(value)
    return torch.device("cpu") if requested.type == "cuda" and not torch.cuda.is_available() else requested


class MultiTaskMobileNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        base = mobilenet_v3_small(weights=None)
        self.features = base.features
        self.avgpool = base.avgpool
        feature_count = base.classifier[0].in_features
        self.dropout = nn.Dropout(0.2)
        self.presence_head = nn.Linear(feature_count, 1)
        self.fullness_head = nn.Linear(feature_count, 1)
        self.overflow_head = nn.Linear(feature_count, 1)

    def forward(self, images: torch.Tensor) -> dict[str, torch.Tensor]:
        features = self.dropout(self.avgpool(self.features(images)).flatten(1))
        return {"presence": self.presence_head(features).squeeze(1), "fullness": self.fullness_head(features).squeeze(1), "overflow": self.overflow_head(features).squeeze(1)}


@dataclass
class BinProfile:
    region: dict[str, float] | None
    thresholds: dict[str, float]


class ProfileStore:
    def __init__(self) -> None:
        self.profiles: dict[str, BinProfile] = {}

    def load(self) -> None:
        if not BIN_PROFILE_PATH.is_file():
            return
        payload = json.loads(BIN_PROFILE_PATH.read_text(encoding="utf-8"))
        for key, value in payload.get("profiles", {}).items():
            region = value.get("regionNormalized")
            if region and not (set(region) == {"x1", "y1", "x2", "y2"} and 0 <= region["x1"] < region["x2"] <= 1 and 0 <= region["y1"] < region["y2"] <= 1):
                raise ValueError(f"Invalid normalized ROI for profile {key}")
            thresholds = {name: float(number) for name, number in value.get("thresholds", {}).items()}
            if set(thresholds) - {"presence", "fullness", "overflow", "overflowPresenceFloor"} or any(not 0 < number < 1 for number in thresholds.values()):
                raise ValueError(f"Invalid thresholds for profile {key}")
            self.profiles[key] = BinProfile(region=region, thresholds=thresholds)

    def get(self, camera_id: str | None, bin_id: str | None) -> BinProfile | None:
        return self.profiles.get(f"{camera_id}:{bin_id}") if camera_id and bin_id else None


class SaferStateTracker:
    def __init__(self) -> None:
        self.observations: dict[str, dict[str, float | int | str | None]] = {}
        self.lock = Lock()

    @staticmethod
    def hamming_distance(left: str, right: str) -> int:
        return sum(first != second for first, second in zip(left, right))

    def observe(self, camera_id: str | None, bin_id: str | None, state: str, fingerprint: str, required_frames: int) -> tuple[int, bool, str | None, bool, bool]:
        if not camera_id or not bin_id or state == "unknown":
            return 0, False, None, False, False
        key, now = f"{camera_id}:{bin_id}", monotonic()
        with self.lock:
            previous = self.observations.get(key)
            if previous and (now - float(previous["seen_at"]) > ALERT_TRACK_TTL_SECONDS):
                previous = None
            # A camera can change JPEG encoding without changing the scene.  Use a
            # compact perceptual fingerprint rather than byte equality so those
            # replays cannot manufacture temporal consensus.
            duplicate = bool(previous and (
                self.hamming_distance(str(previous["fingerprint"]), fingerprint) <= 2
                or now - float(previous["seen_at"]) < ALERT_MIN_FRAME_INTERVAL_SECONDS
            ))
            frames = int(previous["frames"]) if duplicate and previous else 0
            if not duplicate:
                frames = int(previous["frames"]) + 1 if previous and previous.get("candidate") == state else 1
            stable = str(previous["stable"]) if previous and previous.get("stable") else None
            if not duplicate and frames >= required_frames:
                stable = state
            self.observations[key] = {"candidate": state, "frames": frames, "stable": stable, "seen_at": now, "fingerprint": fingerprint}
        confirmed = state == "overflow" and stable == "overflow" and frames >= required_frames
        return frames, confirmed, stable, stable != state, not duplicate


class MultiStateClassifier:
    def __init__(self) -> None:
        self.model: MultiTaskMobileNet | None = None
        self.transform = None
        self.device = resolve_device(DEVICE)
        self.load_error: str | None = None
        self.image_size = 224
        self.context = .15
        self.thresholds = {"presence": .5, "fullness": .5, "overflow": .5}
        self.overflow_policy = "conservative"
        self.overflow_presence_floor = .5
        self.uncertainty_margin = .03
        self.profile_store = ProfileStore()
        self.tracker = SaferStateTracker()

    @property
    def ready(self) -> bool:
        return self.model is not None and self.transform is not None

    def load(self) -> None:
        try:
            self.profile_store.load()
            if not STATE_CLASSIFIER_PATH.is_file():
                raise FileNotFoundError(f"State-classifier checkpoint is not available: {STATE_CLASSIFIER_PATH}")
            checkpoint = torch.load(STATE_CLASSIFIER_PATH, map_location="cpu", weights_only=True)
            if checkpoint.get("architecture") != "multitask_mobilenet_v3_small":
                raise ValueError("Expected a multi-task state-classifier checkpoint")
            model = MultiTaskMobileNet(); model.load_state_dict(checkpoint["model"]); model.eval().to(self.device)
            self.image_size = int(checkpoint["image_size"]); self.context = float(checkpoint["context"])
            self.thresholds = {key: float(value) for key, value in checkpoint["thresholds"].items()}
            self.overflow_policy = str(checkpoint.get("overflow_policy", "conservative"))
            self.overflow_presence_floor = float(checkpoint.get("overflow_presence_floor", self.thresholds["presence"]))
            preset = MobileNet_V3_Small_Weights.DEFAULT.transforms()
            self.transform = v2.Compose([v2.Resize((self.image_size, self.image_size), antialias=True), v2.ToImage(), v2.ToDtype(torch.float32, scale=True), v2.Normalize(mean=preset.mean, std=preset.std)])
            self.model, self.load_error = model, None
        except Exception as error:
            self.model, self.transform, self.load_error = None, None, str(error)

    def profile_region(self, image: Image.Image, camera_id: str | None, bin_id: str | None) -> tuple[BoundingBox | None, bool]:
        profile = self.profile_store.get(camera_id, bin_id)
        if not profile or not profile.region:
            return None, False
        region = profile.region
        return BoundingBox(x1=region["x1"] * image.width, y1=region["y1"] * image.height, x2=region["x2"] * image.width, y2=region["y2"] * image.height), True

    @staticmethod
    def quality_reasons(crop: Image.Image) -> list[str]:
        if min(crop.size) < 48:
            return ["region_too_small"]
        gray = cv2.cvtColor(np.asarray(crop), cv2.COLOR_RGB2GRAY)
        mean, contrast = float(gray.mean()), float(gray.std())
        reasons = []
        if mean < 15: reasons.append("too_dark")
        if mean > 245: reasons.append("overexposed")
        if contrast < 8: reasons.append("low_contrast")
        if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < 12: reasons.append("too_blurry")
        return reasons

    @staticmethod
    def expanded_region(image: Image.Image, region: BoundingBox, context: float) -> BoundingBox:
        """Match the padded crop geometry used during classifier training."""
        width, height = region.x2 - region.x1, region.y2 - region.y1
        return BoundingBox(
            x1=max(0.0, region.x1 - width * context),
            y1=max(0.0, region.y1 - height * context),
            x2=min(float(image.width), region.x2 + width * context),
            y2=min(float(image.height), region.y2 + height * context),
        )

    @staticmethod
    def perceptual_fingerprint(crop: Image.Image) -> str:
        gray = cv2.cvtColor(np.asarray(crop.resize((9, 8))), cv2.COLOR_RGB2GRAY)
        # Difference hash: stable across minor compression changes, but changes
        # when the visual content materially changes.
        return "".join("1" if value else "0" for value in (gray[:, 1:] > gray[:, :-1]).ravel())

    @torch.inference_mode()
    def classify(self, image: Image.Image, region: BoundingBox, camera_id: str | None, bin_id: str | None, confirmation_frames: int, profile_used: bool, localizer_used: bool = False) -> StateClassificationResponse:
        if not self.ready or self.model is None or self.transform is None:
            raise RuntimeError(self.load_error or "State classifier is not loaded")
        started = perf_counter()
        effective_region = self.expanded_region(image, region, self.context)
        crop = image.crop((effective_region.x1, effective_region.y1, effective_region.x2, effective_region.y2)).convert("RGB")
        reasons = self.quality_reasons(crop)
        logits = self.model(self.transform(crop).unsqueeze(0).to(self.device))
        signals = {key: float(torch.sigmoid(value)[0].cpu()) for key, value in logits.items()}
        profile = self.profile_store.get(camera_id, bin_id)
        thresholds = self.thresholds | (profile.thresholds if profile else {})
        presence_floor = thresholds.get("overflowPresenceFloor", self.overflow_presence_floor)
        recall_first_overflow = self.overflow_policy.startswith("recall_first") and signals["overflow"] >= thresholds["overflow"] and signals["presence"] >= presence_floor
        if reasons:
            state, confidence = "unknown", 1 - signals["presence"] if "bin_not_detected" in reasons else .0
        elif recall_first_overflow:
            state, confidence = "overflow", signals["overflow"]
        elif signals["presence"] < thresholds["presence"]:
            reasons.append("bin_not_detected")
            state, confidence = "unknown", 1 - signals["presence"]
        elif abs(signals["overflow"] - thresholds["overflow"]) < self.uncertainty_margin:
            reasons.append("uncertain_overflow")
            state, confidence = "unknown", 0.0
        elif signals["overflow"] >= thresholds["overflow"]:
            state, confidence = "overflow", signals["overflow"]
        elif abs(signals["fullness"] - thresholds["fullness"]) < self.uncertainty_margin:
            reasons.append("uncertain_fullness")
            state, confidence = "unknown", 0.0
        elif signals["fullness"] >= thresholds["fullness"]:
            state, confidence = "full", signals["fullness"]
        else:
            state, confidence = "normal", min(signals["presence"], 1 - signals["overflow"], 1 - signals["fullness"])
        fingerprint = self.perceptual_fingerprint(crop)
        required = confirmation_frames if state == "overflow" else 2
        frames, confirmed, stable_state, pending, distinct_frame = self.tracker.observe(camera_id, bin_id, state, fingerprint, required)
        return StateClassificationResponse(modelVersion=STATE_CLASSIFIER_VERSION, decisionPolicy=self.overflow_policy, state=state, stableState=stable_state, confidence=confidence, signals=StateSignals(binPresence=signals["presence"], fullness=signals["fullness"], overflow=signals["overflow"]), confirmed=confirmed, confirmationFrames=frames, distinctFrameAccepted=distinct_frame, transitionPending=pending, unknownReasons=reasons, cameraId=camera_id, binId=bin_id, image=ImageInfo(width=image.width, height=image.height), region=effective_region, profileUsed=profile_used, localizerUsed=localizer_used, processingTimeMs=(perf_counter() - started) * 1000)
