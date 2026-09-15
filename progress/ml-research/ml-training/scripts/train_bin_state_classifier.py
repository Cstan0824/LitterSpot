"""Train a lightweight binary classifier on labeled bin crops.

This experiment assumes a fixed-camera ROI or another upstream mechanism has
already localized the bin. GCO normal and full classes map to ``normal``;
overflowing maps to ``overflow``. Model selection uses validation only, and the
held-out test split is evaluated once after selection.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from PIL import Image, ImageDraw
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
from torchvision.transforms import v2


ROOT = Path(__file__).resolve().parents[2]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
CLASS_NAMES = ["normal", "overflow"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_v1")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--frozen-epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--context", type=float, default=0.15)
    parser.add_argument("--head-lr", type=float, default=1e-3)
    parser.add_argument("--finetune-lr", type=float, default=2e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--error-samples", type=int, default=36)
    return parser.parse_args()


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def image_for_label(images_dir: Path, label_path: Path) -> Path | None:
    for suffix in IMAGE_SUFFIXES:
        candidate = images_dir / f"{label_path.stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


def index_split(data_root: Path, split: str) -> list[dict[str, object]]:
    images_dir = data_root / split / "images"
    labels_dir = data_root / split / "labels"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise FileNotFoundError(f"Missing {split} images or labels under {data_root}")
    samples: list[dict[str, object]] = []
    for label_path in sorted(labels_dir.glob("*.txt")):
        image_path = image_for_label(images_dir, label_path)
        if image_path is None:
            continue
        for object_index, line in enumerate(label_path.read_text(encoding="utf-8").splitlines()):
            values = line.split()
            if len(values) < 5:
                continue
            source_class = int(values[0])
            if source_class not in {0, 1, 2}:
                continue
            cx, cy, width, height = (float(value) for value in values[1:5])
            samples.append(
                {
                    "image": image_path,
                    "object_index": object_index,
                    "source_class": source_class,
                    "target": 1 if source_class == 2 else 0,
                    "box": (cx, cy, width, height),
                }
            )
    if not samples:
        raise RuntimeError(f"No labeled objects found in {split}")
    return samples


def crop_bin(image: Image.Image, normalized_box: tuple[float, float, float, float], context: float) -> Image.Image:
    width, height = image.size
    cx, cy, box_width, box_height = normalized_box
    box_width *= 1 + context * 2
    box_height *= 1 + context * 2
    left = max(0.0, (cx - box_width / 2) * width)
    top = max(0.0, (cy - box_height / 2) * height)
    right = min(float(width), (cx + box_width / 2) * width)
    bottom = min(float(height), (cy + box_height / 2) * height)
    if right <= left or bottom <= top:
        raise ValueError(f"Invalid crop bounds: {(left, top, right, bottom)}")
    return image.crop((left, top, right, bottom)).convert("RGB")


class BinCropDataset(Dataset):
    def __init__(self, samples: list[dict[str, object]], transform, context: float) -> None:
        self.samples = samples
        self.transform = transform
        self.context = context

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image, sample["box"], self.context)
        return self.transform(crop), int(sample["target"]), index


def transforms(image_size: int):
    weights = MobileNet_V3_Small_Weights.DEFAULT
    preset = weights.transforms()
    normalization = v2.Normalize(mean=preset.mean, std=preset.std)
    train = v2.Compose(
        [
            v2.Resize((image_size + 32, image_size + 32), antialias=True),
            v2.RandomResizedCrop((image_size, image_size), scale=(0.80, 1.0), ratio=(0.85, 1.15), antialias=True),
            v2.RandomHorizontalFlip(),
            v2.ColorJitter(brightness=0.20, contrast=0.20, saturation=0.15, hue=0.03),
            v2.RandomRotation(5),
            v2.ToImage(),
            v2.ToDtype(torch.float32, scale=True),
            normalization,
        ]
    )
    evaluate = v2.Compose(
        [
            v2.Resize((image_size, image_size), antialias=True),
            v2.ToImage(),
            v2.ToDtype(torch.float32, scale=True),
            normalization,
        ]
    )
    return train, evaluate


def build_model() -> nn.Module:
    model = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
    input_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(input_features, len(CLASS_NAMES))
    return model


def set_trainable_phase(model: nn.Module, frozen: bool) -> None:
    for parameter in model.features.parameters():
        parameter.requires_grad = not frozen
    if not frozen:
        # Keep most generic features fixed; adapt only the final feature stages.
        for block in list(model.features.children())[:-4]:
            for parameter in block.parameters():
                parameter.requires_grad = False
    for parameter in model.classifier.parameters():
        parameter.requires_grad = True


def confusion_metrics(matrix: list[list[int]]) -> dict[str, object]:
    tn, fp = matrix[0]
    fn, tp = matrix[1]
    total = tn + fp + fn + tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    f2 = 5 * precision * recall / (4 * precision + recall) if 4 * precision + recall else 0.0
    return {
        "accuracy": (tp + tn) / total if total else 0.0,
        "overflow_precision": precision,
        "overflow_recall": recall,
        "overflow_f1": f1,
        "overflow_f2": f2,
        "normal_recall": specificity,
        "confusion_matrix": matrix,
    }


@torch.inference_mode()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device, criterion: nn.Module) -> tuple[dict[str, object], list[dict[str, object]]]:
    model.eval()
    matrix = [[0, 0], [0, 0]]
    loss_total = 0.0
    rows: list[dict[str, object]] = []
    for images, targets, indices in loader:
        images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)
        logits = model(images)
        loss_total += float(criterion(logits, targets)) * len(targets)
        probabilities = logits.softmax(dim=1)
        predictions = probabilities.argmax(dim=1)
        for target, prediction, probability, index in zip(targets.cpu(), predictions.cpu(), probabilities.cpu(), indices):
            actual, predicted = int(target), int(prediction)
            matrix[actual][predicted] += 1
            rows.append(
                {
                    "sample_index": int(index),
                    "actual": CLASS_NAMES[actual],
                    "predicted": CLASS_NAMES[predicted],
                    "overflow_probability": float(probability[1]),
                    "correct": actual == predicted,
                }
            )
    metrics = confusion_metrics(matrix)
    metrics["loss"] = loss_total / len(loader.dataset)
    return metrics, rows


def save_error_sheet(samples: list[dict[str, object]], rows: list[dict[str, object]], context: float, output: Path, limit: int) -> None:
    errors = sorted(
        (row for row in rows if not bool(row["correct"])),
        key=lambda row: abs(float(row["overflow_probability"]) - 0.5),
        reverse=True,
    )[:limit]
    if not errors:
        return
    tile_width, tile_height = 260, 300
    columns = 6
    rows_count = (len(errors) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_width, rows_count * tile_height), "#111713")
    draw = ImageDraw.Draw(sheet)
    for position, error in enumerate(errors):
        sample = samples[int(error["sample_index"])]
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image, sample["box"], context)
        crop.thumbnail((tile_width - 12, tile_height - 54))
        x = (position % columns) * tile_width
        y = (position // columns) * tile_height
        sheet.paste(crop, (x + (tile_width - crop.width) // 2, y + 4))
        label = f"{error['actual']} -> {error['predicted']}  p={float(error['overflow_probability']):.2f}"
        draw.text((x + 6, y + tile_height - 42), label, fill="#ff9e9e")
    sheet.save(output)


def main() -> None:
    args = parse_args()
    seed_everything(args.seed)
    data_root = args.data.resolve()
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    device = torch.device(args.device)

    split_samples = {split: index_split(data_root, split) for split in ("train", "valid", "test")}
    counts = {
        split: Counter(CLASS_NAMES[int(sample["target"])] for sample in samples)
        for split, samples in split_samples.items()
    }
    print(f"DATA_COUNTS={{{', '.join(f'{key}: {dict(value)}' for key, value in counts.items())}}}", flush=True)

    train_transform, eval_transform = transforms(args.image_size)
    datasets = {
        "train": BinCropDataset(split_samples["train"], train_transform, args.context),
        "valid": BinCropDataset(split_samples["valid"], eval_transform, args.context),
        "test": BinCropDataset(split_samples["test"], eval_transform, args.context),
    }
    generator = torch.Generator().manual_seed(args.seed)
    loaders = {
        "train": DataLoader(datasets["train"], batch_size=args.batch, shuffle=True, num_workers=args.workers, pin_memory=True, generator=generator),
        "valid": DataLoader(datasets["valid"], batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=True),
        "test": DataLoader(datasets["test"], batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=True),
    }

    model = build_model().to(device)
    train_counts = counts["train"]
    class_weights = torch.tensor(
        [
            (sum(train_counts.values()) / (2 * train_counts["normal"])),
            (sum(train_counts.values()) / (2 * train_counts["overflow"])),
        ],
        dtype=torch.float32,
        device=device,
    )
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    history: list[dict[str, object]] = []
    best_score = -1.0
    best_epoch = -1
    best_path = output_dir / "best.pt"
    started = perf_counter()

    optimizer: torch.optim.Optimizer | None = None
    for epoch in range(1, args.epochs + 1):
        frozen = epoch <= args.frozen_epochs
        if epoch == 1 or epoch == args.frozen_epochs + 1:
            set_trainable_phase(model, frozen=frozen)
            learning_rate = args.head_lr if frozen else args.finetune_lr
            optimizer = torch.optim.AdamW(
                (parameter for parameter in model.parameters() if parameter.requires_grad),
                lr=learning_rate,
                weight_decay=args.weight_decay,
            )
        assert optimizer is not None
        model.train()
        train_loss = 0.0
        for images, targets, _ in loaders["train"]:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                logits = model(images)
                loss = criterion(logits, targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            train_loss += float(loss) * len(targets)
        valid_metrics, _ = evaluate(model, loaders["valid"], device, criterion)
        score = float(valid_metrics["overflow_f2"])
        row = {
            "epoch": epoch,
            "phase": "head" if frozen else "finetune",
            "train_loss": train_loss / len(datasets["train"]),
            **valid_metrics,
        }
        history.append(row)
        print(
            f"EPOCH {epoch}/{args.epochs} phase={row['phase']} train_loss={row['train_loss']:.4f} "
            f"val_accuracy={valid_metrics['accuracy']:.4f} overflow_P={valid_metrics['overflow_precision']:.4f} "
            f"overflow_R={valid_metrics['overflow_recall']:.4f} overflow_F2={score:.4f}",
            flush=True,
        )
        if score > best_score:
            best_score, best_epoch = score, epoch
            torch.save(
                {
                    "model": model.state_dict(),
                    "architecture": "mobilenet_v3_small",
                    "class_names": CLASS_NAMES,
                    "image_size": args.image_size,
                    "context": args.context,
                    "epoch": epoch,
                    "validation": valid_metrics,
                },
                best_path,
            )

    checkpoint = torch.load(best_path, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model"])
    test_metrics, test_rows = evaluate(model, loaders["test"], device, criterion)
    elapsed = perf_counter() - started
    acceptance = {
        "accuracy_at_least_0_85": float(test_metrics["accuracy"]) >= 0.85,
        "overflow_precision_at_least_0_80": float(test_metrics["overflow_precision"]) >= 0.80,
        "overflow_recall_at_least_0_80": float(test_metrics["overflow_recall"]) >= 0.80,
        "overflow_f1_at_least_0_80": float(test_metrics["overflow_f1"]) >= 0.80,
    }
    acceptance["passed"] = all(acceptance.values())
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "fixed-ROI binary state classification",
        "architecture": "mobilenet_v3_small",
        "pretrained": True,
        "mapping": {"normal trash bin": "normal", "full trash bin": "normal", "overflowing trash bin": "overflow"},
        "data_counts": {split: dict(count) for split, count in counts.items()},
        "settings": vars(args) | {"data": str(data_root), "output": str(output_dir)},
        "best_epoch": best_epoch,
        "best_validation_f2": best_score,
        "history": history,
        "test": test_metrics,
        "acceptance": acceptance,
        "elapsed_seconds": elapsed,
        "peak_vram_mb": float(torch.cuda.max_memory_allocated() / 2**20) if device.type == "cuda" else 0.0,
    }
    (output_dir / "report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    with (output_dir / "test_predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(test_rows[0]))
        writer.writeheader()
        writer.writerows(test_rows)
    save_error_sheet(split_samples["test"], test_rows, args.context, output_dir / "errors.jpg", args.error_samples)
    print(json.dumps({"test": test_metrics, "acceptance": acceptance}, indent=2), flush=True)
    print(f"REPORT={output_dir / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
