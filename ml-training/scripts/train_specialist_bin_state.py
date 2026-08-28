"""Train the fixed-camera bin-state specialist from reviewed manifest crops.

The locked ``mock-data`` benchmark is intentionally rejected by the companion
data audit. This trainer consumes only reviewed rows from
``ml-training/data/specialists/manifest.json`` and writes the checkpoint format
loaded by ``BinStateSpecialistAdapter``.
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small
from torchvision.transforms import v2


ROOT = Path(__file__).resolve().parents[2]
VALID_STATES = {"normal", "full", "overflow", "unknown"}


class MultiTaskMobileNet(nn.Module):
    """Architecture shared with the runtime bin-state adapter."""

    def __init__(self) -> None:
        super().__init__()
        base = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
        self.features = base.features
        self.avgpool = base.avgpool
        features = base.classifier[0].in_features
        self.dropout = nn.Dropout(0.2)
        self.presence_head = nn.Linear(features, 1)
        self.fullness_head = nn.Linear(features, 1)
        self.overflow_head = nn.Linear(features, 1)

    def forward(self, images: torch.Tensor) -> dict[str, torch.Tensor]:
        features = self.avgpool(self.features(images)).flatten(1)
        features = self.dropout(features)
        return {
            "presence": self.presence_head(features).squeeze(1),
            "fullness": self.fullness_head(features).squeeze(1),
            "overflow": self.overflow_head(features).squeeze(1),
        }


def _resolve(value: str, root: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def load_manifest_samples(manifest: Path, root: Path = ROOT) -> dict[str, list[dict[str, Any]]]:
    """Map reviewed bin manifest rows into independent training targets."""
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    samples = {split: [] for split in ("train", "valid", "test")}
    for row in payload.get("samples", []):
        if row.get("pipeline") != "bin_state":
            continue
        label = row.get("label", {})
        state = label.get("state")
        if state not in VALID_STATES or not isinstance(label.get("binPresent"), bool):
            raise ValueError(f"Invalid bin-state label in {row.get('sampleId', '<unknown>')}")
        split = row.get("split")
        if split not in samples:
            raise ValueError(f"Invalid split in {row.get('sampleId', '<unknown>')}: {split!r}")
        path = _resolve(str(row["path"]), root).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Training image is missing: {path}")
        known_state = state != "unknown"
        presence_known = bool(label.get("presenceKnown", True))
        fullness_known = bool(label.get("fullnessKnown", known_state))
        overflow_known = bool(label.get("overflowKnown", known_state))
        samples[split].append({
            "sampleId": str(row["sampleId"]),
            "image": path,
            "group": str(row["captureGroup"]),
            "state": state,
            "presence": float(label["binPresent"]),
            "presence_mask": float(presence_known),
            "fullness": float(state in {"full", "overflow"}),
            "fullness_mask": float(fullness_known),
            "overflow": float(state == "overflow"),
            "overflow_mask": float(overflow_known),
        })
    return samples


class BinCropDataset(Dataset):
    def __init__(self, samples: list[dict[str, Any]], transform) -> None:
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        with Image.open(sample["image"]) as image:
            tensor = self.transform(image.convert("RGB"))
        labels = {
            key: torch.tensor(float(sample[key]), dtype=torch.float32)
            for key in ("presence", "presence_mask", "fullness", "fullness_mask", "overflow", "overflow_mask")
        }
        return tensor, labels, index


def transforms(image_size: int):
    weights = MobileNet_V3_Small_Weights.DEFAULT
    normalize = v2.Normalize(mean=weights.transforms().mean, std=weights.transforms().std)
    train = v2.Compose([
        v2.Resize((image_size, image_size), antialias=True),
        v2.RandomHorizontalFlip(p=0.5),
        v2.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
        v2.ToImage(), v2.ToDtype(torch.float32, scale=True), normalize,
    ])
    evaluate = v2.Compose([
        v2.Resize((image_size, image_size), antialias=True),
        v2.ToImage(), v2.ToDtype(torch.float32, scale=True), normalize,
    ])
    return train, evaluate


def _metrics(targets: list[int], probabilities: list[float], threshold: float) -> dict[str, float | list[list[int]]]:
    matrix = [[0, 0], [0, 0]]
    for target, probability in zip(targets, probabilities):
        matrix[target][int(probability >= threshold)] += 1
    tn, fp = matrix[0]
    fn, tp = matrix[1]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "confusionMatrix": matrix,
    }


def _task_values(rows: list[dict[str, Any]], task: str) -> tuple[list[int], list[float]]:
    if task == "presence":
        selected = [row for row in rows if row["presence_mask"]]
    else:
        selected = [row for row in rows if row[f"{task}_mask"]]
    return [int(row[task]) for row in selected], [float(row[f"{task}_probability"]) for row in selected]


def _calibrate(rows: list[dict[str, Any]], task: str) -> tuple[float, dict[str, float | list[list[int]]]]:
    targets, probabilities = _task_values(rows, task)
    if not targets or len(set(targets)) < 2:
        raise ValueError(f"Validation split needs positive and negative labels for {task}")
    candidates = [(step / 100, _metrics(targets, probabilities, step / 100)) for step in range(10, 91)]
    viable = [candidate for candidate in candidates if candidate[1]["precision"] >= .80 and candidate[1]["recall"] >= .80]
    return max(viable or candidates, key=lambda item: float(item[1]["f1"]))


@torch.inference_mode()
def predict(model: nn.Module, loader: DataLoader, samples: list[dict[str, Any]], device: torch.device) -> list[dict[str, Any]]:
    model.eval()
    rows: list[dict[str, Any]] = []
    for images, labels, indices in loader:
        outputs = model(images.to(device, non_blocking=True))
        probabilities = {name: torch.sigmoid(value).cpu().tolist() for name, value in outputs.items()}
        for position, index in enumerate(indices.tolist()):
            sample = samples[index]
            rows.append({
                "sampleId": sample["sampleId"], "group": sample["group"], "state": sample["state"],
                **{name: float(labels[name][position]) for name in labels},
                **{f"{name}_probability": float(values[position]) for name, values in probabilities.items()},
            })
    return rows


def _state_metrics(rows: list[dict[str, Any]], thresholds: dict[str, float]) -> dict[str, Any]:
    states = ["normal", "full", "overflow", "unknown"]
    matrix = [[0] * len(states) for _ in states]
    for row in rows:
        if row["presence_probability"] < thresholds["presence"]:
            predicted = "unknown"
        elif row["overflow_probability"] >= thresholds["overflow"]:
            predicted = "overflow"
        elif row["fullness_probability"] >= thresholds["fullness"]:
            predicted = "full"
        else:
            predicted = "normal"
        matrix[states.index(row["state"])][states.index(predicted)] += 1
    return {"states": states, "confusionMatrix": matrix}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/specialist_mobilenet_v3_small_v1")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--context", type=float, default=.15)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch < 1 or not 64 <= args.image_size <= 512 or not 0 <= args.context <= .5:
        raise SystemExit("Invalid training parameters")
    random.seed(args.seed); torch.manual_seed(args.seed)
    samples = load_manifest_samples(args.manifest.resolve())
    if any(not samples[split] for split in samples):
        raise SystemExit("Manifest requires non-empty train, valid, and test bin_state splits")
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"Refusing to overwrite existing run: {output}")
    output.mkdir(parents=True)
    device = torch.device(args.device if not str(args.device).isdigit() else f"cuda:{args.device}")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise SystemExit(f"CUDA device requested but unavailable: {device}")
    train_transform, eval_transform = transforms(args.image_size)
    train_counts = Counter(sample["state"] for sample in samples["train"])
    weights = [1 / train_counts[sample["state"]] for sample in samples["train"]]
    train_loader = DataLoader(BinCropDataset(samples["train"], train_transform), batch_size=args.batch,
                              sampler=WeightedRandomSampler(weights, len(weights), replacement=True),
                              num_workers=args.workers, pin_memory=device.type == "cuda")
    loaders = {
        split: DataLoader(BinCropDataset(split_samples, eval_transform), batch_size=args.batch,
                          num_workers=args.workers, pin_memory=device.type == "cuda")
        for split, split_samples in samples.items() if split != "train"
    }
    model = MultiTaskMobileNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    criterion = nn.BCEWithLogitsLoss(reduction="none")
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    best_score, history, started = -1.0, [], perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train(); total_loss = 0.0
        for images, labels, _ in train_loader:
            images = images.to(device, non_blocking=True)
            labels = {name: value.to(device, non_blocking=True) for name, value in labels.items()}
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                output_values = model(images)
                presence_mask = labels["presence_mask"]
                losses = [(criterion(output_values["presence"], labels["presence"]) * presence_mask).sum() / presence_mask.sum().clamp_min(1)]
                for task in ("fullness", "overflow"):
                    mask = labels[f"{task}_mask"]
                    losses.append((criterion(output_values[task], labels[task]) * mask).sum() / mask.sum().clamp_min(1))
                loss = sum(losses)
            scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            total_loss += float(loss.detach()) * len(images)
        valid_rows = predict(model, loaders["valid"], samples["valid"], device)
        thresholds_and_metrics = {task: _calibrate(valid_rows, task) for task in ("presence", "fullness", "overflow")}
        thresholds = {task: value[0] for task, value in thresholds_and_metrics.items()}
        scores = {task: float(value[1]["f1"]) for task, value in thresholds_and_metrics.items()}
        score = min(scores.values())
        history.append({"epoch": epoch, "loss": total_loss / len(samples["train"]), "thresholds": thresholds, "validationF1": scores})
        if score > best_score:
            best_score = score
            torch.save({
                "model": model.state_dict(), "architecture": "multitask_mobilenet_v3_small",
                "class_names": ["normal", "full", "overflow", "unknown"], "image_size": args.image_size,
                "context": args.context, "thresholds": thresholds, "epoch": epoch,
                "modelVersion": "specialist-mobilenet-v3-small-v1",
            }, output / "best.pt")
    checkpoint = torch.load(output / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model"])
    test_rows = predict(model, loaders["test"], samples["test"], device)
    thresholds = checkpoint["thresholds"]
    tasks = {task: _metrics(*_task_values(test_rows, task), thresholds[task]) for task in thresholds}
    acceptance = {
        "overflowRecallAtLeast090": tasks["overflow"]["recall"] >= .90,
        "overflowPrecisionAtLeast085": tasks["overflow"]["precision"] >= .85,
        "containedFullRecallAtLeast085": tasks["fullness"]["recall"] >= .85,
    }
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(), "manifest": str(args.manifest.resolve()),
        "sampleCounts": {split: len(values) for split, values in samples.items()}, "history": history,
        "selectedEpoch": checkpoint["epoch"], "thresholds": thresholds, "testTasks": tasks,
        "testStates": _state_metrics(test_rows, thresholds), "acceptance": acceptance | {"passed": all(acceptance.values())},
        "elapsedSeconds": perf_counter() - started,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "acceptance": report["acceptance"]}, indent=2))


if __name__ == "__main__":
    main()
