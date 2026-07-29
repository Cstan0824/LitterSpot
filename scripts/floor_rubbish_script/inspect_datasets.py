"""Inspect raw TACO and HD10K/IROS2022 datasets without modifying them."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from dataset_utils import (
    collect_hd10k_pairs,
    default_search_roots,
    find_hd10k_roots,
    find_taco_jsons,
    image_size,
    inspect_mask_values,
    parse_roots,
    prepared_dataset_root,
    project_root,
    read_json,
    resolve_coco_image_path,
)


def inspect_taco(roots: list[Path]) -> tuple[list[str], list[dict[str, object]]]:
    lines = ["## TACO", ""]
    entries: list[dict[str, object]] = []
    jsons = find_taco_jsons(roots)
    if not jsons:
        lines.extend(["No TACO COCO annotation JSON files were found.", ""])
        return lines, entries

    lines.append(f"Detected COCO JSON files: {len(jsons)}")
    for json_path in jsons:
        data = read_json(json_path) or {}
        images = data.get("images", [])
        annotations = data.get("annotations", [])
        categories = data.get("categories", [])
        category_names = [category.get("name", str(category.get("id"))) for category in categories]
        polygon_annotations = 0
        invalid_or_missing_images = []
        image_dirs = Counter()

        for image_info in images:
            file_name = str(image_info.get("file_name", ""))
            image_path = resolve_coco_image_path(json_path, file_name)
            if image_path is None:
                invalid_or_missing_images.append(file_name)
            else:
                image_dirs[str(image_path.parent)] += 1

        for annotation in annotations:
            segmentation = annotation.get("segmentation")
            if isinstance(segmentation, list) and any(isinstance(poly, list) and len(poly) >= 6 for poly in segmentation):
                polygon_annotations += 1

        entries.append(
            {
                "json_path": str(json_path),
                "images": len(images),
                "annotations": len(annotations),
                "categories": category_names,
                "polygon_annotations": polygon_annotations,
                "missing_images": len(invalid_or_missing_images),
            }
        )
        lines.extend(
            [
                f"### {json_path}",
                "",
                f"- Annotation format: COCO instance segmentation JSON",
                f"- Images: {len(images)}",
                f"- Annotations: {len(annotations)}",
                f"- Categories ({len(category_names)}): {', '.join(category_names)}",
                f"- Polygon segmentation annotations: {polygon_annotations}",
                f"- Missing/unmatched image references: {len(invalid_or_missing_images)}",
                "- Image directories:",
            ]
        )
        lines.extend([f"  - {directory}: {count}" for directory, count in image_dirs.most_common()])
        if invalid_or_missing_images:
            lines.append("- First missing image references:")
            lines.extend([f"  - {name}" for name in invalid_or_missing_images[:25]])
        lines.append("")
    return lines, entries


def inspect_hd10k(roots: list[Path]) -> tuple[list[str], list[dict[str, object]]]:
    lines = ["## HD10K / IROS2022 Active Cleaning", ""]
    entries: list[dict[str, object]] = []
    hd_roots = find_hd10k_roots(roots)
    if not hd_roots:
        lines.extend(["No HD10K/IROS2022 dataset folders were found.", ""])
        return lines, entries

    for root in hd_roots:
        train_pairs, train_issues = collect_hd10k_pairs(root, "train")
        test_pairs, test_issues = collect_hd10k_pairs(root, "test")
        train_scenes = sorted({str(pair["scene"]) for pair in train_pairs})
        test_scenes = sorted({str(pair["scene"]) for pair in test_pairs})
        mask_samples = []
        for pair in (train_pairs + test_pairs)[:10]:
            mask_samples.append({"mask": str(pair["mask"]), "values": inspect_mask_values(pair["mask"])})
        image_mask_matches = sum(1 for pair in train_pairs + test_pairs if Path(pair["image"]).stem == Path(pair["mask"]).stem)
        total_pairs = len(train_pairs) + len(test_pairs)

        entries.append(
            {
                "root": str(root),
                "train_pairs": len(train_pairs),
                "test_pairs": len(test_pairs),
                "train_scenes": train_scenes,
                "test_scenes": test_scenes,
                "issues": len(train_issues) + len(test_issues),
            }
        )
        lines.extend(
            [
                f"### {root}",
                "",
                f"- Annotation format: liquid/stain masks; solid-rubbish bounding boxes are present but skipped.",
                f"- Training liquid image/mask pairs: {len(train_pairs)}",
                f"- Official test liquid image/mask pairs: {len(test_pairs)}",
                f"- Training scenes: {', '.join(train_scenes) if train_scenes else 'none'}",
                f"- Official test scenes: {', '.join(test_scenes) if test_scenes else 'none'}",
                f"- Image and mask stem matches: {image_mask_matches}/{total_pairs}",
                "- Mask foreground assumption: any non-zero grayscale value or non-black color pixel is treated as spill foreground.",
                "- Sample mask values:",
            ]
        )
        for sample in mask_samples:
            lines.append(f"  - {sample['mask']}: {sample['values']}")
        issues = train_issues + test_issues
        lines.append(f"- Missing/unmatched files: {len(issues)}")
        for issue in issues[:50]:
            lines.append(f"  - {issue['type']}: {issue['path']} ({issue['detail']})")
        lines.append("")
    return lines, entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--search-root", action="append", help="Root to search. Can be repeated.")
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    args = parser.parse_args()

    roots = parse_roots(args.search_root)
    report_lines = [
        "# Dataset Inspection Report",
        "",
        "## Search Roots",
        "",
        *[f"- {root}" for root in roots],
        "",
        "## Assumptions",
        "",
        "- Raw dataset folders are treated as read-only.",
        "- Generated outputs are written only inside the project workspace.",
        "- TACO COCO polygon segmentations map to class 0 `floor_litter`.",
        "- HD10K liquid/stain masks map to class 1 `floor_spill`; HD10K solid bounding boxes are skipped.",
        "",
    ]

    taco_lines, _ = inspect_taco(roots)
    hd_lines, _ = inspect_hd10k(roots)
    report_lines.extend(taco_lines)
    report_lines.extend(hd_lines)

    root_report = project_root() / "ml-training" / "floor_rubbish" / "dataset_inspection_report.md"
    reports_dir = args.prepared / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    root_report.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    (reports_dir / "dataset_inspection_report.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    print(f"Wrote {root_report}")
    print(f"Wrote {reports_dir / 'dataset_inspection_report.md'}")


if __name__ == "__main__":
    main()
