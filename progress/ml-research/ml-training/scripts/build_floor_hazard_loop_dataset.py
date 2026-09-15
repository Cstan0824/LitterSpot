"""Build an auditable two-class floor-hazard segmentation dataset.

The local admitted litter set contains polygon masks. The admitted public wet
surface set contains YOLO boxes, so this script converts those boxes to
rectangular polygons and records that limitation in the manifest. It never
uses the locked mock/evaluation folders as training data.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--litter-root", type=Path, default=Path("dataset/floor_rubbish/prepared_specialist_dataset_v2"))
    parser.add_argument("--spill-root", type=Path, default=Path("dataset/floor_spill/wet_surface_v4"))
    parser.add_argument("--output", type=Path, default=Path("dataset/floor_hazards/loop1"))
    parser.add_argument("--loop", type=int, choices=(1, 2), default=1)
    return parser.parse_args()


def copy_sample(source_root: Path, output_root: Path, split: str, image_name: str, source_label: str, label_lines: list[str], source_kind: str, repeat_index: int = 0) -> dict:
    image_source = source_root / "images" / split / image_name
    if not image_source.exists():
        raise FileNotFoundError(image_source)
    stem = Path(image_name).stem
    safe_stem = f"{source_kind}__{stem}{f'__r{repeat_index}' if repeat_index else ''}"
    image_target = output_root / "images" / split / f"{safe_stem}{image_source.suffix.lower()}"
    label_target = output_root / "labels" / split / f"{safe_stem}.txt"
    shutil.copy2(image_source, image_target)
    label_target.write_text("\n".join(label_lines) + ("\n" if label_lines else ""), encoding="utf-8")
    return {
        "image": str(image_target.relative_to(output_root)).replace("\\", "/"),
        "label": str(label_target.relative_to(output_root)).replace("\\", "/"),
        "split": split,
        "source": source_label,
        "sourceKind": source_kind,
        "labelType": "polygon" if source_kind == "litter" else "bbox_promoted_to_rectangle_polygon",
    }


def spill_polygon_lines(path: Path) -> list[str]:
    converted: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        values = raw.split()
        if len(values) < 5:
            continue
        _, cx, cy, width, height = map(float, values[:5])
        half_width, half_height = width / 2, height / 2
        points = (
            (max(0.0, cx - half_width), max(0.0, cy - half_height)),
            (min(1.0, cx + half_width), max(0.0, cy - half_height)),
            (min(1.0, cx + half_width), min(1.0, cy + half_height)),
            (max(0.0, cx - half_width), min(1.0, cy + half_height)),
        )
        converted.append("1 " + " ".join(f"{x:.6f} {y:.6f}" for x, y in points))
    return converted


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    for split in ("train", "val", "test"):
        (output / "images" / split).mkdir(parents=True, exist_ok=True)
        (output / "labels" / split).mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    counts = {"litter": {"train": 0, "val": 0, "test": 0}, "spill": {"train": 0, "val": 0, "test": 0}}
    for split in ("train", "val", "test"):
        litter_images = sorted((args.litter_root / "images" / split).glob("*"))
        for image in litter_images:
            label = args.litter_root / "labels" / split / f"{image.stem}.txt"
            lines = [line.strip() for line in label.read_text(encoding="utf-8").splitlines() if line.strip()] if label.exists() else []
            repeat_count = 8 if args.loop == 2 and split == "train" else 1
            for repeat_index in range(repeat_count):
                manifest.append(copy_sample(args.litter_root, output, split, image.name, "local_taco_specialist", lines, "litter", repeat_index))
                counts["litter"][split] += 1

        spill_images = sorted((args.spill_root / "images" / split).glob("*"))
        for image in spill_images:
            label = args.spill_root / "labels" / split / f"{image.stem}.txt"
            manifest.append(copy_sample(args.spill_root, output, split, image.name, "mendeley_wet_surface_v4", spill_polygon_lines(label), "spill"))
            counts["spill"][split] += 1

    yaml = f"path: '{output.as_posix()}'\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: floor_litter\n  1: floor_spill\n"
    (output / "data.yaml").write_text(yaml, encoding="utf-8")
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "loop": args.loop,
        "output": str(output),
        "counts": counts,
        "totalImages": len(manifest),
        "sources": {
            "local_taco_specialist": {"role": "dispatchable litter bootstrap", "labelType": "polygon"},
            "mendeley_wet_surface_v4": {"role": "spill pretraining/diagnostic only", "labelType": "bbox_promoted_to_rectangle_polygon", "dispatchable": False},
        },
        "trainingEligibility": {
            "loop1": "bootstrap_only" if args.loop == 1 else "targeted_mitigation",
            "spillDispatchable": False,
            "lockedMocksUsed": False,
            "loop2Mitigation": "8x train-only oversampling of local polygon litter to reduce spill-source dominance; runtime ROI/exclusion and temporal confirmation remain required.",
            "warning": "No fixed-camera theme-park spill masks are available; spill labels are rectangular public wet-surface boxes.",
        },
        "manifest": manifest,
    }
    (output / "manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "totalImages": len(manifest), "counts": counts}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
