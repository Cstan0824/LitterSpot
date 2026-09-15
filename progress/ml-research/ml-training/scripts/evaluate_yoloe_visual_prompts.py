"""Evaluate cross-image YOLOE visual prompts using training-only references."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import numpy as np
import torch
from PIL import Image, ImageDraw
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEVPSegPredictor

from evaluate_yoloe_prompts import IMAGE_SUFFIXES, ROOT, box_iou, read_labels, summarize


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="yoloe-v8l-seg.pt")
    parser.add_argument("--reference-images", type=Path, default=ROOT / "ml-training/data/processed/train/images")
    parser.add_argument("--reference-labels", type=Path, default=ROOT / "ml-training/data/processed/train/labels")
    parser.add_argument("--images", type=Path, default=ROOT / "ml-training/data/processed/test/images")
    parser.add_argument("--labels", type=Path, default=ROOT / "ml-training/data/processed/test/labels")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/prompt_experiments/yoloe_v8l_gco_visual_v1")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--confidence", type=float, default=0.05)
    parser.add_argument("--iou", type=float, default=0.70)
    parser.add_argument("--match-iou", type=float, default=0.50)
    parser.add_argument("--state-margin", type=float, default=0.10)
    parser.add_argument("--sample-images", type=int, default=24)
    parser.add_argument("--limit", type=int, default=0, help="Deterministic image limit; zero evaluates all images")
    return parser.parse_args()


def image_for_stem(directory: Path, stem: str) -> Path | None:
    for suffix in IMAGE_SUFFIXES:
        candidate = directory / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


def normalized_boxes(label_path: Path) -> list[dict[str, object]]:
    boxes: list[dict[str, object]] = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        values = line.split()
        if len(values) < 5:
            continue
        class_id = int(values[0])
        if class_id not in {0, 1, 2}:
            continue
        cx, cy, width, height = (float(value) for value in values[1:5])
        boxes.append(
            {
                "class_id": class_id,
                "state_id": 1 if class_id == 2 else 0,
                "xywh": (cx, cy, width, height),
                "area": width * height,
            }
        )
    return boxes


def select_reference(images_dir: Path, labels_dir: Path) -> tuple[Path, list[dict[str, object]]]:
    candidates: list[tuple[float, Path, list[dict[str, object]]]] = []
    for label_path in sorted(labels_dir.glob("*.txt")):
        boxes = normalized_boxes(label_path)
        normal = [box for box in boxes if box["state_id"] == 0]
        overflow = [box for box in boxes if box["state_id"] == 1]
        if not normal or not overflow:
            continue
        image_path = image_for_stem(images_dir, label_path.stem)
        if image_path is None:
            continue
        # Favor references where both states are large and clearly visible.
        score = min(max(float(box["area"]) for box in normal), max(float(box["area"]) for box in overflow))
        candidates.append((score, image_path, boxes))
    if not candidates:
        raise RuntimeError("No training image contains both normal and overflowing bin references")
    _, image_path, boxes = max(candidates, key=lambda row: (row[0], row[1].name))
    selected: list[dict[str, object]] = []
    for state_id in (0, 1):
        state_boxes = sorted(
            (box for box in boxes if int(box["state_id"]) == state_id),
            key=lambda box: float(box["area"]),
            reverse=True,
        )
        selected.extend(state_boxes[:3])
    return image_path, selected


def pixel_prompt_boxes(image_path: Path, boxes: list[dict[str, object]]) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(image_path) as image:
        width, height = image.size
    pixels: list[list[float]] = []
    classes: list[int] = []
    for box in boxes:
        cx, cy, box_width, box_height = box["xywh"]
        pixels.append(
            [
                (cx - box_width / 2) * width,
                (cy - box_height / 2) * height,
                (cx + box_width / 2) * width,
                (cy + box_height / 2) * height,
            ]
        )
        classes.append(int(box["state_id"]))
    return np.asarray(pixels, dtype=np.float32), np.asarray(classes, dtype=np.int64)


def save_reference_preview(image_path: Path, boxes: np.ndarray, classes: np.ndarray, output: Path) -> None:
    with Image.open(image_path).convert("RGB") as image:
        draw = ImageDraw.Draw(image)
        for box, class_id in zip(boxes, classes):
            color = "#42d392" if int(class_id) == 0 else "#ff6868"
            label = "normal reference" if int(class_id) == 0 else "overflow reference"
            draw.rectangle(tuple(float(value) for value in box), outline=color, width=4)
            draw.text((float(box[0]) + 4, float(box[1]) + 4), label, fill=color)
        image.save(output)


def main() -> None:
    args = parse_args()
    reference_images = args.reference_images.resolve()
    reference_labels = args.reference_labels.resolve()
    images_dir = args.images.resolve()
    labels_dir = args.labels.resolve()
    output_dir = args.output.resolve()
    for directory in (reference_images, reference_labels, images_dir, labels_dir):
        if not directory.is_dir():
            raise FileNotFoundError(directory)
    output_dir.mkdir(parents=True, exist_ok=False)
    samples_dir = output_dir / "samples"
    samples_dir.mkdir()

    reference_image, reference_rows = select_reference(reference_images, reference_labels)
    prompt_boxes, prompt_classes = pixel_prompt_boxes(reference_image, reference_rows)
    save_reference_preview(reference_image, prompt_boxes, prompt_classes, output_dir / "reference.jpg")
    visual_prompts = {"bboxes": prompt_boxes, "cls": prompt_classes}
    image_paths = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)
    if args.limit > 0:
        image_paths = image_paths[: args.limit]
    if not image_paths:
        raise RuntimeError("No evaluation images found")

    torch_device = "cpu" if str(args.device).lower() == "cpu" else f"cuda:{args.device}"
    print(f"STAGE load_model model={args.model}", flush=True)
    model = YOLOE(args.model)
    model.eval()
    model.to(torch_device)
    if torch.cuda.is_available() and str(args.device).lower() != "cpu":
        torch.cuda.reset_peak_memory_stats()
    print(
        f"STAGE encode_visual_prompts reference={reference_image.name} boxes={len(prompt_boxes)}",
        flush=True,
    )
    prompt_started = perf_counter()
    model.predict(
        source=str(image_paths[0]),
        refer_image=str(reference_image),
        visual_prompts=visual_prompts,
        predictor=YOLOEVPSegPredictor,
        device=args.device,
        imgsz=args.imgsz,
        conf=args.confidence,
        iou=args.iou,
        max_det=100,
        verbose=False,
    )
    prompt_setup_ms = (perf_counter() - prompt_started) * 1000
    print("STAGE inference", flush=True)

    rows: list[dict[str, object]] = []
    image_summaries: list[dict[str, object]] = []
    latencies: list[float] = []
    sample_count = 0
    for index, image_path in enumerate(image_paths, start=1):
        with Image.open(image_path) as image:
            width, height = image.size
        gt_objects = read_labels(labels_dir / f"{image_path.stem}.txt", width, height)
        result = model.predict(
            str(image_path),
            device=args.device,
            imgsz=args.imgsz,
            conf=args.confidence,
            iou=args.iou,
            max_det=100,
            verbose=False,
        )[0]
        latency = float(sum(result.speed.values()))
        latencies.append(latency)
        predictions: list[dict[str, object]] = []
        if result.boxes is not None:
            for box in result.boxes:
                class_id = int(box.cls[0])
                predictions.append(
                    {
                        "box": tuple(float(value) for value in box.xyxy[0].tolist()),
                        "confidence": float(box.conf[0]),
                        "state": "normal" if class_id == 0 else "overflow",
                    }
                )
        image_rows: list[dict[str, object]] = []
        for object_index, gt in enumerate(gt_objects):
            scores = {"normal": 0.0, "overflow": 0.0}
            best_iou = 0.0
            for prediction in predictions:
                overlap = box_iou(gt["box"], prediction["box"])
                best_iou = max(best_iou, overlap)
                if overlap >= args.match_iou:
                    state = str(prediction["state"])
                    scores[state] = max(scores[state], float(prediction["confidence"]))
            detected = max(scores.values()) > 0
            margin = abs(scores["normal"] - scores["overflow"])
            ambiguous = detected and margin < args.state_margin
            predicted_state = None if not detected or ambiguous else max(scores, key=scores.get)
            actual_state = str(gt["state"])
            row: dict[str, object] = {
                "image": image_path.name,
                "object_index": object_index,
                "actual_class_id": int(gt["class_id"]),
                "actual_state": actual_state,
                "detected": detected,
                "ambiguous": ambiguous,
                "predicted_state": predicted_state,
                "correct": predicted_state == actual_state,
                "normal_score": round(scores["normal"], 6),
                "overflow_score": round(scores["overflow"], 6),
                "state_margin": round(margin, 6),
                "best_iou": round(best_iou, 6),
            }
            rows.append(row)
            image_rows.append(row)
        has_error = any(not bool(row["correct"]) for row in image_rows)
        if sample_count < args.sample_images and (has_error or index <= args.sample_images // 3):
            plotted = result.plot()
            Image.fromarray(plotted[..., ::-1]).save(samples_dir / f"{index:04d}_{image_path.stem}.jpg")
            sample_count += 1
        image_summaries.append(
            {
                "image": image_path.name,
                "ground_truth_objects": len(gt_objects),
                "predictions": len(predictions),
                "latency_ms": round(latency, 3),
            }
        )
        if index % 25 == 0 or index == len(image_paths):
            print(f"PROGRESS images={index}/{len(image_paths)} objects={len(rows)}", flush=True)

    peak_vram_mb = (
        float(torch.cuda.max_memory_allocated() / 2**20)
        if torch.cuda.is_available() and str(args.device).lower() != "cpu"
        else 0.0
    )
    metrics = summarize(rows, latencies, peak_vram_mb)
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "zero-shot YOLOE cross-image visual state prompts",
        "model": args.model,
        "reference": {
            "image": str(reference_image),
            "boxes": prompt_boxes.tolist(),
            "classes": prompt_classes.tolist(),
            "normal_examples": int((prompt_classes == 0).sum()),
            "overflow_examples": int((prompt_classes == 1).sum()),
            "setup_ms": prompt_setup_ms,
        },
        "dataset": {"images": str(images_dir), "labels": str(labels_dir), "image_count": len(image_paths)},
        "settings": {
            "confidence": args.confidence,
            "iou": args.iou,
            "match_iou": args.match_iou,
            "state_margin": args.state_margin,
            "imgsz": args.imgsz,
            "device": args.device,
        },
        "metrics": metrics,
    }
    (output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (output_dir / "objects.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (output_dir / "images.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(image_summaries[0]))
        writer.writeheader()
        writer.writerows(image_summaries)
    print(json.dumps(metrics, indent=2), flush=True)
    print(f"REPORT={output_dir / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
