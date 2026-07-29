"""Convert UAVVaste COCO polygon annotations into YOLO segmentation labels."""
from __future__ import annotations

import argparse
import shutil
from collections import defaultdict
from pathlib import Path

from dataset_utils import (
    find_uavvaste_roots,
    image_size,
    normalize_polygon,
    parse_roots,
    prepared_dataset_root,
    project_root,
    read_json,
    safe_name,
    write_csv,
    yolo_line,
)


FIELDS = [
    "source",
    "split",
    "source_image",
    "source_label",
    "output_image",
    "output_label",
    "output_filename",
    "group",
    "floor_litter_objects",
    "floor_spill_objects",
]


def load_split_map(root: Path) -> dict[str, str]:
    split_path = root / "annotations" / "train_val_test_distribution_file.json"
    data = read_json(split_path) or {}
    split_map: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for file_name in data.get(split, []):
            split_map[str(file_name)] = split
    return split_map


def convert_root(root: Path, prepared: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    annotation_path = root / "annotations" / "annotations.json"
    data = read_json(annotation_path)
    if not data:
        return [], [{"type": "invalid_json", "source": str(annotation_path), "image_id": "", "detail": "Could not parse COCO JSON"}]

    split_map = load_split_map(root)
    images = {image["id"]: image for image in data.get("images", []) if "id" in image}
    annotations_by_image: dict[object, list[dict[str, object]]] = defaultdict(list)
    for annotation in data.get("annotations", []):
        annotations_by_image[annotation.get("image_id")].append(annotation)

    rows: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []
    image_out_dir = prepared / "intermediate" / "uavvaste" / "images"
    label_out_dir = prepared / "intermediate" / "uavvaste" / "labels"
    image_out_dir.mkdir(parents=True, exist_ok=True)
    label_out_dir.mkdir(parents=True, exist_ok=True)

    for image_id, image_info in sorted(images.items(), key=lambda item: str(item[0])):
        file_name = str(image_info.get("file_name", ""))
        source_image = root / "images" / file_name
        if not source_image.exists():
            skipped.append({"type": "missing_image", "source": str(annotation_path), "image_id": image_id, "detail": file_name})
            continue

        split = split_map.get(file_name)
        if split not in {"train", "val", "test"}:
            skipped.append({"type": "missing_split", "source": str(annotation_path), "image_id": image_id, "detail": file_name})
            continue

        width = int(image_info.get("width") or 0)
        height = int(image_info.get("height") or 0)
        if width <= 0 or height <= 0:
            size = image_size(source_image)
            if size is None:
                skipped.append({"type": "unreadable_image", "source": str(source_image), "image_id": image_id, "detail": file_name})
                continue
            width, height = size

        lines: list[str] = []
        object_count = 0
        for annotation in annotations_by_image.get(image_id, []):
            segmentation = annotation.get("segmentation")
            if not isinstance(segmentation, list):
                skipped.append(
                    {
                        "type": "non_polygon_segmentation",
                        "source": str(annotation_path),
                        "image_id": image_id,
                        "annotation_id": annotation.get("id", ""),
                        "detail": "Expected list polygon segmentation",
                    }
                )
                continue
            for polygon_index, polygon in enumerate(segmentation):
                if not isinstance(polygon, list):
                    skipped.append(
                        {
                            "type": "invalid_polygon_type",
                            "source": str(annotation_path),
                            "image_id": image_id,
                            "annotation_id": annotation.get("id", ""),
                            "detail": f"polygon_index={polygon_index}",
                        }
                    )
                    continue
                normalized = normalize_polygon(polygon, width, height)
                if normalized is None or len(normalized) < 6:
                    skipped.append(
                        {
                            "type": "invalid_polygon",
                            "source": str(annotation_path),
                            "image_id": image_id,
                            "annotation_id": annotation.get("id", ""),
                            "detail": f"points={len(polygon) // 2}",
                        }
                    )
                    continue
                lines.append(yolo_line(0, normalized))
                object_count += 1

        if not lines:
            skipped.append({"type": "no_valid_polygons", "source": str(annotation_path), "image_id": image_id, "detail": file_name})
            continue

        output_name = safe_name("uavvaste", Path(file_name))
        output_image = image_out_dir / output_name
        output_label = label_out_dir / f"{Path(output_name).stem}.txt"
        shutil.copy2(source_image, output_image)
        output_label.write_text("\n".join(lines) + "\n", encoding="utf-8")
        rows.append(
            {
                "source": "uavvaste",
                "split": split,
                "source_image": str(source_image),
                "source_label": str(annotation_path),
                "output_image": str(output_image),
                "output_label": str(output_label),
                "output_filename": output_name,
                "group": Path(file_name).stem,
                "floor_litter_objects": object_count,
                "floor_spill_objects": 0,
            }
        )
    return rows, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--search-root", action="append", help="Root to search. Can be repeated.")
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    args = parser.parse_args()

    roots = parse_roots(args.search_root)
    uav_roots = find_uavvaste_roots(roots)
    all_rows: list[dict[str, object]] = []
    all_skipped: list[dict[str, object]] = []
    print(f"Found {len(uav_roots)} candidate UAVVaste roots")
    for root in uav_roots:
        print(f"Converting UAVVaste annotations: {root}")
        rows, skipped = convert_root(root, args.prepared)
        all_rows.extend(rows)
        all_skipped.extend(skipped)
        print(f"  converted images={len(rows)} skipped_records={len(skipped)}")

    out_dir = args.prepared / "intermediate" / "uavvaste"
    write_csv(out_dir / "manifest.csv", all_rows, FIELDS)
    write_csv(out_dir / "skipped.csv", all_skipped, ["type", "source", "image_id", "annotation_id", "detail"])
    print(f"UAVVaste converted images: {len(all_rows)}")
    print(f"UAVVaste skipped records: {len(all_skipped)}")


if __name__ == "__main__":
    main()
