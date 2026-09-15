"""Evaluate the multi-angle bin-state prototype by angle, state, and latency.

This evaluator intentionally reports the synthetic surrogate benchmark as such.
It does not alter a checkpoint or register it for production.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import statistics
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter
from typing import Any

import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset


ROOT = Path(__file__).resolve().parents[1]
STATES = ("normal", "full", "overflow", "unknown")
sys.path.insert(0, str(ROOT / "ai-service"))
from app.bin_state_decision import decide_bin_state


def load_trainer_module():
    path = ROOT / "ml-training/scripts/train_specialist_bin_state.py"
    spec = importlib.util.spec_from_file_location("train_specialist_bin_state", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load trainer module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


class EvalDataset(Dataset):
    def __init__(self, rows: list[dict[str, Any]], transform) -> None:
        self.rows = rows
        self.transform = transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        with Image.open(row["path"]) as image:
            return self.transform(image.convert("RGB")), index


def binary_metrics(targets: list[int], probabilities: list[float], threshold: float) -> dict[str, Any]:
    matrix = [[0, 0], [0, 0]]
    for target, probability in zip(targets, probabilities):
        matrix[target][int(probability >= threshold)] += 1
    tn, fp = matrix[0]
    fn, tp = matrix[1]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "confusionMatrix": matrix, "count": len(targets)}


def state_prediction(
    row: dict[str, Any],
    thresholds: dict[str, float],
    uncertainty_margin: float,
    overflow_policy: str,
) -> str:
    decision = decide_bin_state(
        signals={
            "presence": row["presence_probability"],
            "fullness": row["fullness_probability"],
            "overflow": row["overflow_probability"],
        },
        thresholds=thresholds,
        quality_reasons=[],
        overflow_policy=overflow_policy,
        overflow_presence_floor=thresholds["presence"],
        uncertainty_margin=uncertainty_margin,
    )
    return decision.state


def state_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    matrix = [[0] * len(STATES) for _ in STATES]
    for row in rows:
        matrix[STATES.index(row["state"])][STATES.index(row["predictedState"])] += 1
    f1_values: list[float] = []
    per_state: dict[str, dict[str, float | int]] = {}
    for index, state in enumerate(STATES):
        tp = matrix[index][index]
        fp = sum(matrix[other][index] for other in range(len(STATES)) if other != index)
        fn = sum(matrix[index][other] for other in range(len(STATES)) if other != index)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        per_state[state] = {"precision": precision, "recall": recall, "f1": f1, "support": sum(matrix[index])}
    return {"states": list(STATES), "confusionMatrix": matrix, "perState": per_state, "macroF1": statistics.fmean(f1_values) if f1_values else 0.0, "count": len(rows)}


@torch.inference_mode()
def infer(
    model, loader: DataLoader, rows: list[dict[str, Any]], device: torch.device,
    thresholds: dict[str, float], uncertainty_margin: float, overflow_policy: str,
) -> list[dict[str, Any]]:
    model.eval()
    output_rows: list[dict[str, Any]] = []
    for images, indices in loader:
        outputs = model(images.to(device, non_blocking=True))
        probabilities = {name: torch.sigmoid(value).cpu().tolist() for name, value in outputs.items()}
        for position, index in enumerate(indices.tolist()):
            row = rows[index]
            result = {
                "sampleId": row["sampleId"],
                "group": row["captureGroup"],
                "angleBand": row["angleBand"],
                "state": row["state"],
                "binPresent": row["binPresent"],
                "fullnessKnown": row["fullnessKnown"],
                "overflowKnown": row["overflowKnown"],
                "kind": row["kind"],
                "presence_probability": float(probabilities["presence"][position]),
                "fullness_probability": float(probabilities["fullness"][position]),
                "overflow_probability": float(probabilities["overflow"][position]),
            }
            result["predictedState"] = state_prediction(result, thresholds, uncertainty_margin, overflow_policy)
            output_rows.append(result)
    return output_rows


def latency(model, dataset: EvalDataset, device: torch.device, batch_size: int) -> dict[str, float | int | str]:
    count = min(batch_size, len(dataset))
    batch = torch.stack([dataset[index][0] for index in range(count)]).to(device)
    model.eval()
    for _ in range(5):
        _ = model(batch)
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    durations: list[float] = []
    for _ in range(30):
        started = perf_counter()
        _ = model(batch)
        if device.type == "cuda":
            torch.cuda.synchronize(device)
        durations.append((perf_counter() - started) * 1000.0)
    durations.sort()
    return {
        "device": str(device),
        "batchSize": count,
        "iterations": len(durations),
        "meanMs": statistics.fmean(durations),
        "p50Ms": durations[len(durations) // 2],
        "p95Ms": durations[max(0, round(len(durations) * .95) - 1)],
        "perImageMeanMs": statistics.fmean(durations) / count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/multi-angle-prototype/manifest.json")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/multi_angle_report.json")
    parser.add_argument("--predictions", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/predictions.csv")
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    if args.batch < 1:
        raise SystemExit("--batch must be positive")
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise SystemExit(f"CUDA requested but unavailable: {device}")
    trainer = load_trainer_module()
    payload = json.loads(resolve(args.manifest).read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    for row in payload.get("samples", []):
        if row.get("pipeline") != "bin_state" or row.get("split") != "test":
            continue
        source = row.get("source", {})
        label = row.get("label", {})
        rows.append({
            "sampleId": row["sampleId"],
            "captureGroup": row["captureGroup"],
            "angleBand": source.get("viewAngle", "unknown"),
            "state": label["state"],
            "binPresent": bool(label.get("binPresent", True)),
            "fullnessKnown": bool(label.get("fullnessKnown", label["state"] != "unknown")),
            "overflowKnown": bool(label.get("overflowKnown", label["state"] != "unknown")),
            "kind": "weak_base" if row["sampleId"].endswith("-base") else "synthetic_variant",
            "path": resolve(row["path"]),
        })
    if not rows:
        raise SystemExit("Manifest has no bin_state test rows")
    checkpoint = torch.load(resolve(args.checkpoint), map_location=device, weights_only=True)
    model = trainer.MultiTaskMobileNet().to(device)
    model.load_state_dict(checkpoint["model"])
    _, eval_transform = trainer.transforms(int(checkpoint.get("image_size", 224)))
    dataset = EvalDataset(rows, eval_transform)
    loader = DataLoader(dataset, batch_size=args.batch, shuffle=False, num_workers=0, pin_memory=device.type == "cuda")
    predictions = infer(
        model, loader, rows, device, checkpoint["thresholds"],
        float(checkpoint.get("uncertainty_margin", .03)),
        str(checkpoint.get("overflow_policy", "conservative")),
    )
    by_angle: dict[str, list[dict[str, Any]]] = {}
    for row in predictions:
        by_angle.setdefault(row["angleBand"], []).append(row)
    task_metrics: dict[str, Any] = {}
    for task in ("presence", "fullness", "overflow"):
        targets: list[int] = []
        probabilities: list[float] = []
        for row in predictions:
            if task == "presence":
                target = int(row["binPresent"])
            elif task == "fullness":
                if not row["fullnessKnown"]:
                    continue
                target = int(row["state"] in {"full", "overflow"})
            else:
                if not row["overflowKnown"]:
                    continue
                target = int(row["state"] == "overflow")
            targets.append(target)
            probabilities.append(row[f"{task}_probability"])
        task_metrics[task] = binary_metrics(targets, probabilities, checkpoint["thresholds"][task])
    angle_metrics = {angle: {"counts": dict(Counter(row["state"] for row in angle_rows)), "metrics": state_metrics(angle_rows)} for angle, angle_rows in sorted(by_angle.items())}
    kind_metrics = {
        kind: {"counts": dict(Counter(row["state"] for row in kind_rows)), "metrics": state_metrics(kind_rows)}
        for kind in ("weak_base", "synthetic_variant")
        for kind_rows in [[row for row in predictions if row["kind"] == kind]]
    }
    latencies = {str(batch): latency(model, dataset, device, batch) for batch in (4, 8)}
    report = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "manifest": str(resolve(args.manifest)),
        "checkpoint": str(resolve(args.checkpoint)),
        "benchmarkType": "synthetic_surrogate_holdout",
        "productionReady": False,
        "productionBlocker": "Test rows inherit weak/public crops and controlled synthetic angle/state overlays; collect reviewed oblique/side/overflow captures before promotion.",
        "sampleCount": len(predictions),
        "thresholds": checkpoint["thresholds"],
        "taskMetrics": task_metrics,
        "perAngle": angle_metrics,
        "perKind": kind_metrics,
        "latency": latencies,
        "acceptance": {
            "macroF1AtLeast075EachAngle": all(value["metrics"]["macroF1"] >= .75 for value in angle_metrics.values()),
            "overflowPrecisionAtLeast075EachAngle": all(value["metrics"]["perState"]["overflow"]["precision"] >= .75 for value in angle_metrics.values()),
            "overflowRecallAtLeast085EachAngle": all(value["metrics"]["perState"]["overflow"]["recall"] >= .85 for value in angle_metrics.values()),
            "passed": all(value["metrics"]["macroF1"] >= .75 for value in angle_metrics.values()),
        },
    }
    output = resolve(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    predictions_path = resolve(args.predictions)
    predictions_path.parent.mkdir(parents=True, exist_ok=True)
    with predictions_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(predictions[0]))
        writer.writeheader(); writer.writerows(predictions)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
