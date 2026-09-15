"""Run small fixed-camera robustness checks for the bin-state prototype."""
from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
STATES = ("normal", "full", "overflow", "unknown")
sys.path.insert(0, str(ROOT / "ai-service"))
from app.bin_state_decision import decide_bin_state


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def trainer_module():
    path = ROOT / "ml-training/scripts/train_specialist_bin_state.py"
    spec = importlib.util.spec_from_file_location("prototype_trainer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load trainer")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def shifted(image: Image.Image, fraction: float) -> Image.Image:
    dx, dy = round(image.width * fraction), round(image.height * fraction)
    canvas = Image.new("RGB", image.size, (34, 34, 34))
    canvas.paste(image, (dx, dy))
    return canvas


def scaled(image: Image.Image, fraction: float) -> Image.Image:
    width = round(image.width * (1.0 + fraction)); height = round(image.height * (1.0 + fraction))
    resized = image.resize((width, height), Image.Resampling.BICUBIC)
    if fraction >= 0:
        left, top = max(0, (width - image.width) // 2), max(0, (height - image.height) // 2)
        return resized.crop((left, top, left + image.width, top + image.height))
    canvas = Image.new("RGB", image.size, (34, 34, 34))
    canvas.paste(resized, ((image.width - width) // 2, (image.height - height) // 2))
    return canvas


def occluded(image: Image.Image) -> Image.Image:
    result = image.copy().filter(ImageFilter.GaussianBlur(radius=1.0))
    draw = ImageDraw.Draw(result, "RGBA")
    draw.rectangle((image.width * .18, image.height * .16, image.width * .82, image.height * .52), fill=(35, 35, 35, 185))
    return result


def predict(
    model, transform, images: list[Image.Image], device: torch.device,
    thresholds: dict[str, float], uncertainty_margin: float, overflow_policy: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, len(images), 64):
        batch_images = torch.stack([transform(image.convert("RGB")) for image in images[start:start + 64]]).to(device)
        with torch.inference_mode():
            outputs = model(batch_images)
            values = {name: torch.sigmoid(value).cpu().tolist() for name, value in outputs.items()}
        for index in range(len(batch_images)):
            presence, fullness, overflow = (float(values[name][index]) for name in ("presence", "fullness", "overflow"))
            signals = {"presence": presence, "fullness": fullness, "overflow": overflow}
            decision = decide_bin_state(
                signals, thresholds, [], overflow_policy, thresholds["presence"], uncertainty_margin,
            )
            rows.append({"state": decision.state, **signals, "reasons": decision.reasons})
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/multi-angle-prototype/manifest.json")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/robustness_report.json")
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise SystemExit(f"CUDA unavailable: {device}")
    trainer = trainer_module()
    payload = json.loads(resolve(args.manifest).read_text(encoding="utf-8"))
    selected: list[dict[str, Any]] = []
    counts: Counter[tuple[str, str]] = Counter()
    for row in payload["samples"]:
        if row.get("pipeline") != "bin_state" or row.get("split") != "test" or row["sampleId"].endswith("-base"):
            continue
        angle = row.get("source", {}).get("viewAngle", "unknown"); state = row["label"]["state"]
        if counts[(angle, state)] >= 4:
            continue
        counts[(angle, state)] += 1
        with Image.open(resolve(row["path"])) as opened:
            selected.append({"image": opened.convert("RGB"), "state": state, "angle": angle})
    checkpoint = torch.load(resolve(args.checkpoint), map_location=device, weights_only=True)
    model = trainer.MultiTaskMobileNet().to(device); model.load_state_dict(checkpoint["model"]); model.eval()
    _, transform = trainer.transforms(int(checkpoint.get("image_size", 224)))
    uncertainty_margin = float(checkpoint.get("uncertainty_margin", .03))
    overflow_policy = str(checkpoint.get("overflow_policy", "conservative"))
    scenarios = {
        "roi_shift_plus_3pct": (lambda image: shifted(image, .03), "same_or_unknown"),
        "roi_shift_minus_3pct": (lambda image: shifted(image, -.03), "same_or_unknown"),
        "scale_plus_5pct": (lambda image: scaled(image, .05), "same_or_unknown"),
        "scale_minus_5pct": (lambda image: scaled(image, -.05), "same_or_unknown"),
        "partial_occlusion": (occluded, "unknown_or_same"),
    }
    report_scenarios: dict[str, Any] = {}
    for scenario, (function, policy) in scenarios.items():
        transformed = [function(item["image"]) for item in selected]
        predictions = predict(
            model, transform, transformed, device, checkpoint["thresholds"], uncertainty_margin, overflow_policy,
        )
        safe = sum(pred["state"] in {item["state"], "unknown"} for item, pred in zip(selected, predictions))
        normal_unknown = [pred for item, pred in zip(selected, predictions) if item["state"] in {"normal", "unknown"}]
        false_overflow = sum(pred["state"] == "overflow" for pred in normal_unknown)
        probability_by_state = {}
        for expected_state in STATES:
            state_predictions = [pred for item, pred in zip(selected, predictions) if item["state"] == expected_state]
            probability_by_state[expected_state] = {
                signal: {
                    "min": min(pred[signal] for pred in state_predictions),
                    "median": statistics.median(pred[signal] for pred in state_predictions),
                    "max": max(pred[signal] for pred in state_predictions),
                }
                for signal in ("presence", "fullness", "overflow")
            }
        report_scenarios[scenario] = {
            "policy": policy, "count": len(predictions), "safeSameOrUnknown": safe / len(predictions),
            "normalUnknownCount": len(normal_unknown), "falseOverflowRateOnNormalUnknown": false_overflow / len(normal_unknown) if normal_unknown else 0.0,
            "predictedStates": dict(Counter(pred["state"] for pred in predictions)),
            "probabilityByExpectedState": probability_by_state,
        }
    blank = [Image.new("RGB", item["image"].size, (32, 32, 32)) for item in selected]
    missing_predictions = predict(
        model, transform, blank, device, checkpoint["thresholds"], uncertainty_margin, overflow_policy,
    )
    report_scenarios["missing_bin_blank"] = {
        "count": len(missing_predictions), "absentOrUnknownRate": sum(pred["state"] == "unknown" for pred in missing_predictions) / len(missing_predictions),
        "predictedStates": dict(Counter(pred["state"] for pred in missing_predictions)),
    }
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(), "checkpoint": str(resolve(args.checkpoint)),
        "benchmarkType": "synthetic_surrogate_robustness", "sampleBase": len(selected),
        "scenarios": report_scenarios, "productionReady": False,
        "note": "Controlled perturbations only; not a substitute for real camera-shift/occlusion captures.",
    }
    output = resolve(args.output); output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
