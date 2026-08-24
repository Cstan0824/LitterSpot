import json
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.placement_analysis import BinReplacementPolicy, PlacementDecision, PlacementPolicy
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

    def test_confirmed_video_clear_resolves_matching_active_alert(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3")
            store.initialize()
            flagged = {
                "imageName": "video-00-01.jpg", "cameraId": "camera-1", "peopleCount": 0,
                "flags": [{"severity": "critical", "kind": "floor_spill", "message": "Floor Spill"}],
                "floorHazards": [{"className": "floor_spill", "confidence": 0.9}], "bins": [],
            }
            clear = {
                "imageName": "video-00-03.jpg", "cameraId": "camera-1", "peopleCount": 0,
                "flags": [], "floorHazards": [], "bins": [],
            }
            store.save(flagged)

            store.save(clear, resolve_missing_alerts=True)

            self.assertEqual(store.alerts(status="active"), [])
            resolved = store.alerts(status="resolved")
            self.assertEqual(len(resolved), 1)
            self.assertEqual(resolved[0]["kind"], "floor_spill")

    def test_demo_seed_is_a_noop_without_legacy_sample_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3", seed_demo=True)
            store.initialize()
            dashboard = store.dashboard()
            self.assertEqual(len(dashboard["cameras"]), 6)
            self.assertTrue(all(item["latest"] is None for item in dashboard["cameras"]))
            self.assertEqual(store.pending_demo_frames(), [])
            self.assertEqual(store.alerts(), [])

    def test_store_persists_short_window_state_and_recommendation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(path=Path(directory) / "analysis.sqlite3")
            store.initialize()
            started = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(minutes=9)
            with store.connect() as connection:
                for minute in range(10):
                    litter_x = 100 + (minute // 3) * 300
                    payload = {
                        "image": {"width": 1000, "height": 1000},
                        "bins": [{"state": "full"}],
                        "floorHazards": ([{"className": "floor_litter", "bbox": {"x1": litter_x, "y1": 100, "x2": litter_x + 50, "y2": 150}}] if minute in {0, 3, 6} else []),
                    }
                    connection.execute(
                        "INSERT INTO analysis_runs (created_at, camera_id, image_name, severity, flag_count, people_count, payload_json) VALUES (?, ?, ?, 'clear', 0, ?, ?)",
                        ((started + timedelta(minutes=minute)).strftime("%Y-%m-%d %H:%M:%S"), "camera-1", "mock.jpg", 2, json.dumps(payload)),
                    )

            first = store.evaluate_placement("camera-1", force=True)
            second = store.evaluate_placement("camera-1", force=True)

            self.assertEqual(first["windowMinutes"], 10)
            self.assertEqual(first["validSamples"], 10)
            self.assertFalse(first["recommended"])
            self.assertTrue(second["recommended"])
            self.assertEqual(second["status"], "replacement_recommended")

    def test_short_window_recommends_when_two_independent_signals_are_high(self):
        policy = BinReplacementPolicy()
        rows = []
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        for minute in range(10):
            litter_x = 100 + (minute // 3) * 300
            payload = {
                "image": {"width": 1000, "height": 1000},
                "bins": [{"state": "full"}],
                "floorHazards": ([{"className": "floor_litter", "confidence": .9, "bbox": {"x1": litter_x, "y1": 100, "x2": litter_x + 50, "y2": 150}}] if minute in {0, 3, 6} else []),
            }
            rows.append(((started + timedelta(minutes=minute)).isoformat(), 2, json.dumps(payload)))

        first = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))
        second = policy.evaluate(rows, PlacementDecision(False, None, first["raiseStreak"], first["clearStreak"]))

        self.assertEqual(first["decision"], "keep_current_bin")
        self.assertEqual(second["decision"], "replacement_recommended")
        self.assertGreaterEqual(second["signals"]["binPressure"], 50)
        self.assertGreaterEqual(second["signals"]["litterPressure"], 50)
        self.assertGreaterEqual(len(second["highSignals"]), 2)

    def test_short_window_does_not_recommend_for_a_temporary_crowd(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = [
            ((started + timedelta(minutes=minute)).isoformat(), 8 if minute == 0 else 0,
             json.dumps({"bins": [{"state": "normal"}], "floorHazards": []}))
            for minute in range(10)
        ]

        report = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))

        self.assertEqual(report["decision"], "keep_current_bin")
        self.assertLess(report["score"], 70)

    def test_unconfirmed_overflow_does_not_drive_capacity_pressure(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = [
            ((started + timedelta(minutes=minute)).isoformat(), 0,
             json.dumps({"bins": [{"state": "overflow" if minute == 0 else "normal", "confirmed": False}], "floorHazards": []}))
            for minute in range(10)
        ]

        report = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))

        self.assertEqual(report["fullMinutes"], 0)
        self.assertEqual(report["signals"]["binPressure"], 0)
        self.assertFalse(report["recommended"])

    def test_stable_unknown_overrides_raw_full_state(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = [
            ((started + timedelta(minutes=minute)).isoformat(), 0,
             json.dumps({"bins": [{"state": "full", "stableState": "unknown"}], "floorHazards": []}))
            for minute in range(10)
        ]

        report = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))

        self.assertEqual(report["fullMinutes"], 0)
        self.assertEqual(report["unknownMinutes"], 10)
        self.assertEqual(report["decision"], "insufficient_evidence")

    def test_confirmed_overflow_contributes_to_replacement_evidence(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = []
        for minute in range(10):
            litter_x = 100 + (minute // 3) * 300
            payload = {
                "bins": [{"state": "overflow", "confirmed": True}],
                "floorHazards": ([{"className": "floor_litter", "bbox": {"x1": litter_x, "y1": 100, "x2": litter_x + 50, "y2": 150}}] if minute in {0, 3, 6} else []),
            }
            rows.append(((started + timedelta(minutes=minute)).isoformat(), 2, json.dumps(payload)))

        first = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))
        second = policy.evaluate(rows, PlacementDecision(False, None, first["raiseStreak"], first["clearStreak"]))

        self.assertEqual(second["fullMinutes"], 10)
        self.assertTrue(second["recommended"])

    def test_persistent_hazard_is_one_episode_but_returning_hazard_is_two(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = []
        for minute in range(10):
            hazards = []
            if minute in {0, 1, 2, 5}:
                hazards.append({"className": "floor_litter", "confidence": .9, "bbox": {"x1": 100, "y1": 100, "x2": 200, "y2": 200}})
            rows.append(((started + timedelta(minutes=minute)).isoformat(), 0, json.dumps({"bins": [{"state": "normal"}], "floorHazards": hazards})))

        report = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))

        self.assertEqual(report["litterEpisodes"], 2)

    def test_unknown_state_ratio_blocks_recommendation(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = []
        for minute in range(10):
            state = "unknown" if minute < 3 else "full"
            rows.append(((started + timedelta(minutes=minute)).isoformat(), 2, json.dumps({"bins": [{"state": state}], "floorHazards": []})))

        report = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))

        self.assertEqual(report["decision"], "insufficient_evidence")
        self.assertFalse(report["coverageReady"])

    def test_recommendation_clears_after_three_failing_evaluations(self):
        policy = BinReplacementPolicy()
        started = datetime(2026, 1, 1, 8, tzinfo=UTC)
        rows = [((started + timedelta(minutes=minute)).isoformat(), 0, json.dumps({"bins": [{"state": "normal"}], "floorHazards": []})) for minute in range(10)]
        current = PlacementDecision(True, "capacity_pressure", 0, 0)

        first = policy.evaluate(rows, current)
        second = policy.evaluate(rows, PlacementDecision(first["recommended"], first["triggerReason"], first["raiseStreak"], first["clearStreak"]))
        third = policy.evaluate(rows, PlacementDecision(second["recommended"], second["triggerReason"], second["raiseStreak"], second["clearStreak"]))

        self.assertTrue(first["recommended"])
        self.assertTrue(second["recommended"])
        self.assertFalse(third["recommended"])
        self.assertEqual(third["decision"], "keep_current_bin")


if __name__ == "__main__":
    unittest.main()
