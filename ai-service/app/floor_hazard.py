"""Floor-rubbish and people-count inference used by the combined MVP endpoint."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter

from PIL import Image
from ultralytics import YOLO

from .config import DEVICE, FLOOR_HAZARD_PATH
from .schemas import BoundingBox, FloorHazard, PersonDetection, Point


FLOOR_CLASSES = {0: "floor_litter", 1: "floor_spill"}
COMMON_OBJECT_CLASSES = {
    0: "person", 13: "bench", 24: "backpack", 26: "handbag", 28: "suitcase",
    39: "bottle", 56: "chair", 57: "couch", 60: "dining table", 62: "tv",
    63: "laptop", 67: "cell phone",
}


@dataclass(frozen=True)
class CommonObjectDetection:
    className: str
    confidence: float
    bbox: BoundingBox


@dataclass(frozen=True)
class FloorAnalysis:
    people: list[PersonDetection]
    hazards: list[FloorHazard]
    processing_time_ms: float
    objects: list[CommonObjectDetection] = field(default_factory=list)


class FloorHazardAnalyzer:
    """Loads the floor segmentation and COCO people detector once per worker."""

    def __init__(self) -> None:
        self.floor_model: YOLO | None = None
        self.people_model: YOLO | None = None
        self.load_error: str | None = None

    @property
    def ready(self) -> bool:
        return self.floor_model is not None and self.people_model is not None

    @staticmethod
    def weights_path() -> Path:
        if FLOOR_HAZARD_PATH.is_file():
            return FLOOR_HAZARD_PATH
        root = Path(__file__).resolve().parents[2]
        candidates = [
            root / "ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt",
            root / "runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt",
        ]
        return next((path for path in candidates if path.is_file()), candidates[0])

    def load(self) -> None:
        weights = self.weights_path()
        if not weights.is_file():
            self.load_error = f"Floor-rubbish checkpoint is not available: {weights}"
            return
        try:
            self.floor_model = YOLO(str(weights))
            self.people_model = YOLO("yolo26s.pt")
            self.load_error = None
        except Exception as error:
            self.floor_model, self.people_model, self.load_error = None, None, str(error)

    def analyze(
        self,
        image: Image.Image,
        confidence: float = 0.25,
        *,
        detect_people: bool = True,
        detect_floor: bool = True,
    ) -> FloorAnalysis:
        if not self.ready:
            raise RuntimeError(self.load_error or "Floor analyzer is not ready")
        started = perf_counter()
        people: list[PersonDetection] = []
        objects: list[CommonObjectDetection] = []
        if detect_people:
            object_result = self.people_model.predict(
                image, classes=sorted(COMMON_OBJECT_CLASSES), conf=0.20,
                imgsz=960, device=DEVICE, verbose=False,
            )[0]
            if object_result.boxes is not None:
                for box, class_id, score in zip(
                    object_result.boxes.xyxy.tolist(), object_result.boxes.cls.tolist(),
                    object_result.boxes.conf.tolist(),
                ):
                    bbox = BoundingBox(x1=box[0], y1=box[1], x2=box[2], y2=box[3])
                    class_name = COMMON_OBJECT_CLASSES.get(int(class_id))
                    if class_name is None:
                        continue
                    objects.append(CommonObjectDetection(className=class_name, confidence=float(score), bbox=bbox))
                    if class_name == "person":
                        people.append(PersonDetection(confidence=float(score), bbox=bbox))
        if not detect_floor:
            return FloorAnalysis(
                people=people, hazards=[], objects=objects,
                processing_time_ms=(perf_counter() - started) * 1000,
            )
        floor_result = self.floor_model.predict(image, conf=confidence, imgsz=960, device=DEVICE, verbose=False)[0]
        hazards: list[FloorHazard] = []
        if floor_result.boxes is not None:
            polygons = floor_result.masks.xy if floor_result.masks is not None else []
            for index, (box, class_id, score) in enumerate(zip(
                floor_result.boxes.xyxy.tolist(),
                floor_result.boxes.cls.tolist(),
                floor_result.boxes.conf.tolist(),
            )):
                label = FLOOR_CLASSES.get(int(class_id))
                if label:
                    polygon = [Point(x=float(point[0]), y=float(point[1])) for point in polygons[index]] if index < len(polygons) else []
                    if len(polygon) < 3:
                        polygon = [Point(x=box[0], y=box[1]), Point(x=box[2], y=box[1]), Point(x=box[2], y=box[3]), Point(x=box[0], y=box[3])]
                    hazards.append(FloorHazard(
                        className=label,
                        confidence=float(score),
                        bbox=BoundingBox(x1=box[0], y1=box[1], x2=box[2], y2=box[3]),
                        polygon=polygon,
                    ))
        return FloorAnalysis(
            people=people, hazards=hazards, objects=objects,
            processing_time_ms=(perf_counter() - started) * 1000,
        )

    @classmethod
    def filter_hazards(
        cls,
        hazards: list[FloorHazard],
        objects: list[CommonObjectDetection],
        overlap_threshold: float = 0.10,
    ) -> list[FloorHazard]:
        """Suppress litter masks substantially explained by common foreground objects."""
        return [
            hazard for hazard in hazards
            if hazard.className != "floor_litter"
            or not any(cls.coverage(hazard.bbox, item.bbox) >= overlap_threshold for item in objects)
        ]

    @staticmethod
    def coverage(subject: BoundingBox, covering: BoundingBox) -> float:
        """Fraction of the subject box covered by another box (intersection over subject area)."""
        width = max(0.0, min(subject.x2, covering.x2) - max(subject.x1, covering.x1))
        height = max(0.0, min(subject.y2, covering.y2) - max(subject.y1, covering.y1))
        area = max(0.0, subject.x2 - subject.x1) * max(0.0, subject.y2 - subject.y1)
        return width * height / area if area else 0.0
