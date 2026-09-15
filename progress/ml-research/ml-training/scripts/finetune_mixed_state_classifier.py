"""Adapt MobileNet jointly to GCO and GBS with domain/class-balanced sampling."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from torch import nn
from torch.utils.data import ConcatDataset, DataLoader, WeightedRandomSampler

from evaluate_gbs_state_classifier import index_gbs
from finetune_gbs_state_classifier import temporal_splits
from train_bin_state_classifier import BinCropDataset, CLASS_NAMES, ROOT, build_model, evaluate, index_split, seed_everything, transforms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1-2/best.pt")
    parser.add_argument("--gco", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--gbs", type=Path, default=ROOT / "ml-training/data/raw/GBS")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_gbs_mixed_v1")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--samples-per-epoch", type=int, default=30000)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def gates(metrics: dict[str, object]) -> dict[str, bool]:
    values = {
        "accuracy_at_least_0_85": float(metrics["accuracy"]) >= 0.85,
        "overflow_precision_at_least_0_80": float(metrics["overflow_precision"]) >= 0.80,
        "overflow_recall_at_least_0_80": float(metrics["overflow_recall"]) >= 0.80,
        "overflow_f1_at_least_0_80": float(metrics["overflow_f1"]) >= 0.80,
    }
    values["passed"] = all(values.values())
    return values


def main() -> None:
    args = parse_args()
    seed_everything(42)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    device = torch.device(args.device)
    base = torch.load(args.base.resolve(), map_location="cpu", weights_only=True)
    gco = {split: index_split(args.gco.resolve(), split) for split in ("train", "valid", "test")}
    gbs = temporal_splits(index_gbs(args.gbs.resolve()))
    train_transform, eval_transform = transforms(int(base["image_size"]))
    context = float(base["context"])
    gco_train = BinCropDataset(gco["train"], train_transform, context)
    gbs_train = BinCropDataset(gbs["train"], train_transform, context)
    train_dataset = ConcatDataset([gco_train, gbs_train])
    group_counts = {
        (domain, target): sum(int(sample["target"]) == target for sample in samples)
        for domain, samples in (("gco", gco["train"]), ("gbs", gbs["train"])) for target in (0, 1)
    }
    sample_weights = [1 / group_counts[("gco", int(sample["target"]))] for sample in gco["train"]]
    sample_weights += [1 / group_counts[("gbs", int(sample["target"]))] for sample in gbs["train"]]
    sampler = WeightedRandomSampler(sample_weights, num_samples=args.samples_per_epoch, replacement=True, generator=torch.Generator().manual_seed(42))
    train_loader = DataLoader(train_dataset, batch_size=args.batch, sampler=sampler, num_workers=args.workers, pin_memory=device.type == "cuda")
    validation_loaders = {
        "gco": DataLoader(BinCropDataset(gco["valid"], eval_transform, context), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda"),
        "gbs": DataLoader(BinCropDataset(gbs["valid"], eval_transform, context), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda"),
    }
    test_loaders = {
        "gco": DataLoader(BinCropDataset(gco["test"], eval_transform, context), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda"),
        "gbs": DataLoader(BinCropDataset(gbs["test"], eval_transform, context), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda"),
    }
    model = build_model()
    model.load_state_dict(base["model"])
    model.to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    history: list[dict[str, object]] = []
    best_score = -1.0
    started = perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_total = 0.0
        for images, targets, _ in train_loader:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                loss = criterion(model(images), targets)
            scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            loss_total += float(loss) * len(targets)
        validation = {domain: evaluate(model, loader, device, criterion)[0] for domain, loader in validation_loaders.items()}
        score = min(float(metrics["overflow_f2"]) for metrics in validation.values())
        history.append({"epoch": epoch, "train_loss": loss_total / args.samples_per_epoch, "selection_score": score, "validation": validation})
        print(f"EPOCH {epoch}/{args.epochs} loss={loss_total/args.samples_per_epoch:.4f} score={score:.4f} GCO_P/R={validation['gco']['overflow_precision']:.3f}/{validation['gco']['overflow_recall']:.3f} GBS_P/R={validation['gbs']['overflow_precision']:.3f}/{validation['gbs']['overflow_recall']:.3f}", flush=True)
        if score > best_score:
            best_score = score
            torch.save({"model": model.state_dict(), "architecture": "mobilenet_v3_small", "class_names": CLASS_NAMES, "image_size": int(base["image_size"]), "context": context, "epoch": epoch, "validation": validation, "domain_adaptation": "balanced GCO+GBS rehearsal"}, output / "best.pt")
    selected = torch.load(output / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(selected["model"])
    test = {domain: evaluate(model, loader, device, criterion)[0] for domain, loader in test_loaders.items()}
    acceptance = {domain: gates(metrics) for domain, metrics in test.items()}
    acceptance["passed_both_domains"] = all(value["passed"] for value in acceptance.values())
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "experiment": "balanced mixed-domain adaptation", "selected_epoch": int(selected["epoch"]), "sampling_groups": {str(key): value for key, value in group_counts.items()}, "history": history, "test": test, "acceptance": acceptance, "elapsed_seconds": perf_counter() - started}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"test": test, "acceptance": acceptance}, indent=2), flush=True)


if __name__ == "__main__":
    main()
