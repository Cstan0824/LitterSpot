"""Build the final YOLO segmentation dataset from converted intermediates."""
from __future__ import annotations

import argparse
import shutil
from collections import Counter
from pathlib import Path

from dataset_utils import SEED, deterministic_split, hd10k_group_key, prepared_dataset_root, read_csv, write_csv
import random


FIELDS = [
    "split",
    "source",
    "source_image",
    "source_label",
    "prepared_image",
    "prepared_label",
    "output_filename",
    "group",
    "floor_litter_objects",
    "floor_spill_objects",
]


def clear_final_dirs(prepared: Path) -> None:
    for split in ("train", "val", "test"):
        for kind in ("images", "labels"):
            target = prepared / kind / split
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)


def split_rows(rows: list[dict[str, str]], source: str) -> dict[int, str]:
    if source == "uavvaste" and all(row.get("split") in {"train", "val", "test"} for row in rows):
        return {idx: row["split"] for idx, row in enumerate(rows)}
    if source == "hd10k":
        group_sizes = Counter(hd10k_group_key(row.get("source_image", "")) for row in rows)
        targets = {
            "train": int(len(rows) * 0.70),
            "val": int(len(rows) * 0.15),
            "test": len(rows) - int(len(rows) * 0.70) - int(len(rows) * 0.15),
        }
        groups = list(group_sizes)
        random.Random(SEED).shuffle(groups)
        groups.sort(key=lambda group: group_sizes[group], reverse=True)
        assigned = Counter()
        group_splits: dict[str, str] = {}
        for group in groups:
            split = max(targets, key=lambda name: targets[name] - assigned[name])
            group_splits[group] = split
            assigned[split] += group_sizes[group]
        return {idx: group_splits[hd10k_group_key(row.get("source_image", ""))] for idx, row in enumerate(rows)}
    item_splits = deterministic_split(list(range(len(rows))))
    return item_splits


def copy_rows(prepared: Path, rows: list[dict[str, str]], source: str) -> list[dict[str, str]]:
    split_map = split_rows(rows, source)
    copied: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for idx, row in enumerate(rows):
        split = split_map[idx]
        image = Path(row["output_image"])
        label = Path(row["output_label"])
        if not image.exists() or not label.exists():
            continue
        output_name = row["output_filename"]
        if output_name in seen_names:
            output_name = f"{source}_{idx}_{output_name}"
        seen_names.add(output_name)
        dest_image = prepared / "images" / split / output_name
        dest_label = prepared / "labels" / split / f"{Path(output_name).stem}.txt"
        shutil.copy2(image, dest_image)
        shutil.copy2(label, dest_label)
        copied.append(
            {
                "split": split,
                "source": source,
                "source_image": row.get("source_image", ""),
                "source_label": row.get("source_label", ""),
                "prepared_image": str(dest_image),
                "prepared_label": str(dest_label),
                "output_filename": output_name,
                "group": hd10k_group_key(row.get("source_image", "")) if source == "hd10k" else row.get("group", ""),
                "floor_litter_objects": row.get("floor_litter_objects", "0"),
                "floor_spill_objects": row.get("floor_spill_objects", "0"),
            }
        )
    return copied


def write_data_yaml(prepared: Path) -> None:
    text = """path: dataset/floor_rubbish/prepared_dataset
train: images/train
val: images/val
test: images/test

names:
  0: floor_litter
  1: floor_spill
"""
    (prepared / "data.yaml").write_text(text, encoding="utf-8")


def write_build_report(prepared: Path, rows: list[dict[str, str]]) -> None:
    by_split = Counter(row["split"] for row in rows)
    by_source = Counter(row["source"] for row in rows)
    lines = [
        "# Dataset Build Report",
        "",
        f"Total prepared images: {len(rows)}",
        "",
        "## Images by Split",
        "",
        *[f"- {split}: {by_split.get(split, 0)}" for split in ("train", "val", "test")],
        "",
        "## Images by Source",
        "",
        *[f"- {source}: {count}" for source, count in sorted(by_source.items())],
        "",
        "## Notes",
        "",
        "- TACO was split deterministically at image level.",
        "- HD10K was split by scene plus filename sequence group, not by individual frame.",
        "- Official HD10K test scenes remain under `prepared_dataset/external_test/hd10k` and are not included in train/val/test.",
    ]
    (prepared / "reports").mkdir(parents=True, exist_ok=True)
    (prepared / "reports" / "build_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    args = parser.parse_args()

    args.prepared.mkdir(parents=True, exist_ok=True)
    (args.prepared / "reports").mkdir(parents=True, exist_ok=True)
    clear_final_dirs(args.prepared)

    taco_rows = read_csv(args.prepared / "intermediate" / "taco" / "manifest.csv")
    hd_rows = read_csv(args.prepared / "intermediate" / "hd10k" / "manifest.csv")
    uav_rows = read_csv(args.prepared / "intermediate" / "uavvaste" / "manifest.csv")
    print(f"Building final dataset from TACO images={len(taco_rows)} HD10K images={len(hd_rows)} UAVVaste images={len(uav_rows)}")
    final_rows = (
        copy_rows(args.prepared, taco_rows, "taco")
        + copy_rows(args.prepared, hd_rows, "hd10k")
        + copy_rows(args.prepared, uav_rows, "uavvaste")
    )
    write_csv(args.prepared / "dataset_manifest.csv", final_rows, FIELDS)
    write_data_yaml(args.prepared)
    write_build_report(args.prepared, final_rows)
    print(f"Prepared final images: {len(final_rows)}")
    for split, count in Counter(row["split"] for row in final_rows).items():
        print(f"  {split}: {count}")


if __name__ == "__main__":
    main()
