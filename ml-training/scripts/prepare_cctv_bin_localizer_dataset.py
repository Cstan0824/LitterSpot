"""Merge generic bin data with reviewed deployment frames for localizer training."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any

from PIL import Image, ImageDraw

from audit_cctv_bin_localizer_data import audit


ROOT = Path(__file__).resolve().parents[2]
SPLITS = ("train", "valid", "test")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def materialize(source: Path, destination: Path, mode: str) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if mode in {"auto", "hardlink"}:
        try:
            os.link(source, destination)
            return "hardlink"
        except OSError:
            if mode == "hardlink":
                raise
    shutil.copy2(source, destination)
    return "copy"


def ensure_empty(destination: Path) -> None:
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"Destination must be empty: {destination}")


def safe_stem(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return clean[:48] or "sample"


def copy_generic(generic: Path, destination: Path, image_mode: str) -> dict[str, Any]:
    split_counts: dict[str, dict[str, int]] = {}
    materialization: Counter[str] = Counter()
    for split in SPLITS:
        image_dir = generic / split / "images"
        label_dir = generic / split / "labels"
        if not image_dir.is_dir() or not label_dir.is_dir():
            raise FileNotFoundError(f"Missing generic {split} images or labels under {generic}")
        images = positives = negatives = objects = 0
        for image in sorted(path for path in image_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES):
            label = label_dir / f"{image.stem}.txt"
            label_text = label.read_text(encoding="utf-8") if label.is_file() else ""
            target_stem = f"generic_{safe_stem(image.stem)}"
            target_image = destination / split / "images" / f"{target_stem}{image.suffix.lower()}"
            target_label = destination / split / "labels" / f"{target_stem}.txt"
            materialization[materialize(image, target_image, image_mode)] += 1
            target_label.parent.mkdir(parents=True, exist_ok=True)
            target_label.write_text(label_text, encoding="utf-8")
            object_count = sum(bool(line.strip()) for line in label_text.splitlines())
            images += 1
            objects += object_count
            positives += int(object_count > 0)
            negatives += int(object_count == 0)
        split_counts[split] = {
            "images": images,
            "positiveImages": positives,
            "negativeImages": negatives,
            "objects": objects,
        }
    return {"splits": split_counts, "imageMaterialization": dict(materialization)}


def copy_reviewed(
    manifest: Path,
    root: Path,
    destination: Path,
    image_mode: str,
) -> dict[str, Any]:
    with manifest.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    split_counts = {split: {"images": 0, "positiveImages": 0, "negativeImages": 0, "objects": 0} for split in SPLITS}
    categories: Counter[str] = Counter()
    materialization: Counter[str] = Counter()
    for row_number, row in enumerate(rows, start=2):
        split = row["split"].strip()
        image = root / row["image"].strip()
        digest = hashlib.sha256(f"{row_number}:{row['source_id']}:{row['image']}".encode()).hexdigest()[:10]
        target_stem = f"cctv_{safe_stem(row['source_id'])}_{safe_stem(image.stem)}_{digest}"
        target_image = destination / split / "images" / f"{target_stem}{image.suffix.lower()}"
        target_label = destination / split / "labels" / f"{target_stem}.txt"
        materialization[materialize(image, target_image, image_mode)] += 1
        label_name = row["label"].strip()
        label_text = (root / label_name).read_text(encoding="utf-8") if label_name else ""
        target_label.parent.mkdir(parents=True, exist_ok=True)
        target_label.write_text(label_text, encoding="utf-8")
        object_count = sum(bool(line.strip()) for line in label_text.splitlines())
        has_bin = row["has_bin"].strip().lower() == "true"
        split_counts[split]["images"] += 1
        split_counts[split]["positiveImages" if has_bin else "negativeImages"] += 1
        split_counts[split]["objects"] += object_count
        if not has_bin:
            categories[row["negative_category"].strip()] += 1
    return {
        "splits": split_counts,
        "negativeCategories": dict(categories),
        "imageMaterialization": dict(materialization),
    }


def combined_counts(*sources: dict[str, Any]) -> dict[str, int]:
    return {
        key: sum(source["splits"][split][key] for source in sources for split in SPLITS)
        for key in ("images", "positiveImages", "negativeImages", "objects")
    }


def render_contact_sheets(destination: Path, page_size: int = 100) -> dict[str, Any]:
    review_dir = destination / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    index: dict[str, Any] = {"selection": "all reviewed CCTV frames plus deterministic 10% generic sample", "splits": {}}
    tile_width, tile_height, header_height, columns = 256, 216, 24, 5
    for split in SPLITS:
        images_dir = destination / split / "images"
        all_images = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)
        cctv_images = [path for path in all_images if path.stem.startswith("cctv_")]
        generic_images = [path for path in all_images if path.stem.startswith("generic_")]
        selected = cctv_images + generic_images[::10]
        pages: list[dict[str, Any]] = []
        for page_index, offset in enumerate(range(0, len(selected), page_size)):
            page_images = selected[offset:offset + page_size]
            rows = (len(page_images) + columns - 1) // columns
            sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "#1f2328")
            draw = ImageDraw.Draw(sheet)
            page_rows: list[dict[str, Any]] = []
            for tile_index, image_path in enumerate(page_images):
                column, row = tile_index % columns, tile_index // columns
                tile_x, tile_y = column * tile_width, row * tile_height
                with Image.open(image_path) as opened:
                    rendered = opened.convert("RGB").resize((tile_width, tile_height - header_height))
                sheet.paste(rendered, (tile_x, tile_y + header_height))
                label_path = destination / split / "labels" / f"{image_path.stem}.txt"
                label_lines = [line for line in label_path.read_text(encoding="utf-8").splitlines() if line.strip()]
                draw.rectangle((tile_x, tile_y, tile_x + tile_width - 1, tile_y + header_height - 1), fill="#111827")
                draw.text(
                    (tile_x + 5, tile_y + 5),
                    f"{image_path.name[:24]}  {'NEG' if not label_lines else f'POS {len(label_lines)}'}",
                    fill="#f9fafb",
                )
                for line in label_lines:
                    _, x_center, y_center, width, height = line.split()
                    x_center, y_center, width, height = map(float, (x_center, y_center, width, height))
                    x1 = tile_x + (x_center - width / 2) * tile_width
                    x2 = tile_x + (x_center + width / 2) * tile_width
                    y1 = tile_y + header_height + (y_center - height / 2) * (tile_height - header_height)
                    y2 = tile_y + header_height + (y_center + height / 2) * (tile_height - header_height)
                    draw.rectangle((x1, y1, x2, y2), outline="#22c55e", width=3)
                page_rows.append({"image": str(image_path.relative_to(destination)).replace("\\", "/"), "objects": len(label_lines)})
            filename = f"{split}-contact-sheet.jpg" if page_index == 0 else f"{split}-contact-sheet-{page_index + 1:03d}.jpg"
            sheet.save(review_dir / filename, quality=90)
            pages.append({"file": f"review/{filename}", "images": page_rows})
        index["splits"][split] = {"selectedImages": len(selected), "pages": pages}
    (review_dir / "contact-sheet-index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return index


def build_dataset(
    *,
    manifest: Path,
    root: Path,
    generic: Path,
    destination: Path,
    image_mode: str = "auto",
    minimum_positive_images: int = 1200,
    minimum_negative_images: int = 1500,
    minimum_chair_negatives: int = 400,
) -> dict[str, Any]:
    manifest, root, generic, destination = (
        manifest.resolve(), root.resolve(), generic.resolve(), destination.resolve()
    )
    audit_report = audit(manifest, root)
    if not audit_report["passed"]:
        raise ValueError("Reviewed CCTV manifest failed audit")
    ensure_empty(destination)
    destination.mkdir(parents=True, exist_ok=True)
    generic_report = copy_generic(generic, destination, image_mode)
    reviewed_report = copy_reviewed(manifest, root, destination, image_mode)
    contact_sheets = render_contact_sheets(destination)
    totals = combined_counts(generic_report, reviewed_report)
    chair_count = int(reviewed_report["negativeCategories"].get("chair", 0))
    coverage_gates = {
        "positiveImages": {
            "value": totals["positiveImages"], "minimum": minimum_positive_images,
            "passed": totals["positiveImages"] >= minimum_positive_images,
        },
        "negativeImages": {
            "value": totals["negativeImages"], "minimum": minimum_negative_images,
            "passed": totals["negativeImages"] >= minimum_negative_images,
        },
        "reviewedChairNegatives": {
            "value": chair_count, "minimum": minimum_chair_negatives,
            "passed": chair_count >= minimum_chair_negatives,
        },
    }
    coverage = {"totals": totals, "gates": coverage_gates, "passed": all(gate["passed"] for gate in coverage_gates.values())}
    serializable_audit = json.loads(json.dumps(audit_report, default=dict))
    report = {
        "datasetVersion": destination.name,
        "manifest": str(manifest),
        "genericDataset": str(generic),
        "destination": str(destination),
        "audit": serializable_audit,
        "generic": generic_report,
        "reviewedDeployment": reviewed_report,
        "contactSheets": contact_sheets,
        "coverage": coverage,
        "readyForTraining": bool(serializable_audit["passed"] and coverage["passed"]),
    }
    shutil.copy2(manifest, destination / "source-manifest.csv")
    (destination / "audit-report.json").write_text(
        json.dumps(serializable_audit, indent=2) + "\n", encoding="utf-8"
    )
    (destination / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (destination / "data.yaml").write_text(
        f"path: {destination.as_posix()}\ntrain: train/images\nval: valid/images\ntest: test/images\nnames:\n  0: trash bin\n",
        encoding="utf-8",
    )
    failed_gates = [name for name, gate in coverage_gates.items() if not gate["passed"]]
    (destination / "data-card.md").write_text(
        "# Localized bin-localizer dataset\n\n"
        f"- Version: `{destination.name}`\n"
        f"- Total images: {totals['images']}\n"
        f"- Positive images: {totals['positiveImages']}\n"
        f"- Negative images: {totals['negativeImages']}\n"
        f"- Reviewed chair negatives: {chair_count}\n"
        f"- Ready for training: {'yes' if report['readyForTraining'] else 'no'}\n\n"
        "## Limitations\n\n"
        + ("Coverage gates not met: " + ", ".join(failed_gates) + ".\n" if failed_gates else "No automated coverage gate is currently failing.\n")
        + "Manual contact-sheet review and operator approval remain required before promotion.\n",
        encoding="utf-8",
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--generic", type=Path, default=ROOT / "ml-training/data/bin-localizer")
    parser.add_argument("--destination", type=Path, default=ROOT / "ml-training/data/bin-localizer-cctv-v3")
    parser.add_argument("--image-mode", choices=("auto", "hardlink", "copy"), default="auto")
    parser.add_argument("--minimum-positive-images", type=int, default=1200)
    parser.add_argument("--minimum-negative-images", type=int, default=1500)
    parser.add_argument("--minimum-chair-negatives", type=int, default=400)
    parser.add_argument("--require-coverage", action="store_true")
    args = parser.parse_args()
    manifest = args.manifest.resolve()
    root = (args.root or manifest.parent).resolve()
    try:
        report = build_dataset(
            manifest=manifest,
            root=root,
            generic=args.generic,
            destination=args.destination,
            image_mode=args.image_mode,
            minimum_positive_images=args.minimum_positive_images,
            minimum_negative_images=args.minimum_negative_images,
            minimum_chair_negatives=args.minimum_chair_negatives,
        )
    except (FileNotFoundError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps({"destination": report["destination"], "coverage": report["coverage"], "readyForTraining": report["readyForTraining"]}, indent=2))
    return 1 if args.require_coverage and not report["readyForTraining"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
