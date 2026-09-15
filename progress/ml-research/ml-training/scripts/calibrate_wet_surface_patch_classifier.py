#!/usr/bin/env python3
"""Calibrate the public wet/dry classifier on validation, then test once."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision.models import mobilenet_v3_small

from train_wet_surface_patch_classifier import _datasets, compute_metrics


ROOT = Path(__file__).resolve().parents[2]


def _confusion(labels: list[int], probabilities: list[float], threshold: float) -> list[list[int]]:
    matrix = [[0, 0], [0, 0]]
    for expected, probability in zip(labels, probabilities):
        matrix[expected][int(probability >= threshold)] += 1
    return matrix


def choose_threshold(
    labels: list[int],
    probabilities: list[float],
    minimum_wet_recall: float = .95,
) -> tuple[float, dict[str, Any]]:
    candidates = []
    for step in range(1, 200):
        threshold = step / 200
        metrics = compute_metrics(_confusion(labels, probabilities, threshold))
        if metrics["wetRecall"] >= minimum_wet_recall:
            candidates.append((
                float(metrics["drySpecificity"]),
                float(metrics["wetPrecision"]),
                float(metrics["wetF1"]),
                threshold,
                metrics,
            ))
    if not candidates:
        raise ValueError("no threshold satisfies the validation wet-recall constraint")
    _specificity, _precision, _f1, threshold, metrics = max(candidates)
    return threshold, metrics


def slice_metrics(
    dataset: Any,
    labels: list[int],
    probabilities: list[float],
    threshold: float,
    manifest_rows: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    provenance = {str(Path(row["image"]).resolve()): row for row in manifest_rows}
    buckets: dict[str, tuple[list[int], list[float]]] = defaultdict(lambda: ([], []))
    for (path, _class_id), expected, probability in zip(dataset.samples, labels, probabilities):
        row = provenance[str(Path(path).resolve())]
        source = row["sourceDataset"]
        original = str(row.get("sourcePath", "")).lower()
        lighting = "withlight" if "withlight" in original else "nolight" if "nolight" in original else "not_applicable"
        for name in (f"source:{source}", f"lighting:{lighting}"):
            buckets[name][0].append(expected)
            buckets[name][1].append(probability)
    return {
        name: compute_metrics(_confusion(bucket_labels, bucket_probabilities, threshold))
        for name, (bucket_labels, bucket_probabilities) in sorted(buckets.items())
    }


@torch.inference_mode()
def _probabilities(model, loader, device) -> tuple[list[int], list[float]]:
    labels, probabilities = [], []
    model.eval()
    for inputs, targets in loader:
        values = torch.softmax(model(inputs.to(device)), dim=1)[:, 1]
        labels.extend(targets.tolist())
        probabilities.extend(values.cpu().tolist())
    return labels, probabilities


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--data", type=Path, default=ROOT / "dataset/floor_spill/wet_surface_patches_v1")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-wet-recall", type=float, default=.95)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    checkpoint, data = args.checkpoint.resolve(), args.data.resolve()
    payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if payload.get("architecture") != "mobilenet_v3_small_binary_patch_classifier":
        raise SystemExit("unexpected checkpoint architecture")
    device = torch.device(args.device if args.device != "auto" else ("cuda:0" if torch.cuda.is_available() else "cpu"))
    model = mobilenet_v3_small(weights=None)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 2)
    model.load_state_dict(payload["model"])
    model.to(device)
    _train, validation, test = _datasets(data, int(payload["imageSize"]))
    loader_options = {"num_workers": args.workers, "persistent_workers": args.workers > 0}
    validation_loader = DataLoader(validation, batch_size=args.batch, shuffle=False, **loader_options)
    test_loader = DataLoader(test, batch_size=args.batch, shuffle=False, **loader_options)
    validation_labels, validation_probabilities = _probabilities(model, validation_loader, device)
    threshold, validation_metrics = choose_threshold(
        validation_labels, validation_probabilities, args.minimum_wet_recall,
    )
    test_labels, test_probabilities = _probabilities(model, test_loader, device)
    test_metrics = compute_metrics(_confusion(test_labels, test_probabilities, threshold))
    manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    test_slices = slice_metrics(test, test_labels, test_probabilities, threshold, manifest["samples"])
    gates = {
        "wetRecall": {"value": test_metrics["wetRecall"], "minimum": .95},
        "wetPrecision": {"value": test_metrics["wetPrecision"], "minimum": .90},
        "drySpecificity": {"value": test_metrics["drySpecificity"], "minimum": .90},
    }
    for gate in gates.values():
        gate["passed"] = gate["value"] >= gate["minimum"]
    calibrated_checkpoint = args.output.with_name(f"{args.output.stem}-calibrated.pt")
    calibrated = dict(payload)
    calibrated["wetThreshold"] = threshold
    calibrated["calibrationSplit"] = "val"
    calibrated["minimumValidationWetRecall"] = args.minimum_wet_recall
    torch.save(calibrated, calibrated_checkpoint)
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCheckpoint": str(checkpoint),
        "calibratedCheckpoint": str(calibrated_checkpoint.resolve()),
        "dataset": str(data),
        "selectedOn": "validation",
        "wetThreshold": threshold,
        "minimumValidationWetRecall": args.minimum_wet_recall,
        "validation": validation_metrics,
        "test": test_metrics,
        "testSlices": test_slices,
        "publicDiagnosticGates": gates,
        "publicDiagnosticPassed": all(gate["passed"] for gate in gates.values()),
        "evidenceTier": "public",
        "qualificationEligible": False,
        "dispatchEligible": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
