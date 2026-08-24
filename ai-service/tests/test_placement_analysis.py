import json
from pathlib import Path

from app.placement_analysis import BinReplacementPolicy, PlacementDecision


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "mock-data" / "bin-placement-prototype"


def rows_for(name: str) -> list[tuple[str, int, str]]:
    document = json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))
    return [(item["createdAt"], item["peopleCount"], json.dumps(item["payload"])) for item in document["rows"]]


def evaluate_twice(rows: list[tuple[str, int, str]]) -> tuple[dict, dict]:
    policy = BinReplacementPolicy()
    first = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))
    second = policy.evaluate(rows, PlacementDecision(
        first["recommended"], first["triggerReason"], first["raiseStreak"], first["clearStreak"],
    ))
    return first, second


def test_replacement_fixture_requires_two_passing_evaluations():
    first, second = evaluate_twice(rows_for("replacement-needed.json"))
    assert first["decision"] == "keep_current_bin"
    assert second["decision"] == "replacement_recommended"
    assert second["score"] == 95.0


def test_negative_fixtures_never_recommend():
    for name in ("keep-current-bin.json", "temporary-crowd.json", "insufficient-coverage.json"):
        first, second = evaluate_twice(rows_for(name))
        assert first["recommended"] is False
        assert second["recommended"] is False
        if name == "insufficient-coverage.json":
            assert second["decision"] == "insufficient_evidence"


def test_unconfirmed_overflow_does_not_drive_capacity_pressure():
    rows = []
    for minute in range(10):
        rows.append((
            f"2026-08-25T12:{minute:02d}:00+00:00",
            0,
            json.dumps({"bins": [{"state": "overflow", "confirmed": False}], "floorHazards": []}),
        ))
    result = BinReplacementPolicy().evaluate(rows)
    assert result["fullMinutes"] == 0
    assert result["decision"] == "keep_current_bin"


def test_stable_unknown_overrides_raw_full_state():
    rows = []
    for minute in range(10):
        rows.append((
            f"2026-08-25T12:{minute:02d}:00+00:00",
            0,
            json.dumps({"bins": [{"state": "full", "stableState": "unknown"}], "floorHazards": []}),
        ))
    result = BinReplacementPolicy().evaluate(rows)
    assert result["fullMinutes"] == 0
    assert result["coverageReady"] is False
