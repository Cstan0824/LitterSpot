from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import evaluate_end_to_end_bin_state as evaluator  # noqa: E402


def test_score_counts_localizer_misses_as_end_to_end_state_failures() -> None:
    rows = [
        {"expectedState": "overflow", "localized": True, "actualState": "overflow"},
        {"expectedState": "overflow", "localized": False, "actualState": None},
        {"expectedState": "normal", "localized": True, "actualState": "full"},
    ]
    negative_frames = [
        {"detectionCount": 0, "states": []},
        {"detectionCount": 2, "states": ["unknown", "overflow"]},
    ]

    metrics = evaluator.score(rows, negative_frames)

    assert metrics == {
        "expectedFrameBins": 3,
        "localizedFrameBins": 2,
        "localizerRecall": 2 / 3,
        "stateCorrectGivenLocalized": 1,
        "stateAccuracyGivenLocalized": 0.5,
        "endToEndStateCorrect": 1,
        "endToEndStateAccuracy": 1 / 3,
        "expectedOverflowFrameBins": 2,
        "detectedOverflowFrameBins": 1,
        "endToEndOverflowRecall": 0.5,
        "negativeFrames": 2,
        "falseBinFrames": 1,
        "falseBinFrameRate": 0.5,
        "falseOverflowFrames": 1,
        "falseOverflowFrameRate": 0.5,
    }
