"""Evaluate zero-shot YOLOE text prompts without training or tuning on test data."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

import torch
from PIL import Image
from ultralytics import YOLOE


ROOT = Path(__file__).resolve().parents[2]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
PROMPTS = [
    "empty trash bin",
    "partly filled trash bin",
    "full trash bin with all garbage contained inside",
    "overfilled trash bin",
    "garbage protruding above a trash bin",
    "garbage spilling out of a trash bin",
]
PROMPT_STATES = ["normal", "normal", "normal", "overflow", "overflow", "overflow"]
GT_STATES = {0: "normal", 1: "normal", 2: "overflow"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="yoloe-v8s-seg.pt")
    parser.add_argument("--images", type=Path, default=ROOT / "ml-training/data/processed/test/images")
    parser.add_argument("--labels", type=Path, default=ROOT / "ml-training/data/processed/test/labels")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/prompt_experiments/yoloe_v8s_gco_text_v1")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--confidence", type=float, default=0.05)
    parser.add_argument("--iou", type=float, default=0.70)
    parser.add_argument("--match-iou", type=float, default=0.50)
    parser.add_argument("--state-margin", type=float, default=0.10)
    parser.add_argument("--limit", type=int, default=0, help="Deterministic image limit; zero evaluates all images")
    parser.add_argument("--sample-images", type=int, default=24)
    return parser.parse_args()


def box_iou(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def read_labels(label_path: Path, width: int, height: int) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not label_path.is_file():
        return rows
    for line in label_path.read_text(encoding="utf-8").splitlines():
        values = line.split()
        if len(values) < 5:
            continue
        class_id = int(values[0])
        if class_id not in GT_STATES:
            continue
        cx, cy, box_width, box_height = (float(value) for value in values[1:5])
        rows.append(
            {
                "class_id": class_id,
                "state": GT_STATES[class_id],
                "box": (
                    (cx - box_width / 2) * width,
                    (cy - box_height / 2) * height,
                    (cx + box_width / 2) * width,
                    (cy + box_height / 2) * height,
                ),
            }
        )
    return rows


def summarize(rows: list[dict[str, object]], latencies: list[float], peak_vram_mb: float) -> dict[str, object]:
    total = len(rows)
    detected = [row for row in rows if row["detected"]]
    decisive = [row for row in detected if not row["ambiguous"]]
    correct = [row for row in decisive if row["correct"]]
    by_state: dict[str, dict[str, float | int]] = {}
    for state in ("normal", "overflow"):
        state_rows = [row for row in rows if row["actual_state"] == state]
        state_detected = [row for row in state_rows if row["detected"]]
        state_decisive = [row for row in state_detected if not row["ambiguous"]]
        state_correct = [row for row in state_decisive if row["correct"]]
        by_state[state] = {
            "objects": len(state_rows),
            "localization_recall": len(state_detected) / len(state_rows) if state_rows else 0.0,
            "decisive_state_accuracy": len(state_correct) / len(state_decisive) if state_decisive else 0.0,
            "end_to_end_correct_rate": len(state_correct) / len(state_rows) if state_rows else 0.0,
            "ambiguous_objects": len(state_detected) - len(state_decisive),
        }
    return {
        "objects": total,
        "localized_objects": len(detected),
        "localization_recall": len(detected) / total if total else 0.0,
        "decisive_objects": len(decisive),
        "ambiguous_objects": len(detected) - len(decisive),
        "ambiguity_rate_among_localized": (len(detected) - len(decisive)) / len(detected) if detected else 0.0,
        "decisive_state_accuracy": len(correct) / len(decisive) if decisive else 0.0,
        "end_to_end_correct_rate": len(correct) / total if total else 0.0,
        "by_state": by_state,
        "latency_ms": {
            "mean": mean(latencies) if latencies else 0.0,
            "min": min(latencies) if latencies else 0.0,
            "max": max(latencies) if latencies else 0.0,
        },
        "peak_vram_mb": peak_vram_mb,
    }


def main() -> None:
    args = parse_args()
    images_dir = args.images.resolve()
    labels_dir = args.labels.resolve()
    output_dir = args.output.resolve()
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise FileNotFoundError(f"Expected image and label directories: {images_dir}, {labels_dir}")
    image_paths = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)
    if args.limit > 0:
        image_paths = image_paths[: args.limit]
    if not image_paths:
        raise RuntimeError("No evaluation images found")

    output_dir.mkdir(parents=True, exist_ok=False)
    samples_dir = output_dir / "samples"
    samples_dir.mkdir()

    torch_device = (
        "cpu"
        if str(args.device).lower() == "cpu"
        else f"cuda:{args.device}"
        if str(args.device).isdigit()
        else str(args.device)
    )
    print(f"STAGE load_model model={args.model}", flush=True)
    model = YOLOE(args.model)
    model.eval()
    print(f"STAGE move_model device={torch_device}", flush=True)
    model.to(torch_device)
    print("STAGE encode_text_prompts", flush=True)
    text_embeddings = model.get_text_pe(PROMPTS)
    model.set_classes(PROMPTS, text_embeddings)
    print("STAGE inference", flush=True)
    if torch.cuda.is_available() and str(args.device) != "cpu":
        torch.cuda.reset_peak_memory_stats()

    rows: list[dict[str, object]] = []
    image_summaries: list[dict[str, object]] = []
    latencies: list[float] = []
    gt_counts: Counter[str] = Counter()
    prompt_hits: Counter[str] = Counter()
    sample_count = 0

    for index, image_path in enumerate(image_paths, start=1):
        with Image.open(image_path) as image:
            width, height = image.size
        gt_objects = read_labels(labels_dir / f"{image_path.stem}.txt", width, height)
        gt_counts.update(str(row["state"]) for row in gt_objects)
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
        predicted: list[dict[str, object]] = []
        if result.boxes is not None:
            for box in result.boxes:
                prompt_id = int(box.cls[0])
                prompt_hits[PROMPTS[prompt_id]] += 1
                predicted.append(
                    {
                        "box": tuple(float(value) for value in box.xyxy[0].tolist()),
                        "confidence": float(box.conf[0]),
                        "prompt_id": prompt_id,
                        "state": PROMPT_STATES[prompt_id],
                    }
                )

        image_rows: list[dict[str, object]] = []
        for object_index, gt in enumerate(gt_objects):
            state_scores: defaultdict[str, float] = defaultdict(float)
            best_iou = 0.0
            for prediction in predicted:
                overlap = box_iou(gt["box"], prediction["box"])
                best_iou = max(best_iou, overlap)
                if overlap >= args.match_iou:
                    state = str(prediction["state"])
                    state_scores[state] = max(state_scores[state], float(prediction["confidence"]))
            normal_score = state_scores["normal"]
            overflow_score = state_scores["overflow"]
            detected = max(normal_score, overflow_score) > 0.0
            margin = abs(normal_score - overflow_score)
            ambiguous = detected and margin < args.state_margin
            predicted_state = None if not detected or ambiguous else ("normal" if normal_score > overflow_score else "overflow")
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
                "normal_score": round(normal_score, 6),
                "overflow_score": round(overflow_score, 6),
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
                "predictions": len(predicted),
                "latency_ms": round(latency, 3),
            }
        )
        if index % 25 == 0 or index == len(image_paths):
            print(f"PROGRESS images={index}/{len(image_paths)} objects={len(rows)}", flush=True)

    peak_vram_mb = (
        float(torch.cuda.max_memory_allocated() / 2**20)
        if torch.cuda.is_available() and str(args.device) != "cpu"
        else 0.0
    )
    metrics = summarize(rows, latencies, peak_vram_mb)
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "zero-shot YOLOE natural-language state prompts",
        "model": args.model,
        "dataset": {"images": str(images_dir), "labels": str(labels_dir), "image_count": len(image_paths)},
        "settings": {
            "prompts": [{"text": text, "state": state} for text, state in zip(PROMPTS, PROMPT_STATES)],
            "confidence": args.confidence,
            "iou": args.iou,
            "match_iou": args.match_iou,
            "state_margin": args.state_margin,
            "imgsz": args.imgsz,
            "device": args.device,
        },
        "ground_truth_state_counts": dict(gt_counts),
        "prediction_prompt_counts": dict(prompt_hits),
        "metrics": metrics,
        "interpretation": {
            "localization_recall": "Fraction of labeled bins with any state prompt overlapping at IoU >= match_iou.",
            "decisive_state_accuracy": "State accuracy only where YOLOE localized a bin and the normal/overflow score margin passed the abstention gate.",
            "end_to_end_correct_rate": "Correct, decisive states divided by every labeled bin, including misses and abstentions.",
        },
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
