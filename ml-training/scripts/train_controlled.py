"""Start or resume guarded, observable YOLOE-26S training."""
from __future__ import annotations
import argparse
import math
from pathlib import Path
import torch
import yaml
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEPETrainer
from training_control import TrainingControl

ROOT = Path(__file__).resolve().parents[2]

def resumable_checkpoint(run_dir: Path) -> Path:
    epochs = sorted((run_dir / "weights").glob("epoch*.pt"), key=lambda p: int(p.stem.removeprefix("epoch")), reverse=True)
    candidates = [run_dir / "weights/last.pt", *epochs]
    for checkpoint in candidates:
        if not checkpoint.exists(): continue
        try:
            state = torch.load(checkpoint, map_location="cpu", weights_only=False)
            metrics = state.get("train_metrics") or {}
            if state.get("optimizer") is not None and metrics and all(math.isfinite(float(v)) for v in metrics.values()):
                return checkpoint
        except (OSError, ValueError, TypeError, RuntimeError): continue
    raise FileNotFoundError(f"No checkpoint with optimizer state and finite metrics found in {run_dir}")

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--resume", action="store_true"); args = parser.parse_args()
    config = yaml.safe_load((ROOT / "ml-training/configs/training_control.yaml").read_text())
    control = TrainingControl(ROOT, config); run = config["run"]
    run_dir = ROOT / "runs/bin_overflow" / run["name"]
    last = run_dir / "weights/last.pt"
    if args.resume:
        checkpoint = resumable_checkpoint(run_dir); print(f"Resuming from validated checkpoint: {checkpoint}", flush=True)
        model = YOLOE(str(checkpoint))
    else:
        model = YOLOE("yoloe-26s.yaml"); model.load("yoloe-26s-seg.pt")
    model.add_callback("on_pretrain_routine_end", control.bind)
    model.add_callback("on_train_epoch_start", control.epoch_start)
    model.add_callback("on_train_batch_end", control.heartbeat)
    model.add_callback("on_val_batch_end", control.heartbeat)
    model.add_callback("on_fit_epoch_end", control.on_epoch_end)
    model.add_callback("on_train_end", control.finish)
    control.start()
    common = dict(data=str(ROOT / "ml-training/configs/bin_overflow.yaml"), epochs=run["epochs"], patience=run["patience"], imgsz=run["imgsz"], batch=run["batch"], device=0, workers=run["workers"], plots=True, save=True, save_period=1, project=str(ROOT / "runs/bin_overflow"), name=run["name"], exist_ok=True)
    if args.resume: model.train(trainer=YOLOEPETrainer, resume=str(checkpoint))
    else: model.train(trainer=YOLOEPETrainer, optimizer="AdamW", lr0=0.001, weight_decay=0.0005, degrees=5.0, translate=0.10, scale=0.30, perspective=0.0005, fliplr=0.5, mosaic=0.5, close_mosaic=10, amp=True, seed=42, deterministic=True, **common)

if __name__ == "__main__": main()
