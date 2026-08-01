"""Validate the prepared YOLO segmentation dataset."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from dataset_utils import IMAGE_EXTENSIONS, file_sha256, image_size, prepared_dataset_root, read_csv


def image_for_label(label: Path, split_image_dir: Path) -> Path | None:
    for suffix in IMAGE_EXTENSIONS:
        candidate = split_image_dir / f"{label.stem}{suffix}"
        if candidate.exists():
            return candidate
    return None


def validate_label(label: Path) -> tuple[Counter[int], list[str]]:
    counts: Counter[int] = Counter()
    issues: list[str] = []
    text = label.read_text(encoding="utf-8").strip()
    if not text:
        issues.append(f"empty_label:{label}")
        return counts, issues
    for line_no, line in enumerate(text.splitlines(), 1):
        parts = line.split()
        if len(parts) < 7:
            issues.append(f"too_few_values:{label}:{line_no}")
            continue
        try:
            class_id = int(parts[0])
            coords = [float(part) for part in parts[1:]]
        except ValueError:
            issues.append(f"non_numeric:{label}:{line_no}")
            continue
        if class_id not in {0, 1}:
            issues.append(f"invalid_class:{label}:{line_no}:{class_id}")
        if len(coords) % 2 != 0:
            issues.append(f"odd_coordinate_count:{label}:{line_no}")
        if len(coords) < 6:
            issues.append(f"polygon_too_short:{label}:{line_no}")
        if any(value < 0.0 or value > 1.0 for value in coords):
            issues.append(f"coordinate_out_of_range:{label}:{line_no}")
        counts[class_id] += 1
    return counts, issues


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    args = parser.parse_args()
    prepared = args.prepared
    manifest = read_csv(prepared / "dataset_manifest.csv")

    issues: list[str] = []
    object_counts: Counter[int] = Counter()
    images_by_split: Counter[str] = Counter()
    images_by_source: Counter[str] = Counter()
    split_names: dict[str, set[str]] = defaultdict(set)
    all_output_names: list[str] = []
    image_hashes_by_split: dict[str, dict[str, str]] = defaultdict(dict)

    for split in ("train", "val", "test"):
        image_dir = prepared / "images" / split
        label_dir = prepared / "labels" / split
        images = sorted(path for path in image_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS) if image_dir.exists() else []
        labels = sorted(label_dir.glob("*.txt")) if label_dir.exists() else []
        images_by_split[split] = len(images)
        image_stems = {image.stem for image in images}
        label_stems = {label.stem for label in labels}

        for image in images:
            all_output_names.append(image.name)
            split_names[split].add(image.name)
            if image_size(image) is None:
                issues.append(f"unreadable_image:{image}")
            try:
                image_hashes_by_split[split][image.name] = file_sha256(image)
            except OSError:
                issues.append(f"unhashable_image:{image}")

        for label in labels:
            if label.stem not in image_stems:
                issues.append(f"label_without_image:{label}")
            if image_for_label(label, image_dir) is None:
                issues.append(f"label_missing_matching_image:{label}")
            counts, label_issues = validate_label(label)
            object_counts.update(counts)
            issues.extend(label_issues)

        missing_labels = sorted(image_stems - label_stems)
        for stem in missing_labels:
            issues.append(f"image_without_label:{image_dir / stem}")

    for row in manifest:
        images_by_source[row.get("source", "unknown")] += 1
        prepared_image = Path(row.get("prepared_image", ""))
        prepared_label = Path(row.get("prepared_label", ""))
        if row.get("prepared_image") and not prepared_image.exists():
            issues.append(f"manifest_image_missing:{prepared_image}")
        if row.get("prepared_label") and not prepared_label.exists():
            issues.append(f"manifest_label_missing:{prepared_label}")

    duplicate_names = [name for name, count in Counter(all_output_names).items() if count > 1]
    for name in duplicate_names:
        issues.append(f"duplicate_output_filename:{name}")

    for left in ("train", "val", "test"):
        for right in ("train", "val", "test"):
            if left >= right:
                continue
            overlap = split_names[left] & split_names[right]
            if overlap:
                issues.append(f"split_filename_overlap:{left}:{right}:{sorted(overlap)[:10]}")

    external_manifest = read_csv(prepared / "external_test" / "hd10k" / "manifest.csv")
    external_sources = {row.get("source_image", "") for row in external_manifest if row.get("source_image")}
    prepared_sources = {row.get("source_image", "") for row in manifest if row.get("source") == "hd10k"}
    leaked_sources = sorted(external_sources & prepared_sources)
    for source in leaked_sources[:50]:
        issues.append(f"external_test_leak:{source}")

    skipped_files = []
    for skipped_path in (
        prepared / "intermediate" / "taco" / "skipped.csv",
        prepared / "intermediate" / "hd10k" / "skipped.csv",
        prepared / "intermediate" / "uavvaste" / "skipped.csv",
    ):
        skipped_files.extend(read_csv(skipped_path))

    critical = [issue for issue in issues if not issue.startswith("image_without_label:")]
    passed = len(critical) == 0
    lines = [
        "# Validation Report",
        "",
        f"Final result: {'PASS' if passed else 'FAIL'}",
        "",
        "## Total Images by Split",
        "",
        *[f"- {split}: {images_by_split.get(split, 0)}" for split in ("train", "val", "test")],
        "",
        "## Total Objects by Class",
        "",
        f"- 0 floor_litter: {object_counts.get(0, 0)}",
        f"- 1 floor_spill: {object_counts.get(1, 0)}",
        "",
        "## Images per Source Dataset",
        "",
        *[f"- {source}: {count}" for source, count in sorted(images_by_source.items())],
        "",
        "## Missing Image/Label Pairs",
        "",
        *[f"- {issue}" for issue in issues if "without_" in issue or "missing_matching" in issue or "manifest_" in issue],
        "",
        "## Invalid Annotations",
        "",
        *[f"- {issue}" for issue in issues if any(key in issue for key in ("invalid_", "non_numeric", "coordinate_", "polygon_", "too_few", "odd_"))],
        "",
        "## Skipped Files",
        "",
        f"Skipped records: {len(skipped_files)}",
        *[f"- {row.get('type', '')}: {row.get('source', '')} {row.get('detail', '')}" for row in skipped_files[:100]],
        "",
        "## Class Balance",
        "",
        f"- floor_litter objects: {object_counts.get(0, 0)}",
        f"- floor_spill objects: {object_counts.get(1, 0)}",
        "",
        "## Other Issues",
        "",
        *[f"- {issue}" for issue in issues if issue not in critical[:0] and not any(key in issue for key in ("without_", "missing_matching", "manifest_", "invalid_", "non_numeric", "coordinate_", "polygon_", "too_few", "odd_"))],
    ]
    report_path = prepared / "reports" / "validation_report.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Validation result: {'PASS' if passed else 'FAIL'}")
    print(f"Critical issues: {len(critical)}")
    print(f"Wrote {report_path}")
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
