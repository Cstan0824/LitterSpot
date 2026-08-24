import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.bin_localizer import LocalizedBin
from app.floor_hazard import FloorAnalysis, FloorHazardAnalyzer
from app.pipeline import AnalysisPipeline, InvalidFocusRegionError
from app.schemas import BoundingBox, FloorHazard, PersonDetection, PipelineOptions, Point, StateSignals


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
    def test_person_covered_bin_candidate_is_rejected_before_state_classification(self):
        classifier = RecordingStateClassifier()
        pipeline = AnalysisPipeline(classifier, CandidateBinLocalizer(), ObjectAwareFloorAnalyzer())

        result = pipeline.analyze(
            Image.new("RGB", (100, 100)),
            PipelineOptions(localizerConfidence=0.7, floorConfidence=0.25),
        )

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
