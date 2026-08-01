import json
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.placement_analysis import PlacementDecision, PlacementPolicy
from app.analysis_store import AnalysisStore


class PlacementAnalysisTests(unittest.TestCase):
    policy = PlacementPolicy()

    def observations(self, days: int, people: int, overflow_minutes: set[tuple[int, int]] | None = None):
        overflow_minutes = overflow_minutes or set()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = []
        for day in range(days):
            for minute in range(480):
                flags = [{"kind": "bin_overflow"}] if (day, minute) in overflow_minutes else []
                rows.append(((started + timedelta(days=day, minutes=minute)).isoformat(), people, json.dumps({"flags": flags})))
        return rows

    def test_high_popularity_passes_independent_of_overflow(self):
        ranks = self.policy.rank(self.observations(3, people=2), window_days=3)
        self.assertTrue(ranks["coverageReady"])
        self.assertEqual(ranks["overflowRank"], 0)
        self.assertEqual(ranks["popularityRank"], 100)

    def test_overflow_episodes_are_deduplicated_for_thirty_minutes(self):
        rows = self.observations(3, people=0, overflow_minutes={(0, 1), (0, 2), (1, 1), (2, 1)})
        ranks = self.policy.rank(rows, window_days=3)
        self.assertEqual(ranks["overflowEpisodes"], 3)
        self.assertEqual(ranks["overflowRank"], 100)

    def test_continuous_overflow_remains_one_episode(self):
        rows = self.observations(3, people=0, overflow_minutes={(0, minute) for minute in range(90)})
        ranks = self.policy.rank(rows, window_days=3)
        self.assertEqual(ranks["overflowEpisodes"], 1)

    def test_incomplete_observation_does_not_unlock_recommendation(self):
        ranks = self.policy.rank(self.observations(2, people=5), window_days=3)
        self.assertFalse(ranks["coverageReady"])

    def test_either_independent_rank_can_raise_recommendation(self):
        ranks = self.policy.rank(self.observations(3, people=2), window_days=3)
        pending = self.policy.decide(ranks, PlacementDecision(False, None, 0, 0))
        raised = self.policy.decide(ranks, pending)
        self.assertTrue(raised.recommended)
        self.assertEqual(raised.trigger_reason, "high_popularity")

    def test_sqlite_connections_are_released_after_access(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "analysis.sqlite3"
            store = AnalysisStore(path=path)
            store.initialize()
            store.recent()
            path.unlink()
            self.assertFalse(path.exists())

    def test_saved_analysis_creates_evidence_and_deduplicated_active_alert(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3")
            store.initialize()
            result = {
                "imageName": "camera.jpg", "cameraId": "camera-1", "peopleCount": 2,
                "flags": [{"severity": "critical", "kind": "floor_spill", "message": "Floor Spill"}],
                "floorHazards": [{"className": "floor_spill", "confidence": 0.88}], "bins": [],
            }
            first_id = store.save(result, b"image-bytes", "camera.jpg")
            store.save(result, b"image-bytes", "camera.jpg")
            alerts = store.alerts()
            self.assertEqual(len(alerts), 1)
            self.assertEqual(alerts[0]["analysisId"], first_id + 1)
            self.assertTrue(store.evidence_path(first_id))
            dashboard = store.dashboard()
            self.assertEqual(dashboard["summary"]["configuredCameras"], 6)
            camera = next(item for item in dashboard["cameras"] if item["id"] == "camera-1")
            self.assertEqual(camera["latest"]["analysisId"], first_id + 1)
            updated = store.update_alert_status(alerts[0]["id"], "resolved", "tester", "handled")
            self.assertEqual(updated["status"], "resolved")
            self.assertEqual(len(store.alerts(status="resolved")), 1)

    def test_demo_seed_populates_every_camera_with_evidence_only(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3", seed_demo=True)
            store.initialize()
            dashboard = store.dashboard()
            self.assertEqual(len(dashboard["cameras"]), 6)
            self.assertTrue(all(item["latest"]["isDemo"] for item in dashboard["cameras"]))
            self.assertEqual(len(store.pending_demo_frames()), 6)
            self.assertEqual(store.alerts(), [])


if __name__ == "__main__":
    unittest.main()
