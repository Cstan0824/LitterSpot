"""Train and evaluate a three-class fill-level model on the pinned public data.

Model selection uses simulated validation images only.  The real-domain split
is evaluated exactly once after selection and is never used for thresholds or
hyperparameters.  This model predicts fill level, not physical overflow.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime
import json
from pathlib import Path
import random
from time import perf_counter
from typing import Any

from PIL import Image
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
from torchvision.transforms import v2


ROOT = Path(__file__).resolve().parents[2]
CLASS_NAMES = ("empty", "halffull", "full")


def load_samples(manifest: Path) -> dict[str, list[dict[str, Any]]]:
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    result: dict[str, list[dict[str, Any]]] = {split: [] for split in ("train", "valid", "test")}
    seen: set[Path] = set()
    for row in payload.get("samples", []):
        split, domain, label = str(row["split"]), str(row["domain"]), str(row["fillLevel"])
        if split not in result or label not in CLASS_NAMES:
            raise ValueError(f"Invalid split or fill level in {row.get('sampleId')}")
        if domain == "real" and split != "test":
            raise ValueError("Real-domain images must remain test-only")
        if domain == "simulated" and split == "test":
            raise ValueError("The held-out test split must contain real-domain images only")
        path = (manifest.parent / str(row["path"])).resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        if path in seen:
            raise ValueError(f"Duplicate image across splits: {path}")
        seen.add(path)
        result[split].append({**row, "image": path, "target": CLASS_NAMES.index(label)})
    return result


def classification_metrics(targets: list[int], predictions: list[int]) -> dict[str, Any]:
    matrix = [[0] * len(CLASS_NAMES) for _ in CLASS_NAMES]
    for target, prediction in zip(targets, predictions):
        matrix[target][prediction] += 1
    recalls, f1s = {}, []
    for index, name in enumerate(CLASS_NAMES):
        tp = matrix[index][index]
        actual = sum(matrix[index])
        predicted = sum(row[index] for row in matrix)
        precision = tp / predicted if predicted else 0.0
        recall = tp / actual if actual else 0.0
        recalls[name] = recall
        f1s.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    total = sum(map(sum, matrix))
    return {
        "accuracy": sum(matrix[index][index] for index in range(len(CLASS_NAMES))) / total if total else 0.0,
        "macroF1": sum(f1s) / len(f1s),
        "recallByClass": recalls,
        "confusionMatrix": matrix,
    }


class FillDataset(Dataset):
    def __init__(self, samples: list[dict[str, Any]], transform) -> None:
        self.samples, self.transform = samples, transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        with Image.open(sample["image"]) as image:
            tensor = self.transform(image.convert("RGB"))
        return tensor, int(sample["target"])


def transforms(image_size: int):
    weights = MobileNet_V3_Small_Weights.DEFAULT
    normalize = v2.Normalize(weights.transforms().mean, weights.transforms().std)
    train = v2.Compose([
        v2.Resize((image_size + 32, image_size + 32), antialias=True),
        v2.RandomResizedCrop((image_size, image_size), scale=(.78, 1.0), ratio=(.85, 1.15), antialias=True),
        v2.RandomHorizontalFlip(),
        v2.ColorJitter(brightness=.25, contrast=.25, saturation=.15, hue=.03),
        v2.ToImage(), v2.ToDtype(torch.float32, scale=True), normalize,
    ])
    evaluate = v2.Compose([
        v2.Resize((image_size, image_size), antialias=True),
        v2.ToImage(), v2.ToDtype(torch.float32, scale=True), normalize,
    ])
    return train, evaluate


def build_model() -> nn.Module:
    model = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(CLASS_NAMES))
    return model


@torch.inference_mode()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    model.eval(); targets: list[int] = []; predictions: list[int] = []; rows = []
    for images, labels in loader:
        probabilities = model(images.to(device, non_blocking=True)).softmax(dim=1).cpu()
        batch_predictions = probabilities.argmax(dim=1)
        for label, prediction, probability in zip(labels.tolist(), batch_predictions.tolist(), probabilities.tolist()):
            targets.append(label); predictions.append(prediction)
            rows.append({"actual": CLASS_NAMES[label], "predicted": CLASS_NAMES[prediction], "probabilities": dict(zip(CLASS_NAMES, probability))})
    return classification_metrics(targets, predictions), rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/public/waste-bin-dataset/manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/waste_bin_fill_loop2_v1")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--frozen-epochs", type=int, default=2)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    random.seed(args.seed); torch.manual_seed(args.seed); torch.cuda.manual_seed_all(args.seed)
    samples = load_samples(args.manifest.resolve())
    if any(not samples[split] for split in samples):
        raise SystemExit("Manifest requires non-empty train, valid, and test splits")
    for split in samples:
        if set(int(row["target"]) for row in samples[split]) != set(range(len(CLASS_NAMES))):
            raise SystemExit(f"Split {split} does not cover all fill-level classes")
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"Refusing to overwrite existing run: {output}")
    output.mkdir(parents=True)
    device = torch.device(args.device if not str(args.device).isdigit() else f"cuda:{args.device}")
    train_transform, eval_transform = transforms(args.image_size)
    counts = Counter(int(row["target"]) for row in samples["train"])
    weights = [1 / counts[int(row["target"])] for row in samples["train"]]
    loaders = {
        "train": DataLoader(FillDataset(samples["train"], train_transform), batch_size=args.batch,
                            sampler=WeightedRandomSampler(weights, len(weights), replacement=True,
                                                          generator=torch.Generator().manual_seed(args.seed)),
                            num_workers=args.workers, pin_memory=device.type == "cuda"),
        **{split: DataLoader(FillDataset(samples[split], eval_transform), batch_size=args.batch,
                             num_workers=args.workers, pin_memory=device.type == "cuda") for split in ("valid", "test")},
    }
    model = build_model().to(device)
    criterion = nn.CrossEntropyLoss(); history = []; best = -1.0; started = perf_counter()
    for epoch in range(1, args.epochs + 1):
        frozen = epoch <= args.frozen_epochs
        for parameter in model.features.parameters(): parameter.requires_grad = not frozen
        optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=1e-3 if frozen else 2e-4, weight_decay=1e-4)
        model.train(); loss_total = 0.0
        for images, labels in loaders["train"]:
            images, labels = images.to(device, non_blocking=True), labels.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True); loss = criterion(model(images), labels)
            loss.backward(); optimizer.step(); loss_total += float(loss.detach()) * len(labels)
        metrics, _ = evaluate(model, loaders["valid"], device)
        history.append({"epoch": epoch, "loss": loss_total / len(samples["train"]), "validation": metrics})
        print(f"EPOCH {epoch}/{args.epochs} loss={history[-1]['loss']:.4f} val_macro_f1={metrics['macroF1']:.4f}", flush=True)
        if float(metrics["macroF1"]) > best:
            best = float(metrics["macroF1"])
            torch.save({"model": model.state_dict(), "architecture": "mobilenet_v3_small", "classNames": CLASS_NAMES,
                        "imageSize": args.image_size, "epoch": epoch, "validation": metrics}, output / "best.pt")
    checkpoint = torch.load(output / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model"])
    test_metrics, test_rows = evaluate(model, loaders["test"], device)
    report = {
        "generatedAt": datetime.now(UTC).isoformat(), "task": "fill-level classification (not overflow)",
        "manifest": str(args.manifest.resolve()), "selectedEpoch": checkpoint["epoch"],
        "counts": {split: dict(Counter(str(row["fillLevel"]) for row in rows)) for split, rows in samples.items()},
        "history": history, "validation": checkpoint["validation"], "realDomainTest": test_metrics,
        "overflowLimitation": "No overflow labels were used; full output must not trigger an overflow alert.",
        "elapsedSeconds": perf_counter() - started,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "test-predictions.json").write_text(json.dumps(test_rows, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selectedEpoch": report["selectedEpoch"], "validation": report["validation"], "realDomainTest": test_metrics}, indent=2))


if __name__ == "__main__":
    main()
