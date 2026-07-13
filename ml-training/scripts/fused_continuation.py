"""Continue an already-fused YOLOE checkpoint without rebuilding text embeddings."""
from __future__ import annotations

import json
import argparse
from copy import deepcopy
from pathlib import Path

import torch
import yaml
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEPETrainer
from ultralytics.nn.tasks import YOLOEModel
from ultralytics.utils.torch_utils import unwrap_model

from training_control import TrainingControl

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHECKPOINT = ROOT / "runs/bin_overflow/yoloe26s_fused_tune20_v1/weights/last.pt"


class FusedYOLOEPETrainer(YOLOEPETrainer):
    """PE trainer that preserves, rather than re-fuses, an existing fused head."""

    def get_model(self, cfg=None, weights=None, verbose: bool = True):
        assert weights is not None, "A fused continuation requires a checkpoint."
        # Model.train() provides the checkpoint's YOLOEModel here. Cloning it
        # preserves the fused 3-class convolution weights, whose shape cannot
        # be loaded into a newly constructed pre-fusion YOLOE head.
        if isinstance(weights, torch.nn.Module):
            model = deepcopy(weights).float()
        else:
            model = YOLOEModel(cfg["yaml_file"] if isinstance(cfg, dict) else cfg, ch=self.data["channels"], nc=self.data["nc"], verbose=verbose)
            if hasattr(model.model[-1], "savpe"):
                del model.model[-1].savpe
            model.load(weights)
        # The fused checkpoint's last classifier convolutions were frozen by fuse().
        # Re-enable only those projection layers; do not call set_classes() or fuse().
        for index in range(3):
            model.model[-1].cv3[index][2] = deepcopy(model.model[-1].cv3[index][2]).requires_grad_(True)
        if getattr(model.model[-1], "one2one_cv3", None) is not None:
            for index in range(3):
                model.model[-1].one2one_cv3[index][2] = deepcopy(model.model[-1].one2one_cv3[index][2]).requires_grad_(True)
        model.train()
        return model


class FusedCheckpointVerifier:
    def __init__(self, checkpoint: Path, output: Path):
        self.checkpoint, self.output = checkpoint, output

    def __call__(self, trainer) -> None:
        source = torch.load(self.checkpoint, map_location="cpu", weights_only=False)["ema"].float().state_dict()
        target = unwrap_model(trainer.model).state_dict()
        common = sorted(set(source) & set(target))
        mismatches = [key for key in common if source[key].shape != target[key].shape or not torch.equal(source[key].cpu(), target[key].cpu())]
        head_keys = [key for key in common if key.startswith("model.23.cv3.") or key.startswith("model.23.one2one_cv3.")]
        report = {"checkpoint": str(self.checkpoint), "common_tensor_count": len(common), "head_tensor_count": len(head_keys), "mismatch_count": len(mismatches), "mismatches": mismatches[:20], "verified": not mismatches}
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        if mismatches:
            raise RuntimeError(f"Fused checkpoint verification failed: {len(mismatches)} mismatched tensors. See {self.output}")
        print(f"FUSED_CHECKPOINT_VERIFIED tensors={len(common)} head_tensors={len(head_keys)}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT); parser.add_argument("--config", type=Path, default=ROOT / "ml-training/configs/fused_continuation_control.yaml"); args = parser.parse_args()
    checkpoint = args.checkpoint if args.checkpoint.is_absolute() else ROOT / args.checkpoint
    if not checkpoint.exists():
        raise FileNotFoundError(checkpoint)
    config_path = args.config if args.config.is_absolute() else ROOT / args.config
    config = yaml.safe_load(config_path.read_text())
    control = TrainingControl(ROOT, config)
    run = config["run"]
    model = YOLOE(str(checkpoint))
    verification = ROOT / "ml-training/logs" / run["name"] / "fused-load-verification.json"
    model.add_callback("on_pretrain_routine_end", control.bind)
    model.add_callback("on_pretrain_routine_end", FusedCheckpointVerifier(checkpoint, verification))
    model.add_callback("on_train_epoch_start", control.epoch_start)
    model.add_callback("on_train_batch_end", control.heartbeat)
    model.add_callback("on_val_batch_end", control.heartbeat)
    model.add_callback("on_fit_epoch_end", control.on_epoch_end)
    model.add_callback("on_train_end", control.finish)
    control.start()
    model.train(data=str(ROOT / "ml-training/configs/bin_overflow.yaml"), trainer=FusedYOLOEPETrainer,
        epochs=run["epochs"], patience=run["patience"], imgsz=run["imgsz"], batch=run["batch"], device=0,
        workers=run["workers"], optimizer="AdamW", lr0=0.001, weight_decay=0.0005,
        degrees=5.0, translate=0.10, scale=0.30, perspective=0.0005, fliplr=0.5, mosaic=0.5,
        close_mosaic=10, amp=True, seed=42, deterministic=True, plots=True, save=True, save_period=1,
        project=str(ROOT / "runs/bin_overflow"), name=run["name"], exist_ok=True)


if __name__ == "__main__":
    main()
