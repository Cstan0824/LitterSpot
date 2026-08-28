"""Reference and geometry evidence for the registered-camera prototype."""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageDraw

from .schemas import Point


def _prototype_config() -> dict[str, float]:
    path = Path(__file__).resolve().parents[2] / "config" / "registered-bin-evidence.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        zones = payload.get("zones", {})
        thresholds = payload.get("thresholds", {})
        return {
            "topFraction": float(zones.get("topFraction", 0.30)),
            "sideExpansionFraction": float(zones.get("sideExpansionFraction", 0.12)),
            "bottomExpansionFraction": float(zones.get("bottomExpansionFraction", 0.15)),
            "topChangeRatio": float(thresholds.get("topChangeRatio", 0.08)),
            "sideChangeRatio": float(thresholds.get("sideChangeRatio", 0.04)),
            "bottomChangeRatio": float(thresholds.get("bottomChangeRatio", 0.03)),
            "exteriorNoiseCeiling": float(thresholds.get("exteriorNoiseCeiling", 0.02)),
            "differenceThreshold": float(thresholds.get("differenceThreshold", 0.12)),
            "floorMaskOverlap": float(thresholds.get("floorMaskOverlap", 0.60)),
        }
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return {
            "topFraction": 0.30,
            "sideExpansionFraction": 0.12,
            "bottomExpansionFraction": 0.15,
            "topChangeRatio": 0.08,
            "sideChangeRatio": 0.04,
            "bottomChangeRatio": 0.03,
            "exteriorNoiseCeiling": 0.02,
            "differenceThreshold": 0.12,
            "floorMaskOverlap": 0.60,
        }


_CONFIG = _prototype_config()


@dataclass(frozen=True)
class BinSpatialEvidence:
    """Small, serializable evidence summary used to gate overflow decisions."""

    state: str
    reason: str | None
    topChangeRatio: float
    outsideChangeRatio: float
    exteriorEvidence: bool

    def as_dict(self) -> dict[str, object]:
        result = {
            "topChangeRatio": round(self.topChangeRatio, 4),
            "outsideChangeRatio": round(self.outsideChangeRatio, 4),
            "exteriorEvidence": self.exteriorEvidence,
        }
        return result


class RegisteredSceneEvidenceModule:
    """Deep module that hides derived zones and reference-difference details."""

    TOP_ZONE_FRACTION = _CONFIG["topFraction"]
    SIDE_EXPANSION_FRACTION = _CONFIG["sideExpansionFraction"]
    BOTTOM_EXPANSION_FRACTION = _CONFIG["bottomExpansionFraction"]
    TOP_CHANGE_THRESHOLD = _CONFIG["topChangeRatio"]
    SIDE_CHANGE_THRESHOLD = _CONFIG["sideChangeRatio"]
    BOTTOM_CHANGE_THRESHOLD = _CONFIG["bottomChangeRatio"]
    EXTERIOR_NOISE_CEILING = _CONFIG["exteriorNoiseCeiling"]
    DIFFERENCE_THRESHOLD = _CONFIG["differenceThreshold"]
    FLOOR_MASK_OVERLAP = _CONFIG["floorMaskOverlap"]

    @classmethod
    def gate_bin_state(
        cls,
        current: Image.Image,
        reference: Image.Image | None,
        polygon: list[Point],
        bin_type: str,
        model_state: str,
    ) -> BinSpatialEvidence | None:
        """Return a spatial override when a model state lacks exterior evidence.

        A missing reference intentionally returns ``None`` so legacy direct
        callers retain their previous behaviour. Production registered-camera
        jobs always provide the validated reference media.
        """
        if reference is None or current.size != reference.size or len(polygon) < 3:
            return None
        top_ratio, outside_ratio, side_ratio, bottom_ratio = cls._change_ratios(current, reference, polygon)
        exterior = (
            side_ratio >= cls.SIDE_CHANGE_THRESHOLD
            or bottom_ratio >= cls.BOTTOM_CHANGE_THRESHOLD
        )
        if bin_type == "lidded" and top_ratio >= cls.TOP_CHANGE_THRESHOLD and outside_ratio < cls.EXTERIOR_NOISE_CEILING:
            return BinSpatialEvidence("review", "lid_obstruction", top_ratio, outside_ratio, False)
        if model_state == "overflow" and not exterior:
            return BinSpatialEvidence("review", "overflow_without_exterior_evidence", top_ratio, outside_ratio, False)
        return BinSpatialEvidence(model_state, None, top_ratio, outside_ratio, exterior)

    @classmethod
    def _change_ratios(
        cls,
        current: Image.Image,
        reference: Image.Image,
        polygon: list[Point],
    ) -> tuple[float, float, float, float]:
        width, height = current.size
        current_array = cls._gray(current)
        reference_array = cls._gray(reference)
        difference = np.abs(current_array - reference_array) > cls.DIFFERENCE_THRESHOLD

        points = [(round(point.x * width), round(point.y * height)) for point in polygon]
        x_values, y_values = zip(*points)
        x1, x2 = max(0, min(x_values)), min(width, max(x_values))
        y1, y2 = max(0, min(y_values)), min(height, max(y_values))
        if x2 <= x1 or y2 <= y1:
            return 0.0, 0.0, 0.0, 0.0

        inside = Image.new("L", (width, height), 0)
        ImageDraw.Draw(inside).polygon(points, fill=255)
        inside_mask = np.asarray(inside, dtype=bool)
        top_mask = np.zeros((height, width), dtype=bool)
        top_mask[y1:max(y1 + 1, y1 + round((y2 - y1) * cls.TOP_ZONE_FRACTION)), x1:x2 + 1] = True
        top_mask &= inside_mask

        expanded_x1 = max(0, x1 - round((x2 - x1) * cls.SIDE_EXPANSION_FRACTION))
        expanded_x2 = min(width, x2 + round((x2 - x1) * cls.SIDE_EXPANSION_FRACTION))
        expanded_y2 = min(height, y2 + round((y2 - y1) * cls.BOTTOM_EXPANSION_FRACTION))
        exterior = np.zeros((height, width), dtype=bool)
        exterior[y1:expanded_y2 + 1, expanded_x1:expanded_x2 + 1] = True
        exterior &= ~inside_mask
        valid_side = exterior.copy()
        valid_side[y2 + 1:, :] = False
        valid_bottom = exterior.copy()
        valid_bottom[:y2 + 1, :] = False

        top_ratio = cls._ratio(difference, top_mask)
        side_ratio = cls._ratio(difference, valid_side)
        bottom_ratio = cls._ratio(difference, valid_bottom)
        return top_ratio, max(side_ratio, bottom_ratio), side_ratio, bottom_ratio

    @staticmethod
    def _gray(image: Image.Image) -> np.ndarray:
        # A small blur and per-frame mean normalization make the prototype less
        # sensitive to minor exposure changes between stable mock frames.
        array = np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(radius=1.2)), dtype=np.float32) / 255.0
        mean = float(array.mean())
        if mean > 0:
            array = np.clip(array * (0.5 / mean), 0.0, 1.0)
        return array

    @staticmethod
    def _ratio(mask: np.ndarray, region: np.ndarray) -> float:
        area = int(region.sum())
        return float((mask & region).sum() / area) if area else 0.0
