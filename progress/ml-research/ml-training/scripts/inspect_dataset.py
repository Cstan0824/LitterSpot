"""Report basic integrity problems in an exported YOLO-format dataset."""
from __future__ import annotations

import argparse
import hashlib
from collections import Counter
from pathlib import Path

from PIL import Image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def find_files(root: Path, extensions: set[str]) -> dict[str, Path]:
    return {path.stem: path for path in root.rglob("*") if path.suffix.lower() in extensions}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path, help="Exported Roboflow YOLO26 dataset directory")
    parser.add_argument("--class-count", type=int, required=True)
    args = parser.parse_args()
    images = find_files(args.dataset, IMAGE_EXTENSIONS)
    labels = find_files(args.dataset, {".txt"})
    counts: Counter[int] = Counter()
    invalid = Counter()
    hashes: dict[str, list[Path]] = {}
    sizes: Counter[tuple[int, int]] = Counter()

    for key, image_path in images.items():
        try:
            with Image.open(image_path) as image:
                sizes[image.size] += 1
        except OSError:
            invalid["unreadable_images"] += 1
            continue
        digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
        hashes.setdefault(digest, []).append(image_path)
        label_path = labels.get(key)
        if not label_path:
            continue
        for line_number, line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), 1):
            parts = line.split()
            if len(parts) != 5:
                invalid["malformed_labels"] += 1
                print(f"Malformed label: {label_path}:{line_number}")
                continue
            try:
                class_id = int(parts[0]); coordinates = [float(value) for value in parts[1:]]
            except ValueError:
                invalid["non_numeric_labels"] += 1
                continue
            if not 0 <= class_id < args.class_count:
                invalid["invalid_class_ids"] += 1
            if any(value < 0 or value > 1 for value in coordinates):
                invalid["out_of_range_coordinates"] += 1
            if coordinates[2] == 0 or coordinates[3] == 0:
                invalid["zero_area_boxes"] += 1
            counts[class_id] += 1

    duplicate_groups = [paths for paths in hashes.values() if len(paths) > 1]
    print(f"Images: {len(images)}")
    print(f"Label files: {len(labels)}")
    print(f"Images without label files: {len(images.keys() - labels.keys())}")
    print(f"Label files without images: {len(labels.keys() - images.keys())}")
    print(f"Objects per class: {dict(sorted(counts.items()))}")
    print(f"Invalid records: {dict(invalid)}")
    print(f"Duplicate image groups: {len(duplicate_groups)}")
    print(f"Image sizes: {dict(sizes.most_common(10))}")


if __name__ == "__main__":
    main()
