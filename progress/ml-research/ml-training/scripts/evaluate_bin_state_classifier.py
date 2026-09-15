"""Evaluate a selected MobileNet bin-state checkpoint once on the held-out test split."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from torch import nn
from torch.utils.data import DataLoader

from train_bin_state_classifier import (
    BinCropDataset,
    ROOT,
    build_model,
    evaluate,
    index_split,
    save_error_sheet,
    transforms,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2/best.pt")
    parser.add_argument("--data", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2")
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--error-samples", type=int, default=36)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint_path = args.checkpoint.resolve()
    data_root = args.data.resolve()
    output_dir = args.output.resolve()
    if not checkpoint_path.is_file():
        raise FileNotFoundError(checkpoint_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    device = torch.device(args.device)
    _, eval_transform = transforms(int(checkpoint["image_size"]))
    samples = index_split(data_root, "test")
    dataset = BinCropDataset(samples, eval_transform, float(checkpoint["context"]))
    loader = DataLoader(dataset, batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=True)
    model = build_model()
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    criterion = nn.CrossEntropyLoss()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
    started = perf_counter()
    metrics, rows = evaluate(model, loader, device, criterion)
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = perf_counter() - started
    acceptance = {
        "accuracy_at_least_0_85": float(metrics["accuracy"]) >= 0.85,
        "overflow_precision_at_least_0_80": float(metrics["overflow_precision"]) >= 0.80,
        "overflow_recall_at_least_0_80": float(metrics["overflow_recall"]) >= 0.80,
        "overflow_f1_at_least_0_80": float(metrics["overflow_f1"]) >= 0.80,
    }
    acceptance["passed"] = all(acceptance.values())
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "fixed-ROI binary state classification held-out evaluation",
        "checkpoint": str(checkpoint_path),
        "selected_epoch": int(checkpoint["epoch"]),
        "selection_validation": checkpoint["validation"],
        "data": str(data_root / "test"),
        "objects": len(samples),
        "mapping": {"normal trash bin": "normal", "full trash bin": "normal", "overflowing trash bin": "overflow"},
        "test": metrics,
        "acceptance": acceptance,
        "elapsed_seconds": elapsed,
        "throughput_objects_per_second": len(samples) / elapsed,
        "peak_vram_mb": float(torch.cuda.max_memory_allocated() / 2**20) if device.type == "cuda" else 0.0,
    }
    (output_dir / "test-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (output_dir / "test-predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    save_error_sheet(samples, rows, float(checkpoint["context"]), output_dir / "test-errors.jpg", args.error_samples)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
