import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.bin_localizer import LocalizedBin
from app.floor_hazard import FloorAnalysis, FloorHazardAnalyzer
from app.pipeline import AnalysisPipeline, InvalidFocusRegionError
from app.schemas import BoundingBox, FloorHazard, PersonDetection, PipelineOptions, Point, RegisteredBinContext, RegistrationContext, StateSignals


class ReadyStateClassifier:
    ready = True


class EmptyBinLocalizer:
    ready = True

    @staticmethod
    def locate_all(*_args):
        return [], 0


class DemoFloorAnalyzer:
    ready = True

    @staticmethod
    def analyze(_image, _confidence=0.25, *, detect_people=True, detect_floor=True):
        people = [PersonDetection(confidence=0.9, bbox=BoundingBox(x1=2, y1=2, x2=12, y2=12))] if detect_people else []
        hazards = [FloorHazard(
            className="floor_spill", confidence=0.9, bbox=BoundingBox(x1=3, y1=3, x2=13, y2=13),
            polygon=[Point(x=3, y=3), Point(x=13, y=3), Point(x=13, y=13)],
        )] if detect_floor else []
        return FloorAnalysis(people=people, hazards=hazards, processing_time_ms=1)


class CandidateBinLocalizer:
    ready = True

    @staticmethod
    def locate_all(*_args):
        return [LocalizedBin(BoundingBox(x1=10, y1=10, x2=50, y2=90), 0.9)], 1


class ShadowCandidateLocalizer:
    ready = True

    @staticmethod
    def locate_all(*_args):
        return [
            LocalizedBin(BoundingBox(x1=10, y1=10, x2=50, y2=90), 0.9),
            LocalizedBin(BoundingBox(x1=60, y1=20, x2=90, y2=80), 0.85),
        ], 1


class RecordingStateClassifier:
    ready = True

    def __init__(self):
        self.calls = 0
        self.arguments = []

    def classify(self, *args):
        self.calls += 1
        self.arguments.append(args)
        region = BoundingBox(x1=10, y1=10, x2=50, y2=90)
        return SimpleNamespace(
            region=region, state="overflow", stableState=None, confidence=0.9,
            signals=StateSignals(binPresence=0.9, fullness=0.8, overflow=0.9),
            confirmed=True, confirmationFrames=1, unknownReasons=[], processingTimeMs=1,
        )


class ObjectAwareFloorAnalyzer:
    ready = True

    @staticmethod
    def analyze(_image, _confidence=0.25, *, detect_people=True, detect_floor=True):
        person = PersonDetection(confidence=0.95, bbox=BoundingBox(x1=8, y1=8, x2=52, y2=92))
        blocker = SimpleNamespace(className="person", confidence=0.95, bbox=person.bbox)
        return SimpleNamespace(
            people=[person] if detect_people else [], objects=[blocker] if detect_people else [],
            hazards=[], processing_time_ms=1,
        )


class PipelineRegionTests(unittest.TestCase):
    @staticmethod
    def registered_bin_context():
        return RegistrationContext(
            status="ready",
            alignmentStatus="valid",
            sourceWidth=100,
            sourceHeight=100,
            walkableFloorPolygon=[Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1)],
            bins=[RegisteredBinContext(
                binId="bin-1",
                binType="lidded",
                binPolygon=[Point(x=.1, y=.1), Point(x=.5, y=.1), Point(x=.5, y=.9), Point(x=.1, y=.9)],
            )],
        )

    def test_registered_still_image_uses_direct_bin_state_without_review(self):
        image = Image.new("RGB", (100, 100), "gray")
        result = AnalysisPipeline(
            RecordingStateClassifier(), EmptyBinLocalizer(), DemoFloorAnalyzer(),
        ).analyze(
            image,
            PipelineOptions(registration=self.registered_bin_context(), binReviewEnabled=False),
            reference_image=image.copy(),
        )

        self.assertEqual(result.bins[0].state, "overflow")
        self.assertEqual(result.bins[0].unknownReasons, [])
        self.assertIsNone(result.bins[0].evidence)

    def test_registered_video_frame_applies_review_gate(self):
        image = Image.new("RGB", (100, 100), "gray")
        result = AnalysisPipeline(
            RecordingStateClassifier(), EmptyBinLocalizer(), DemoFloorAnalyzer(),
        ).analyze(
            image,
            PipelineOptions(registration=self.registered_bin_context(), binReviewEnabled=True),
            reference_image=image.copy(),
        )

        self.assertEqual(result.bins[0].state, "review")
        self.assertEqual(result.bins[0].unknownReasons, ["overflow_without_exterior_evidence"])
        self.assertIsNotNone(result.bins[0].evidence)

    def test_registered_context_fails_closed_when_frame_dimensions_change(self):
        registration = RegistrationContext(
            status="ready",
            alignmentStatus="valid",
            sourceWidth=200,
            sourceHeight=100,
            walkableFloorPolygon=[Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1)],
            bins=[RegisteredBinContext(
                binId="bin-1",
                bodyPolygon=[Point(x=.1, y=.4), Point(x=.3, y=.4), Point(x=.3, y=.9), Point(x=.1, y=.9)],
                rimPolygon=[Point(x=.1, y=.4), Point(x=.3, y=.4), Point(x=.3, y=.5), Point(x=.1, y=.5)],
                groundRingPolygon=[Point(x=.1, y=.85), Point(x=.3, y=.85), Point(x=.3, y=.9), Point(x=.1, y=.9)],
            )],
        )
        pipeline = AnalysisPipeline(RecordingStateClassifier(), CandidateBinLocalizer(), DemoFloorAnalyzer())

        result = pipeline.analyze(Image.new("RGB", (100, 100)), PipelineOptions(registration=registration))

        self.assertEqual(result.bins, [])
        self.assertEqual(result.floorHazards, [])

    def test_person_covered_bin_candidate_is_rejected_before_state_classification(self):
        classifier = RecordingStateClassifier()
        pipeline = AnalysisPipeline(classifier, CandidateBinLocalizer(), ObjectAwareFloorAnalyzer())

        result = pipeline.analyze(
            Image.new("RGB", (100, 100)),
            PipelineOptions(localizerConfidence=0.7, floorConfidence=0.25),
        )

        self.assertEqual(result.bins, [])
        self.assertEqual(classifier.calls, 0)

    def test_person_covered_registered_bin_keeps_identity_and_fails_closed(self):
        classifier = RecordingStateClassifier()
        result = AnalysisPipeline(
            classifier, EmptyBinLocalizer(), ObjectAwareFloorAnalyzer(),
        ).analyze(
            Image.new("RGB", (100, 100)),
            PipelineOptions(registration=self.registered_bin_context(), binReviewEnabled=True),
            reference_image=Image.new("RGB", (100, 100)),
        )

        self.assertEqual(len(result.bins), 1)
        self.assertEqual(result.bins[0].binId, "bin-1")
        self.assertEqual(result.bins[0].state, "unknown")
        self.assertEqual(result.bins[0].unknownReasons, ["registered_bin_occluded"])
        self.assertEqual(classifier.calls, 0)

    def test_registered_video_bin_without_reference_fails_closed(self):
        result = AnalysisPipeline(
            RecordingStateClassifier(), EmptyBinLocalizer(), DemoFloorAnalyzer(),
        ).analyze(
            Image.new("RGB", (100, 100)),
            PipelineOptions(registration=self.registered_bin_context(), binReviewEnabled=True),
        )

        self.assertEqual(result.bins[0].state, "unknown")
        self.assertIn("reference_evidence_unavailable", result.bins[0].unknownReasons)

    def test_registered_camera_surfaces_unregistered_shadow_candidate_as_unknown(self):
        registration = RegistrationContext(
            status="ready",
            alignmentStatus="valid",
            sourceWidth=100,
            sourceHeight=100,
            walkableFloorPolygon=[Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1)],
            bins=[RegisteredBinContext(
                binId="bin-1",
                binPolygon=[Point(x=.1, y=.1), Point(x=.5, y=.1), Point(x=.5, y=.9), Point(x=.1, y=.9)],
            )],
        )
        result = AnalysisPipeline(
            RecordingStateClassifier(), ShadowCandidateLocalizer(), DemoFloorAnalyzer(),
        ).analyze(Image.new("RGB", (100, 100)), PipelineOptions(registration=registration))

        self.assertEqual(len(result.bins), 2)
        self.assertEqual(result.bins[0].binId, "bin-1")
        self.assertEqual(result.bins[1].state, "unknown")
        self.assertEqual(result.bins[1].unknownReasons, ["unregistered_candidate"])

    def test_registered_camera_without_bins_skips_bin_detection(self):
        registration = RegistrationContext(
            status="ready",
            alignmentStatus="valid",
            sourceWidth=100,
            sourceHeight=100,
            walkableFloorPolygon=[Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1)],
            bins=[],
        )
        classifier = RecordingStateClassifier()

        result = AnalysisPipeline(
            classifier, ShadowCandidateLocalizer(), DemoFloorAnalyzer(),
        ).analyze(Image.new("RGB", (100, 100)), PipelineOptions(registration=registration))

        self.assertEqual(result.bins, [])
        self.assertEqual(classifier.calls, 0)

    def test_floor_litter_overlapping_a_bottle_is_filtered(self):
        litter = FloorHazard(
            className="floor_litter", confidence=0.8,
            bbox=BoundingBox(x1=10, y1=10, x2=40, y2=80),
            polygon=[Point(x=10, y=10), Point(x=40, y=10), Point(x=40, y=80), Point(x=10, y=80)],
        )
        bottle = SimpleNamespace(
            className="bottle", confidence=0.9,
            bbox=BoundingBox(x1=8, y1=8, x2=42, y2=82),
        )

        self.assertEqual(FloorHazardAnalyzer.filter_hazards([litter], [bottle]), [])

    def test_floor_litter_remains_visible_without_a_floor_focus_region(self):
        litter = FloorHazard(
            className="floor_litter", confidence=0.8,
            bbox=BoundingBox(x1=10, y1=10, x2=20, y2=20), polygon=[],
        )
        spill = FloorHazard(
            className="floor_spill", confidence=0.8,
            bbox=BoundingBox(x1=30, y1=30, x2=40, y2=40), polygon=[],
        )

        self.assertEqual(
            AnalysisPipeline._floor_hazards_for_context([litter, spill], []),
            [litter, spill],
        )

    def test_floor_context_rejects_hazard_outside_polygon(self):
        hazard = FloorHazard(
            className="floor_litter", confidence=0.8,
            bbox=BoundingBox(x1=70, y1=70, x2=90, y2=90),
            polygon=[Point(x=70, y=70), Point(x=90, y=70), Point(x=90, y=90), Point(x=70, y=90)],
        )
        floor = [Point(x=0, y=0), Point(x=0.5, y=0), Point(x=0.5, y=0.5), Point(x=0, y=0.5)]

        self.assertEqual(
            AnalysisPipeline._floor_hazards_for_context([hazard], floor, (100, 100)),
            [],
        )

    def test_floor_context_rejects_hazard_over_registered_bin(self):
        hazard = FloorHazard(
            className="floor_spill", confidence=0.8,
            bbox=BoundingBox(x1=20, y1=20, x2=40, y2=40),
            polygon=[Point(x=20, y=20), Point(x=40, y=20), Point(x=40, y=40), Point(x=20, y=40)],
        )
        floor = [Point(x=0, y=0), Point(x=1, y=0), Point(x=1, y=1), Point(x=0, y=1)]

        self.assertEqual(
            AnalysisPipeline._floor_hazards_for_context(
                [hazard], floor, (100, 100), registered_bins=[hazard.bbox],
            ),
            [],
        )

    def test_partial_bin_candidate_touching_frame_edge_is_not_rejected_on_position_alone(self):
        edge_box = BoundingBox(x1=0, y1=10, x2=30, y2=90)
        self.assertFalse(AnalysisPipeline._blocked_bin(edge_box, []))

    def test_focus_region_crops_floor_input_without_resizing_coordinates(self):
        image = Image.new("RGB", (100, 80), "white")
        points = [Point(x=0.2, y=0.25), Point(x=0.8, y=0.25), Point(x=0.8, y=0.75), Point(x=0.2, y=0.75)]
        cropped, offset_x, offset_y = AnalysisPipeline._floor_input(image, points)
        self.assertEqual(cropped.size, (60, 40))
        self.assertEqual((offset_x, offset_y), (20, 20))

    def test_focus_region_requires_a_polygon(self):
        with self.assertRaises(InvalidFocusRegionError):
            AnalysisPipeline._floor_input(Image.new("RGB", (100, 80)), [Point(x=0, y=0), Point(x=1, y=1)])

    def test_combined_result_contains_only_inference_data(self):
        pipeline = AnalysisPipeline(ReadyStateClassifier(), EmptyBinLocalizer(), DemoFloorAnalyzer())

        result = pipeline.analyze(Image.new("RGB", (100, 100)), PipelineOptions())

        self.assertEqual(result.peopleCount, 1)
        self.assertEqual(len(result.floorHazards), 1)
        self.assertEqual(
            set(result.model_dump()),
            {"image", "focusRegion", "peopleCount", "people", "bins", "floorHazards", "modelVersions", "processingTimeMs"},
        )

    def test_combined_bin_result_has_no_tracking_or_business_fields(self):
        classifier = RecordingStateClassifier()
        pipeline = AnalysisPipeline(classifier, CandidateBinLocalizer(), DemoFloorAnalyzer())

        result = pipeline.analyze(Image.new("RGB", (100, 100)), PipelineOptions())

        self.assertEqual(classifier.arguments[0][2:5], (None, None, 1))
        self.assertEqual(
            set(result.bins[0].model_dump()),
            {
                "binIndex", "localizerConfidence", "bbox", "classificationRegion", "state",
                "stateConfidence", "signals", "unknownReasons", "processingTimeMs",
            },
        )


if __name__ == "__main__":
    unittest.main()
