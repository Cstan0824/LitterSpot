import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.registered_scene_evidence import RegisteredSceneEvidenceModule
from app.schemas import Point


def reference_frame() -> Image.Image:
    image = Image.new("RGB", (100, 100), "#303030")
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 80, 90), fill="#416b42")
    draw.rectangle((20, 20, 80, 35), fill="#6fa84f")
    return image


class RegisteredSceneEvidenceTests(unittest.TestCase):
    polygon = [Point(x=.2, y=.2), Point(x=.8, y=.2), Point(x=.8, y=.9), Point(x=.2, y=.9)]

    def test_lid_only_change_is_review_not_overflow(self):
        reference = reference_frame()
        current = reference.copy()
        pixels = np.asarray(current).copy()
        pixels[18:38, 20:81] = [240, 240, 240]
        current = Image.fromarray(pixels)

        evidence = RegisteredSceneEvidenceModule.gate_bin_state(current, reference, self.polygon, "lidded", "overflow")

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.state, "review")
        self.assertEqual(evidence.reason, "lid_obstruction")
        self.assertFalse(evidence.exteriorEvidence)

    def test_exterior_change_preserves_overflow(self):
        reference = reference_frame()
        current = reference.copy()
        draw = ImageDraw.Draw(current)
        draw.rectangle((15, 45, 20, 70), fill="#f0f0f0")

        evidence = RegisteredSceneEvidenceModule.gate_bin_state(current, reference, self.polygon, "lidded", "overflow")

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.state, "overflow")
        self.assertTrue(evidence.exteriorEvidence)

    def test_open_top_overflow_without_exterior_evidence_is_review(self):
        evidence = RegisteredSceneEvidenceModule.gate_bin_state(
            reference_frame(), reference_frame(), self.polygon, "open_top", "overflow",
        )

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.state, "review")
        self.assertEqual(evidence.reason, "overflow_without_exterior_evidence")
        self.assertFalse(evidence.exteriorEvidence)

    def test_missing_reference_is_a_legacy_noop(self):
        self.assertIsNone(RegisteredSceneEvidenceModule.gate_bin_state(
            reference_frame(), None, self.polygon, "lidded", "overflow",
        ))


if __name__ == "__main__":
    unittest.main()
