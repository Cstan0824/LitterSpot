"""Build review crops from acquired Open Images pixels and official boxes."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ACQUISITION = ROOT / "ml-training/data/public/openimages-v7-verified-pilot/manifest.json"
DEFAULT_BOXES = ROOT / "artifacts/dataset-readiness/openimages-v7-verified-bin-boxes.json"
DEFAULT_OUTPUT = ROOT / "artifacts/contact-sheet/openimages-v7-verified-pilot-crops/source-crops"


class CropBuildError(RuntimeError):
    """Raised when source pixels or box evidence fail closed."""


def _hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _pixel_box(
    coordinates: list[float], width: int, height: int, padding: float,
) -> tuple[int, int, int, int]:
    if len(coordinates) != 4:
        raise CropBuildError("box must contain four normalized coordinates")
    xmin, ymin, xmax, ymax = (float(value) for value in coordinates)
    if not (0 <= xmin < xmax <= 1 and 0 <= ymin < ymax <= 1):
        raise CropBuildError(f"invalid normalized box: {coordinates}")
    box_width = xmax - xmin
    box_height = ymax - ymin
    xmin = max(0.0, xmin - box_width * padding)
    xmax = min(1.0, xmax + box_width * padding)
    ymin = max(0.0, ymin - box_height * padding)
    ymax = min(1.0, ymax + box_height * padding)
    return (
        math.floor(xmin * width),
        math.floor(ymin * height),
        math.ceil(xmax * width),
        math.ceil(ymax * height),
    )


def build_crops(
    acquisition: dict[str, Any], boxes: dict[str, Any], *, output_dir: Path,
    padding: float = 0.1,
) -> dict[str, Any]:
    if not 0 <= padding <= 1:
        raise ValueError("padding must be between 0 and 1")
    if boxes.get("readyForCropping") is not True:
        raise CropBuildError("box artifact is not readyForCropping")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise CropBuildError(f"refusing to overwrite non-empty crop directory: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    source_root = Path(str(acquisition.get("outputDirectory", ""))).resolve()
    box_map = {
        str(row.get("ImageID", "")): row.get("boxes", [])
        for row in boxes.get("records", []) if isinstance(row, dict)
    }
    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    source_count = 0
    for source_record in acquisition.get("records", []):
        if not isinstance(source_record, dict) or source_record.get("status") not in {"downloaded", "reused"}:
            continue
        image_id = str(source_record.get("ImageID", ""))
        filename = str(source_record.get("localFilename", ""))
        if not image_id or Path(filename).name != filename:
            failures.append({"ImageID": image_id, "reason": "unsafe source identity or filename"})
            continue
        source = source_root / filename
        if not source.is_file() or _hash(source) != str(source_record.get("sha256", "")):
            failures.append({"ImageID": image_id, "reason": "source missing or checksum mismatch"})
            continue
        try:
            with Image.open(source) as opened:
                image = opened.convert("RGB")
                width, height = image.size
        except (UnidentifiedImageError, OSError) as error:
            failures.append({"ImageID": image_id, "reason": f"source decode failed: {error}"})
            continue
        if width != int(source_record.get("width", -1)) or height != int(source_record.get("height", -1)):
            failures.append({"ImageID": image_id, "reason": "source dimensions changed"})
            continue
        image_boxes = box_map.get(image_id, [])
        if not image_boxes:
            failures.append({"ImageID": image_id, "reason": "no verified Waste container box"})
            continue
        source_count += 1
        for index, box in enumerate(image_boxes):
            try:
                pixel_box = _pixel_box(list(box.get("xyxyNormalized", [])), width, height, padding)
                crop = image.crop(pixel_box)
                local_filename = f"{image_id}-box-{index:03d}.jpg"
                destination = output_dir / local_filename
                temporary = output_dir / f".{local_filename}.tmp"
                crop.save(temporary, format="JPEG", quality=95)
                temporary.replace(destination)
                records.append({
                    "ImageID": image_id,
                    "boxIndex": index,
                    "officialBox": box,
                    "pixelBoxWithPadding": list(pixel_box),
                    "paddingFraction": padding,
                    "localFilename": local_filename,
                    "cropSha256": _hash(destination),
                    "cropWidth": crop.width,
                    "cropHeight": crop.height,
                    "sourceFilename": filename,
                    "sourceSha256": source_record.get("sha256"),
                    "originalUrl": source_record.get("originalUrl"),
                    "landingUrl": source_record.get("landingUrl"),
                    "declaredLicense": source_record.get("declaredLicense"),
                    "declaredAuthorProfileUrl": source_record.get("declaredAuthorProfileUrl"),
                    "declaredAuthor": source_record.get("declaredAuthor"),
                    "title": source_record.get("title"),
                    "isDerivative": True,
                    "changesDescription": "cropped to the official Waste container bounding box",
                })
            except (CropBuildError, OSError, ValueError, TypeError) as error:
                failures.append({"ImageID": image_id, "reason": f"box {index}: {error}"})
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceImageDirectory": str(source_root),
        "outputDirectory": str(output_dir.resolve()),
        "counts": {"sourceImages": source_count, "crops": len(records), "failures": len(failures)},
        "failures": failures,
        "records": records,
    }
    _atomic_json(output_dir / "manifest.json", report)
    return report


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition-manifest", type=Path, default=DEFAULT_ACQUISITION)
    parser.add_argument("--boxes", type=Path, default=DEFAULT_BOXES)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--padding", type=float, default=0.1)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    acquisition = json.loads(args.acquisition_manifest.read_text(encoding="utf-8"))
    boxes = json.loads(args.boxes.read_text(encoding="utf-8"))
    report = build_crops(
        acquisition, boxes, output_dir=args.output_dir.resolve(), padding=args.padding,
    )
    print(json.dumps({
        "manifest": str((args.output_dir.resolve() / "manifest.json")),
        "counts": report["counts"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
