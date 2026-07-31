"""Evaluate SmolVLM zero-shot bin-state classification on tightly cropped bins.

This is deliberately a shadow experiment: it never changes production alert
decisions.  The generated answer is mapped only when it contains exactly one
of normal, full, overflow, or unknown.  Unparseable answers become unknown.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import torch
from PIL import Image
from transformers import AutoModelForVision2Seq, AutoProcessor

from train_multitask_bin_state import load_gco
from train_bin_state_classifier import ROOT, crop_bin


MODEL_ID = "HuggingFaceTB/SmolVLM-500M-Instruct"
STATES = ("normal", "full", "overflow", "unknown")
PROMPT = (
    "Inspect this tightly cropped waste bin. Classify its current state. "
    "normal means it has capacity; full means waste reaches the rim but stays "
    "inside; overflow means waste is spilling or piled outside the bin; unknown "
    "means there is no clear bin or the image is unsuitable. Reply with exactly "
    "one lowercase word: normal, full, overflow, or unknown."
)


def parse_answer(answer: str) -> str:
    words = re.findall(r"[a-z]+", answer.lower())
    found = [state for state in STATES if state in words]
    return found[0] if len(found) == 1 else "unknown"


def metrics(rows: list[dict[str, object]]) -> dict[str, object]:
    matrix = {actual: {predicted: 0 for predicted in STATES} for actual in STATES}
    for row in rows:
        matrix[str(row["actual_state"])][str(row["predicted_state"])] += 1
    overflow_tp = matrix["overflow"]["overflow"]
    overflow_fp = sum(matrix[actual]["overflow"] for actual in STATES if actual != "overflow")
    overflow_fn = sum(matrix["overflow"][predicted] for predicted in STATES if predicted != "overflow")
    precision = overflow_tp / (overflow_tp + overflow_fp) if overflow_tp + overflow_fp else 0.0
    recall = overflow_tp / (overflow_tp + overflow_fn) if overflow_tp + overflow_fn else 0.0
    return {
        "accuracy": sum(matrix[state][state] for state in STATES) / len(rows),
        "overflow_precision": precision,
        "overflow_recall": recall,
        "unknown_rate": sum(row["predicted_state"] == "unknown" for row in rows) / len(rows),
        "confusion_matrix": matrix,
    }


def balanced_samples(samples: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    """Choose an equal deterministic quota per labelled state for a quick screen."""
    if not limit:
        return samples
    groups = {state: [] for state in ("normal", "full", "overflow")}
    for sample in samples:
        state = str(sample["state"])
        if state in groups:
            groups[state].append(sample)
    quota, remainder = divmod(limit, len(groups))
    selected = []
    for index, state in enumerate(groups):
        selected.extend(groups[state][:quota + (1 if index < remainder else 0)])
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=("valid", "test"), default="valid", help="Use validation for prompt iteration; reserve test for one final run.")
    parser.add_argument("--limit", type=int, default=30, help="Deterministic sample cap; use 0 for all crops.")
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/prompt_experiments/smolvlm_500m_gco_v1")
    args = parser.parse_args()
    samples = balanced_samples(load_gco(ROOT / "ml-training/data/processed", args.split), args.limit)
    if not samples:
        raise RuntimeError("No labeled bin crops found")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    device = torch.device(args.device)
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    print(f"STAGE load_model model={MODEL_ID} device={device}", flush=True)
    processor = AutoProcessor.from_pretrained(MODEL_ID, size={"longest_edge": 512})
    model = AutoModelForVision2Seq.from_pretrained(MODEL_ID, torch_dtype=dtype).to(device).eval()
    prompt = processor.apply_chat_template(
        [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}],
        add_generation_prompt=True,
    )
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    rows: list[dict[str, object]] = []
    for index, sample in enumerate(samples, start=1):
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image.convert("RGB"), sample["box"], 0.15)
        inputs = processor(text=prompt, images=[crop], return_tensors="pt").to(device)
        started = perf_counter()
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=8, do_sample=False)
        answer = processor.decode(generated[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()
        predicted = parse_answer(answer)
        rows.append({
            "image": Path(sample["image"]).name,
            "actual_state": sample["state"],
            "predicted_state": predicted,
            "raw_answer": answer,
            "latency_ms": round((perf_counter() - started) * 1000, 2),
        })
        print(f"PROGRESS {index}/{len(samples)} actual={sample['state']} predicted={predicted} answer={answer!r}", flush=True)
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "experiment": "zero-shot SmolVLM-500M tight-bin classification",
        "model": MODEL_ID,
        "split": args.split,
        "prompt": PROMPT,
        "samples": len(rows),
        "metrics": metrics(rows),
        "latency_ms": {"mean": sum(float(row["latency_ms"]) for row in rows) / len(rows), "max": max(float(row["latency_ms"]) for row in rows)},
        "peak_vram_mb": round(torch.cuda.max_memory_allocated(device) / 2**20, 1) if device.type == "cuda" else 0,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (output / "predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
