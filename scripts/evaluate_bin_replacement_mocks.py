"""Benchmark the short-window placement policy against deterministic timelines."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from app.placement_analysis import BinReplacementPolicy, PlacementDecision  # noqa: E402


def load_rows(path: Path) -> list[tuple[str, int, str]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return [
        (row["createdAt"], int(row["peopleCount"]), json.dumps(row["payload"]))
        for row in document["rows"]
    ]


def main() -> int:
    policy = BinReplacementPolicy()
    fixture_root = ROOT / "mock-data" / "bin-placement-prototype"
    fixtures = sorted(fixture_root.glob("*.json"))
    failures: list[str] = []
    print("scenario                 score  signals  coverage  decision (after 2nd eval)")
    print("-" * 78)
    for fixture in fixtures:
        document = json.loads(fixture.read_text(encoding="utf-8"))
        rows = load_rows(fixture)
        first = policy.evaluate(rows, PlacementDecision(False, None, 0, 0))
        second = policy.evaluate(rows, PlacementDecision(first["recommended"], first["triggerReason"], first["raiseStreak"], first["clearStreak"]))
        if document["scenario"] == "replacement-needed":
            if not (not first["recommended"] and second["recommended"] and second["score"] >= 70 and len(second["highSignals"]) >= 2):
                failures.append(fixture.name)
        elif first["recommended"] or second["recommended"]:
            failures.append(fixture.name)
        print(
            f"{document['scenario']:<24} {second['score']:>5.1f}    "
            f"{len(second['highSignals']):>2}       "
            f"{second['validSamples']}/{second['requiredValidSamples']:<5}   "
            f"{second['decision']}"
        )
        print(f"  signals={json.dumps(second['signals'], sort_keys=True)} reason={second['triggerReason'] or '-'}")
    if failures:
        print(f"FAILED: {', '.join(failures)}")
        return 1
    print("PASS: replacement requires two consecutive passing evaluations; negative mocks stayed below the rule.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
