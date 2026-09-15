import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from calibrate_wet_surface_patch_classifier import choose_threshold, slice_metrics


class WetSurfaceThresholdCalibrationTests(unittest.TestCase):
    def test_threshold_maximizes_specificity_subject_to_recall(self):
        labels = [0, 0, 0, 0, 1, 1, 1, 1]
        probabilities = [.1, .2, .4, .6, .55, .7, .8, .9]
        threshold, metrics = choose_threshold(labels, probabilities, minimum_wet_recall=.75)
        self.assertGreater(threshold, .5)
        self.assertGreaterEqual(metrics["wetRecall"], .75)
        self.assertEqual(metrics["drySpecificity"], 1.0)

    def test_raises_when_recall_constraint_is_impossible(self):
        with self.assertRaisesRegex(ValueError, "no threshold"):
            choose_threshold([1], [0.0], minimum_wet_recall=1.0)

    def test_slice_metrics_uses_manifest_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / "one.jpg", root / "two.jpg"
            dataset = SimpleNamespace(samples=[(str(first), 0), (str(second), 1)])
            rows = [
                {"image": str(first), "sourceDataset": "figshare", "sourcePath": "withlight/dry/a.jpg"},
                {"image": str(second), "sourceDataset": "mendeley", "sourcePath": "wet/b.jpg"},
            ]
            metrics = slice_metrics(dataset, [0, 1], [.1, .9], .5, rows)
        self.assertEqual(metrics["source:figshare"]["drySpecificity"], 1.0)
        self.assertEqual(metrics["source:mendeley"]["wetRecall"], 1.0)


if __name__ == "__main__":
    unittest.main()
