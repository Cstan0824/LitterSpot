"""Prepare the CC BY wet-surface source as a leakage-resistant YOLO dataset.

The two source classes are preserved. This dataset may pretrain a spill
proposal model, but its rows are always tagged ``public`` and cannot satisfy
real-camera qualification gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "ml-training/data/specialists/source-cache/mendeley-wet-surface-v4/dataset"
DEFAULT_OUTPUT = ROOT / "dataset/floor_spill/wet_surface_v4"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
NUMBER_RE = re.compile(r"(\d+)(?!.*\d)")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _capture_group(source: Path, image: Path) -> str:
    relative_parent = image.parent.relative_to(source).as_posix().lower()
    match = NUMBER_RE.search(image.stem)
    frame_number = int(match.group(1)) if match else 0
    # Contiguous filenames are likely adjacent captures. Keep blocks together.
    return f"{relative_parent}:block-{frame_number // 25:04d}"


def _split(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def _labels(path: Path) -> tuple[list[str], Counter[int]]:
    normalized: list[str] = []
    counts: Counter[int] = Counter()
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        values = line.split()
        if len(values) != 5:
            raise ValueError(f"{path}:{line_number}: expected five YOLO columns")
        class_id = int(values[0])
        coordinates = [float(value) for value in values[1:]]
        if class_id not in {0, 1} or any(not 0 <= value <= 1 for value in coordinates):
            raise ValueError(f"{path}:{line_number}: invalid class or normalized coordinates")
        normalized.append(f"{class_id} " + " ".join(f"{value:.8f}" for value in coordinates))
        counts[class_id] += 1
    return normalized, counts


def prepare(source: Path = DEFAULT_SOURCE, output: Path = DEFAULT_OUTPUT) -> dict[str, Any]:
    source = source.resolve()
    output = output.resolve()
    if not source.is_dir():
        raise FileNotFoundError(source)
    images = sorted(
        path for path in source.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_SUFFIXES
        and "raw data" not in {part.lower() for part in path.parts}
        and path.with_suffix(".txt").is_file()
    )
    if not images:
        raise ValueError("no paired wet-surface images were found")
    if output.exists() and any(output.rglob("*")):
        raise FileExistsError(f"output is not empty; choose a new immutable version: {output}")

    rows: list[dict[str, Any]] = []
    split_counts: Counter[str] = Counter()
    split_groups: defaultdict[str, set[str]] = defaultdict(set)
    class_counts: Counter[int] = Counter()
    for index, image in enumerate(images):
        label = image.with_suffix(".txt")
        group = _capture_group(source, image)
        split = _split(group)
        relative = image.relative_to(source).as_posix()
        stable_id = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:16]
        name = f"{index:05d}-{stable_id}{image.suffix.lower()}"
        destination_image = output / "images" / split / name
        destination_label = output / "labels" / split / f"{Path(name).stem}.txt"
        destination_image.parent.mkdir(parents=True, exist_ok=True)
        destination_label.parent.mkdir(parents=True, exist_ok=True)
        labels, counts = _labels(label)
        shutil.copy2(image, destination_image)
        destination_label.write_text("\n".join(labels) + ("\n" if labels else ""), encoding="utf-8")
        split_counts[split] += 1
        split_groups[split].add(group)
        class_counts.update(counts)
        rows.append({
            "sampleId": f"mendeley-wet-surface-v4-{stable_id}",
            "sourcePath": str(image),
            "sourceSha256": _sha256(image),
            "sourceLabelPath": str(label),
            "sourceLabelSha256": _sha256(label),
            "captureGroup": group,
            "split": split,
            "preparedImage": str(destination_image),
            "preparedLabel": str(destination_label),
            "classInstances": {str(key): value for key, value in sorted(counts.items())},
            "evidenceTier": "public",
            "qualificationEligible": False,
        })

    group_sets = list(split_groups.values())
    for index, left in enumerate(group_sets):
        for right in group_sets[index + 1:]:
            if left & right:
                raise AssertionError("capture group leakage across prepared splits")
    data_yaml = {
        "path": str(output),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {0: "water", 1: "wet_surface"},
    }
    (output / "data.yaml").write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "samples": rows}, indent=2) + "\n", encoding="utf-8")
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "output": str(output),
        "sampleCount": len(rows),
        "splitCounts": dict(sorted(split_counts.items())),
        "captureGroupCounts": {split: len(groups) for split, groups in sorted(split_groups.items())},
        "classInstanceCounts": {str(key): value for key, value in sorted(class_counts.items())},
        "qualificationEligible": False,
        "intendedUse": "possible_spill_pretraining_and_public_diagnostic",
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
