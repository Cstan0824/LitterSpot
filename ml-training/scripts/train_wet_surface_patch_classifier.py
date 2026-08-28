#!/usr/bin/env python3
"""Train and test a compact public wet/dry change-proposal classifier."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision.datasets import ImageFolder
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
from torchvision.transforms import v2


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = ROOT / "dataset/floor_spill/wet_surface_patches_v1"
DEFAULT_OUTPUT = ROOT / "ml-training/floor_rubbish/runs/patch_classifiers/wet_surface_mobilenet_v3_small_seed42"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_metrics(confusion: list[list[int]]) -> dict[str, float | int | list[list[int]]]:
    """Return dry=0/wet=1 metrics from a row=true, column=pred matrix."""
    tn, fp = confusion[0]
    fn, tp = confusion[1]
    total = tn + fp + fn + tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {
        "confusion": confusion,
        "sampleCount": total,
        "accuracy": (tp + tn) / total if total else 0.0,
        "wetPrecision": precision,
        "wetRecall": recall,
        "wetF1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "drySpecificity": specificity,
    }


def build_report(
    *,
    data: Path,
    checkpoint: Path,
    parameter_count: int,
    seed: int,
    history: list[dict[str, Any]],
    test_metrics: dict[str, Any],
) -> dict[str, Any]:
    gates = {
        "wetRecall": {"value": test_metrics["wetRecall"], "minimum": .95},
        "wetPrecision": {"value": test_metrics["wetPrecision"], "minimum": .90},
        "drySpecificity": {"value": test_metrics["drySpecificity"], "minimum": .90},
    }
    for gate in gates.values():
        gate["passed"] = gate["value"] >= gate["minimum"]
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "architecture": "mobilenet_v3_small_binary_patch_classifier",
        "parameterCount": parameter_count,
        "seed": seed,
        "dataset": str(data.resolve()),
        "datasetManifestSha256": _sha256(data / "manifest.json"),
        "checkpoint": str(checkpoint.resolve()),
        "history": history,
        "test": test_metrics,
        "publicDiagnosticGates": gates,
        "publicDiagnosticPassed": all(gate["passed"] for gate in gates.values()),
        "evidenceTier": "public",
        "qualificationEligible": False,
        "dispatchEligible": False,
        "intendedUse": "semantic_validator_for_fixed_camera_change_proposals",
        "limitations": [
            "Dry crops are automatically sampled and are not manually confirmed floor-only hard negatives.",
            "Wet labels are water/wet-surface surrogates, not verified F&B spill labels.",
            "Real project-camera event qualification is required before integration can be dispatch eligible.",
        ],
    }


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _datasets(data: Path, image_size: int, low_light_augmentation: bool = False):
    weights = MobileNet_V3_Small_Weights.DEFAULT
    mean, std = weights.transforms().mean, weights.transforms().std
    common = [
        v2.Resize((image_size, image_size), antialias=True),
        v2.ToImage(),
        v2.ToDtype(torch.float32, scale=True),
        v2.Normalize(mean=mean, std=std),
    ]
    augmentations = [v2.RandomHorizontalFlip()]
    if low_light_augmentation:
        augmentations.extend([
            v2.RandomApply([
                v2.ColorJitter(brightness=(.15, .75), contrast=(.45, 1.25), saturation=(.5, 1.1)),
            ], p=.65),
            v2.RandomAutocontrast(p=.15),
            v2.RandomGrayscale(p=.05),
        ])
    else:
        augmentations.append(v2.ColorJitter(brightness=.2, contrast=.2, saturation=.1))
    train = ImageFolder(data / "train", transform=v2.Compose([*augmentations, *common]))
    validation = ImageFolder(data / "val", transform=v2.Compose(common))
    test = ImageFolder(data / "test", transform=v2.Compose(common))
    expected = {"dry": 0, "wet": 1}
    if train.class_to_idx != expected or validation.class_to_idx != expected or test.class_to_idx != expected:
        raise ValueError(f"expected class mapping {expected}")
    return train, validation, test


def _evaluate(model, loader, device, loss_function) -> tuple[float, dict[str, Any]]:
    model.eval()
    confusion = [[0, 0], [0, 0]]
    losses, timings = [], []
    with torch.inference_mode():
        for inputs, targets in loader:
            inputs, targets = inputs.to(device), targets.to(device)
            if device.type == "cuda":
                torch.cuda.synchronize(device)
            started = perf_counter()
            logits = model(inputs)
            if device.type == "cuda":
                torch.cuda.synchronize(device)
            timings.append((perf_counter() - started) * 1000 / len(inputs))
            losses.append(float(loss_function(logits, targets).detach().cpu()))
            for expected, predicted in zip(targets.cpu().tolist(), logits.argmax(1).cpu().tolist()):
                confusion[expected][predicted] += 1
    metrics = compute_metrics(confusion)
    timings.sort()
    metrics["inferenceMeanMsPerCrop"] = sum(timings) / len(timings) if timings else 0.0
    metrics["inferenceP95MsPerCrop"] = timings[min(len(timings) - 1, math.ceil(.95 * len(timings)) - 1)] if timings else 0.0
    return sum(losses) / len(losses), metrics


def train(args: argparse.Namespace) -> dict[str, Any]:
    data, output = args.data.resolve(), args.output.resolve()
    if not (data / "manifest.json").is_file():
        raise FileNotFoundError(data / "manifest.json")
    if output.exists() and any(output.rglob("*")):
        raise FileExistsError(f"output is not empty; use a new immutable run name: {output}")
    output.mkdir(parents=True, exist_ok=True)
    _seed_everything(args.seed)
    device = torch.device(args.device if args.device != "auto" else ("cuda:0" if torch.cuda.is_available() else "cpu"))
    train_data, val_data, test_data = _datasets(data, args.image_size, args.low_light_augmentation)
    generator = torch.Generator().manual_seed(args.seed)
    loader_options = {
        "num_workers": args.workers,
        "pin_memory": device.type == "cuda",
        "persistent_workers": args.workers > 0,
    }
    train_loader = DataLoader(train_data, batch_size=args.batch, shuffle=True, generator=generator, **loader_options)
    val_loader = DataLoader(val_data, batch_size=args.batch, shuffle=False, **loader_options)
    test_loader = DataLoader(test_data, batch_size=args.batch, shuffle=False, **loader_options)

    model = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 2)
    model.to(device)
    class_counts = np.bincount(train_data.targets, minlength=2)
    weights = torch.tensor(class_counts.sum() / np.maximum(class_counts, 1), dtype=torch.float32, device=device)
    loss_function = nn.CrossEntropyLoss(weight=weights / weights.sum() * 2)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    amp_enabled = device.type == "cuda" and not args.disable_amp
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    history, best_score = [], -1.0
    epochs_without_improvement = 0
    checkpoint = output / "best.pt"
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_losses = []
        for inputs, targets in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=amp_enabled):
                logits = model(inputs)
                loss = loss_function(logits, targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            train_losses.append(float(loss.detach().cpu()))
        scheduler.step()
        val_loss, val_metrics = _evaluate(model, val_loader, device, loss_function)
        score = float(val_metrics["wetF1"]) * float(val_metrics["drySpecificity"])
        row = {
            "epoch": epoch,
            "trainLoss": sum(train_losses) / len(train_losses),
            "validationLoss": val_loss,
            **val_metrics,
        }
        history.append(row)
        print(json.dumps(row), flush=True)
        if score > best_score:
            best_score = score
            epochs_without_improvement = 0
            torch.save({
                "architecture": "mobilenet_v3_small_binary_patch_classifier",
                "model": model.state_dict(),
                "classes": ["dry", "wet"],
                "imageSize": args.image_size,
                "seed": args.seed,
                "datasetManifestSha256": _sha256(data / "manifest.json"),
                "evidenceTier": "public",
                "qualificationEligible": False,
                "lowLightAugmentation": args.low_light_augmentation,
            }, checkpoint)
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= args.patience:
                break
    saved = torch.load(checkpoint, map_location=device, weights_only=True)
    model.load_state_dict(saved["model"])
    _test_loss, test_metrics = _evaluate(model, test_loader, device, loss_function)
    report = build_report(
        data=data, checkpoint=checkpoint,
        parameter_count=sum(parameter.numel() for parameter in model.parameters()),
        seed=args.seed, history=history, test_metrics=test_metrics,
    )
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "history"}, indent=2))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--image-size", type=int, default=160)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--low-light-augmentation", action="store_true")
    parser.add_argument("--disable-amp", action="store_true")
    args = parser.parse_args()
    train(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
