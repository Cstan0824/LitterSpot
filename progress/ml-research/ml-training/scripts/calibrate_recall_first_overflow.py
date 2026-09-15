"""Select and evaluate a recall-first overflow threshold without using test data for selection."""
from __future__ import annotations

import json

import torch
from torch.utils.data import DataLoader

from train_bin_state_classifier import ROOT, transforms
from train_multitask_bin_state import MultiTaskMobileNet, TaskDataset, binary_metrics, load_gbs, load_gco, predict, task_rows, temporal_gbs_splits


def recall_first_states(rows, thresholds, overflow_presence_floor):
    classes = ["normal", "full", "overflow", "unknown"]
    matrix = [[0] * 4 for _ in classes]
    for row in rows:
        if float(row["overflow_probability"]) >= thresholds["overflow"] and float(row["presence_probability"]) >= overflow_presence_floor:
            predicted = "overflow"
        elif float(row["presence_probability"]) < thresholds["presence"]:
            predicted = "unknown"
        elif float(row["fullness_probability"]) >= thresholds["fullness"]:
            predicted = "full"
        else:
            predicted = "normal"
        matrix[classes.index(str(row["state"]))][classes.index(predicted)] += 1
    recalls = {classes[index]: matrix[index][index] / sum(matrix[index]) if sum(matrix[index]) else None for index in range(4)}
    total = sum(map(sum, matrix))
    return {"accuracy": sum(matrix[index][index] for index in range(4)) / total, "recall": recalls, "confusion_matrix": matrix}


def alert_metrics(rows, overflow_threshold, presence_floor):
    targets = [1 if row["state"] == "overflow" else 0 for row in rows]
    predictions = [1 if float(row["overflow_probability"]) >= overflow_threshold and float(row["presence_probability"]) >= presence_floor else 0 for row in rows]
    matrix = [[0, 0], [0, 0]]
    for target, prediction in zip(targets, predictions): matrix[target][prediction] += 1
    tn, fp = matrix[0]; fn, tp = matrix[1]
    precision = tp / (tp + fp) if tp + fp else 0.0; recall = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": precision, "recall": recall, "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0, "confusion_matrix": matrix}


def main() -> None:
    checkpoint_path = ROOT / "runs/state_classifier/multitask_bin_state/best.pt"
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = MultiTaskMobileNet(); model.load_state_dict(checkpoint["model"]); model.to(device)
    _, transform = transforms(int(checkpoint["image_size"]))
    gbs = temporal_gbs_splits(load_gbs(ROOT / "ml-training/data/raw/GBS"))
    samples = {
        "gco_valid": load_gco(ROOT / "ml-training/data/processed", "valid"), "gco_test": load_gco(ROOT / "ml-training/data/processed", "test"),
        "gbs_valid": gbs["valid"], "gbs_test": gbs["test"],
    }
    rows = {}
    for name, values in samples.items():
        loader = DataLoader(TaskDataset(values, transform, float(checkpoint["context"])), batch_size=128, num_workers=8, pin_memory=device.type == "cuda")
        rows[name] = predict(model, loader, values, device)
    viable = []
    base_thresholds = {"presence": float(checkpoint["thresholds"]["presence"]), "fullness": .34}
    for floor_step in range(250, 564, 10):
        floor = floor_step / 1000
        for threshold_step in range(300, 516, 5):
            threshold = threshold_step / 1000
            validation = {domain: alert_metrics(rows[f"{domain}_valid"], threshold, floor) for domain in ("gco", "gbs")}
            gbs_states = recall_first_states(rows["gbs_valid"], base_thresholds | {"overflow": threshold}, floor)
            gco_states = recall_first_states(rows["gco_valid"], base_thresholds | {"overflow": threshold}, floor)
            if validation["gco"]["recall"] >= .85 and validation["gbs"]["recall"] >= .90 and all(metrics["precision"] >= .60 for metrics in validation.values()) and float(gbs_states["recall"]["unknown"]) >= .70 and float(gco_states["recall"]["full"]) >= .75:
                viable.append((min(metrics["recall"] for metrics in validation.values()), min(metrics["precision"] for metrics in validation.values()), floor, threshold, validation, gco_states, gbs_states))
    if not viable: raise RuntimeError("No recall-first threshold meets the validation constraints")
    _, _, presence_floor, overflow_threshold, validation, validation_gco_states, validation_gbs_states = max(viable, key=lambda item: (item[0], item[1]))
    thresholds = {"presence": float(checkpoint["thresholds"]["presence"]), "fullness": .34, "overflow": overflow_threshold}
    test = {}
    for domain in ("gco", "gbs"):
        test_rows = rows[f"{domain}_test"]
        test[domain] = {"overflow_alert": alert_metrics(test_rows, overflow_threshold, presence_floor), "states": recall_first_states(test_rows, thresholds, presence_floor)}
    production = dict(checkpoint); production["thresholds"] = thresholds; production["overflow_policy"] = "recall_first_with_presence_floor"; production["overflow_presence_floor"] = presence_floor; production["calibration"] = "recall-first alert policy selected on validation with non-bin rejection constraint"
    torch.save(production, checkpoint_path.parent / "production.pt")
    report = {"policy": "recall_first_with_presence_floor", "overflow_presence_floor": presence_floor, "thresholds": thresholds, "validation": validation, "validation_gco_states": validation_gco_states, "validation_gbs_states": validation_gbs_states, "test": test}
    (checkpoint_path.parent / "recall-first-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__": main()
