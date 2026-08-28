"""Jointly calibrate a fail-closed hierarchical bin-state policy.

Only the manifest validation split participates in candidate selection.  The
locked WhatsApp suite and reserved test rows are deliberately never loaded.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
STATES = ("normal", "full", "overflow", "unknown")


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def trainer_module():
    path = ROOT / "ml-training/scripts/train_specialist_bin_state.py"
    spec = importlib.util.spec_from_file_location("hierarchical_policy_trainer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load trainer from {path}")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def occluded(image: Image.Image) -> Image.Image:
    result = image.copy().filter(ImageFilter.GaussianBlur(radius=1.0))
    draw = ImageDraw.Draw(result, "RGBA")
    draw.rectangle((image.width * .18, image.height * .16, image.width * .82, image.height * .52), fill=(35, 35, 35, 185))
    return result


def infer(model, transform, rows: list[dict[str, Any]], device: torch.device, *, apply_occlusion: bool) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for start in range(0, len(rows), 64):
        selected = rows[start:start + 64]
        tensors = []
        for row in selected:
            with Image.open(row["path"]) as opened:
                image = opened.convert("RGB")
            if apply_occlusion:
                image = occluded(image)
            tensors.append(transform(image))
        images = torch.stack(tensors).to(device)
        with torch.inference_mode():
            logits = model(images)
            probabilities = {name: torch.sigmoid(value).cpu().tolist() for name, value in logits.items()}
        for index, row in enumerate(selected):
            output.append({
                "sampleId": row["sampleId"], "state": row["state"],
                "presence": float(probabilities["presence"][index]),
                "fullness": float(probabilities["fullness"][index]),
                "overflow": float(probabilities["overflow"][index]),
            })
    return output


def decide(row: dict[str, Any], thresholds: dict[str, float], margin: float) -> str:
    if row["presence"] < thresholds["presence"]:
        return "unknown"
    if abs(row["overflow"] - thresholds["overflow"]) < margin:
        return "unknown"
    if row["overflow"] >= thresholds["overflow"]:
        if row["fullness"] < thresholds["overflowFullnessFloor"]:
            return "unknown"
        return "overflow"
    if abs(row["fullness"] - thresholds["fullness"]) < margin:
        return "unknown"
    return "full" if row["fullness"] >= thresholds["fullness"] else "normal"


def state_metrics(rows: list[dict[str, Any]], thresholds: dict[str, float], margin: float) -> dict[str, Any]:
    matrix = [[0] * len(STATES) for _ in STATES]
    predictions: list[str] = []
    for row in rows:
        predicted = decide(row, thresholds, margin); predictions.append(predicted)
        matrix[STATES.index(row["state"])][STATES.index(predicted)] += 1
    per_state = {}
    f1_values = []
    for index, state in enumerate(STATES):
        tp = matrix[index][index]
        fp = sum(matrix[other][index] for other in range(len(STATES)) if other != index)
        fn = sum(matrix[index][other] for other in range(len(STATES)) if other != index)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        per_state[state] = {"precision": precision, "recall": recall, "f1": f1, "support": sum(matrix[index])}
    valid_rows = [row for row in rows if row["state"] != "unknown"]
    valid_predictions = [prediction for row, prediction in zip(rows, predictions) if row["state"] != "unknown"]
    return {
        "states": list(STATES), "confusionMatrix": matrix, "perState": per_state,
        "macroF1": statistics.fmean(f1_values),
        "validStateCoverage": sum(prediction != "unknown" for prediction in valid_predictions) / len(valid_rows),
        "count": len(rows),
    }


def occlusion_metrics(rows: list[dict[str, Any]], thresholds: dict[str, float], margin: float) -> dict[str, Any]:
    predictions = [decide(row, thresholds, margin) for row in rows]
    safe = sum(predicted in {row["state"], "unknown"} for row, predicted in zip(rows, predictions))
    normal_unknown = [(row, predicted) for row, predicted in zip(rows, predictions) if row["state"] in {"normal", "unknown"}]
    false_overflow = sum(predicted == "overflow" for _, predicted in normal_unknown)
    return {
        "count": len(rows), "safeSameOrUnknown": safe / len(rows),
        "falseOverflowOnNormalUnknown": false_overflow / len(normal_unknown),
        "predictedStates": dict(Counter(predictions)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/multi-angle-prototype/manifest.json")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_loop1")
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--uncertainty-margin", type=float, default=.03)
    args = parser.parse_args()
    if not 0 <= args.uncertainty_margin < .25:
        raise SystemExit("--uncertainty-margin must be in [0, .25)")
    output = resolve(args.output)
    if output.exists():
        raise SystemExit(f"Refusing to overwrite an existing calibration run: {output}")
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise SystemExit(f"CUDA requested but unavailable: {device}")
    payload = json.loads(resolve(args.manifest).read_text(encoding="utf-8"))
    validation_rows = []
    for row in payload.get("samples", []):
        if row.get("pipeline") != "bin_state" or row.get("split") != "valid" or row["sampleId"].endswith("-base"):
            continue
        validation_rows.append({
            "sampleId": row["sampleId"], "state": row["label"]["state"], "path": resolve(row["path"]),
        })
    if not validation_rows or set(row["state"] for row in validation_rows) != set(STATES):
        raise SystemExit("Validation requires synthetic support for every state")
    checkpoint = torch.load(resolve(args.checkpoint), map_location=device, weights_only=True)
    trainer = trainer_module(); model = trainer.MultiTaskMobileNet().to(device); model.load_state_dict(checkpoint["model"]); model.eval()
    _, transform = trainer.transforms(int(checkpoint.get("image_size", 224)))
    clean = infer(model, transform, validation_rows, device, apply_occlusion=False)
    occlusion = infer(model, transform, validation_rows, device, apply_occlusion=True)
    presence = float(checkpoint["thresholds"]["presence"])
    margin = args.uncertainty_margin
    candidates = []
    for fullness_step in range(30, 71):
        for overflow_step in range(10, 41):
            for agreement_step in range(45, 76):
                thresholds = {
                    "presence": presence,
                    "fullness": fullness_step / 100,
                    "overflow": overflow_step / 100,
                    "overflowFullnessFloor": agreement_step / 100,
                }
                clean_metrics = state_metrics(clean, thresholds, margin)
                occluded_metrics = occlusion_metrics(occlusion, thresholds, margin)
                per_state = clean_metrics["perState"]
                passes = (
                    clean_metrics["macroF1"] >= .916
                    and clean_metrics["validStateCoverage"] >= .85
                    and per_state["overflow"]["precision"] >= .75
                    and per_state["overflow"]["recall"] >= .85
                    and per_state["full"]["recall"] >= .80
                    and per_state["normal"]["precision"] >= .80
                    and per_state["unknown"]["recall"] >= .80
                    and occluded_metrics["safeSameOrUnknown"] >= .95
                    and occluded_metrics["falseOverflowOnNormalUnknown"] <= .01
                )
                if passes:
                    candidates.append((thresholds, clean_metrics, occluded_metrics))
    if not candidates:
        raise SystemExit("No hierarchical threshold candidate passed the validation-only gates")
    selected = max(candidates, key=lambda item: (
        round(item[1]["macroF1"], 10),
        round(item[2]["safeSameOrUnknown"], 10),
        round(item[1]["validStateCoverage"], 10),
        round(item[1]["perState"]["overflow"]["recall"], 10),
        -item[0]["overflow"], -item[0]["overflowFullnessFloor"], -item[0]["fullness"],
    ))
    thresholds, selected_clean, selected_occlusion = selected
    baseline_thresholds = {
        "presence": presence,
        "fullness": float(checkpoint["thresholds"]["fullness"]),
        "overflow": float(checkpoint["thresholds"]["overflow"]),
        "overflowFullnessFloor": float(checkpoint["thresholds"].get("overflowFullnessFloor", checkpoint["thresholds"]["fullness"])),
    }
    output.mkdir(parents=True)
    calibrated = dict(checkpoint)
    calibrated.update({
        "thresholds": thresholds,
        "uncertainty_margin": margin,
        "modelVersion": "multi-angle-mobilenet-v3-small-loop1-hierarchical",
        "calibration": "validation-only hierarchical overflow/fullness safety calibration with occlusion negatives",
        "calibrationManifest": str(resolve(args.manifest)),
    })
    torch.save(calibrated, output / "best.pt")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "manifest": str(resolve(args.manifest)), "baseCheckpoint": str(resolve(args.checkpoint)),
        "selectionData": "validation synthetic variants only; locked WhatsApp and test rows not loaded",
        "validationRows": len(clean), "occludedValidationRows": len(occlusion),
        "search": {"passingCandidates": len(candidates), "uncertaintyMargin": margin},
        "baseline": {
            "thresholds": baseline_thresholds,
            "clean": state_metrics(clean, baseline_thresholds, margin),
            "occlusion": occlusion_metrics(occlusion, baseline_thresholds, margin),
        },
        "selected": {"thresholds": thresholds, "clean": selected_clean, "occlusion": selected_occlusion},
        "checkpoint": str(output / "best.pt"), "productionReady": False,
    }
    (output / "calibration_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
