"""Audit reviewed full-frame positives and hard negatives for bin-localizer training."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path


REQUIRED_FIELDS = (
    "image", "source_id", "camera_id", "split", "has_bin", "label",
    "bin_style", "state", "view_angle", "lighting", "occlusion",
    "negative_category", "review_status", "notes",
)
VALID_SPLITS = {"train", "valid", "test"}


def validate_yolo_label(label: Path, row_number: int) -> list[str]:
    errors: list[str] = []
    for line_number, line in enumerate(label.read_text(encoding="utf-8").splitlines(), start=1):
        values = line.split()
        prefix = f"row {row_number}: label line {line_number}"
        if len(values) != 5:
            errors.append(f"{prefix}: expected class_id x_center y_center width height")
            continue
        if values[0] != "0":
            errors.append(f"{prefix}: class id must be 0")
        try:
            x_center, y_center, width, height = (float(value) for value in values[1:])
        except ValueError:
            errors.append(f"{prefix}: box coordinates must be numeric")
            continue
        if not all(math.isfinite(value) for value in (x_center, y_center, width, height)):
            errors.append(f"{prefix}: box coordinates must be finite")
            continue
        if width <= 0 or height <= 0:
            errors.append(f"{prefix}: box width and height must be positive")
            continue
        if not (
            0 <= x_center - width / 2
            and x_center + width / 2 <= 1
            and 0 <= y_center - height / 2
            and y_center + height / 2 <= 1
        ):
            errors.append(f"{prefix}: box extends outside normalized image bounds")
    return errors


def audit(manifest: Path, root: Path) -> dict[str, object]:
    with manifest.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = tuple(reader.fieldnames or ())
        missing = [field for field in REQUIRED_FIELDS if field not in fields]
        if missing:
            raise ValueError("Manifest is missing columns: " + ", ".join(missing))
        rows = list(reader)

    errors: list[str] = []
    source_splits: dict[str, set[str]] = defaultdict(set)
    camera_splits: dict[str, set[str]] = defaultdict(set)
    content_splits: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    split_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"positive": 0, "negative": 0})
    negative_categories: dict[str, int] = defaultdict(int)
    for index, row in enumerate(rows, start=2):
        split = row["split"].strip()
        has_bin = row["has_bin"].strip().lower()
        image = root / row["image"].strip()
        label_name = row["label"].strip()
        label = root / label_name if label_name else None
        source_id = row["source_id"].strip()
        camera_id = row["camera_id"].strip()
        if split not in VALID_SPLITS:
            errors.append(f"row {index}: split must be one of {sorted(VALID_SPLITS)}")
        if has_bin not in {"true", "false"}:
            errors.append(f"row {index}: has_bin must be true or false")
            continue
        if not source_id:
            errors.append(f"row {index}: source_id is required")
        else:
            source_splits[source_id].add(split)
        if camera_id:
            camera_splits[camera_id].add(split)
        if not image.is_file():
            errors.append(f"row {index}: image does not exist: {row['image']}")
        else:
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            content_splits[digest][split].append(row["image"].strip())
        if row["review_status"].strip().lower() != "reviewed":
            errors.append(f"row {index}: only reviewed samples may enter the dataset")
        if has_bin == "true":
            split_counts[split]["positive"] += 1
            if label is None or not label.is_file() or not label.read_text(encoding="utf-8").strip():
                errors.append(f"row {index}: positive sample needs a non-empty YOLO label file")
            else:
                errors.extend(validate_yolo_label(label, index))
        else:
            split_counts[split]["negative"] += 1
            if label is not None and label.is_file() and label.read_text(encoding="utf-8").strip():
                errors.append(f"row {index}: negative sample label must be empty")
            category = row["negative_category"].strip()
            if not category:
                errors.append(f"row {index}: negative sample needs negative_category")
            else:
                negative_categories[category] += 1
    for source_id, splits in source_splits.items():
        if len(splits) > 1:
            errors.append(f"source {source_id!r} appears across splits: {sorted(splits)}")
    for camera_id, splits in camera_splits.items():
        if len(splits) > 1:
            errors.append(f"camera {camera_id!r} appears across splits: {sorted(splits)}")
    for digest, split_paths in content_splits.items():
        if len(split_paths) > 1:
            paths = [path for split in sorted(split_paths) for path in split_paths[split]]
            errors.append(
                f"duplicate image content {digest[:12]} appears across splits: {paths}"
            )
    return {
        "manifest": str(manifest),
        "root": str(root),
        "rows": len(rows),
        "splitCounts": split_counts,
        "negativeCategories": negative_categories,
        "errors": errors,
        "passed": not errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = args.manifest.resolve()
    if not manifest.is_file():
        raise SystemExit(f"Manifest not found: {manifest}")
    report = audit(manifest, (args.root or manifest.parent).resolve())
    rendered = json.dumps(report, indent=2, default=dict)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    if not report["passed"]:
        raise SystemExit("CCTV localizer data audit failed")


if __name__ == "__main__":
    main()
