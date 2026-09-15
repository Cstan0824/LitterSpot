#!/usr/bin/env python3
"""Extract original-resolution bin crops from a YOLO bootstrap dataset.

This separates localisation from state annotation.  Each YOLO box is expanded
by a small context margin, saved as an individual image, and recorded in a
sidecar with source checksums and box coordinates.  No state is inferred.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repo_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def parse_boxes(label_path: Path, width: int, height: int) -> list[dict[str, float]]:
    boxes: list[dict[str, float]] = []
    for line_number, line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), start=1):
        values = line.split()
        if len(values) != 5:
            raise ValueError(f"{label_path}:{line_number}: expected five YOLO fields")
        class_id, cx, cy, box_width, box_height = (float(value) for value in values)
        if int(class_id) != 0 or not all(0 <= value <= 1 for value in (cx, cy, box_width, box_height)):
            raise ValueError(f"{label_path}:{line_number}: invalid normalized box")
        x1, x2 = (cx - box_width / 2) * width, (cx + box_width / 2) * width
        y1, y2 = (cy - box_height / 2) * height, (cy + box_height / 2) * height
        if x2 <= x1 or y2 <= y1:
            raise ValueError(f"{label_path}:{line_number}: non-positive box")
        boxes.append({"x1": max(0.0, x1), "y1": max(0.0, y1),
                      "x2": min(float(width), x2), "y2": min(float(height), y2)})
    return boxes


def extract(pseudo_root: Path, output: Path, context: float = .15) -> dict:
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Refusing to overwrite non-empty output: {output}")
    output.mkdir(parents=True, exist_ok=True)
    crops: list[dict] = []
    image_count = 0
    for split in ("train", "valid", "test"):
        image_root = pseudo_root / split / "images"
        label_root = pseudo_root / split / "labels"
        if not image_root.is_dir():
            continue
        for image_path in sorted(path for path in image_root.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES):
            label_path = label_root / f"{image_path.stem}.txt"
            if not label_path.is_file():
                continue
            with Image.open(image_path) as opened:
                image = opened.convert("RGB")
                boxes = parse_boxes(label_path, image.width, image.height)
                source_hash = sha256(image_path)
                for index, box in enumerate(boxes):
                    width, height = box["x2"] - box["x1"], box["y2"] - box["y1"]
                    crop_box = (
                        max(0.0, box["x1"] - width * context),
                        max(0.0, box["y1"] - height * context),
                        min(float(image.width), box["x2"] + width * context),
                        min(float(image.height), box["y2"] + height * context),
                    )
                    destination = output / "images" / split / f"{image_path.stem}__bin-{index:02d}.jpg"
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    image.crop(crop_box).save(destination, quality=95)
                    crops.append({
                        "cropId": f"{split}-{image_path.stem}-bin-{index:02d}",
                        "split": split, "path": repo_path(destination), "sha256": sha256(destination),
                        "sourcePath": repo_path(image_path), "sourceSha256": source_hash,
                        "localizerBox": box, "cropBox": [round(value, 3) for value in crop_box],
                        "state": "unknown",
                    })
            image_count += 1
    report = {
        "generatedAt": datetime.now(UTC).isoformat(), "pseudoRoot": str(pseudo_root.resolve()),
        "images": image_count, "crops": len(crops), "context": context,
        "stateLabelsGenerated": 0, "cropsRequireBatchReview": True,
    }
    (output / "crops.json").write_text(json.dumps({"schemaVersion": 1, "crops": crops}, indent=2) + "\n", encoding="utf-8")
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pseudo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--context", type=float, default=.15)
    args = parser.parse_args()
    if not 0 <= args.context <= .5:
        parser.error("--context must be between 0 and 0.5")
    report = extract(args.pseudo_root.resolve(), args.output.resolve(), args.context)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
