from pathlib import Path
from time import perf_counter
from time import monotonic

from PIL import Image

from .config import ALERT_TRACK_IOU, ALERT_TRACK_TTL_SECONDS, CLASS_NAMES, DEVICE, MODEL_PATH, MODEL_VERSION
from .schemas import BoundingBox, Detection, DetectionOptions, DetectionResponse, ImageInfo


class AlertTracker:
    """Confirms an overflow only after matching it across consecutive camera frames."""
    def __init__(self) -> None:
        self.tracks: dict[str, list[dict[str, object]]] = {}

    @staticmethod
    def iou(left: BoundingBox, right: BoundingBox) -> float:
        x1, y1 = max(left.x1, right.x1), max(left.y1, right.y1)
        x2, y2 = min(left.x2, right.x2), min(left.y2, right.y2)
        intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        union = (left.x2 - left.x1) * (left.y2 - left.y1) + (right.x2 - right.x1) * (right.y2 - right.y1) - intersection
        return intersection / union if union > 0 else 0.0

    def observe(self, camera_id: str, box: BoundingBox, required_frames: int) -> tuple[int, bool]:
        now = monotonic()
        active = [track for track in self.tracks.get(camera_id, []) if now - float(track["seen_at"]) <= ALERT_TRACK_TTL_SECONDS]
        match = next((track for track in active if self.iou(box, track["bbox"]) >= ALERT_TRACK_IOU), None)
        if match is None:
            match = {"bbox": box, "frames": 0, "seen_at": now}
            active.append(match)
        match["bbox"] = box
        match["seen_at"] = now
        match["frames"] = int(match["frames"]) + 1
        self.tracks[camera_id] = active
        frames = int(match["frames"])
        return frames, frames >= required_frames


class BinDetector:
    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        self.model_path = model_path
        self.model = None
        self.load_error: str | None = None
        self.alert_tracker = AlertTracker()

    def load(self) -> None:
        if not self.model_path.exists():
            self.load_error = f"Model checkpoint is not available: {self.model_path}"
            return
        try:
            from ultralytics import YOLOE
            self.model = YOLOE(str(self.model_path))
            self.load_error = None
        except Exception as error:
            self.load_error = str(error)

    @property
    def ready(self) -> bool:
        return self.model is not None

    def detect(self, image: Image.Image, options: DetectionOptions) -> DetectionResponse:
        if not self.model:
            raise RuntimeError(self.load_error or "Model is not loaded")
        started = perf_counter()
        result = self.model.predict(image, device=DEVICE, conf=options.confidence, iou=options.iou, imgsz=options.imgsz, max_det=options.max_detections, verbose=False)[0]
        detections: list[Detection] = []
        if result.boxes:
            for box in result.boxes:
                class_id = int(box.cls[0])
                if class_id not in range(len(CLASS_NAMES)):
                    continue
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                bbox = BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2)
                frames, confirmed = (0, False)
                if class_id == 2 and options.camera_id:
                    frames, confirmed = self.alert_tracker.observe(options.camera_id, bbox, options.confirmation_frames)
                detections.append(Detection(
                    className=CLASS_NAMES[class_id], confidence=float(box.conf[0]),
                    confirmed=confirmed, confirmationFrames=frames,
                    bbox=bbox,
                ))
        return DetectionResponse(modelVersion=MODEL_VERSION, cameraId=options.camera_id, image=ImageInfo(width=image.width, height=image.height), detections=detections, processingTimeMs=(perf_counter() - started) * 1000)
