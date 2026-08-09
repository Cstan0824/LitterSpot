"""Train a presence/fullness/overflow MobileNet with compatible GCO+GBS labels."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision.models import mobilenet_v3_small

from train_bin_state_classifier import ROOT, crop_bin, index_split, seed_everything, transforms


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


class MultiTaskMobileNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        base = mobilenet_v3_small(weights=None)
        self.features = base.features
        self.avgpool = base.avgpool
        feature_count = base.classifier[0].in_features
        self.dropout = nn.Dropout(0.2)
        self.presence_head = nn.Linear(feature_count, 1)
        self.fullness_head = nn.Linear(feature_count, 1)
        self.overflow_head = nn.Linear(feature_count, 1)

    def forward(self, images: torch.Tensor) -> dict[str, torch.Tensor]:
        features = self.avgpool(self.features(images)).flatten(1)
        features = self.dropout(features)
        return {
            "presence": self.presence_head(features).squeeze(1),
            "fullness": self.fullness_head(features).squeeze(1),
            "overflow": self.overflow_head(features).squeeze(1),
        }


def load_gbs(root: Path) -> list[dict[str, object]]:
    coco = json.loads((root / "Annotations/GBS_coco.json").read_text(encoding="utf-8"))
    images = {int(item["id"]): item for item in coco["images"]}
    sizes: dict[int, tuple[int, int]] = {}
    samples = []
    for annotation in coco["annotations"]:
        category = int(annotation["category_id"])
        if category not in {0, 1, 2}:
            continue
        image_id = int(annotation["image_id"])
        info = images[image_id]
        path = root / "Images" / str(info.get("file_name", f"{image_id:06d}.jpg"))
        if image_id not in sizes:
            width, height = int(info.get("width", 0)), int(info.get("height", 0))
            if width <= 0 or height <= 0:
                with Image.open(path) as image:
                    width, height = image.size
            sizes[image_id] = width, height
        width, height = sizes[image_id]
        x, y, box_width, box_height = (float(value) for value in annotation["bbox"])
        if box_width <= 2 or box_height <= 2:
            continue
        samples.append({
            "image": path, "image_id": image_id, "group": f"gbs_{category}",
            "box": ((x + box_width / 2) / width, (y + box_height / 2) / height, box_width / width, box_height / height),
            "presence": 0.0 if category == 2 else 1.0,
            "fullness": 0.0, "fullness_mask": 0.0,
            "overflow": 1.0 if category == 0 else 0.0, "overflow_mask": 0.0 if category == 2 else 1.0,
            "state": "unknown" if category == 2 else ("overflow" if category == 0 else "normal"),
        })
    return samples


def load_gco(root: Path, split: str) -> list[dict[str, object]]:
    samples = []
    for source in index_split(root, split):
        category = int(source["source_class"])
        samples.append({
            **source, "image_id": str(source["image"]), "group": f"gco_{category}", "presence": 1.0,
            "fullness": 1.0 if category == 1 else 0.0, "fullness_mask": 0.0 if category == 2 else 1.0,
            "overflow": 1.0 if category == 2 else 0.0, "overflow_mask": 1.0,
            "state": ("normal", "full", "overflow")[category],
        })
    return samples


def load_ood_negatives(root: Path, split: str) -> list[dict[str, object]]:
    """Load full-frame/crop OOD negatives split by source video or camera."""
    directory = root / split
    if not directory.is_dir():
        return []
    return [{
        "image": path, "image_id": str(path), "group": "ood_negative",
        "box": (.5, .5, 1.0, 1.0), "presence": 0.0,
        "fullness": 0.0, "fullness_mask": 0.0,
        "overflow": 0.0, "overflow_mask": 0.0, "state": "unknown",
    } for path in sorted(directory.rglob("*")) if path.suffix.lower() in IMAGE_SUFFIXES]


def temporal_gbs_splits(samples: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    image_ids = sorted({int(sample["image_id"]) for sample in samples})
    valid_start, test_start = image_ids[int(.70 * len(image_ids))], image_ids[int(.85 * len(image_ids))]
    return {
        "train": [sample for sample in samples if int(sample["image_id"]) < valid_start],
        "valid": [sample for sample in samples if valid_start <= int(sample["image_id"]) < test_start],
        "test": [sample for sample in samples if int(sample["image_id"]) >= test_start],
    }


class TaskDataset(Dataset):
    def __init__(self, samples, transform, context: float) -> None:
        self.samples, self.transform, self.context = samples, transform, context

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image, sample["box"], self.context)
        return self.transform(crop), {key: torch.tensor(float(sample[key])) for key in ("presence", "fullness", "fullness_mask", "overflow", "overflow_mask")}, index


def binary_metrics(targets: list[int], probabilities: list[float], threshold: float) -> dict[str, object]:
    matrix = [[0, 0], [0, 0]]
    for target, probability in zip(targets, probabilities):
        matrix[target][1 if probability >= threshold else 0] += 1
    tn, fp = matrix[0]; fn, tp = matrix[1]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "accuracy": (tp + tn) / sum(map(sum, matrix)), "confusion_matrix": matrix}


@torch.inference_mode()
def predict(model, loader, samples, device):
    model.eval(); rows = []
    for images, labels, indices in loader:
        outputs = model(images.to(device, non_blocking=True))
        probabilities = {key: torch.sigmoid(value).cpu().tolist() for key, value in outputs.items()}
        for position, index in enumerate(indices.tolist()):
            sample = samples[index]
            rows.append({"group": sample["group"], "state": sample["state"], **{f"{key}_probability": float(value[position]) for key, value in probabilities.items()}, **{key: float(labels[key][position]) for key in labels}})
    return rows


def task_rows(rows, task):
    if task == "presence":
        return [int(row["presence"]) for row in rows], [float(row["presence_probability"]) for row in rows]
    mask = f"{task}_mask"
    selected = [row for row in rows if float(row[mask]) == 1.0]
    return [int(row[task]) for row in selected], [float(row[f"{task}_probability"]) for row in selected]


def calibrate(rows, task):
    targets, probabilities = task_rows(rows, task)
    candidates = [(step / 1000, binary_metrics(targets, probabilities, step / 1000)) for step in range(100, 901)]
    viable = [item for item in candidates if item[1]["precision"] >= .80 and item[1]["recall"] >= .80]
    return max(viable or candidates, key=lambda item: item[1]["f1"])


def state_metrics(rows, thresholds):
    classes = ["normal", "full", "overflow", "unknown"]
    matrix = [[0] * 4 for _ in classes]
    for row in rows:
        if float(row["presence_probability"]) < thresholds["presence"]:
            predicted = "unknown"
        elif float(row["overflow_probability"]) >= thresholds["overflow"]:
            predicted = "overflow"
        elif float(row["fullness_probability"]) >= thresholds["fullness"]:
            predicted = "full"
        else:
            predicted = "normal"
        matrix[classes.index(str(row["state"]))][classes.index(predicted)] += 1
    recalls = {classes[i]: matrix[i][i] / sum(matrix[i]) if sum(matrix[i]) else None for i in range(4)}
    total = sum(map(sum, matrix))
    return {"accuracy": sum(matrix[i][i] for i in range(4)) / total, "recall": recalls, "confusion_matrix": matrix}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multitask_gco_gbs_ood_v3")
    parser.add_argument("--base", type=Path, default=ROOT / "runs/state_classifier/multitask_gco_gbs_v2/production.pt")
    parser.add_argument("--hard-negative-dir", type=Path, default=ROOT / "ml-training/data/state-hard-negatives")
    parser.add_argument("--epochs", type=int, default=3); parser.add_argument("--samples-per-epoch", type=int, default=36000)
    parser.add_argument("--batch", type=int, default=128); parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--lr", type=float, default=5e-5); parser.add_argument("--context", type=float, default=.15)
    args = parser.parse_args(); seed_everything(42)
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=False)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    gco = {split: load_gco(ROOT / "ml-training/data/processed", split) for split in ("train", "valid", "test")}
    gbs = temporal_gbs_splits(load_gbs(ROOT / "ml-training/data/raw/GBS"))
    ood = {split: load_ood_negatives(args.hard_negative_dir, split) for split in ("train", "valid", "test")}
    train_samples = gco["train"] + gbs["train"] + ood["train"]
    group_counts = Counter(str(sample["group"]) for sample in train_samples)
    weights = [1 / group_counts[str(sample["group"])] for sample in train_samples]
    train_transform, eval_transform = transforms(224)
    train_loader = DataLoader(TaskDataset(train_samples, train_transform, args.context), batch_size=args.batch, sampler=WeightedRandomSampler(weights, args.samples_per_epoch, replacement=True, generator=torch.Generator().manual_seed(42)), num_workers=args.workers, pin_memory=device.type == "cuda")
    split_samples = {
        "gco_valid": gco["valid"], "gco_test": gco["test"],
        "gbs_valid": gbs["valid"], "gbs_test": gbs["test"],
        "ood_valid": ood["valid"], "ood_test": ood["test"],
    }
    loaders = {name: DataLoader(TaskDataset(samples, eval_transform, args.context), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda") for name, samples in split_samples.items()}
    model = MultiTaskMobileNet()
    base = torch.load(args.base.resolve(), map_location="cpu", weights_only=True)["model"]
    model.features.load_state_dict({key.removeprefix("features."): value for key, value in base.items() if key.startswith("features.")})
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    criterion = nn.BCEWithLogitsLoss(reduction="none"); scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    history = []; best_score = -1.0; started = perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train(); loss_total = 0.0
        for images, labels, _ in train_loader:
            images = images.to(device, non_blocking=True); labels = {key: value.to(device, non_blocking=True) for key, value in labels.items()}
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                outputs = model(images)
                presence_loss = criterion(outputs["presence"], labels["presence"]).mean()
                fullness_loss = (criterion(outputs["fullness"], labels["fullness"]) * labels["fullness_mask"]).sum() / labels["fullness_mask"].sum().clamp_min(1)
                overflow_loss = (criterion(outputs["overflow"], labels["overflow"]) * labels["overflow_mask"]).sum() / labels["overflow_mask"].sum().clamp_min(1)
                loss = presence_loss + fullness_loss + overflow_loss
            scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update(); loss_total += float(loss) * len(images)
        validation_rows = {name: predict(model, loaders[name], split_samples[name], device) for name in ("gco_valid", "gbs_valid", "ood_valid")}
        combined = validation_rows["gco_valid"] + validation_rows["gbs_valid"] + validation_rows["ood_valid"]
        thresholds = {task: calibrate(combined if task != "fullness" else validation_rows["gco_valid"], task)[0] for task in ("presence", "fullness", "overflow")}
        task_scores = {task: calibrate(combined if task != "fullness" else validation_rows["gco_valid"], task)[1]["f1"] for task in ("presence", "fullness", "overflow")}
        score = min(task_scores.values()); history.append({"epoch": epoch, "loss": loss_total / args.samples_per_epoch, "thresholds": thresholds, "task_f1": task_scores})
        print(f"EPOCH {epoch}/{args.epochs} loss={loss_total/args.samples_per_epoch:.4f} score={score:.4f} thresholds={thresholds} f1={task_scores}", flush=True)
        if score > best_score:
            best_score = score
            torch.save({"model": model.state_dict(), "architecture": "multitask_mobilenet_v3_small", "class_names": ["normal", "full", "overflow", "unknown"], "image_size": 224, "context": args.context, "thresholds": thresholds, "epoch": epoch, "validation_task_f1": task_scores}, output / "best.pt")
    checkpoint = torch.load(output / "best.pt", map_location=device, weights_only=True); model.load_state_dict(checkpoint["model"])
    all_rows = {name: predict(model, loader, split_samples[name], device) for name, loader in loaders.items()}
    thresholds = checkpoint["thresholds"]
    test_tasks = {}
    for domain in ("gco", "gbs"):
        rows = all_rows[f"{domain}_test"]
        test_tasks[domain] = {task: binary_metrics(*task_rows(rows if task != "fullness" else all_rows["gco_test"], task), thresholds[task]) for task in ("presence", "fullness", "overflow")}
        test_tasks[domain]["states"] = state_metrics(rows, thresholds)
    ood_targets, ood_probabilities = task_rows(all_rows["ood_test"], "presence")
    ood_metrics = binary_metrics(ood_targets, ood_probabilities, thresholds["presence"]) if ood_targets else None
    acceptance = {
        "presence_f1_at_least_0_80": min(test_tasks[d]["presence"]["f1"] for d in ("gco", "gbs")) >= .80,
        "fullness_f1_at_least_0_80": test_tasks["gco"]["fullness"]["f1"] >= .80,
        "overflow_f1_at_least_0_80": min(test_tasks[d]["overflow"]["f1"] for d in ("gco", "gbs")) >= .80,
        "gco_state_accuracy_at_least_0_80": test_tasks["gco"]["states"]["accuracy"] >= .80,
        "ood_presence_false_positive_rate_at_most_0_05": bool(ood_metrics and ood_metrics["confusion_matrix"][0][1] / max(1, sum(ood_metrics["confusion_matrix"][0])) <= .05),
    }; acceptance["passed"] = all(acceptance.values())
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "experiment": "multi-head state model with OOD hard negatives", "group_counts": dict(group_counts), "selected_epoch": checkpoint["epoch"], "thresholds": thresholds, "history": history, "test": test_tasks | {"ood": ood_metrics}, "acceptance": acceptance, "elapsed_seconds": perf_counter() - started}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"test": test_tasks, "acceptance": acceptance}, indent=2), flush=True)


if __name__ == "__main__":
    main()
