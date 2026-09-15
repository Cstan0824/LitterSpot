from __future__ import annotations

import importlib.util
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "evaluate_bin_localizer_regression",
    ROOT / "ml-training/scripts/evaluate_bin_localizer_regression.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def test_score_predictions_enforces_negative_and_positive_video_gates() -> None:
    cases = [
        {
            "caseId": "chair-negative",
            "negativeCategory": "chair",
            "expectedBins": [],
            "samples": [{"sampleIndex": 0}, {"sampleIndex": 1}],
        },
        {
            "caseId": "green-bin",
            "expectedBins": [
                {"binId": "bin-1", "regionNormalized": {"x1": .2, "y1": .2, "x2": .6, "y2": .9}}
            ],
            "samples": [{"sampleIndex": 0}, {"sampleIndex": 1}],
        },
    ]
    predictions = {
        ("chair-negative", 0): [],
        ("chair-negative", 1): [{"bboxNormalized": {"x1": .1, "y1": .1, "x2": .3, "y2": .4}, "confidence": .91}],
        ("green-bin", 0): [{"bboxNormalized": {"x1": .21, "y1": .2, "x2": .59, "y2": .9}, "confidence": .95}],
        ("green-bin", 1): [],
    }

    report = MODULE.score_predictions(cases, predictions, minimum_iou=.25)

    assert report["metrics"]["falseBinFrameRate"] == .5
    assert report["metrics"]["positiveTrackRecall"] == .5
    assert report["metrics"]["chairFalseDetections"] == 1
    assert report["categories"]["chair"]["falsePositiveFrames"] == 1
    assert report["gates"]["chairFalseDetections"]["passed"] is False
    assert report["passed"] is False


def test_score_predictions_passes_a_complete_safe_suite() -> None:
    cases = [
        {
            "caseId": "chair-negative",
            "negativeCategory": "chair",
            "expectedBins": [],
            "samples": [{"sampleIndex": 0}],
        },
        {
            "caseId": "bin-positive",
            "expectedBins": [
                {"binId": "bin-1", "regionNormalized": {"x1": .2, "y1": .2, "x2": .6, "y2": .9}}
            ],
            "samples": [{"sampleIndex": 0}],
        },
    ]
    predictions = {
        ("chair-negative", 0): [],
        ("bin-positive", 0): [{"bboxNormalized": {"x1": .2, "y1": .2, "x2": .6, "y2": .9}, "confidence": .95}],
    }

    report = MODULE.score_predictions(cases, predictions, minimum_iou=.25)

    assert report["metrics"]["falseBinFrameRate"] == 0
    assert report["metrics"]["positiveTrackRecall"] == 1
    assert report["passed"] is True


def test_blocker_veto_rejects_candidate_covered_by_person() -> None:
    detections = [
        {"bboxNormalized": {"x1": .2, "y1": .2, "x2": .6, "y2": .9}, "confidence": .91},
        {"bboxNormalized": {"x1": .7, "y1": .2, "x2": .9, "y2": .8}, "confidence": .88},
    ]
    blockers = [
        {"className": "person", "bboxNormalized": {"x1": .1, "y1": .1, "x2": .65, "y2": .95}, "confidence": .97},
    ]

    accepted, rejected = MODULE.filter_blocked_detections(detections, blockers, minimum_coverage=.40)

    assert accepted == [detections[1]]
    assert rejected[0]["rejectionReason"] == "blocked_by_person"


def test_sample_media_accepts_a_still_image(tmp_path: Path) -> None:
    image_path = tmp_path / "hard-negative.jpg"
    cv2.imwrite(str(image_path), np.zeros((24, 32, 3), dtype=np.uint8))

    samples = MODULE.sample_media(image_path, sample_rate_fps=1.0)

    assert len(samples) == 1
    assert samples[0]["sampleIndex"] == 0
    assert samples[0]["frameIndex"] == 0
    assert samples[0]["frame"].shape[:2] == (24, 32)
