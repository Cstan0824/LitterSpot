import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from detection_stability import audit_manifest, qualify


class DetectionStabilityTests(unittest.TestCase):
    @staticmethod
    def _source(root: Path, name: str = "event.bin") -> dict:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode("utf-8"))
        return {"path": name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    @classmethod
    def _event(
        cls,
        root: Path,
        event_id: str,
        pipeline: str,
        expected: dict,
        *,
        tier: str = "real",
        camera: str = "camera-1",
        tags: list[str] | None = None,
    ) -> dict:
        return {
            "eventId": event_id,
            "pipeline": pipeline,
            "cameraId": camera,
            "sessionId": f"session-{event_id}",
            "captureGroup": f"group-{event_id}",
            "evidenceTier": tier,
            "durationSeconds": 30,
            "edgeTags": tags or [],
            "source": cls._source(root, f"media/{event_id}.bin"),
            "review": {"status": "reviewed", "reviewer": "qa"},
            "expected": expected,
        }

    @staticmethod
    def _manifest(events: list[dict]) -> dict:
        return {
            "schemaVersion": 1,
            "qualificationVersion": "qualification-v1",
            "frozen": True,
            "events": events,
        }

    @staticmethod
    def _predictions(events: list[dict]) -> dict:
        return {
            "schemaVersion": 1,
            "qualificationVersion": "qualification-v1",
            "candidate": {"version": "candidate-v1"},
            "events": events,
            "runtime": {},
            "shadow": {},
        }

    def test_manifest_checks_checksum_review_and_training_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event = self._event(root, "one", "bin_state", {"state": "normal"})
            event["captureGroup"] = "training-group"

            report = audit_manifest(
                self._manifest([event]),
                root=root,
                training_capture_groups={"training-group"},
            )

            self.assertFalse(report["passed"])
            self.assertTrue(any("overlap training data" in error for error in report["errors"]))

    def test_only_real_events_contribute_to_readiness_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = self._event(root, "real", "bin_state", {"state": "overflow"})
            mock = self._event(root, "mock", "bin_state", {"state": "overflow"}, tier="mock")
            predictions = self._predictions([
                {"eventId": "real", "actual": {"state": "normal"}},
                {"eventId": "mock", "actual": {"state": "overflow"}},
            ])
            gates = {"gates": [{
                "id": "recall",
                "module": "bin_state",
                "metric": "bin_state.overflow.recall",
                "operator": "min_lower_bound",
                "threshold": 0.5,
                "minEvidence": 1,
            }]}

            report = qualify(self._manifest([real, mock]), predictions, gates, root=root)

            self.assertEqual(report["metrics"]["realEventCount"], 1)
            self.assertEqual(report["metrics"]["diagnosticEventCount"], 1)
            self.assertEqual(report["metrics"]["bin_state"]["overflow"]["recall"]["value"], 0)
            self.assertEqual(report["gates"][0]["status"], "failed")

    def test_confidence_bound_prevents_small_lucky_sample_from_passing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = [self._event(root, f"overflow-{index}", "bin_state", {"state": "overflow"}) for index in range(20)]
            predictions = self._predictions([
                {"eventId": event["eventId"], "actual": {"state": "overflow" if index < 19 else "normal"}}
                for index, event in enumerate(events)
            ])
            gates = {"gates": [{
                "id": "recall",
                "module": "bin_state",
                "metric": "bin_state.overflow.recall",
                "operator": "min_lower_bound",
                "threshold": 0.90,
                "minEvidence": 20,
            }]}

            report = qualify(self._manifest(events), predictions, gates, root=root)

            recall = report["metrics"]["bin_state"]["overflow"]["recall"]
            self.assertEqual(recall["value"], 0.95)
            self.assertLess(recall["lower95"], 0.90)
            self.assertEqual(report["gates"][0]["status"], "failed")

    def test_missing_evidence_is_not_proven_and_cannot_enable_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gates = {"gates": [{
                "id": "occupancy",
                "module": "occupancy",
                "metric": "occupancy.withinOne",
                "operator": "min_lower_bound",
                "threshold": 0.95,
                "minEvidence": 10,
            }]}

            report = qualify(self._manifest([]), self._predictions([]), gates, root=root)

            self.assertEqual(report["status"], "not_ready")
            self.assertFalse(report["dispatchEligibleOutputEnabled"])
            self.assertEqual(report["gates"][0]["status"], "not_proven")

    def test_per_camera_gate_uses_weakest_camera_confidence_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = []
            rows = []
            for camera in ("camera-1", "camera-2"):
                for index in range(10):
                    event_id = f"{camera}-{index}"
                    events.append(self._event(root, event_id, "bin_state", {"state": "overflow"}, camera=camera))
                    state = "normal" if camera == "camera-2" and index == 9 else "overflow"
                    rows.append({"eventId": event_id, "actual": {"state": state}})
            gates = {"gates": [{
                "id": "per-camera",
                "module": "bin_state",
                "metric": "bin_state.overflow.perCameraRecall",
                "operator": "min_each_lower_bound",
                "threshold": 0.70,
                "minEvidence": 10,
            }]}

            report = qualify(self._manifest(events), self._predictions(rows), gates, root=root)

            self.assertEqual(report["gates"][0]["status"], "failed")
            self.assertEqual(report["gates"][0]["evidenceCount"], 10)

    def test_passing_gate_enables_detection_output_but_not_task_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event = self._event(root, "occupancy", "occupancy", {"peopleCount": 2})
            predictions = self._predictions([{"eventId": "occupancy", "actual": {"peopleCount": 2}}])
            gates = {"gates": [{
                "id": "mae",
                "module": "occupancy",
                "metric": "occupancy.meanAbsoluteError",
                "operator": "max",
                "threshold": 0,
                "minEvidence": 1,
            }]}

            report = qualify(self._manifest([event]), predictions, gates, root=root)

            self.assertEqual(report["status"], "detection_ready")
            self.assertTrue(report["dispatchEligibleOutputEnabled"])
            self.assertFalse(report["taskDispatchImplemented"])


if __name__ == "__main__":
    unittest.main()
