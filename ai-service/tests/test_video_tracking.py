import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import (
    BoundingBox,
    ImageInfo,
    LocalizedBinAnalysis,
    PipelineAnalysisResponse,
    StateSignals,
)
from app.video_tracking import VideoSessionTracker


class RecordingStore:
    def __init__(self):
        self.saved = []

    def save(self, payload, evidence_bytes=None, evidence_name=None, **options):
        self.saved.append((payload, evidence_bytes, evidence_name, options))
        return len(self.saved)


def bin_result(state="normal", bbox=None, people_count=0):
    bbox = bbox or BoundingBox(x1=10, y1=10, x2=40, y2=50)
    return PipelineAnalysisResponse(
        imageName="frame.jpg",
        cameraId="camera-1",
        image=ImageInfo(width=100, height=100),
        peopleCount=people_count,
        people=[],
        bins=[LocalizedBinAnalysis(
            binIndex=1,
            localizerConfidence=0.9,
            bbox=bbox,
            classificationRegion=bbox,
            state=state,
            stateConfidence=0.9,
            signals=StateSignals(binPresence=0.9, fullness=0.2, overflow=0.1),
            confirmationFrames=1,
            processingTimeMs=5,
        )],
        floorHazards=[],
        flags=[],
        processingTimeMs=10,
    )


def empty_result(people_count=0):
    return PipelineAnalysisResponse(
        imageName="frame.jpg", cameraId="camera-1", image=ImageInfo(width=100, height=100),
        peopleCount=people_count, people=[], bins=[], floorHazards=[], flags=[], processingTimeMs=10,
    )


class VideoSessionTrackerTests(unittest.TestCase):
    def setUp(self):
        self.store = RecordingStore()
        self.tracker = VideoSessionTracker(self.store)

    def observe(self, result, timestamp):
        return self.tracker.observe("session-1", "camera-1", timestamp, result, b"frame", "frame.jpg")

    def test_baseline_requires_two_consecutive_samples(self):
        pending = self.observe(bin_result(), 0)
        response = self.observe(bin_result(), 1)

        self.assertFalse(pending.baseline)
        self.assertFalse(pending.persisted)
        self.assertEqual(pending.confirmationProgress, 1)
        self.assertFalse(pending.result.bins[0].confirmed)
        self.assertTrue(response.baseline)
        self.assertTrue(response.persisted)
        self.assertTrue(response.result.bins[0].confirmed)
        self.assertEqual(response.result.bins[0].trackingId, "bin-1")
        self.assertEqual(len(self.store.saved), 1)
        self.assertNotIn("resolve_missing_alerts", self.store.saved[0][3])

    def test_semantic_change_requires_two_consecutive_samples(self):
        self.observe(bin_result("normal"), 0)
        self.observe(bin_result("normal"), 1)

        pending = self.observe(bin_result("overflow"), 2)
        confirmed = self.observe(bin_result("overflow"), 3)

        self.assertFalse(pending.persisted)
        self.assertEqual(pending.confirmationProgress, 1)
        self.assertTrue(confirmed.persisted)
        self.assertEqual(confirmed.changes[0].kind, "bin_state")
        self.assertEqual(confirmed.changes[0].previous, "normal")
        self.assertEqual(confirmed.changes[0].current, "overflow")
        self.assertEqual(confirmed.changes[0].videoTimestampSeconds, 3)
        self.assertEqual(len(self.store.saved), 2)
        self.assertTrue(self.store.saved[-1][3]["resolve_missing_alerts"])

    def test_box_movement_keeps_identity_and_does_not_create_change(self):
        self.observe(bin_result(bbox=BoundingBox(x1=10, y1=10, x2=40, y2=50)), 0)
        self.observe(bin_result(bbox=BoundingBox(x1=10, y1=10, x2=40, y2=50)), 1)
        moved = self.observe(bin_result(bbox=BoundingBox(x1=13, y1=12, x2=43, y2=52)), 2)

        self.assertEqual(moved.result.bins[0].trackingId, "bin-1")
        self.assertEqual(moved.changes, [])
        self.assertFalse(moved.persisted)

    def test_people_count_change_is_semantic(self):
        self.observe(bin_result(people_count=0), 0)
        self.observe(bin_result(people_count=0), 1)
        self.observe(bin_result(people_count=2), 2)
        confirmed = self.observe(bin_result(people_count=2), 3)

        self.assertEqual(confirmed.changes[0].kind, "people_count")
        self.assertEqual((confirmed.changes[0].previous, confirmed.changes[0].current), ("0", "2"))

    def test_confirmed_bin_is_carried_for_one_missed_sample(self):
        self.observe(bin_result(), 0)
        self.observe(bin_result(), 1)

        missed = self.observe(empty_result(), 2)

        self.assertEqual(len(missed.result.bins), 1)
        self.assertTrue(missed.result.bins[0].confirmed)
        self.assertTrue(missed.result.bins[0].stale)
        self.assertEqual(missed.changes, [])

    def test_overflow_flags_only_after_four_occurrences_within_ten_seconds(self):
        first = self.observe(bin_result("overflow"), 0)
        second = self.observe(bin_result("overflow"), 1)
        third = self.observe(bin_result("overflow"), 8)
        fourth = self.observe(bin_result("overflow"), 10)

        self.assertEqual(first.result.flags, [])
        self.assertEqual(second.result.flags, [])
        self.assertEqual(third.result.flags, [])
        self.assertEqual(third.flagConfirmationProgress, 3)
        self.assertEqual([flag.kind for flag in fourth.result.flags], ["bin_overflow"])
        self.assertEqual(fourth.flagConfirmationProgress, 4)
        self.assertTrue(fourth.persisted)

    def test_occurrences_older_than_ten_seconds_do_not_confirm_a_flag(self):
        self.observe(bin_result("overflow"), 0)
        self.observe(bin_result("overflow"), 1)
        self.observe(bin_result("overflow"), 2)
        late = self.observe(bin_result("overflow"), 13)

        self.assertEqual(late.result.flags, [])
        self.assertEqual(late.flagConfirmationProgress, 1)

    def test_people_detection_is_flagged_after_four_samples(self):
        self.observe(bin_result(people_count=1), 0)
        self.observe(bin_result(people_count=1), 1)
        self.observe(bin_result(people_count=1), 2)
        response = self.observe(bin_result(people_count=1), 3)

        self.assertEqual([flag.kind for flag in response.result.flags], ["people_present"])
        self.assertTrue(response.persisted)


if __name__ == "__main__":
    unittest.main()
