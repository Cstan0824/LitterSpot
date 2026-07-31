"""Build a one-class bin-localization dataset from GCO and GBS.

GCO contributes reviewed normal/full/overflow bin boxes. GBS contributes its
``overflow`` and ``garbage_bin`` boxes; loose ``garbage`` is retained only as
negative-image context. All positive boxes become class 0 (``trash bin``).

Images are hard-linked when possible to avoid duplicating the multi-gigabyte
GBS dataset. Copying is used as a portable fallback.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[2]
SPLITS = ("train", "valid", "test")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
GBS_BIN_CATEGORIES = {0, 1}  # overflow, garbage_bin; category 2 is loose garbage


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gco", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--gbs", type=Path, default=ROOT / "ml-training/data/raw/GBS")
    parser.add_argument("--destination", type=Path, default=ROOT / "ml-training/data/bin-localizer")
    parser.add_argument(
        "--image-mode",
        choices=("auto", "hardlink", "copy"),
        default="auto",
        help="Use hard links to avoid another 5+ GB copy; auto falls back to copying.",
    )
    return parser.parse_args()


def ensure_empty_destination(destination: Path) -> None:
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"Destination must be empty: {destination}")


def materialize_image(source: Path, destination: Path, mode: str) -> str:
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


def destination_paths(destination: Path, split: str, source: str, image: Path) -> tuple[Path, Path]:
    name = f"{source}_{image.name}"
    return destination / split / "images" / name, destination / split / "labels" / f"{Path(name).stem}.txt"


def write_yolo_label(path: Path, rows: Iterable[tuple[float, float, float, float]]) -> int:
    clean_rows = []
    seen = set()
    for x_center, y_center, width, height in rows:
        values = tuple(min(1.0, max(0.0, value)) for value in (x_center, y_center, width, height))
        if values[2] <= 0 or values[3] <= 0:
            continue
        rounded = tuple(round(value, 8) for value in values)
        if rounded in seen:
            continue
        seen.add(rounded)
        clean_rows.append("0 " + " ".join(f"{value:.8f}" for value in values))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(clean_rows) + ("\n" if clean_rows else ""), encoding="utf-8")
    return len(clean_rows)


def add_gco(gco: Path, destination: Path, image_mode: str) -> dict[str, object]:
    result: dict[str, object] = {"splits": {}, "imageMaterialization": Counter()}
    for split in SPLITS:
        source_images, source_labels = gco / split / "images", gco / split / "labels"
        if not source_images.is_dir() or not source_labels.is_dir():
            raise FileNotFoundError(f"Missing GCO {split} image or label directory")
        image_count = object_count = negative_count = 0
        for image_path in sorted(path for path in source_images.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES):
            label_path = source_labels / f"{image_path.stem}.txt"
            if not label_path.is_file():
                raise FileNotFoundError(f"Missing label for {image_path}")
            rows = []
            for line in label_path.read_text(encoding="utf-8").splitlines():
                values = line.split()
                if len(values) < 5 or values[0] not in {"0", "1", "2"}:
                    raise ValueError(f"Malformed reviewed GCO label in {label_path}: {line}")
                rows.append(tuple(float(value) for value in values[1:5]))
            output_image, output_label = destination_paths(destination, split, "gco", image_path)
            result["imageMaterialization"][materialize_image(image_path, output_image, image_mode)] += 1
            written = write_yolo_label(output_label, rows)
            image_count += 1
            object_count += written
            negative_count += written == 0
        result["splits"][split] = {"images": image_count, "objects": object_count, "negativeImages": negative_count}
    result["imageMaterialization"] = dict(result["imageMaterialization"])
    return result


def gbs_split_by_image_id(images: list[dict[str, object]]) -> dict[int, str]:
    image_ids = sorted(int(image["id"]) for image in images)
    if not image_ids:
        raise ValueError("GBS has no images")
    valid_index = min(int(0.70 * len(image_ids)), len(image_ids) - 1)
    test_index = min(int(0.85 * len(image_ids)), len(image_ids) - 1)
    valid_start, test_start = image_ids[valid_index], image_ids[test_index]
    return {
        image_id: "train" if image_id < valid_start else ("valid" if image_id < test_start else "test")
        for image_id in image_ids
    }


def add_gbs(gbs: Path, destination: Path, image_mode: str) -> dict[str, object]:
    annotation_path = gbs / "Annotations/GBS_coco.json"
    if not annotation_path.is_file():
        raise FileNotFoundError(f"Missing GBS COCO annotations: {annotation_path}")
    coco = json.loads(annotation_path.read_text(encoding="utf-8"))
    categories = {int(category["id"]): str(category["name"]) for category in coco["categories"]}
    if categories.get(0) != "overflow" or categories.get(1) != "garbage_bin":
        raise ValueError(f"Unexpected GBS category mapping: {categories}")

    image_rows = coco["images"]
    images = {int(image["id"]): image for image in image_rows}
    split_for = gbs_split_by_image_id(list(images.values()))
    boxes: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    ignored_loose_garbage = 0
    for annotation in coco["annotations"]:
        category = int(annotation["category_id"])
        if category not in GBS_BIN_CATEGORIES:
            ignored_loose_garbage += category == 2
            continue
        image_id = int(annotation["image_id"])
        image = images[image_id]
        image_width, image_height = float(image["width"]), float(image["height"])
        x, y, width, height = (float(value) for value in annotation["bbox"])
        if image_width <= 0 or image_height <= 0 or width <= 0 or height <= 0:
            continue
        boxes[image_id].append(
            ((x + width / 2) / image_width, (y + height / 2) / image_height, width / image_width, height / image_height)
        )

    counters = {split: Counter() for split in SPLITS}
    materialization = Counter()
    for image_id, image in sorted(images.items()):
        split = split_for[image_id]
        source_image = gbs / "Images" / str(image["file_name"])
        if not source_image.is_file():
            raise FileNotFoundError(f"Missing GBS image: {source_image}")
        output_image, output_label = destination_paths(destination, split, "gbs", source_image)
        materialization[materialize_image(source_image, output_image, image_mode)] += 1
        written = write_yolo_label(output_label, boxes[image_id])
        counters[split]["images"] += 1
        counters[split]["objects"] += written
        counters[split]["negativeImages"] += written == 0

    return {
        "splits": {split: dict(counters[split]) for split in SPLITS},
        "duplicateImageRowsRemoved": len(image_rows) - len(images),
        "ignoredLooseGarbageAnnotations": ignored_loose_garbage,
        "imageMaterialization": dict(materialization),
    }


def prepare(gco: Path, gbs: Path, destination: Path, image_mode: str = "auto") -> dict[str, object]:
    ensure_empty_destination(destination)
    destination.mkdir(parents=True, exist_ok=True)
    report = {
        "sources": {"gco": str(gco.resolve()), "gbs": str(gbs.resolve())},
        "classMapping": {
            "GCO normal/full/overflow": "trash bin",
            "GBS overflow/garbage_bin": "trash bin",
            "GBS garbage": "negative context only",
        },
        "splitPolicy": {
            "GCO": "preserve reviewed source split",
            "GBS": "70/15/15 chronological image-id split, matching state-classifier evaluation",
        },
        "gco": add_gco(gco.resolve(), destination.resolve(), image_mode),
        "gbs": add_gbs(gbs.resolve(), destination.resolve(), image_mode),
    }
    (destination / "conversion-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    args = parse_args()
    try:
        report = prepare(args.gco, args.gbs, args.destination, args.image_mode)
    except (FileNotFoundError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
