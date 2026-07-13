"""Create the three-class LitterSpot dataset from the supplied Roboflow export.

`closed` and `Broken trash can` are excluded pending manual review; no label is
silently guessed. Source-image groups stay together when rebuilding the split.
"""
from __future__ import annotations
import argparse, json, random, shutil
from collections import Counter
from pathlib import Path

MAPPING = {1: 0, 3: 0, 4: 0, 8: 0, 2: 1, 5: 1, 9: 1, 6: 2}
EXCLUDED = {0: "Broken trash can", 7: "closed (manual review required)"}
SPLITS = (("train", .70), ("valid", .20), ("test", .10))
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

def source_group(name: str) -> str:
    return name.split(".rf.", 1)[0]

def main() -> None:
    p = argparse.ArgumentParser(); p.add_argument("source", type=Path); p.add_argument("destination", type=Path); p.add_argument("--seed", type=int, default=42); args = p.parse_args()
    if args.destination.exists() and any(args.destination.iterdir()): raise SystemExit(f"Destination is not empty: {args.destination}")
    images = [p for p in args.source.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES and p.parent.name == "images"]
    groups: dict[str, list[Path]] = {}
    for image in images: groups.setdefault(source_group(image.stem), []).append(image)
    keys = list(groups); random.Random(args.seed).shuffle(keys)
    cut1, cut2 = int(len(keys) * .70), int(len(keys) * .90)
    group_split = {key: "train" if i < cut1 else "valid" if i < cut2 else "test" for i, key in enumerate(keys)}
    counts, excluded, dropped = Counter(), Counter(), 0
    for split, _ in SPLITS:
        (args.destination / split / "images").mkdir(parents=True, exist_ok=True); (args.destination / split / "labels").mkdir(parents=True, exist_ok=True)
    for image in images:
        label = image.parent.parent / "labels" / f"{image.stem}.txt"
        cleaned = []
        for line in label.read_text().splitlines():
            fields = line.split(); old = int(fields[0])
            if old in EXCLUDED: excluded[EXCLUDED[old]] += 1; continue
            if old not in MAPPING: dropped += 1; continue
            new = MAPPING[old]; cleaned.append(" ".join([str(new), *fields[1:]])); counts[new] += 1
        # Retain legitimate negative images but discard images containing only excluded objects.
        if not cleaned and label.read_text().strip(): continue
        split = group_split[source_group(image.stem)]
        shutil.copy2(image, args.destination / split / "images" / image.name)
        (args.destination / split / "labels" / f"{image.stem}.txt").write_text("\n".join(cleaned) + ("\n" if cleaned else ""))
    report = {"sourceImages": len(images), "sourceGroups": len(groups), "classObjects": {"normal": counts[0], "full": counts[1], "overflowing": counts[2]}, "excludedObjects": dict(excluded), "droppedUnknown": dropped, "mapping": MAPPING}
    (args.destination / "conversion-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
if __name__ == "__main__": main()
