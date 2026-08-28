"""Propose reviewed per-camera overflow thresholds from labeled validation scores."""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def metrics(rows: list[dict[str, str]], threshold: float) -> dict[str, float | int]:
    positives = [row for row in rows if row["label"] == "overflow"]
    negatives = [row for row in rows if row["label"] != "overflow"]
    true_positive = sum(float(row["overflow_score"]) >= threshold for row in positives)
    false_positive = sum(float(row["overflow_score"]) >= threshold for row in negatives)
    recall = true_positive / len(positives) if positives else 0.0
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    return {
        "threshold": threshold,
        "positiveCount": len(positives),
        "negativeCount": len(negatives),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "recall": recall,
        "precision": precision,
        "falsePositiveRate": false_positive / len(negatives) if negatives else 0.0,
    }


def choose_threshold(rows: list[dict[str, str]], minimum_recall: float) -> dict[str, float | int]:
    candidates = [metrics(rows, step / 1000) for step in range(50, 951, 5)]
    viable = [item for item in candidates if item["recall"] >= minimum_recall]
    if not viable:
        raise ValueError(f"No threshold reaches recall >= {minimum_recall:.2f}")
    return max(viable, key=lambda item: (item["precision"], -item["falsePositiveRate"], item["threshold"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observations", type=Path, required=True, help="CSV using docs/camera-bin-calibration.template.csv")
    parser.add_argument("--minimum-recall", type=float, default=.80)
    parser.add_argument("--output", type=Path, default=ROOT / "runs/camera-bin-calibration/candidate-profiles.json")
    args = parser.parse_args()
    if not 0 < args.minimum_recall <= 1:
        raise ValueError("minimum-recall must be in (0, 1]")

    with args.observations.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    required = {"camera_id", "bin_id", "split", "label", "overflow_score"}
    if not rows or any(not required <= set(row) for row in rows):
        raise ValueError(f"Observations must include {sorted(required)}")
    validation = [row for row in rows if row["split"] == "validation"]
    if len(validation) != len(rows):
        raise ValueError("Calibration accepts validation rows only; reserve test rows for final evaluation")
    if any(row["label"] not in {"normal", "full", "overflow"} for row in validation):
        raise ValueError("label must be normal, full, or overflow")
    if any(not 0 <= float(row["overflow_score"]) <= 1 for row in validation):
        raise ValueError("overflow_score must be in [0, 1]")

    grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in validation:
        grouped[(row["camera_id"], row["bin_id"])].append(row)

    profiles = {}
    report = {}
    for (camera_id, bin_id), group in sorted(grouped.items()):
        selected = choose_threshold(group, args.minimum_recall)
        key = f"{camera_id}:{bin_id}"
        profiles[key] = {"thresholds": {"overflow": selected["threshold"]}}
        report[key] = selected

    payload = {
        "reviewRequired": True,
        "source": str(args.observations.resolve()),
        "minimumRecall": args.minimum_recall,
        "profiles": profiles,
        "validationReport": report,
        "instructions": "Copy reviewed thresholds into config/bin-profiles.json alongside each physical bin regionNormalized ROI.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
