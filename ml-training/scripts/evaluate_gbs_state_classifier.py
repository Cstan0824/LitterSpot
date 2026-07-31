"""Evaluate the GCO-trained bin-state classifier on the independent GBS dataset."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader

from train_bin_state_classifier import BinCropDataset, ROOT, build_model, confusion_metrics, evaluate, save_error_sheet, transforms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2/best.pt")
    parser.add_argument("--gbs", type=Path, default=ROOT / "ml-training/data/raw/GBS")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2")
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def index_gbs(root: Path) -> list[dict[str, object]]:
    coco = json.loads((root / "Annotations/GBS_coco.json").read_text(encoding="utf-8"))
    images = {int(item["id"]): item for item in coco["images"]}
    sizes: dict[int, tuple[int, int]] = {}
    samples: list[dict[str, object]] = []
    for annotation in coco["annotations"]:
        category = int(annotation["category_id"])
        if category not in {0, 1}:  # GBS: overflow=0, garbage_bin=1, loose garbage=2
            continue
        image_id = int(annotation["image_id"])
        info = images[image_id]
        image_path = root / "Images" / str(info.get("file_name", f"{image_id:06d}.jpg"))
        if image_id not in sizes:
            width = int(info.get("width", 0))
            height = int(info.get("height", 0))
            if width <= 0 or height <= 0:
                with Image.open(image_path) as image:
                    width, height = image.size
            sizes[image_id] = (width, height)
        width, height = sizes[image_id]
        x, y, box_width, box_height = (float(value) for value in annotation["bbox"])
        if box_width <= 1 or box_height <= 1:
            continue
        samples.append({
            "image": image_path,
            "image_id": image_id,
            "object_index": int(annotation["id"]),
            "source_class": category,
            "target": 1 if category == 0 else 0,
            "box": ((x + box_width / 2) / width, (y + box_height / 2) / height, box_width / width, box_height / height),
        })
    if not samples:
        raise RuntimeError("No GBS normal/overflow annotations found")
    return samples


def threshold_sweep(rows: list[dict[str, object]]) -> dict[str, object]:
    ranked = sorted(rows, key=lambda row: float(row["overflow_probability"]), reverse=True)
    normal_count = sum(row["actual"] == "normal" for row in rows)
    overflow_count = len(rows) - normal_count
    matrix = [[normal_count, 0], [overflow_count, 0]]
    results: list[dict[str, object]] = []
    index = 0
    while index < len(ranked):
        threshold = float(ranked[index]["overflow_probability"])
        while index < len(ranked) and float(ranked[index]["overflow_probability"]) == threshold:
            target = 1 if ranked[index]["actual"] == "overflow" else 0
            matrix[target][0] -= 1
            matrix[target][1] += 1
            index += 1
        metrics = confusion_metrics(matrix)
        metrics["confusion_matrix"] = [row.copy() for row in matrix]
        results.append({"threshold": threshold, **metrics})
    best_f1 = max(results, key=lambda item: float(item["overflow_f1"]))
    best_f2 = max(results, key=lambda item: float(item["overflow_f2"]))
    precision_gated = [item for item in results if float(item["overflow_precision"]) >= 0.80]
    best_precision_gated_recall = max(precision_gated, key=lambda item: float(item["overflow_recall"]), default=None)
    return {"best_f1": best_f1, "best_f2": best_f2, "best_recall_at_precision_at_least_0_80": best_precision_gated_recall}


def main() -> None:
    args = parse_args()
    checkpoint = torch.load(args.checkpoint.resolve(), map_location="cpu", weights_only=True)
    device = torch.device(args.device)
    _, transform = transforms(int(checkpoint["image_size"]))
    samples = index_gbs(args.gbs.resolve())
    dataset = BinCropDataset(samples, transform, float(checkpoint["context"]))
    loader = DataLoader(dataset, batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=device.type == "cuda")
    model = build_model()
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    started = perf_counter()
    metrics, rows = evaluate(model, loader, device, nn.CrossEntropyLoss())
    elapsed = perf_counter() - started
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "cross-domain GCO-trained classifier evaluated on GBS",
        "checkpoint": str(args.checkpoint.resolve()),
        "data": str(args.gbs.resolve()),
        "objects": len(samples),
        "mapping": {"GBS garbage_bin": "normal", "GBS overflow": "overflow"},
        "test": metrics,
        "threshold_sweep": threshold_sweep(rows),
        "elapsed_seconds": elapsed,
        "throughput_objects_per_second": len(samples) / elapsed,
    }
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "gbs-cross-domain-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (output / "gbs-cross-domain-predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    save_error_sheet(samples, rows, float(checkpoint["context"]), output / "gbs-cross-domain-errors.jpg", 36)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
