"""Stateless model orchestration for one LitterSpot frame."""
from __future__ import annotations

from time import perf_counter

from PIL import Image, ImageDraw

from .bin_localizer import BinLocalizer
from .config import BIN_LOCALIZER_VERSION, FLOOR_HAZARD_VERSION, PEOPLE_COUNT_VERSION, STATE_CLASSIFIER_VERSION
from .floor_hazard import FloorHazardAnalyzer
from .multi_state_classifier import MultiStateClassifier
from .schemas import (
    BoundingBox,
    FloorHazard,
    FrameBinInference,
    ImageInfo,
    PipelineAnalysisResponse,
    PipelineModelVersions,
    PipelineOptions,
    Point,
)


class PipelineNotReadyError(RuntimeError):
    pass


class InvalidFocusRegionError(ValueError):
    pass


class AnalysisPipeline:
    """Coordinates models and ROI transforms without storing business state."""

    BIN_BLOCKER_CLASSES = {"person", "bottle", "tv", "cell phone"}
    BIN_BLOCKER_COVERAGE = 0.40

    def __init__(
        self,
        state_classifier: MultiStateClassifier,
        bin_localizer: BinLocalizer,
        floor_analyzer: FloorHazardAnalyzer,
    ) -> None:
        self.state_classifier = state_classifier
        self.bin_localizer = bin_localizer
        self.floor_analyzer = floor_analyzer

    @property
    def ready(self) -> bool:
        return self.state_classifier.ready and self.bin_localizer.ready and self.floor_analyzer.ready

    def analyze(
        self,
        image: Image.Image,
        options: PipelineOptions,
    ) -> PipelineAnalysisResponse:
        if not self.ready:
            raise PipelineNotReadyError("One or more pipeline models are not ready")

        started = perf_counter()
        scene = self.floor_analyzer.analyze(image, detect_floor=False)
        floor_image, offset_x, offset_y = self._floor_input(image, options.focusRegion)
        candidates, _ = self.bin_localizer.locate_all(image, options.localizerConfidence, 20)
        candidates = [
            candidate for candidate in candidates
            if not self._blocked_bin(candidate.bbox, scene.objects)
        ]
        bins = [self._classify_bin(image, candidate, index) for index, candidate in enumerate(candidates, start=1)]

        floor_result = self.floor_analyzer.analyze(floor_image, options.floorConfidence, detect_people=False)
        hazards = [self._translate_hazard(hazard, offset_x, offset_y) for hazard in floor_result.hazards]
        hazards = FloorHazardAnalyzer.filter_hazards(hazards, scene.objects)
        hazards = self._floor_hazards_for_context(hazards, options.focusRegion)

        return PipelineAnalysisResponse(
            image=ImageInfo(width=image.width, height=image.height),
            focusRegion=options.focusRegion,
            peopleCount=len(scene.people),
            people=scene.people,
            bins=bins,
            floorHazards=hazards,
            modelVersions=PipelineModelVersions(
                floorHazard=FLOOR_HAZARD_VERSION,
                people=PEOPLE_COUNT_VERSION,
                binLocalizer=BIN_LOCALIZER_VERSION,
                binState=STATE_CLASSIFIER_VERSION,
            ),
            processingTimeMs=(perf_counter() - started) * 1000,
        )

    @classmethod
    def _blocked_bin(cls, bbox: BoundingBox, objects) -> bool:
        return any(
            item.className in cls.BIN_BLOCKER_CLASSES
            and FloorHazardAnalyzer.coverage(bbox, item.bbox) >= cls.BIN_BLOCKER_COVERAGE
            for item in objects
        )

    @staticmethod
    def _floor_hazards_for_context(hazards: list[FloorHazard], focus_region: list[Point]) -> list[FloorHazard]:
        """Keep filtered candidates visible; an optional focus region narrows inference upstream."""
        return hazards

    def _classify_bin(self, image: Image.Image, candidate, index: int) -> FrameBinInference:
        classification = self.state_classifier.classify(
            image,
            candidate.bbox,
            None,
            None,
            1,
            False,
            True,
        )
        return FrameBinInference(
            binIndex=index,
            localizerConfidence=candidate.confidence,
            bbox=candidate.bbox,
            classificationRegion=classification.region,
            state=classification.state,
            stateConfidence=classification.confidence,
            signals=classification.signals,
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
