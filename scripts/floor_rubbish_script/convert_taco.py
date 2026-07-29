"""Convert TACO COCO polygon annotations into YOLO segmentation labels."""
from __future__ import annotations

import argparse
import shutil
from collections import defaultdict
from pathlib import Path

from dataset_utils import (
    find_taco_jsons,
    image_size,
    normalize_polygon,
    parse_roots,
    prepared_dataset_root,
    project_root,
    read_json,
    resolve_coco_image_path,
    safe_name,
    write_csv,
    yolo_line,
)


def select_conversion_jsons(jsons: list[Path]) -> list[Path]:
    """Prefer a single aggregate TACO COCO file when per-batch JSONs are also present."""
    if len(jsons) <= 1:
        return jsons
    scored: list[tuple[int, Path]] = []
    for json_path in jsons:
        data = read_json(json_path) or {}
        scored.append((len(data.get("images", [])), json_path))
    largest_count = max(count for count, _ in scored)
    largest = [path for count, path in scored if count == largest_count]
    if len(largest) == 1:
        return largest
    return sorted(largest)


def taco_relative(json_path: Path, image_path: Path) -> Path:
    for ancestor in image_path.parents:
        if ancestor.name.lower() == "taco":
            try:
                return image_path.relative_to(ancestor)
            except ValueError:
                break
    try:
        return image_path.relative_to(json_path.parent.parent)
    except ValueError:
        return Path(image_path.name)


def convert_one_json(json_path: Path, out_dir: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    data = read_json(json_path)
    if not data:
        return [], [{"type": "invalid_json", "source": str(json_path), "detail": "Could not parse COCO JSON"}]

    images = {image["id"]: image for image in data.get("images", []) if "id" in image}
    annotations_by_image: dict[object, list[dict[str, object]]] = defaultdict(list)
    for annotation in data.get("annotations", []):
        annotations_by_image[annotation.get("image_id")].append(annotation)

    rows: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []
    image_out_dir = out_dir / "images"
    label_out_dir = out_dir / "labels"
    image_out_dir.mkdir(parents=True, exist_ok=True)
    label_out_dir.mkdir(parents=True, exist_ok=True)

    for image_id, image_info in sorted(images.items(), key=lambda item: str(item[0])):
        file_name = str(image_info.get("file_name", ""))
        source_image = resolve_coco_image_path(json_path, file_name)
        if source_image is None:
            skipped.append({"type": "missing_image", "source": str(json_path), "image_id": image_id, "detail": file_name})
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
                        "source": str(json_path),
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
                            "source": str(json_path),
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
                            "source": str(json_path),
                            "image_id": image_id,
                            "annotation_id": annotation.get("id", ""),
                            "detail": f"points={len(polygon) // 2}",
                        }
                    )
                    continue
                lines.append(yolo_line(0, normalized))
                object_count += 1

        if not lines:
            skipped.append({"type": "no_valid_polygons", "source": str(json_path), "image_id": image_id, "detail": file_name})
            continue

        output_name = safe_name("taco", taco_relative(json_path, source_image))
        output_image = image_out_dir / output_name
        output_label = label_out_dir / f"{Path(output_name).stem}.txt"
        shutil.copy2(source_image, output_image)
        output_label.write_text("\n".join(lines) + "\n", encoding="utf-8")
        rows.append(
            {
                "source": "taco",
                "source_image": str(source_image),
                "source_label": str(json_path),
                "output_image": str(output_image),
                "output_label": str(output_label),
                "output_filename": output_name,
                "group": Path(output_name).stem,
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
    out_dir = args.prepared / "intermediate" / "taco"
    jsons = select_conversion_jsons(find_taco_jsons(roots))
    all_rows: list[dict[str, object]] = []
    all_skipped: list[dict[str, object]] = []
    print(f"Found {len(jsons)} candidate TACO COCO JSON files")
    for json_path in jsons:
        print(f"Converting TACO annotations: {json_path}")
        rows, skipped = convert_one_json(json_path, out_dir)
        all_rows.extend(rows)
        all_skipped.extend(skipped)
        print(f"  converted images={len(rows)} skipped_records={len(skipped)}")

    write_csv(
        out_dir / "manifest.csv",
        all_rows,
        [
            "source",
            "source_image",
            "source_label",
            "output_image",
            "output_label",
            "output_filename",
            "group",
            "floor_litter_objects",
            "floor_spill_objects",
        ],
    )
    write_csv(out_dir / "skipped.csv", all_skipped, ["type", "source", "image_id", "annotation_id", "detail"])
    print(f"TACO converted images: {len(all_rows)}")
    print(f"TACO skipped records: {len(all_skipped)}")


if __name__ == "__main__":
    main()
