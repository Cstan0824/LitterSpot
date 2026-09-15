"""Evaluate a selected multi-task checkpoint on untouched GCO and GBS tests."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from train_bin_state_classifier import ROOT, transforms
from train_multitask_bin_state import MultiTaskMobileNet, TaskDataset, binary_metrics, load_gbs, load_gco, predict, state_metrics, task_rows, temporal_gbs_splits


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multitask_bin_state/best.pt")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    checkpoint_path = args.checkpoint.resolve()
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = MultiTaskMobileNet(); model.load_state_dict(checkpoint["model"]); model.to(device)
    _, transform = transforms(int(checkpoint["image_size"]))
    samples = {
        "gco": load_gco(ROOT / "ml-training/data/processed", "test"),
        "gbs": temporal_gbs_splits(load_gbs(ROOT / "ml-training/data/raw/GBS"))["test"],
    }
    rows = {}
    for domain, values in samples.items():
        loader = DataLoader(TaskDataset(values, transform, float(checkpoint["context"])), batch_size=128, num_workers=args.workers, pin_memory=device.type == "cuda")
        rows[domain] = predict(model, loader, values, device)
    thresholds = checkpoint["thresholds"]
    test = {}
    for domain, domain_rows in rows.items():
        test[domain] = {
            "presence": binary_metrics(*task_rows(domain_rows, "presence"), thresholds["presence"]),
            "overflow": binary_metrics(*task_rows(domain_rows, "overflow"), thresholds["overflow"]),
            "states": state_metrics(domain_rows, thresholds),
        }
    test["gco"]["fullness"] = binary_metrics(*task_rows(rows["gco"], "fullness"), thresholds["fullness"])
    acceptance = {
        "presence_f1_at_least_0_80": min(test[domain]["presence"]["f1"] for domain in ("gco", "gbs")) >= .80,
        "fullness_f1_at_least_0_80": test["gco"]["fullness"]["f1"] >= .80,
        "overflow_f1_at_least_0_80": min(test[domain]["overflow"]["f1"] for domain in ("gco", "gbs")) >= .80,
        "gco_state_accuracy_at_least_0_80": test["gco"]["states"]["accuracy"] >= .80,
    }
    acceptance["passed"] = all(acceptance.values())
    report = {"checkpoint": str(checkpoint_path), "selected_epoch": checkpoint["epoch"], "thresholds": thresholds, "test": test, "acceptance": acceptance}
    (checkpoint_path.parent / "test-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if not acceptance["passed"]: raise SystemExit(2)


if __name__ == "__main__":
    main()
