"""Bootstrap conservative bin boxes for the first half of the UM dataset.

The source paper reserves the first 100 images for training and the final 100
for testing. YOLOE text prompts create candidate boxes; overlapping prompt
responses are clustered, and an image is accepted only when exactly three
plausible bin instances remain. These are weak labels and must stay distinct
from ground truth.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import shutil

from PIL import Image, ImageDraw
from ultralytics import YOLOE


ROOT = Path(__file__).resolve().parents[2]
PROMPTS = ["green wheelie bin", "green garbage bin", "trash bin viewed from above"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="yoloe-v8s-seg.pt")
    parser.add_argument("--images", type=Path, default=ROOT / "ml-training/data/malaysia-bin-node/images")
    parser.add_argument("--destination", type=Path, default=ROOT / "ml-training/data/malaysia-bin-node-pseudo")
    parser.add_argument("--training-images", type=int, default=100)
    parser.add_argument("--train-fraction", type=float, default=.80)
    parser.add_argument("--confidence", type=float, default=.05)
    parser.add_argument("--device", default=0)
    return parser.parse_args()


def box_iou(left: list[float], right: list[float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = (left[2] - left[0]) * (left[3] - left[1])
    right_area = (right[2] - right[0]) * (right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def materialize(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def main() -> None:
    args = parse_args()
    destination = args.destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit(f"Destination must be empty: {destination}")
    paths = sorted(args.images.resolve().glob("*.jpg"))[:args.training_images]
    if len(paths) != args.training_images:
        raise SystemExit(f"Expected {args.training_images} source images, found {len(paths)}")

    model = YOLOE(args.model)
    model.set_classes(PROMPTS, model.get_text_pe(PROMPTS))
    accepted: list[tuple[Path, list[tuple[float, list[float]]]]] = []
    rejected_counts: Counter[int] = Counter()
    for index, path in enumerate(paths, start=1):
        result = model.predict(
            str(path), device=args.device, imgsz=640, conf=args.confidence,
            iou=.40, max_det=12, agnostic_nms=True, verbose=False,
        )[0]
        candidates: list[tuple[float, list[float]]] = []
        for xyxy, confidence in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()):
            image_area = float(result.orig_shape[0] * result.orig_shape[1])
            area_ratio = (xyxy[2] - xyxy[0]) * (xyxy[3] - xyxy[1]) / image_area
            if .025 <= area_ratio <= .25:
                candidates.append((float(confidence), [float(value) for value in xyxy]))
        clusters: list[tuple[float, list[float]]] = []
        for confidence, box in sorted(candidates, reverse=True):
            if not any(box_iou(box, existing_box) >= .20 for _, existing_box in clusters):
                clusters.append((confidence, box))
        if len(clusters) == 3:
            accepted.append((path, sorted(clusters, key=lambda item: item[1][0])))
        else:
            rejected_counts[len(clusters)] += 1
        if index % 20 == 0:
            print(f"Processed {index}/{len(paths)}; accepted={len(accepted)}", flush=True)

    split_at = round(len(accepted) * args.train_fraction)
    split_counts = Counter()
    samples = destination / "samples"
    samples.mkdir(parents=True)
    for accepted_index, (path, boxes) in enumerate(accepted):
        split = "train" if accepted_index < split_at else "valid"
        output_image = destination / split / "images" / path.name
        output_label = destination / split / "labels" / f"{path.stem}.txt"
        materialize(path, output_image)
        with Image.open(path) as image:
            width, height = image.size
            rows = []
            for _, (x1, y1, x2, y2) in boxes:
                rows.append(
                    f"0 {(x1 + x2) / (2 * width):.8f} {(y1 + y2) / (2 * height):.8f} "
                    f"{(x2 - x1) / width:.8f} {(y2 - y1) / height:.8f}"
                )
            output_label.parent.mkdir(parents=True, exist_ok=True)
            output_label.write_text("\n".join(rows) + "\n", encoding="utf-8")
            if accepted_index < 12:
                preview = image.convert("RGB")
                draw = ImageDraw.Draw(preview)
                for confidence, box in boxes:
                    draw.rectangle(box, outline="red", width=4)
                    draw.text((box[0], box[1]), f"{confidence:.2f}", fill="red")
                preview.save(samples / path.name)
        split_counts[split] += 1

    report = {
        "source": str(args.images.resolve()),
        "sourceArticle": "https://figshare.com/articles/figure/6269042",
        "labelType": "weak YOLOE text-prompt bootstrap; not manual ground truth",
        "prompts": PROMPTS,
        "sourceTrainingImages": len(paths),
        "acceptedImages": len(accepted),
        "acceptedRate": len(accepted) / len(paths),
        "splits": dict(split_counts),
        "rejectedClusterCounts": dict(sorted(rejected_counts.items())),
        "heldOutPolicy": "Source images 101-200 are never used for bootstrap or fine-tuning.",
    }
    (destination / "bootstrap-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
