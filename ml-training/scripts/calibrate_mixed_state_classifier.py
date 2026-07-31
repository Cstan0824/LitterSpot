"""Choose one mixed-domain decision threshold on validation, then evaluate tests once."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from evaluate_gbs_state_classifier import index_gbs
from finetune_gbs_state_classifier import temporal_splits
from train_bin_state_classifier import BinCropDataset, ROOT, build_model, confusion_metrics, evaluate, index_split, transforms


def metrics_at(rows: list[dict[str, object]], threshold: float) -> dict[str, object]:
    matrix = [[0, 0], [0, 0]]
    for row in rows:
        actual = 1 if row["actual"] == "overflow" else 0
        predicted = 1 if float(row["overflow_probability"]) >= threshold else 0
        matrix[actual][predicted] += 1
    return confusion_metrics(matrix)


def passes(metrics: dict[str, object]) -> bool:
    return (
        float(metrics["accuracy"]) >= 0.85
        and float(metrics["overflow_precision"]) >= 0.80
        and float(metrics["overflow_recall"]) >= 0.80
        and float(metrics["overflow_f1"]) >= 0.80
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/mobilenet_v3_small_gco_gbs_mixed_v1/best.pt")
    parser.add_argument("--gco", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--gbs", type=Path, default=ROOT / "ml-training/data/raw/GBS")
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    checkpoint_path = args.checkpoint.resolve()
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    device = torch.device(args.device)
    _, transform = transforms(int(checkpoint["image_size"]))
    gbs = temporal_splits(index_gbs(args.gbs.resolve()))
    samples = {
        "gco_valid": index_split(args.gco.resolve(), "valid"), "gco_test": index_split(args.gco.resolve(), "test"),
        "gbs_valid": gbs["valid"], "gbs_test": gbs["test"],
    }
    model = build_model(); model.load_state_dict(checkpoint["model"]); model.to(device)
    rows: dict[str, list[dict[str, object]]] = {}
    for name, domain_samples in samples.items():
        loader = DataLoader(BinCropDataset(domain_samples, transform, float(checkpoint["context"])), batch_size=args.batch, num_workers=args.workers, pin_memory=device.type == "cuda")
        _, rows[name] = evaluate(model, loader, device, nn.CrossEntropyLoss())
    candidates = [value / 1000 for value in range(500, 951)]
    viable = []
    for threshold in candidates:
        validation = {domain: metrics_at(rows[f"{domain}_valid"], threshold) for domain in ("gco", "gbs")}
        if all(passes(metrics) for metrics in validation.values()):
            viable.append((threshold, validation))
    if not viable:
        raise RuntimeError("No single threshold passes both validation domains")
    threshold, validation = max(viable, key=lambda item: min(float(metrics["overflow_f1"]) for metrics in item[1].values()))
    test = {domain: metrics_at(rows[f"{domain}_test"], threshold) for domain in ("gco", "gbs")}
    passed = all(passes(metrics) for metrics in test.values())
    production = dict(checkpoint)
    production["decision_threshold"] = threshold
    production["calibration"] = "single threshold selected on GCO+GBS validation only"
    output = checkpoint_path.parent
    torch.save(production, output / "production.pt")
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "decision_threshold": threshold, "validation": validation, "test": test, "passed_both_domains": passed}
    (output / "calibration-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if not passed:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
