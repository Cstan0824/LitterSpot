import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from train_wet_surface_patch_classifier import build_report, compute_metrics


class WetSurfacePatchClassifierTests(unittest.TestCase):
    def test_metrics_use_wet_as_positive_class(self):
        metrics = compute_metrics([[90, 10], [5, 95]])
        self.assertAlmostEqual(metrics["wetPrecision"], 95 / 105)
        self.assertEqual(metrics["wetRecall"], .95)
        self.assertEqual(metrics["drySpecificity"], .9)

    def test_public_pass_never_becomes_qualification_or_dispatch_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            (data / "manifest.json").write_text("{}", encoding="utf-8")
            checkpoint = root / "best.pt"
            checkpoint.touch()
            report = build_report(
                data=data, checkpoint=checkpoint, parameter_count=2_500_000,
                seed=42, history=[], test_metrics={
                    "wetRecall": .96, "wetPrecision": .94, "drySpecificity": .93,
                },
            )
        self.assertTrue(report["publicDiagnosticPassed"])
        self.assertFalse(report["qualificationEligible"])
        self.assertFalse(report["dispatchEligible"])


if __name__ == "__main__":
    unittest.main()
