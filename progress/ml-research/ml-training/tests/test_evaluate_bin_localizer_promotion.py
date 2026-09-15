from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

from evaluate_bin_localizer_promotion import decide_promotion


def passing_reports() -> tuple[dict, dict, dict]:
    dataset = {"readyForTraining": True, "audit": {"passed": True}, "coverage": {"passed": True}}
    generic = {"metrics": {"precision": .95, "recall": .93, "map50": .94}}
    regression = {
        "passed": True,
        "metrics": {"falseBinFrameRate": 0, "positiveTrackRecall": .96, "chairFalseDetections": 0},
        "gates": {"suiteCoverage": {"passed": True}},
    }
    return dataset, generic, regression


def test_promotion_passes_only_when_every_hard_gate_passes() -> None:
    dataset, generic, regression = passing_reports()
    decision = decide_promotion(dataset, generic, regression)
    assert decision["passed"] is True
    assert decision["failedGates"] == []


def test_promotion_does_not_average_away_chair_failure() -> None:
    dataset, generic, regression = passing_reports()
    regression["metrics"]["chairFalseDetections"] = 1
    decision = decide_promotion(dataset, generic, regression)
    assert decision["passed"] is False
    assert "lockedChairFalseDetections" in decision["failedGates"]
