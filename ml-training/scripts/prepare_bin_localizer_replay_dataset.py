"""Mix Malaysian weak labels with the generic localizer data for replay training."""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def copy_split(source: Path, destination: Path, prefix: str = "") -> int:
    count = 0
    for image in sorted((source / "images").iterdir()):
        if image.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        label = source / "labels" / f"{image.stem}.txt"
        target_stem = f"{prefix}{image.stem}"
        link_or_copy(image, destination / "images" / f"{target_stem}{image.suffix.lower()}")
        if label.is_file():
            link_or_copy(label, destination / "labels" / f"{target_stem}.txt")
        else:
            (destination / "labels" / f"{target_stem}.txt").touch()
        count += 1
    return count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generic", type=Path, default=ROOT / "ml-training/data/bin-localizer")
    parser.add_argument("--malaysia", type=Path, default=ROOT / "ml-training/data/malaysia-bin-node-pseudo")
    parser.add_argument("--output", type=Path, default=ROOT / "ml-training/data/bin-loc-replay")
    parser.add_argument("--repeats", type=int, default=32, help="Malaysian train-set repetitions")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.repeats < 1:
        raise SystemExit("--repeats must be at least 1")
    if args.output.exists():
        shutil.rmtree(args.output)

    report: dict[str, object] = {"malaysiaRepeats": args.repeats}
    for split in ("train", "valid", "test"):
        source_split = args.generic / split
        if not source_split.is_dir():
            raise SystemExit(f"Missing generic split: {source_split}")
        report[f"generic{split.title()}Images"] = copy_split(source_split, args.output / split)

    malaysia_train = args.malaysia / "train"
    malaysia_valid = args.malaysia / "valid"
    if not malaysia_train.is_dir() or not malaysia_valid.is_dir():
        raise SystemExit("Run bootstrap_malaysia_bin_labels.py before preparing replay data")
    for repeat in range(args.repeats):
        copy_split(malaysia_train, args.output / "train", prefix=f"um_r{repeat:02d}_")
    # Local validation is included in training once so generic validation remains
    # an independent anti-forgetting gate.
    copy_split(malaysia_valid, args.output / "train", prefix="um_valid_replay_")

    report["malaysiaTrainImages"] = len(list((malaysia_train / "images").iterdir()))
    report["malaysiaValidImages"] = len(list((malaysia_valid / "images").iterdir()))
    report["combinedTrainImages"] = len(list((args.output / "train/images").iterdir()))
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
