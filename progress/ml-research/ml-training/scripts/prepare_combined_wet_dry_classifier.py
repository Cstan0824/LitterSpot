#!/usr/bin/env python3
"""Combine verified Figshare dry/wet labels with Mendeley wet crops.

The Figshare author split is preserved: ``withlight/train`` supplies training,
``nolight/train`` supplies lighting-shift validation, and both source ``val``
folders supply the untouched public test.  No pseudo-dry crop is retained.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIGSHARE = ROOT / "ml-training/data/specialists/source-cache/figshare-road-surface-v1/dataset"
DEFAULT_MENDELEY = ROOT / "dataset/floor_spill/wet_surface_patches_v1"
DEFAULT_OUTPUT = ROOT / "dataset/floor_spill/wet_dry_combined_v1"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _selection(paths: list[Path], maximum: int) -> list[Path]:
    ranked = sorted(paths, key=lambda path: hashlib.sha256(str(path).encode("utf-8")).hexdigest())
    return ranked[:maximum]


def _materialize(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def _figshare_rows(source: Path, maximum: int) -> list[dict[str, Any]]:
    rows = []
    mappings = [
        ("train", "withlight/withlight/train"),
        ("val", "nolight/nolight/train"),
        ("test", "withlight/withlight/val"),
        ("test", "nolight/nolight/val"),
    ]
    for split, relative in mappings:
        split_root = source / relative
        if not split_root.is_dir():
            raise FileNotFoundError(split_root)
        for class_name in ("dry", "wet"):
            candidates = [
                path for path in split_root.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
                and f"_{class_name}_" in path.parent.name.lower()
            ]
            for path in _selection(candidates, maximum):
                rows.append({
                    "source": path,
                    "sourceDataset": "figshare-road-surface-v1",
                    "split": split,
                    "className": class_name,
                    "captureGroup": f"figshare:{relative}:{path.stem[:3]}",
                })
    return rows


def _mendeley_rows(source: Path, maximum: int) -> list[dict[str, Any]]:
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    result = []
    for split in ("train", "val", "test"):
        candidates = [row for row in manifest["samples"] if row["split"] == split and row["className"] == "wet"]
        ranked = sorted(candidates, key=lambda row: hashlib.sha256(row["sampleId"].encode()).hexdigest())[:maximum]
        for row in ranked:
            result.append({
                "source": Path(row["image"]),
                "sourceDataset": "mendeley-wet-surface-v4",
                "split": split,
                "className": "wet",
                "captureGroup": f"mendeley:{row['captureGroup']}",
            })
    return result


def prepare(
    figshare: Path = DEFAULT_FIGSHARE,
    mendeley: Path = DEFAULT_MENDELEY,
    output: Path = DEFAULT_OUTPUT,
    figshare_per_class: int = 2_000,
    mendeley_wet_per_split: int = 1_000,
) -> dict[str, Any]:
    figshare, mendeley, output = figshare.resolve(), mendeley.resolve(), output.resolve()
    if output.exists() and any(output.rglob("*")):
        raise FileExistsError(f"output is not empty; choose a new immutable version: {output}")
    candidates = _figshare_rows(figshare, figshare_per_class) + _mendeley_rows(mendeley, mendeley_wet_per_split)
    counts: Counter[str] = Counter()
    rows = []
    for index, item in enumerate(candidates):
        source = item.pop("source")
        stable = hashlib.sha256(f"{item['sourceDataset']}:{source}".encode()).hexdigest()[:20]
        destination = output / item["split"] / item["className"] / f"{stable}{source.suffix.lower()}"
        _materialize(source, destination)
        rows.append({
            "sampleId": stable,
            **item,
            "sourcePath": str(source),
            "image": str(destination),
            "evidenceTier": "public",
            "qualificationEligible": False,
        })
        counts[f"{item['split']}:{item['className']}"] += 1
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "output": str(output),
        "sampleCounts": dict(sorted(counts.items())),
        "samples": rows,
        "evidenceTier": "public",
        "qualificationEligible": False,
        "pseudoDryRowsIncluded": False,
        "splitPolicy": {
            "train": "figshare withlight/train plus Mendeley train wet crops",
            "val": "figshare nolight/train plus Mendeley val wet crops",
            "test": "Figshare source val plus Mendeley test wet crops",
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--figshare", type=Path, default=DEFAULT_FIGSHARE)
    parser.add_argument("--mendeley", type=Path, default=DEFAULT_MENDELEY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--figshare-per-class", type=int, default=2_000)
    parser.add_argument("--mendeley-wet-per-split", type=int, default=1_000)
    args = parser.parse_args()
    report = prepare(args.figshare, args.mendeley, args.output, args.figshare_per_class, args.mendeley_wet_per_split)
    print(json.dumps({key: value for key, value in report.items() if key != "samples"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
