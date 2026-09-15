"""Train only a linear state head on frozen MobileCLIP image embeddings.

This is not VLM fine-tuning: MobileCLIP remains in eval mode with gradients
disabled. It is a shadow challenger to the deployed MobileNet checkpoint.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset

from train_bin_state_classifier import ROOT, crop_bin, seed_everything
from train_multitask_bin_state import load_gco


STATES = ("normal", "full", "overflow")


class CropDataset(Dataset):
    def __init__(self, samples, preprocess):
        self.samples, self.preprocess = samples, preprocess

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        with Image.open(sample["image"]) as image:
            crop = crop_bin(image, sample["box"], .15)
        return self.preprocess(crop), STATES.index(str(sample["state"]))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="mobileclip_s0")
    parser.add_argument("--weights", type=Path, required=True, help="Downloaded official MobileCLIP .pt checkpoint")
    parser.add_argument("--data", type=Path, default=ROOT / "ml-training/data/processed")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/mobileclip-linear-probe/s0-gco-v1")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--lr", type=float, default=.01)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


@torch.inference_mode()
def embeddings(model, loader, device):
    vectors, targets = [], []
    for images, labels in loader:
        values = model.encode_image(images.to(device, non_blocking=True)).float()
        vectors.append(torch.nn.functional.normalize(values, dim=1).cpu())
        targets.append(labels)
    return torch.cat(vectors), torch.cat(targets)


def metrics(logits, targets):
    predictions = logits.argmax(dim=1)
    matrix = [[int(((targets == actual) & (predictions == predicted)).sum()) for predicted in range(len(STATES))] for actual in range(len(STATES))]
    per_state = {}
    for index, state in enumerate(STATES):
        true_positive = matrix[index][index]
        false_positive = sum(matrix[other][index] for other in range(len(STATES)) if other != index)
        false_negative = sum(matrix[index][other] for other in range(len(STATES)) if other != index)
        per_state[state] = {
            "precision": true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0,
            "recall": true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0,
        }
    return {"accuracy": float((predictions == targets).float().mean()), "confusionMatrix": matrix, "perState": per_state}


def main() -> None:
    args = parse_args(); seed_everything(42)
    if not args.weights.is_file():
        raise SystemExit(f"MobileCLIP weights not found: {args.weights}")
    try:
        import mobileclip
    except ImportError as error:
        raise SystemExit("Install the official runtime first: pip install git+https://github.com/apple/ml-mobileclip.git") from error
    if args.output.exists():
        raise SystemExit(f"Output already exists: {args.output}")
    device = torch.device(args.device)
    model, _, preprocess = mobileclip.create_model_and_transforms(args.model, pretrained=str(args.weights))
    model.eval().to(device)
    for parameter in model.parameters(): parameter.requires_grad_(False)
    splits = {split: load_gco(args.data, split) for split in ("train", "valid", "test")}
    loaders = {split: DataLoader(CropDataset(samples, preprocess), batch_size=args.batch, shuffle=False, num_workers=0, pin_memory=device.type == "cuda") for split, samples in splits.items()}
    features = {}
    for split, loader in loaders.items():
        print(f"STAGE extract_embeddings split={split} samples={len(loader.dataset)}", flush=True)
        features[split] = embeddings(model, loader, device)
    print("STAGE train_linear_head", flush=True)
    head = nn.Linear(features["train"][0].shape[1], len(STATES)).to(device)
    optimizer = torch.optim.AdamW(head.parameters(), lr=args.lr, weight_decay=.001)
    for _ in range(args.epochs):
        head.train(); optimizer.zero_grad()
        loss = nn.functional.cross_entropy(head(features["train"][0].to(device)), features["train"][1].to(device))
        loss.backward(); optimizer.step()
    head.eval()
    report = {"model": args.model, "frozen": True, "classes": STATES, "metrics": {split: metrics(head(values.to(device)).cpu(), targets) for split, (values, targets) in features.items()}}
    args.output.mkdir(parents=True)
    torch.save({"model": args.model, "weights": str(args.weights), "classes": STATES, "context": .15, "linearHead": head.cpu().state_dict()}, args.output / "linear-probe.pt")
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
