"""Stateless model orchestration for one LitterSpot frame."""
from __future__ import annotations

from time import perf_counter

import numpy as np
from PIL import Image, ImageDraw

from .bin_localizer import BinLocalizer
from .config import BIN_LOCALIZER_VERSION, FLOOR_HAZARD_VERSION, PEOPLE_COUNT_VERSION, STATE_CLASSIFIER_VERSION
from .floor_hazard import FloorHazardAnalyzer
from .multi_state_classifier import MultiStateClassifier
from .registered_scene_evidence import RegisteredSceneEvidenceModule
from .schemas import (
    BoundingBox,
    FloorHazard,
    FrameBinInference,
    ImageInfo,
    PipelineAnalysisResponse,
    PipelineModelVersions,
    PipelineOptions,
    Point,
    RegisteredBinContext,
    RegistrationContext,
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
        reference_image: Image.Image | None = None,
    ) -> PipelineAnalysisResponse:
        if not self.ready:
            raise PipelineNotReadyError("One or more pipeline models are not ready")

        started = perf_counter()
        scene = self.floor_analyzer.analyze(image, detect_floor=False)
        registration = options.registration
        registration_blocked = registration is not None and (
            not registration.runtime_safe()
            or not registration.frame_dimensions_match(image.width, image.height)
        )
        floor_points = registration.walkableFloorPolygon if registration else options.focusRegion
        floor_image, offset_x, offset_y = self._floor_input(image, floor_points)
        if registration:
            candidates = [] if registration_blocked else self._registered_candidates(image, registration)
            candidates = [
                candidate for candidate in candidates
                if not self._blocked_bin(candidate.bbox, scene.objects)
            ]
            bins = [self._classify_bin(
                image,
                candidate,
                index,
                candidate.bin_id,
                reference_image,
                candidate.bin_type,
                options.binReviewEnabled,
            )
                    for index, candidate in enumerate(candidates, start=1)]
            # Keep the generic detector in shadow mode for enrolled cameras.
            # Its boxes never become alerts or state decisions; they are only
            # surfaced as explicit unknown candidates when they do not overlap
            # an enrolled physical bin. This makes chairs/props diagnosable
            # without allowing them to replace the stable binId contract.
            if registration.bins and not registration_blocked and self.bin_localizer.ready:
                shadow_candidates, _ = self.bin_localizer.locate_all(image, options.localizerConfidence, 20)
                for candidate in shadow_candidates:
                    if any(self._candidate_matches_registered(candidate.bbox, registered.bbox) for registered in candidates):
                        continue
                    bins.append(self._unknown_candidate(candidate, len(bins) + 1))
        else:
            candidates, _ = self.bin_localizer.locate_all(image, options.localizerConfidence, 20)
            candidates = [
                candidate for candidate in candidates
                if not self._blocked_bin(candidate.bbox, scene.objects)
            ]
            bins = [self._classify_bin(image, candidate, index) for index, candidate in enumerate(candidates, start=1)]

        floor_result = self.floor_analyzer.analyze(floor_image, options.floorConfidence, detect_people=False)
        hazards = [] if registration_blocked else [self._translate_hazard(hazard, offset_x, offset_y) for hazard in floor_result.hazards]
        hazards = FloorHazardAnalyzer.filter_hazards(hazards, scene.objects)
        hazards = self._floor_hazards_for_context(
            hazards,
            floor_points,
            image.size,
            [candidate.bbox for candidate in candidates],
            scene.objects,
        )

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

    @classmethod
    def _floor_hazards_for_context(
        cls,
        hazards: list[FloorHazard],
        focus_region: list[Point],
        image_size: tuple[int, int] | None = None,
        registered_bins: list[BoundingBox] | None = None,
        objects=None,
    ) -> list[FloorHazard]:
        """Apply the registered floor contract to accepted hazard masks.

        The model still runs on a masked crop for efficiency. This second
        check is intentionally redundant: a centroid must be inside the floor
        polygon and at least 60% of the hazard mask must overlap the valid
        floor after furniture and registered bins are removed.
        """
        if not focus_region or image_size is None:
            return hazards
        width, height = image_size
        floor_mask = cls._polygon_mask(focus_region, width, height)
        valid_floor = floor_mask
        accepted: list[FloorHazard] = []
        for hazard in hazards:
            hazard_points = hazard.polygon if len(hazard.polygon) >= 3 else [
                Point(x=hazard.bbox.x1, y=hazard.bbox.y1),
                Point(x=hazard.bbox.x2, y=hazard.bbox.y1),
                Point(x=hazard.bbox.x2, y=hazard.bbox.y2),
                Point(x=hazard.bbox.x1, y=hazard.bbox.y2),
            ]
            hazard_mask = cls._polygon_mask_pixels(hazard_points, width, height)
            area = int(hazard_mask.sum())
            if area == 0:
                continue
            centroid = cls._polygon_centroid(hazard_points)
            centroid_x = max(0, min(width - 1, round(centroid[0])))
            centroid_y = max(0, min(height - 1, round(centroid[1])))
            overlap = int((hazard_mask & valid_floor).sum()) / area
            if not valid_floor[centroid_y, centroid_x] or overlap < RegisteredSceneEvidenceModule.FLOOR_MASK_OVERLAP:
                continue
            if any(FloorHazardAnalyzer.coverage(hazard.bbox, box) >= 0.60 for box in [*(registered_bins or []), *[item.bbox for item in objects or []]]):
                continue
            accepted.append(hazard)
        return accepted

    @staticmethod
    def _polygon_mask(points: list[Point], width: int, height: int) -> np.ndarray:
        pixels = [(round(point.x * width), round(point.y * height)) for point in points]
        return AnalysisPipeline._polygon_mask_pixels(
            [Point(x=x, y=y) for x, y in pixels], width, height,
        )

    @staticmethod
    def _polygon_mask_pixels(points: list[Point], width: int, height: int) -> np.ndarray:
        mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(mask).polygon([(round(point.x), round(point.y)) for point in points], fill=255)
        return np.asarray(mask, dtype=bool)

    @staticmethod
    def _polygon_centroid(points: list[Point]) -> tuple[float, float]:
        area_twice = 0.0
        centroid_x = 0.0
        centroid_y = 0.0
        for index, point in enumerate(points):
            next_point = points[(index + 1) % len(points)]
            cross = point.x * next_point.y - next_point.x * point.y
            area_twice += cross
            centroid_x += (point.x + next_point.x) * cross
            centroid_y += (point.y + next_point.y) * cross
        if abs(area_twice) < 1e-6:
            return (
                sum(point.x for point in points) / len(points),
                sum(point.y for point in points) / len(points),
            )
        return centroid_x / (3 * area_twice), centroid_y / (3 * area_twice)

    def _classify_bin(
        self,
        image: Image.Image,
        candidate,
        index: int,
        bin_id: str | None = None,
        reference_image: Image.Image | None = None,
        bin_type: str = "unknown",
        bin_review_enabled: bool = False,
    ) -> FrameBinInference:
        classification = self.state_classifier.classify(
            image,
            candidate.bbox,
            None,
            bin_id,
            1,
            bool(bin_id),
            not bool(bin_id),
        )
        evidence = RegisteredSceneEvidenceModule.gate_bin_state(
            image,
            reference_image,
            getattr(candidate, "polygon", []),
            bin_type,
            classification.state,
        ) if bin_id and bin_review_enabled else None
        state = evidence.state if evidence else classification.state
        reasons = list(classification.unknownReasons)
        if evidence and evidence.reason:
            reasons.append(evidence.reason)
        return FrameBinInference(
            binIndex=index,
            binId=bin_id,
            localizerConfidence=candidate.confidence,
            bbox=candidate.bbox,
            classificationRegion=classification.region,
            state=state,
            stateConfidence=classification.confidence,
            signals=classification.signals,
            unknownReasons=reasons,
            evidence=evidence.as_dict() if evidence else None,
            processingTimeMs=classification.processingTimeMs,
        )

    @staticmethod
    def _candidate_matches_registered(first: BoundingBox, second: BoundingBox) -> bool:
        left = max(first.x1, second.x1)
        top = max(first.y1, second.y1)
        right = min(first.x2, second.x2)
        bottom = min(first.y2, second.y2)
        intersection = max(0.0, right - left) * max(0.0, bottom - top)
        first_area = max(0.0, first.x2 - first.x1) * max(0.0, first.y2 - first.y1)
        second_area = max(0.0, second.x2 - second.x1) * max(0.0, second.y2 - second.y1)
        union = first_area + second_area - intersection
        if union > 0 and intersection / union >= 0.20:
            return True
        center_x = (first.x1 + first.x2) / 2
        center_y = (first.y1 + first.y2) / 2
        return second.x1 <= center_x <= second.x2 and second.y1 <= center_y <= second.y2

    @staticmethod
    def _unknown_candidate(candidate, index: int) -> FrameBinInference:
        return FrameBinInference(
            binIndex=index,
            localizerConfidence=candidate.confidence,
            bbox=candidate.bbox,
            classificationRegion=candidate.bbox,
            state="unknown",
            stateConfidence=0.0,
            signals={"binPresence": 0.0, "fullness": 0.0, "overflow": 0.0},
            unknownReasons=["unregistered_candidate"],
            processingTimeMs=0,
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
        draw = ImageDraw.Draw(mask)
        draw.polygon([(x - left, y - top) for x, y in pixels], fill=255)
        return Image.composite(crop, Image.new("RGB", crop.size), mask), left, top

    @staticmethod
    def _registered_candidates(image: Image.Image, registration: RegistrationContext):
        """Turn enrolled bin body polygons into deterministic candidate boxes.

        Registration is the source of truth for a fixed camera. The generic
        bin detector is deliberately skipped so chairs, people, and props
        cannot become bins.
        """
        from types import SimpleNamespace

        candidates = []
        for registered in registration.bins:
            pixels = [(round(point.x * image.width), round(point.y * image.height)) for point in registered.binPolygon]
            if not pixels:
                continue
            x_values, y_values = zip(*pixels)
            left, right = max(0, min(x_values)), min(image.width, max(x_values))
            top, bottom = max(0, min(y_values)), min(image.height, max(y_values))
            if right - left < 4 or bottom - top < 4:
                continue
            candidates.append(SimpleNamespace(
                bbox=BoundingBox(x1=left, y1=top, x2=right, y2=bottom),
                confidence=1.0,
                bin_id=registered.binId,
                polygon=registered.binPolygon,
                bin_type=registered.binType,
            ))
        return candidates

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
