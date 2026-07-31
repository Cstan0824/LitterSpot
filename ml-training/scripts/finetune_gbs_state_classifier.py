"""Briefly adapt the GCO MobileNet classifier to GBS using temporal holdouts."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from torch import nn
from torch.utils.data import DataLoader

from evaluate_gbs_state_classifier import index_gbs
from train_bin_state_classifier import BinCropDataset, CLASS_NAMES, ROOT, build_model, evaluate, seed_everything, transforms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2/best.pt")
    parser.add_argument("--gbs", type=Path, default=ROOT / "ml-training/data/raw/GBS")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_gbs_v1")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def temporal_splits(samples: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    image_ids = sorted({int(sample["image_id"]) for sample in samples})
    valid_start = image_ids[int(len(image_ids) * 0.70)]
    test_start = image_ids[int(len(image_ids) * 0.85)]
    return {
        "train": [sample for sample in samples if int(sample["image_id"]) < valid_start],
        "valid": [sample for sample in samples if valid_start <= int(sample["image_id"]) < test_start],
        "test": [sample for sample in samples if int(sample["image_id"]) >= test_start],
    }


def main() -> None:
    args = parse_args()
    seed_everything(args.seed)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    device = torch.device(args.device)
    base = torch.load(args.base.resolve(), map_location="cpu", weights_only=True)
    split_samples = temporal_splits(index_gbs(args.gbs.resolve()))
    counts = {name: Counter(CLASS_NAMES[int(sample["target"])] for sample in samples) for name, samples in split_samples.items()}
    print(f"DATA_COUNTS={dict(counts)}", flush=True)
    train_transform, eval_transform = transforms(int(base["image_size"]))
    datasets = {
        name: BinCropDataset(samples, train_transform if name == "train" else eval_transform, float(base["context"]))
        for name, samples in split_samples.items()
    }
    loaders = {
        name: DataLoader(dataset, batch_size=args.batch, shuffle=name == "train", num_workers=args.workers, pin_memory=device.type == "cuda")
        for name, dataset in datasets.items()
    }
    model = build_model()
    model.load_state_dict(base["model"])
    model.to(device)
    train_counts = counts["train"]
    class_weights = torch.tensor([
        sum(train_counts.values()) / (2 * train_counts["normal"]),
        sum(train_counts.values()) / (2 * train_counts["overflow"]),
    ], device=device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    history: list[dict[str, object]] = []
    best_f2 = -1.0
    started = perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for images, targets, _ in loaders["train"]:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                loss = criterion(model(images), targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            train_loss += float(loss) * len(targets)
        validation, _ = evaluate(model, loaders["valid"], device, criterion)
        row = {"epoch": epoch, "train_loss": train_loss / len(datasets["train"]), **validation}
        history.append(row)
        print(f"EPOCH {epoch}/{args.epochs} loss={row['train_loss']:.4f} val_accuracy={validation['accuracy']:.4f} overflow_P={validation['overflow_precision']:.4f} overflow_R={validation['overflow_recall']:.4f} overflow_F2={validation['overflow_f2']:.4f}", flush=True)
        if float(validation["overflow_f2"]) > best_f2:
            best_f2 = float(validation["overflow_f2"])
            torch.save({
                "model": model.state_dict(), "architecture": "mobilenet_v3_small", "class_names": CLASS_NAMES,
                "image_size": int(base["image_size"]), "context": float(base["context"]), "epoch": epoch,
                "validation": validation, "domain_adaptation": "GCO base briefly fine-tuned on GBS temporal train split",
            }, output / "best.pt")
    selected = torch.load(output / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(selected["model"])
    test, _ = evaluate(model, loaders["test"], device, criterion)
    acceptance = {
        "accuracy_at_least_0_85": float(test["accuracy"]) >= 0.85,
        "overflow_precision_at_least_0_80": float(test["overflow_precision"]) >= 0.80,
        "overflow_recall_at_least_0_80": float(test["overflow_recall"]) >= 0.80,
        "overflow_f1_at_least_0_80": float(test["overflow_f1"]) >= 0.80,
    }
    acceptance["passed"] = all(acceptance.values())
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(), "experiment": "low-effort GBS domain adaptation",
        "base_checkpoint": str(args.base.resolve()), "selected_epoch": int(selected["epoch"]),
        "split_policy": "ordered image IDs: first 70% train, next 15% validation, final 15% test",
        "data_counts": {name: dict(value) for name, value in counts.items()}, "history": history,
        "test": test, "acceptance": acceptance, "elapsed_seconds": perf_counter() - started,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"test": test, "acceptance": acceptance}, indent=2), flush=True)


if __name__ == "__main__":
    main()
