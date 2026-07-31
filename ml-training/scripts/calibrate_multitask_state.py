"""Jointly calibrate multi-head state thresholds on validation data only."""
from __future__ import annotations

import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from train_bin_state_classifier import ROOT, transforms
from train_multitask_bin_state import MultiTaskMobileNet, TaskDataset, binary_metrics, load_gbs, load_gco, predict, state_metrics, task_rows, temporal_gbs_splits


def main() -> None:
    checkpoint_path = ROOT / "runs/state_classifier/multitask_gco_gbs_v2/best.pt"
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = MultiTaskMobileNet(); model.load_state_dict(checkpoint["model"]); model.to(device)
    _, transform = transforms(int(checkpoint["image_size"]))
    samples = {
        "gco": load_gco(ROOT / "ml-training/data/processed", "valid"),
        "gbs": temporal_gbs_splits(load_gbs(ROOT / "ml-training/data/raw/GBS"))["valid"],
    }
    rows = {}
    for domain, values in samples.items():
        loader = DataLoader(TaskDataset(values, transform, float(checkpoint["context"])), batch_size=128, num_workers=8, pin_memory=device.type == "cuda")
        rows[domain] = predict(model, loader, values, device)
    viable = []
    presence = float(checkpoint["thresholds"]["presence"])
    presence_metrics = {domain: binary_metrics(*task_rows(values, "presence"), presence) for domain, values in rows.items()}
    for fullness_step in range(200, 601, 5):
        for overflow_step in range(300, 701, 5):
            thresholds = {"presence": presence, "fullness": fullness_step / 1000, "overflow": overflow_step / 1000}
            gco_states = state_metrics(rows["gco"], thresholds)
            recalls = [float(gco_states["recall"][name]) for name in ("normal", "full", "overflow")]
            overflow_metrics = {domain: binary_metrics(*task_rows(values, "overflow"), thresholds["overflow"]) for domain, values in rows.items()}
            if all(metrics["precision"] >= .80 and metrics["recall"] >= .80 for metrics in overflow_metrics.values()):
                viable.append((min(recalls), sum(recalls) / 3, gco_states["accuracy"], thresholds, gco_states, overflow_metrics, presence_metrics))
    if not viable: raise RuntimeError("No joint thresholds satisfy both overflow validation domains")
    minimum_recall, balanced_recall, _, thresholds, gco_states, overflow_metrics, presence_metrics = max(viable, key=lambda item: item[:3])
    production = dict(checkpoint); production["thresholds"] = thresholds; production["calibration"] = "joint state calibration on GCO+GBS validation only"
    torch.save(production, checkpoint_path.parent / "production.pt")
    report = {"thresholds": thresholds, "minimum_gco_state_recall": minimum_recall, "balanced_gco_state_recall": balanced_recall, "gco_states": gco_states, "presence": presence_metrics, "overflow": overflow_metrics}
    (checkpoint_path.parent / "calibration-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__": main()
