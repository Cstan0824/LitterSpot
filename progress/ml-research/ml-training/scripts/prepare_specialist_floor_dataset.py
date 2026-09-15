#!/usr/bin/env python3
"""Convert reviewed specialist floor masks into a YOLO segmentation dataset.

The input is the project-owned specialist manifest.  Each floor sample supplies a
camera image and a same-size class-index mask: 0=background, 1=litter, 2=spill.
This tool creates a reproducible, non-destructive dataset for ``train.py``.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image
import yaml


SPLITS = {"train": "train", "valid": "val", "val": "val", "test": "test"}
CLASS_NAMES = {0: "floor_litter", 1: "floor_spill"}


def _read_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("samples"), list):
        raise ValueError("Manifest must be an object containing a samples list.")
    return [row for row in payload["samples"] if row.get("pipeline") == "floor_hazard"]


def _source_path(root: Path, value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Floor sample is missing {field}.")
    candidate = Path(value)
    return candidate if candidate.is_absolute() else root / candidate


def _polygon_lines(mask: np.ndarray, min_area: int) -> list[str]:
    lines: list[str] = []
    for mask_value, class_id in ((1, 0), (2, 1)):
        binary = np.uint8(mask == mask_value)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < min_area:
                continue
            points = contour.reshape(-1, 2)
            if len(points) < 3:
                continue
            height, width = mask.shape
            normalized = [
                coordinate
                for x, y in points
                for coordinate in (min(max(x / width, 0.0), 1.0), min(max(y / height, 0.0), 1.0))
            ]
            lines.append(f"{class_id} " + " ".join(f"{value:.6f}" for value in normalized))
    return lines


def build_dataset(manifest: Path, output: Path, project_root: Path, min_area: int = 16) -> dict[str, Any]:
    """Materialise a YOLO segmentation dataset and return its summary."""
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Refusing to overwrite non-empty output directory: {output}")
    rows = _read_manifest(manifest)
    if not rows:
        raise ValueError("No floor_hazard samples found in the manifest.")

    for split in ("train", "val", "test"):
        (output / "images" / split).mkdir(parents=True, exist_ok=True)
        (output / "labels" / split).mkdir(parents=True, exist_ok=True)

    counts: Counter[str] = Counter()
    class_instances: Counter[str] = Counter()
    audit_rows: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        source_split = str(row.get("split", ""))
        if source_split not in SPLITS:
            raise ValueError(f"Sample {index} has unsupported split {source_split!r}.")
        split = SPLITS[source_split]
        image_path = _source_path(project_root, row.get("image") or row.get("path"), "image/path")
        label = row.get("label")
        if not isinstance(label, dict):
            raise ValueError(f"Sample {index} has no label object.")
        mask_value = label.get("maskPath")
        classes = label.get("classes")
        if not isinstance(classes, list):
            raise ValueError(f"Sample {index} has no label.classes list.")
        mask_path = _source_path(project_root, mask_value, "label.maskPath") if mask_value else None
        if not image_path.is_file() or (mask_path is not None and not mask_path.is_file()):
            raise FileNotFoundError(f"Sample {index} image or mask is missing.")

        with Image.open(image_path) as image:
            image_size = image.size
        if mask_path is None:
            if classes:
                raise ValueError(f"Sample {index} has hazards but no label.maskPath.")
            mask = np.zeros((image_size[1], image_size[0]), dtype=np.uint8)
        else:
            with Image.open(mask_path) as mask_image:
                mask = np.asarray(mask_image.convert("L"))
            if mask.shape != (image_size[1], image_size[0]):
                raise ValueError(f"Sample {index} mask dimensions do not match its image.")
            values = set(np.unique(mask).tolist())
            if not values.issubset({0, 1, 2}):
                raise ValueError(f"Sample {index} mask contains invalid classes: {sorted(values - {0, 1, 2})}")

        # Prefix avoids collisions when separate capture folders reuse a filename.
        stem = f"{index:05d}_{image_path.stem}"
        image_destination = output / "images" / split / f"{stem}{image_path.suffix.lower()}"
        label_destination = output / "labels" / split / f"{stem}.txt"
        shutil.copy2(image_path, image_destination)
        lines = _polygon_lines(mask, min_area)
        label_destination.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        counts[split] += 1
        for line in lines:
            class_instances[CLASS_NAMES[int(line[0])]] += 1
        audit_rows.append({
            "sourceIndex": index, "id": row.get("id"), "split": split,
            "image": str(image_path), "mask": str(mask_path) if mask_path else None,
            "outputImage": str(image_destination.relative_to(output)),
            "outputLabel": str(label_destination.relative_to(output)), "instances": len(lines),
        })

    missing = [split for split in ("train", "val", "test") if not counts[split]]
    if missing:
        raise ValueError(f"Floor dataset needs samples in train, valid/val, and test; missing {', '.join(missing)}.")
    data = {
        "path": str(output.resolve()), "train": "images/train", "val": "images/val", "test": "images/test",
        "names": CLASS_NAMES,
    }
    (output / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    summary = {"manifest": str(manifest.resolve()), "output": str(output.resolve()), "samples": dict(counts),
               "instances": dict(class_instances), "minArea": min_area, "rows": audit_rows}
    (output / "preparation-report.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml-training/data/specialists/manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("dataset/floor_rubbish/prepared_dataset"))
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--min-area", type=int, default=16)
    args = parser.parse_args()
    if args.min_area < 1:
        parser.error("--min-area must be positive")
    summary = build_dataset(args.manifest, args.output, args.project_root, args.min_area)
    print(json.dumps({key: summary[key] for key in ("output", "samples", "instances")}, indent=2))


if __name__ == "__main__":
    main()
