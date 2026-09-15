"""Audit label balance and required field diversity before a state-model release."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_FIELDS = ("image", "split", "state", "bin_style", "view_angle", "lighting", "scene_type")
STATES = {"normal", "full", "overflow"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/cctv-labelled/manifest.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/data-audits/bin-state-data-audit.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.manifest.is_file():
        raise SystemExit("Missing label manifest. Create a CSV with: " + ", ".join(REQUIRED_FIELDS) + ", and optional bin_id, notes.")
    with args.manifest.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or set(REQUIRED_FIELDS) - set(reader.fieldnames):
            raise SystemExit("Manifest is missing required columns: " + ", ".join(REQUIRED_FIELDS))
        rows = list(reader)
    invalid = [row["image"] for row in rows if row["state"] not in STATES or not all(row[field].strip() for field in REQUIRED_FIELDS)]
    coverage: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        coverage["state"][row["state"]] += 1
        for field in ("bin_style", "view_angle", "lighting", "scene_type"):
            coverage[field][row[field]] += 1
    report = {"rows": len(rows), "invalidRows": invalid, "coverage": {field: dict(counts) for field, counts in coverage.items()}, "releaseReady": not invalid and all(coverage["state"][state] >= 100 for state in STATES)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if invalid:
        raise SystemExit("Fix invalid manifest rows before training")


if __name__ == "__main__":
    main()
