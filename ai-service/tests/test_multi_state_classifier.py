import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.multi_state_classifier import MultiStateClassifier, SaferStateTracker
from app.schemas import BoundingBox


class MultiStateClassifierTests(unittest.TestCase):
    def test_expanded_region_matches_training_context_and_stays_in_image(self):
        image = Image.new("RGB", (100, 100))
        expanded = MultiStateClassifier.expanded_region(image, BoundingBox(x1=10, y1=20, x2=30, y2=60), .15)
        self.assertEqual(expanded, BoundingBox(x1=7, y1=14, x2=33, y2=66))

        clipped = MultiStateClassifier.expanded_region(image, BoundingBox(x1=0, y1=0, x2=20, y2=20), .15)
        self.assertEqual(clipped, BoundingBox(x1=0, y1=0, x2=23, y2=23))

    def test_perceptual_fingerprint_ignores_minor_uniform_brightness_change(self):
        first = Image.new("RGB", (64, 64), color=(30, 60, 90))
        second = Image.new("RGB", (64, 64), color=(32, 62, 92))
        self.assertEqual(MultiStateClassifier.perceptual_fingerprint(first), MultiStateClassifier.perceptual_fingerprint(second))

    def test_tracker_does_not_count_near_duplicate_fingerprint(self):
        tracker = SaferStateTracker()
        fingerprint = "0" * 64
        first = tracker.observe("camera", "bin", "overflow", fingerprint, 3)
        second = tracker.observe("camera", "bin", "overflow", "1" + "0" * 63, 3)

        self.assertEqual(first[0], 1)
        self.assertTrue(first[4])
        self.assertEqual(second[0], 1)
        self.assertFalse(second[4])
        self.assertFalse(second[1])


if __name__ == "__main__":
    unittest.main()
