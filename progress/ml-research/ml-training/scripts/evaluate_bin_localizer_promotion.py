"""Combine dataset, generic-test, and locked-video reports into a hard promotion gate."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]


def minimum_gate(value: Any, minimum: float) -> dict[str, Any]:
    passed = isinstance(value, (int, float)) and float(value) >= minimum
    return {"value": value, "minimum": minimum, "passed": passed}


def maximum_gate(value: Any, maximum: float) -> dict[str, Any]:
    passed = isinstance(value, (int, float)) and float(value) <= maximum
    return {"value": value, "maximum": maximum, "passed": passed}


def decide_promotion(dataset: dict[str, Any], generic: dict[str, Any], regression: dict[str, Any]) -> dict[str, Any]:
    generic_metrics = generic.get("metrics", {})
    regression_metrics = regression.get("metrics", {})
    gates = {
        "datasetAudit": {"passed": dataset.get("audit", {}).get("passed") is True},
        "datasetCoverage": {"passed": dataset.get("coverage", {}).get("passed") is True},
        "datasetReadyForTraining": {"passed": dataset.get("readyForTraining") is True},
        "genericPrecision": minimum_gate(generic_metrics.get("precision"), .90),
        "genericRecall": minimum_gate(generic_metrics.get("recall"), .90),
        "genericMap50": minimum_gate(generic_metrics.get("map50"), .90),
        "regressionSuiteCoverage": {
            "passed": regression.get("gates", {}).get("suiteCoverage", {}).get("passed") is True,
        },
        "deploymentFalseBinFrameRate": maximum_gate(regression_metrics.get("falseBinFrameRate"), .01),
        "deploymentPositiveTrackRecall": minimum_gate(regression_metrics.get("positiveTrackRecall"), .90),
        "lockedChairFalseDetections": maximum_gate(regression_metrics.get("chairFalseDetections"), 0),
        "lockedSuitePassed": {"passed": regression.get("passed") is True},
    }
    failed = [name for name, gate in gates.items() if not gate["passed"]]
    return {
        "gates": gates,
        "failedGates": failed,
        "passed": not failed,
        "decision": "promote-to-shadow" if not failed else "blocked",
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_report(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--dataset-report", type=Path, required=True)
    parser.add_argument("--generic-report", type=Path, required=True)
    parser.add_argument("--regression-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checkpoint = args.checkpoint.resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")
    try:
        dataset = load_report(args.dataset_report.resolve())
        generic = load_report(args.generic_report.resolve())
        regression = load_report(args.regression_report.resolve())
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    decision = decide_promotion(dataset, generic, regression)
    report = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "checkpoint": str(checkpoint),
        "checkpointSha256": sha256(checkpoint),
        "inputs": {
            "datasetReport": str(args.dataset_report.resolve()),
            "genericReport": str(args.generic_report.resolve()),
            "regressionReport": str(args.regression_report.resolve()),
        },
        **decision,
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
