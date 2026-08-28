import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from evaluate_public_wet_surface_detector import build_report


class _Value:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class _Metrics:
    box = SimpleNamespace(mp=.7, mr=.6, map50=.55, map=.3)
    speed = {"inference": 4.5, "postprocess": _Value(.8)}

    @staticmethod
    def class_result(class_id):
        return (.8, .5, .6, .35) if class_id == 0 else (.6, .7, .5, .25)


class PublicWetSurfaceEvaluationTests(unittest.TestCase):
    def test_public_diagnostic_can_pass_but_never_qualifies_or_dispatches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "best.pt"
            data = root / "data.yaml"
            checkpoint.touch()
            data.touch()
            report = build_report(
                checkpoint=checkpoint, data=data, metrics=_Metrics(),
                min_map50=.3, min_recall=.3,
            )

        self.assertTrue(report["publicDiagnosticPassed"])
        self.assertFalse(report["qualificationEligible"])
        self.assertFalse(report["dispatchEligible"])
        self.assertEqual(report["evidenceTier"], "public")
        self.assertEqual(report["perClass"]["wet_surface"]["recall"], .7)
        self.assertEqual(report["speedMillisecondsPerImage"]["postprocess"], .8)

    def test_each_surrogate_class_must_meet_recall_gate(self):
        class LowWetSurface(_Metrics):
            @staticmethod
            def class_result(class_id):
                return (.8, .5, .6, .35) if class_id == 0 else (.6, .2, .5, .25)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "best.pt"
            data = root / "data.yaml"
            checkpoint.touch()
            data.touch()
            report = build_report(
                checkpoint=checkpoint, data=data, metrics=LowWetSurface(),
                min_map50=.3, min_recall=.3,
            )

        self.assertFalse(report["publicDiagnosticPassed"])
        self.assertFalse(report["publicDiagnosticGates"]["wet_surface_recall"]["passed"])


if __name__ == "__main__":
    unittest.main()
