"""Screen Qwen2.5-VL-3B zero-shot state labels without changing alerts.

The development GPU has 6 GB VRAM.  This runner caps GPU allocation and allows
Transformers to offload the remaining layers to CPU, so it measures a realistic
fallback rather than pretending FP16 fits entirely on the GPU.
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
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

from train_bin_state_classifier import ROOT, crop_bin
from train_multitask_bin_state import load_gco


MODEL_ID = "Qwen/Qwen2.5-VL-3B-Instruct"
STATES = ("normal", "full", "overflow", "unknown")
PROMPT = (
    "Classify this tightly cropped waste bin. normal: capacity remains. full: "
    "waste reaches the rim but stays inside. overflow: waste spills or is piled "
    "outside. unknown: no clear bin or unsuitable image. Reply with exactly one "
    "lowercase word: normal, full, overflow, or unknown."
)


def balanced_samples(samples: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    if not limit:
        return samples
    groups = {state: [] for state in STATES[:3]}
    for sample in samples:
        if str(sample["state"]) in groups:
            groups[str(sample["state"])].append(sample)
    quota, remainder = divmod(limit, len(groups))
    return [sample for index, state in enumerate(groups) for sample in groups[state][:quota + (index < remainder)]]


def parse_answer(answer: str) -> str:
    found = [state for state in STATES if state in re.findall(r"[a-z]+", answer.lower())]
    return found[0] if len(found) == 1 else "unknown"


def summarize(rows: list[dict[str, object]]) -> dict[str, object]:
    matrix = {actual: {predicted: 0 for predicted in STATES} for actual in STATES}
    for row in rows:
        matrix[str(row["actual_state"])][str(row["predicted_state"])] += 1
    tp = matrix["overflow"]["overflow"]
    fp = sum(matrix[state]["overflow"] for state in STATES if state != "overflow")
    fn = sum(matrix["overflow"][state] for state in STATES if state != "overflow")
    return {"accuracy": sum(matrix[state][state] for state in STATES) / len(rows), "overflow_precision": tp / (tp + fp) if tp + fp else 0, "overflow_recall": tp / (tp + fn) if tp + fn else 0, "confusion_matrix": matrix}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=("valid", "test"), default="valid")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--output", type=Path, default=ROOT / "runs/prompt_experiments/qwen25vl_3b_gco_v1")
    args = parser.parse_args()
    samples = balanced_samples(load_gco(ROOT / "ml-training/data/processed", args.split), args.limit)
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=False)
    print(f"STAGE load_model model={MODEL_ID} gpu_cap=5GiB cpu_offload=true", flush=True)
    processor = AutoProcessor.from_pretrained(MODEL_ID, min_pixels=256 * 28 * 28, max_pixels=512 * 28 * 28)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        MODEL_ID, torch_dtype=torch.float16, device_map="auto", max_memory={0: "5GiB", "cpu": "24GiB"},
    ).eval()
    prompt = processor.apply_chat_template(
        [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}],
        tokenize=False, add_generation_prompt=True,
    )
    torch.cuda.reset_peak_memory_stats()
    rows: list[dict[str, object]] = []
    for index, sample in enumerate(samples, start=1):
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image.convert("RGB"), sample["box"], 0.15)
        inputs = processor(text=[prompt], images=[crop], padding=True, return_tensors="pt").to("cuda")
        started = perf_counter()
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=8, do_sample=False)
        answer = processor.batch_decode(generated[:, inputs.input_ids.shape[1]:], skip_special_tokens=True)[0].strip()
        predicted = parse_answer(answer)
        rows.append({"image": Path(sample["image"]).name, "actual_state": sample["state"], "predicted_state": predicted, "raw_answer": answer, "latency_ms": round((perf_counter() - started) * 1000, 2)})
        print(f"PROGRESS {index}/{len(samples)} actual={sample['state']} predicted={predicted} answer={answer!r}", flush=True)
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "experiment": "zero-shot Qwen2.5-VL-3B tight-bin classification with CPU offload", "model": MODEL_ID, "split": args.split, "samples": len(rows), "metrics": summarize(rows), "latency_ms": {"mean": sum(float(row["latency_ms"]) for row in rows) / len(rows), "max": max(float(row["latency_ms"]) for row in rows)}, "peak_vram_mb": round(torch.cuda.max_memory_allocated() / 2**20, 1)}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (output / "predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
