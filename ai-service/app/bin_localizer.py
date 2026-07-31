from time import perf_counter
from dataclasses import dataclass

from PIL import Image
from ultralytics import YOLO

from .config import BIN_LOCALIZER_CONFIDENCE, BIN_LOCALIZER_PATH, DEVICE
from .schemas import BoundingBox


@dataclass(frozen=True)
class LocalizedBin:
    bbox: BoundingBox
    confidence: float


class BinLocalizer:
    """Optional one-class detector. It localizes a bin; it never assigns state."""
    def __init__(self) -> None:
        self.model: YOLO | None = None
        self.load_error: str | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None

    def load(self) -> None:
        if not BIN_LOCALIZER_PATH.is_file():
            self.load_error = f"Bin-localizer checkpoint is not available: {BIN_LOCALIZER_PATH.name}"
            return
        try:
            self.model, self.load_error = YOLO(str(BIN_LOCALIZER_PATH)), None
        except Exception as error:
            self.model, self.load_error = None, str(error)

    def locate(self, image: Image.Image) -> tuple[BoundingBox | None, str | None, float]:
        if self.model is None:
            return None, "localizer_unavailable", 0.0
        detections, elapsed_ms = self.locate_all(image, max_detections=2)
        if not detections:
            return None, "bin_not_localized", elapsed_ms
        if len(detections) != 1:
            return None, "multiple_bins_detected", elapsed_ms
        return detections[0].bbox, None, elapsed_ms

    def locate_all(
        self,
        image: Image.Image,
        confidence: float = BIN_LOCALIZER_CONFIDENCE,
        max_detections: int = 10,
    ) -> tuple[list[LocalizedBin], float]:
        if self.model is None:
            return [], 0.0
        started = perf_counter()
        result = self.model.predict(
            image,
            device=DEVICE,
            conf=confidence,
            imgsz=640,
            max_det=max_detections,
            verbose=False,
        )[0]
        boxes = result.boxes
        elapsed_ms = (perf_counter() - started) * 1000
        if boxes is None:
            return [], elapsed_ms
        detections = [
            LocalizedBin(
                bbox=BoundingBox(x1=float(xyxy[0]), y1=float(xyxy[1]), x2=float(xyxy[2]), y2=float(xyxy[3])),
                confidence=float(score),
            )
            for score, xyxy in zip(boxes.conf.tolist(), boxes.xyxy.tolist())
        ]
        return detections, elapsed_ms
