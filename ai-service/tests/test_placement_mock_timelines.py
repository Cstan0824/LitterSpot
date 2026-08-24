import json
from pathlib import Path

from app.placement_analysis import BinReplacementPolicy, PlacementDecision


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "mock-data" / "bin-placement-prototype"


def rows_for(name: str) -> list[tuple[str, int, str]]:
    document = json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))
    return [(item["createdAt"], item["peopleCount"], json.dumps(item["payload"])) for item in document["rows"]]


def advance(policy: BinReplacementPolicy, rows: list[tuple[str, int, str]]) -> tuple[dict, dict]:
    first = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))
    second = policy.evaluate(rows, PlacementDecision(first["recommended"], first["triggerReason"], first["raiseStreak"], first["clearStreak"]))
    return first, second


def test_mock_replacement_timeline_requires_two_passing_evaluations():
    first, second = advance(BinReplacementPolicy(), rows_for("replacement-needed.json"))

    assert first["decision"] == "keep_current_bin"
    assert first["raiseStreak"] == 1
    assert second["decision"] == "replacement_recommended"
    assert second["recommended"] is True
    assert second["score"] == 95.0
    assert set(second["highSignals"]) == {"bin_pressure", "litter_pressure", "spill_pressure", "human_popularity"}


def test_mock_negative_timelines_never_recommend_replacement():
    policy = BinReplacementPolicy()
    for name in ("keep-current-bin.json", "temporary-crowd.json", "insufficient-coverage.json"):
        first, second = advance(policy, rows_for(name))
        assert first["recommended"] is False
        assert second["recommended"] is False
        if name == "insufficient-coverage.json":
            assert second["decision"] == "insufficient_evidence"
