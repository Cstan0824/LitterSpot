import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.analysis_store import AnalysisStore
from app.floor_hazard import FloorAnalysis
from app.pipeline import AnalysisPipeline, InvalidFocusRegionError
from app.schemas import BoundingBox, FloorHazard, PersonDetection, Point


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


class PipelineRegionTests(unittest.TestCase):
    def test_focus_region_crops_floor_input_without_resizing_coordinates(self):
        image = Image.new("RGB", (100, 80), "white")
        points = [Point(x=0.2, y=0.25), Point(x=0.8, y=0.25), Point(x=0.8, y=0.75), Point(x=0.2, y=0.75)]
        cropped, offset_x, offset_y = AnalysisPipeline._floor_input(image, points)
        self.assertEqual(cropped.size, (60, 40))
        self.assertEqual((offset_x, offset_y), (20, 20))

    def test_focus_region_requires_a_polygon(self):
        with self.assertRaises(InvalidFocusRegionError):
            AnalysisPipeline._floor_input(Image.new("RGB", (100, 80)), [Point(x=0, y=0), Point(x=1, y=1)])

    def test_demo_evidence_is_saved_as_a_real_overlay_result(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3", seed_demo=True)
            store.initialize()
            pipeline = AnalysisPipeline(ReadyStateClassifier(), EmptyBinLocalizer(), DemoFloorAnalyzer(), store)

            self.assertEqual(pipeline.seed_demo_frames(), 6)

            dashboard = store.dashboard()
            latest = [camera["latest"] for camera in dashboard["cameras"]]
            self.assertTrue(all(result["isDemo"] for result in latest))
            self.assertTrue(all(result["analysisId"] for result in latest))
            self.assertTrue(all(result["people"] and result["floorHazards"] for result in latest))
            self.assertEqual(store.alerts(), [])


if __name__ == "__main__":
    unittest.main()
