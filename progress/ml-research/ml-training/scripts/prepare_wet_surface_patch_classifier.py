#!/usr/bin/env python3
"""Build capture-group-isolated wet/dry crops from the public wet-floor source.

This changes the learning task from recovering thousands of fragmented puddle
boxes to classifying a change proposal as wet or dry.  It is an architecture
prototype for a fixed-camera proposal/classifier pipeline.  Every output row
remains public, surrogate evidence and is never qualification eligible.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "dataset/floor_spill/wet_surface_v4"
DEFAULT_OUTPUT = ROOT / "dataset/floor_spill/wet_surface_patches_v1"


def _boxes(label: Path, width: int, height: int) -> list[tuple[float, float, float, float]]:
    result = []
    for line_number, line in enumerate(label.read_text(encoding="utf-8-sig").splitlines(), start=1):
        values = line.split()
        if len(values) != 5:
            raise ValueError(f"{label}:{line_number}: expected five YOLO columns")
        _class_id, x, y, box_width, box_height = values
        x, y, box_width, box_height = map(float, (x, y, box_width, box_height))
        result.append((
            (x - box_width / 2) * width,
            (y - box_height / 2) * height,
            (x + box_width / 2) * width,
            (y + box_height / 2) * height,
        ))
    return result


def _square(box: tuple[float, float, float, float], width: int, height: int, context: float = .35) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    size = max(24.0, x2 - x1, y2 - y1) * (1 + 2 * context)
    size = min(size, width, height)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    left = min(max(0.0, cx - size / 2), width - size)
    top = min(max(0.0, cy - size / 2), height - size)
    return round(left), round(top), round(left + size), round(top + size)


def _intersection_over_crop(
    crop: tuple[int, int, int, int],
    boxes: list[tuple[float, float, float, float]],
) -> float:
    x1, y1, x2, y2 = crop
    crop_area = max(1, (x2 - x1) * (y2 - y1))
    overlap = 0.0
    for bx1, by1, bx2, by2 in boxes:
        overlap += max(0.0, min(x2, bx2) - max(x1, bx1)) * max(0.0, min(y2, by2) - max(y1, by1))
    return overlap / crop_area


def _negative_crop(
    width: int,
    height: int,
    boxes: list[tuple[float, float, float, float]],
    size: int,
) -> tuple[int, int, int, int] | None:
    size = max(32, min(size, width, height))
    candidates = []
    for y_fraction in (.75, .5, .9, .25):
        for x_fraction in (.5, .25, .75, .1, .9):
            cx, cy = width * x_fraction, height * y_fraction
            left = round(min(max(0, cx - size / 2), width - size))
            top = round(min(max(0, cy - size / 2), height - size))
            crop = (left, top, left + size, top + size)
            candidates.append((_intersection_over_crop(crop, boxes), crop))
    overlap, crop = min(candidates, key=lambda item: item[0])
    return crop if overlap <= .01 else None


def _save_crop(image: Image.Image, crop: tuple[int, int, int, int], destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.crop(crop).convert("RGB").save(destination, quality=92)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def prepare(source: Path = DEFAULT_SOURCE, output: Path = DEFAULT_OUTPUT, positives_per_image: int = 2) -> dict[str, Any]:
    source, output = source.resolve(), output.resolve()
    manifest_path = source / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(manifest_path)
    if output.exists() and any(output.rglob("*")):
        raise FileExistsError(f"output is not empty; choose a new immutable version: {output}")
    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = []
    counts: Counter[str] = Counter()
    capture_groups: dict[str, set[str]] = {"train": set(), "val": set(), "test": set()}
    for sample in source_manifest.get("samples", []):
        split = str(sample["split"])
        if split not in capture_groups:
            raise ValueError(f"unsupported split {split!r}")
        image_path = Path(sample["preparedImage"])
        label_path = Path(sample["preparedLabel"])
        with Image.open(image_path) as opened:
            image = opened.convert("RGB")
        boxes = _boxes(label_path, image.width, image.height)
        if not boxes:
            continue
        sample_id = str(sample["sampleId"])
        group = str(sample["captureGroup"])
        capture_groups[split].add(group)
        ranked = sorted(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
        selected = ranked[:max(1, positives_per_image)]
        crops: list[tuple[str, tuple[int, int, int, int], str]] = []
        for index, box in enumerate(selected):
            crops.append(("wet", _square(box, image.width, image.height), f"wet-{index}"))
        positive_sizes = [crop[2] - crop[0] for _, crop, _ in crops]
        negative = _negative_crop(image.width, image.height, boxes, round(sum(positive_sizes) / len(positive_sizes)))
        if negative is not None:
            crops.append(("dry", negative, "dry-0"))
        for class_name, crop, suffix in crops:
            stable = hashlib.sha256(f"{sample_id}:{suffix}".encode()).hexdigest()[:16]
            destination = output / split / class_name / f"{stable}.jpg"
            digest = _save_crop(image, crop, destination)
            rows.append({
                "sampleId": f"{sample_id}-{suffix}",
                "parentSampleId": sample_id,
                "captureGroup": group,
                "split": split,
                "className": class_name,
                "crop": list(crop),
                "image": str(destination),
                "sha256": digest,
                "evidenceTier": "public",
                "qualificationEligible": False,
            })
            counts[f"{split}:{class_name}"] += 1
    for left_index, left in enumerate(capture_groups.values()):
        for right in list(capture_groups.values())[left_index + 1:]:
            if left & right:
                raise AssertionError("capture group leakage in public patch dataset")
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "output": str(output),
        "classes": ["dry", "wet"],
        "sampleCounts": dict(sorted(counts.items())),
        "captureGroupCounts": {key: len(value) for key, value in capture_groups.items()},
        "samples": rows,
        "evidenceTier": "public",
        "qualificationEligible": False,
        "intendedUse": "fixed_camera_change_proposal_classifier_prototype",
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--positives-per-image", type=int, default=2)
    args = parser.parse_args()
    report = prepare(args.source, args.output, args.positives_per_image)
    print(json.dumps({key: value for key, value in report.items() if key != "samples"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
