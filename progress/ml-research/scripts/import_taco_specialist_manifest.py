#!/usr/bin/env python3
"""Import downloaded, reviewed TACO polygons into the specialist manifest.

Only images listed by ``acquire_taco_subset.py`` are imported. Exact COCO
relative paths are required, preventing basename collisions and accidental
reuse of an annotation for another image. TACO supplies solid-litter masks;
it supplies no spill or bin-state labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANNOTATIONS = ROOT / "dataset/floor_rubbish/raw_dataset/TACO-repo/data/annotations.json"
DEFAULT_ACQUISITION = ROOT / "dataset/floor_rubbish/raw_dataset/TACO-images/acquisition-manifest.json"
DEFAULT_MANIFEST = ROOT / "ml-training/data/specialists/manifest.json"
DEFAULT_MASK_ROOT = ROOT / "ml-training/data/specialists/source-cache/taco-masks"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _split(image_id: int, seed: int) -> str:
    value = random.Random(seed + image_id).random()
    return "train" if value < 0.70 else "valid" if value < 0.85 else "test"


def import_rows(
    annotations_path: Path,
    acquisition_path: Path,
    manifest_path: Path,
    mask_root: Path,
    project_root: Path = ROOT,
    seed: int = 42,
) -> dict[str, Any]:
    annotations = json.loads(annotations_path.read_text(encoding="utf-8"))
    acquisition = json.loads(acquisition_path.read_text(encoding="utf-8"))
    image_by_id = {int(row["id"]): row for row in annotations.get("images", [])}
    annotations_by_image: dict[int, list[dict[str, Any]]] = {}
    for annotation in annotations.get("annotations", []):
        annotations_by_image.setdefault(int(annotation["image_id"]), []).append(annotation)
    existing_payload = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {"schemaVersion": 1, "samples": []}
    existing_rows = [row for row in existing_payload.get("samples", []) if row.get("pipeline") != "floor_hazard" ]
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    mask_root.mkdir(parents=True, exist_ok=True)
    for record in acquisition.get("records", []):
        image_id = int(record["imageId"])
        image_info = image_by_id.get(image_id)
        if image_info is None:
            skipped.append({"imageId": str(image_id), "reason": "missing annotation image"})
            continue
        source = project_root / str(record["path"])
        if not source.is_file():
            # The acquisition cache path can differ from the exact COCO path;
            # the copied official-relative image is the only acceptable fallback.
            source = annotations_path.parent / str(image_info["file_name"])
        if not source.is_file():
            skipped.append({"imageId": str(image_id), "reason": "image missing"})
            continue
        try:
            with Image.open(source) as image:
                image = image.convert("RGB")
                width, height = image.size
        except (OSError, ValueError) as exc:
            skipped.append({"imageId": str(image_id), "reason": f"image decode failed: {exc}"})
            continue
        mask = Image.new("L", (width, height), 0)
        drawer = ImageDraw.Draw(mask)
        source_width = float(image_info.get("width") or width)
        source_height = float(image_info.get("height") or height)
        scale_x = width / source_width
        scale_y = height / source_height
        polygon_count = 0
        for annotation in annotations_by_image.get(image_id, []):
            segmentation = annotation.get("segmentation")
            if not isinstance(segmentation, list):
                continue
            for polygon in segmentation:
                if not isinstance(polygon, list) or len(polygon) < 6 or len(polygon) % 2:
                    continue
                points = [
                    (float(polygon[index]) * scale_x, float(polygon[index + 1]) * scale_y)
                    for index in range(0, len(polygon), 2)
                ]
                drawer.polygon(points, fill=1)
                polygon_count += 1
        if polygon_count == 0:
            skipped.append({"imageId": str(image_id), "reason": "no valid reviewed polygon"})
            continue
        mask_path = mask_root / f"taco-{image_id:06d}.png"
        mask.save(mask_path)
        relative_image = str(source.resolve().relative_to(project_root.resolve())).replace("\\", "/")
        relative_mask = str(mask_path.resolve().relative_to(project_root.resolve())).replace("\\", "/")
        rows.append({
            "sampleId": f"taco-floor-litter-{image_id:06d}",
            "pipeline": "floor_hazard",
            "path": relative_image,
            "captureGroup": f"taco-image-{image_id:06d}",
            "split": _split(image_id, seed),
            "source": {
                "id": "taco-reviewed",
                "url": "https://github.com/pedropro/TACO",
                "license": "CC BY 4.0 (verify original Flickr asset terms before redistribution)",
                "annotationId": str(image_id),
            },
            "sha256": _sha256(source),
            "review": {
                "status": "reviewed",
                "reviewer": "taco-annotation",
                "reviewedAt": datetime.now(UTC).date().isoformat(),
            },
            "edgeTags": ["solid_litter", "public_source"],
            "label": {"classes": ["floor_litter"], "maskPath": relative_mask},
        })
    output = {"schemaVersion": 1, "samples": existing_rows + rows}
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    report = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "annotations": str(annotations_path.resolve()),
        "acquisition": str(acquisition_path.resolve()),
        "manifest": str(manifest_path.resolve()),
        "imported": len(rows), "skipped": len(skipped), "preservedNonFloorRows": len(existing_rows),
        "skippedRows": skipped,
        "note": "TACO contributes floor_litter only; no floor_spill or bin-state labels were inferred.",
    }
    (manifest_path.parent / "taco-import-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, default=DEFAULT_ANNOTATIONS)
    parser.add_argument("--acquisition", type=Path, default=DEFAULT_ACQUISITION)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--mask-root", type=Path, default=DEFAULT_MASK_ROOT)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    report = import_rows(args.annotations.resolve(), args.acquisition.resolve(), args.manifest.resolve(), args.mask_root.resolve(), ROOT, args.seed)
    print(json.dumps({key: report[key] for key in ("imported", "skipped", "preservedNonFloorRows")}, indent=2))
    return 0 if report["imported"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
