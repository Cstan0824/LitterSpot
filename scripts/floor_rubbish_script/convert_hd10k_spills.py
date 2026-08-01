"""Convert HD10K/IROS2022 liquid masks into YOLO segmentation labels."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from dataset_utils import (
    collect_hd10k_pairs,
    find_hd10k_roots,
    image_size,
    normalize_polygon,
    parse_roots,
    prepared_dataset_root,
    project_root,
    safe_name,
    write_csv,
    yolo_line,
)


def mask_to_polygons(mask_path: Path, min_area: float) -> tuple[list[list[float]], str]:
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("OpenCV and NumPy are required for HD10K mask conversion") from exc

    mask = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
    if mask is None:
        return [], "unreadable_mask"
    if mask.ndim == 2:
        binary = (mask > 0).astype("uint8") * 255
    else:
        binary = (np.any(mask[:, :, :3] > 0, axis=2)).astype("uint8") * 255
    if int(binary.sum()) == 0:
        return [], "empty_mask"

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[list[float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
        approx = cv2.approxPolyDP(contour, epsilon, True)
        points = approx.reshape(-1, 2)
        if len(points) < 3:
            continue
        polygon: list[float] = []
        for x, y in points:
            polygon.extend([float(x), float(y)])
        polygons.append(polygon)
    if not polygons:
        return [], "no_valid_regions"
    return polygons, "ok"


def copy_external_tests(root: Path, prepared: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    test_pairs, issues = collect_hd10k_pairs(root, "test")
    external_root = prepared / "external_test" / "hd10k"
    for pair in test_pairs:
        image = Path(pair["image"])
        mask = Path(pair["mask"])
        scene = str(pair["scene"])
        image_rel = Path(root.name) / "test" / "images" / scene / image.name
        mask_rel = Path(root.name) / "test" / "liquid_dirts_masks" / scene / mask.name
        dest_image = external_root / image_rel
        dest_mask = external_root / mask_rel
        dest_image.parent.mkdir(parents=True, exist_ok=True)
        dest_mask.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image, dest_image)
        shutil.copy2(mask, dest_mask)
        rows.append(
            {
                "source": "hd10k_external_test",
                "source_image": str(image),
                "source_label": str(mask),
                "output_image": str(dest_image),
                "output_label": str(dest_mask),
                "output_filename": dest_image.name,
                "group": scene,
                "floor_litter_objects": 0,
                "floor_spill_objects": "",
            }
        )
    for issue in issues:
        rows.append(
            {
                "source": "hd10k_external_test_issue",
                "source_image": issue.get("path", ""),
                "source_label": "",
                "output_image": "",
                "output_label": "",
                "output_filename": "",
                "group": issue.get("detail", ""),
                "floor_litter_objects": 0,
                "floor_spill_objects": "",
            }
        )
    return rows


def convert_root(root: Path, prepared: Path, min_area: float) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []
    image_out_dir = prepared / "intermediate" / "hd10k" / "images"
    label_out_dir = prepared / "intermediate" / "hd10k" / "labels"
    image_out_dir.mkdir(parents=True, exist_ok=True)
    label_out_dir.mkdir(parents=True, exist_ok=True)

    pairs, issues = collect_hd10k_pairs(root, "train")
    for issue in issues:
        skipped.append({"type": issue["type"], "source": issue["path"], "image_id": "", "detail": issue["detail"]})

    for pair in pairs:
        image = Path(pair["image"])
        mask = Path(pair["mask"])
        scene = str(pair["scene"])
        size = image_size(image)
        if size is None:
            skipped.append({"type": "unreadable_image", "source": str(image), "image_id": image.stem, "detail": str(mask)})
            continue
        width, height = size
        polygons, status = mask_to_polygons(mask, min_area=min_area)
        if status != "ok":
            skipped.append({"type": status, "source": str(mask), "image_id": image.stem, "detail": str(image)})
            continue

        lines: list[str] = []
        for polygon in polygons:
            normalized = normalize_polygon(polygon, width, height)
            if normalized is None or len(normalized) < 6:
                skipped.append({"type": "invalid_contour", "source": str(mask), "image_id": image.stem, "detail": f"points={len(polygon) // 2}"})
                continue
            lines.append(yolo_line(1, normalized))
        if not lines:
            skipped.append({"type": "no_valid_polygons", "source": str(mask), "image_id": image.stem, "detail": str(image)})
            continue

        rel = Path(root.name) / "train" / "liquid_dirts" / "images" / scene / image.name
        output_name = safe_name("hd10k", rel)
        output_image = image_out_dir / output_name
        output_label = label_out_dir / f"{Path(output_name).stem}.txt"
        shutil.copy2(image, output_image)
        output_label.write_text("\n".join(lines) + "\n", encoding="utf-8")
        rows.append(
            {
                "source": "hd10k",
                "source_image": str(image),
                "source_label": str(mask),
                "output_image": str(output_image),
                "output_label": str(output_label),
                "output_filename": output_name,
                "group": scene,
                "floor_litter_objects": 0,
                "floor_spill_objects": len(lines),
            }
        )
    external_rows = copy_external_tests(root, prepared)
    return rows, skipped, external_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--search-root", action="append", help="Root to search. Can be repeated.")
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    parser.add_argument("--min-area", type=float, default=25.0, help="Minimum mask contour area in pixels.")
    args = parser.parse_args()

    roots = parse_roots(args.search_root)
    hd_roots = find_hd10k_roots(roots)
    all_rows: list[dict[str, object]] = []
    all_skipped: list[dict[str, object]] = []
    all_external: list[dict[str, object]] = []
    print(f"Found {len(hd_roots)} candidate HD10K/IROS2022 roots")
    for root in hd_roots:
        print(f"Converting HD10K liquid masks: {root}")
        rows, skipped, external = convert_root(root, args.prepared, min_area=args.min_area)
        all_rows.extend(rows)
        all_skipped.extend(skipped)
        all_external.extend(external)
        print(f"  converted images={len(rows)} skipped_records={len(skipped)} external_records={len(external)}")

    out_dir = args.prepared / "intermediate" / "hd10k"
    fields = [
        "source",
        "source_image",
        "source_label",
        "output_image",
        "output_label",
        "output_filename",
        "group",
        "floor_litter_objects",
        "floor_spill_objects",
    ]
    write_csv(out_dir / "manifest.csv", all_rows, fields)
    write_csv(out_dir / "skipped.csv", all_skipped, ["type", "source", "image_id", "detail"])
    write_csv(args.prepared / "external_test" / "hd10k" / "manifest.csv", all_external, fields)
    print(f"HD10K converted images: {len(all_rows)}")
    print(f"HD10K skipped records: {len(all_skipped)}")
    print(f"HD10K external-test records copied: {len(all_external)}")


if __name__ == "__main__":
    main()
