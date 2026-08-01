"""Deep application service for one complete LitterSpot frame analysis."""
from __future__ import annotations

from io import BytesIO
from time import perf_counter

from PIL import Image, ImageDraw

from .analysis_store import AnalysisStore
from .bin_localizer import BinLocalizer
from .floor_hazard import FloorHazardAnalyzer
from .multi_state_classifier import MultiStateClassifier
from .schemas import (
    BoundingBox,
    FloorHazard,
    ImageInfo,
    LocalizedBinAnalysis,
    PipelineAnalysisResponse,
    PipelineFlag,
    PipelineOptions,
    Point,
)


class PipelineNotReadyError(RuntimeError):
    pass


class InvalidFocusRegionError(ValueError):
    pass


class AnalysisPipeline:
    """Hides model coordination, ROI transforms, flagging, and persistence."""

    def __init__(
        self,
        state_classifier: MultiStateClassifier,
        bin_localizer: BinLocalizer,
        floor_analyzer: FloorHazardAnalyzer,
        store: AnalysisStore,
    ) -> None:
        self.state_classifier = state_classifier
        self.bin_localizer = bin_localizer
        self.floor_analyzer = floor_analyzer
        self.store = store

    @property
    def ready(self) -> bool:
        return self.state_classifier.ready and self.bin_localizer.ready and self.floor_analyzer.ready

    def analyze(
        self,
        image: Image.Image,
        image_name: str,
        options: PipelineOptions,
        evidence_bytes: bytes | None = None,
        *,
        is_demo: bool = False,
    ) -> PipelineAnalysisResponse:
        if not self.ready:
            raise PipelineNotReadyError("One or more pipeline models are not ready")

        floor_image, offset_x, offset_y = self._floor_input(image, options.focusRegion)
        started = perf_counter()
        candidates, _ = self.bin_localizer.locate_all(image, options.localizerConfidence, 20)
        bins = [self._classify_bin(image, candidate, index, options) for index, candidate in enumerate(candidates, start=1)]

        people = self.floor_analyzer.analyze(image, detect_floor=False).people
        floor_result = self.floor_analyzer.analyze(floor_image, options.floorConfidence, detect_people=False)
        hazards = [self._translate_hazard(hazard, offset_x, offset_y) for hazard in floor_result.hazards]
        flags = self._flags_for(bins, hazards)

        result = PipelineAnalysisResponse(
            isDemo=is_demo,
            imageName=image_name,
            cameraId=options.cameraId,
            image=ImageInfo(width=image.width, height=image.height),
            focusRegion=options.focusRegion,
            peopleCount=len(people),
            people=people,
            bins=bins,
            floorHazards=hazards,
            flags=flags,
            processingTimeMs=(perf_counter() - started) * 1000,
        )
        result.analysisId = self.store.save(result.model_dump(), evidence_bytes, image_name)
        return result

    def seed_demo_frames(self) -> int:
        """Analyse the persisted demo evidence through the normal production path."""
        if not self.ready:
            return 0
        processed = 0
        for camera_id, image_name, evidence_path in self.store.pending_demo_frames():
            try:
                contents = evidence_path.read_bytes()
                image = Image.open(BytesIO(contents)).convert("RGB")
                self.analyze(
                    image,
                    image_name,
                    PipelineOptions(cameraId=camera_id, confirmationFrames=1),
                    contents,
                    is_demo=True,
                )
                processed += 1
            except (OSError, ValueError):
                # A damaged checked-in sample must not prevent the service starting.
                continue
        return processed

    def _classify_bin(self, image: Image.Image, candidate, index: int, options: PipelineOptions) -> LocalizedBinAnalysis:
        classification = self.state_classifier.classify(
            image,
            candidate.bbox,
            options.cameraId,
            f"frame-bin-{index}" if options.cameraId else None,
            options.confirmationFrames,
            False,
            True,
        )
        return LocalizedBinAnalysis(
            binIndex=index,
            localizerConfidence=candidate.confidence,
            bbox=candidate.bbox,
            classificationRegion=classification.region,
            state=classification.state,
            stableState=classification.stableState,
            stateConfidence=classification.confidence,
            signals=classification.signals,
            confirmed=classification.confirmed,
            confirmationFrames=classification.confirmationFrames,
            unknownReasons=classification.unknownReasons,
            processingTimeMs=classification.processingTimeMs,
        )

    @staticmethod
    def _floor_input(image: Image.Image, points: list[Point]) -> tuple[Image.Image, int, int]:
        if not points:
            return image, 0, 0
        if len(points) < 3 or any(not 0 <= point.x <= 1 or not 0 <= point.y <= 1 for point in points):
            raise InvalidFocusRegionError("focus_region needs at least three normalized points")
        pixels = [(round(point.x * image.width), round(point.y * image.height)) for point in points]
        xs, ys = zip(*pixels)
        left, top = max(0, min(xs)), max(0, min(ys))
        right, bottom = min(image.width, max(xs)), min(image.height, max(ys))
        if right - left < 2 or bottom - top < 2:
            raise InvalidFocusRegionError("focus_region is too small")
        crop = image.crop((left, top, right, bottom))
        mask = Image.new("L", crop.size, 0)
        ImageDraw.Draw(mask).polygon([(x - left, y - top) for x, y in pixels], fill=255)
        return Image.composite(crop, Image.new("RGB", crop.size), mask), left, top

    @staticmethod
    def _translate_hazard(hazard: FloorHazard, offset_x: int, offset_y: int) -> FloorHazard:
        return FloorHazard(
            className=hazard.className,
            confidence=hazard.confidence,
            bbox=BoundingBox(
                x1=hazard.bbox.x1 + offset_x,
                y1=hazard.bbox.y1 + offset_y,
                x2=hazard.bbox.x2 + offset_x,
                y2=hazard.bbox.y2 + offset_y,
            ),
            polygon=[Point(x=point.x + offset_x, y=point.y + offset_y) for point in hazard.polygon],
        )

    @staticmethod
    def _flags_for(bins: list[LocalizedBinAnalysis], hazards: list[FloorHazard]) -> list[PipelineFlag]:
        flags = [
            PipelineFlag(severity="critical", kind="bin_overflow", message=f"Bin {item.binIndex}: confirmed overflow")
            for item in bins if item.state == "overflow" and item.confirmed
        ]
        flags.extend(
            PipelineFlag(
                severity="critical" if hazard.className == "floor_spill" else "warning",
                kind=hazard.className,
                message=hazard.className.replace("_", " ").title(),
            )
            for hazard in hazards
        )
        return flags
