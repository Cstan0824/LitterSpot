#!/usr/bin/env python3
"""Build a numbered bin contact sheet and materialise one label per tile.

The contact sheet is an annotation aid only.  ``sidecar.json`` maps every tile
back to its original image, so ``--labels`` can recreate full-resolution bin
crops without training on the downscaled sheet.  A label file is deliberately
simple and batch-friendly::

    {"tiles": [
      {"tileId": "tile-0000", "state": "normal", "confidence": 0.95},
      {"tileId": "tile-0001", "state": "unknown"}
    ]}

Unknown, missing, or low-confidence labels are logged but excluded from the
generated manifest.  This tool never reads or writes the locked ``mock-data``
tree as training data; callers should use it only for public/project-owned
inputs and keep WhatsApp evaluation images out of the input directory.
"""

from __future__ import annotations

import argparse
import csv
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import shutil
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
STATES = {"normal", "full", "overflow", "unknown"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repo_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def resolve_source(value: str, project_root: Path) -> Path:
    candidate = Path(value)
    return candidate if candidate.is_absolute() else project_root / candidate


def image_paths(value: Path) -> list[Path]:
    if value.is_file():
        return [value.resolve()]
    if value.is_dir():
        return sorted(path.resolve() for path in value.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)
    return sorted(path.resolve() for path in value.parent.glob(value.name) if path.suffix.lower() in IMAGE_SUFFIXES)


def _font() -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", 18)
    except OSError:
        return ImageFont.load_default()


def build_contact_sheet(
    inputs: list[Path],
    output: Path,
    *,
    columns: int = 4,
    tile_size: tuple[int, int] = (448, 448),
    project_root: Path = ROOT,
    source_metadata: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Render tiles and write the sidecar/template; return the sidecar payload."""
    if not inputs:
        raise ValueError("No images were found for the contact sheet")
    if columns < 1 or tile_size[0] < 128 or tile_size[1] < 128:
        raise ValueError("columns must be positive and tile dimensions must be at least 128")
    output.mkdir(parents=True, exist_ok=True)
    sheet_path = output / "contact-sheet.jpg"
    sidecar_path = output / "sidecar.json"
    template_path = output / "labels.template.json"
    if any(path.exists() for path in (sheet_path, sidecar_path, template_path)):
        raise FileExistsError(f"Refusing to overwrite contact-sheet artifacts under {output}")

    tile_width, tile_height = tile_size
    rows = (len(inputs) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "#202124")
    draw = ImageDraw.Draw(sheet)
    font = _font()
    tiles: list[dict[str, Any]] = []
    metadata = source_metadata or {
        "id": "contact-sheet-input",
        "url": "project-owned/input-metadata-required",
        "license": "unknown-until-supplied",
    }
    header_height = 34
    for index, source in enumerate(inputs):
        with Image.open(source) as opened:
            image = opened.convert("RGB")
            source_width, source_height = image.size
        column, row = index % columns, index // columns
        tile_x, tile_y = column * tile_width, row * tile_height
        content_x1, content_y1 = tile_x + 4, tile_y + header_height
        content_x2, content_y2 = tile_x + tile_width - 4, tile_y + tile_height - 4
        content_width, content_height = content_x2 - content_x1, content_y2 - content_y1
        scale = min(content_width / source_width, content_height / source_height)
        rendered_size = (max(1, round(source_width * scale)), max(1, round(source_height * scale)))
        with Image.open(source) as opened:
            rendered = opened.convert("RGB").resize(rendered_size, Image.Resampling.LANCZOS)
        paste_x = content_x1 + (content_width - rendered.width) // 2
        paste_y = content_y1 + (content_height - rendered.height) // 2
        sheet.paste(rendered, (paste_x, paste_y))
        tile_id = f"tile-{index:04d}"
        draw.rectangle((tile_x, tile_y, tile_x + tile_width - 1, tile_y + tile_height - 1), outline="#8ab4f8", width=2)
        draw.rectangle((tile_x + 1, tile_y + 1, tile_x + tile_width - 2, tile_y + header_height - 1), fill="#202124")
        draw.text((tile_x + 10, tile_y + 8), tile_id, fill="white", font=font)
        tiles.append({
            "tileId": tile_id,
            "index": index,
            "sourcePath": repo_path(source),
            "sourceSha256": sha256(source),
            "sourceSize": [source_width, source_height],
            "sheetBox": [tile_x, tile_y, tile_x + tile_width, tile_y + tile_height],
            "contentBox": [paste_x, paste_y, paste_x + rendered.width, paste_y + rendered.height],
        })

    sheet.save(sheet_path, quality=92)
    sidecar = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sheet": repo_path(sheet_path),
        "tileSize": [tile_width, tile_height],
        "source": metadata,
        "tiles": tiles,
        "labelInstructions": (
            "Return one object per tileId. Use normal/full/overflow/unknown. "
            "Use unknown when the rim, contents, or surrounding floor is not visible. "
            "Do not infer a state from adjacent tiles."
        ),
    }
    sidecar_path.write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    template_path.write_text(json.dumps({
        "schemaVersion": 1,
        "tiles": [{"tileId": tile["tileId"], "state": "unknown", "confidence": 0.0} for tile in tiles],
    }, indent=2) + "\n", encoding="utf-8")
    return sidecar


def materialize_labels(
    sidecar_path: Path,
    labels_path: Path,
    output: Path,
    *,
    project_root: Path = ROOT,
    min_confidence: float = .80,
    default_review_status: str = "reviewed",
) -> dict[str, Any]:
    """Copy original tile sources and produce a specialist manifest + CSV log."""
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    labels_payload = json.loads(labels_path.read_text(encoding="utf-8"))
    tiles = sidecar.get("tiles")
    labels = labels_payload.get("tiles") if isinstance(labels_payload, dict) else labels_payload
    if not isinstance(tiles, list) or not isinstance(labels, list):
        raise ValueError("sidecar and labels must contain a tiles array")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Refusing to overwrite non-empty label output: {output}")
    output.mkdir(parents=True, exist_ok=True)
    tile_map = {str(tile.get("tileId")): tile for tile in tiles if isinstance(tile, dict)}
    metadata = sidecar.get("source") if isinstance(sidecar.get("source"), dict) else {}
    manifest_rows: list[dict[str, Any]] = []
    log_rows: list[dict[str, Any]] = []
    accepted = 0
    rejected = 0
    seen_ids: set[str] = set()
    for label in labels:
        if not isinstance(label, dict):
            rejected += 1
            log_rows.append({"tileId": "<invalid>", "status": "rejected", "reason": "label must be an object"})
            continue
        tile_id = str(label.get("tileId", "")).strip()
        tile = tile_map.get(tile_id)
        if tile is None:
            rejected += 1
            log_rows.append({"tileId": tile_id or "<missing>", "status": "rejected", "reason": "tileId not in sidecar"})
            continue
        if tile_id in seen_ids:
            rejected += 1
            log_rows.append({"tileId": tile_id, "status": "rejected", "reason": "duplicate tileId"})
            continue
        seen_ids.add(tile_id)
        state = str(label.get("state", "unknown")).strip().lower()
        confidence = float(label.get("confidence", 0.0))
        if state not in STATES:
            reason = "invalid_state"
        elif state == "unknown":
            reason = "teacher_or_reviewer_unknown"
        elif not 0 <= confidence <= 1 or confidence < min_confidence:
            reason = "below_confidence_threshold"
        else:
            reason = "accepted_label"
        source = resolve_source(str(tile["sourcePath"]), project_root)
        row = {"tileId": tile_id, "source": str(tile["sourcePath"]), "state": state,
               "confidence": confidence, "status": "accepted" if reason == "accepted_label" else "unknown",
               "reason": reason}
        if reason != "accepted_label":
            rejected += 1
            log_rows.append(row)
            continue
        if not source.is_file():
            rejected += 1
            row.update(status="rejected", reason="source_missing")
            log_rows.append(row)
            continue
        actual_hash = sha256(source)
        if actual_hash != tile.get("sourceSha256"):
            rejected += 1
            row.update(status="rejected", reason="source_checksum_changed")
            log_rows.append(row)
            continue
        destination = output / "images" / f"{tile_id}.jpg"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image.convert("RGB").save(destination, quality=95)
        sample_id = f"contact-bin-{tile_id}"
        review_status = str(label.get("review", label.get("status", default_review_status))).strip() or default_review_status
        if review_status not in {"reviewed", "weak_label"}:
            review_status = default_review_status
        split = str(label.get("split", "train")).strip()
        if split not in {"train", "valid", "test"}:
            split = "train"
        manifest_rows.append({
            "sampleId": sample_id, "pipeline": "bin_state", "path": repo_path(destination),
            "captureGroup": f"contact-sheet-{Path(str(tile['sourcePath'])).stem}", "split": split,
            "source": {**metadata, "annotationId": tile_id, "sourceSha256": actual_hash},
            "sha256": sha256(destination),
            "review": {"status": review_status, "reviewer": str(label.get("reviewer", "contact-sheet")),
                       "method": "numbered-contact-sheet", "reviewedAt": datetime.now(UTC).date().isoformat()},
            "edgeTags": ["contact_sheet_label", "bin_state"],
            "label": {"binId": sample_id, "state": state, "binPresent": True,
                      "presenceKnown": True, "fullnessKnown": True, "overflowKnown": True},
        })
        accepted += 1
        row.update(status="accepted", crop=repo_path(destination), sampleId=sample_id)
        log_rows.append(row)

    (output / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "samples": manifest_rows}, indent=2) + "\n", encoding="utf-8")
    with (output / "labels.csv").open("w", newline="", encoding="utf-8") as handle:
        fieldnames = sorted({key for row in log_rows for key in row}) if log_rows else ["tileId", "status", "reason"]
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(log_rows)
    report = {
        "generatedAt": datetime.now(UTC).isoformat(), "sidecar": str(sidecar_path.resolve()),
        "labels": str(labels_path.resolve()), "tiles": len(tiles), "labelRows": len(labels),
        "accepted": accepted, "unknownOrRejected": rejected,
        "acceptanceRate": accepted / len(tiles) if tiles else 0.0,
        "trainingPixelsComeFromOriginalSources": True,
        "lockedMockDataAllowed": False,
        "defaultReviewStatus": default_review_status,
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="directory, file, or wildcard of source bin images/crops")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--tile-width", type=int, default=448)
    parser.add_argument("--tile-height", type=int, default=448)
    parser.add_argument("--source-id", default="contact-sheet-input")
    parser.add_argument("--source-url", default="project-owned/input-metadata-required")
    parser.add_argument("--license", dest="license_name", default="unknown-until-supplied")
    parser.add_argument("--labels", type=Path, help="JSON labels file; materialises original-resolution crops")
    parser.add_argument("--sidecar", type=Path, help="existing sidecar.json to materialise without rebuilding a sheet")
    parser.add_argument("--page-size", type=int, default=0, help="split a large input into contact-sheet subdirectories")
    parser.add_argument("--min-confidence", type=float, default=.80)
    parser.add_argument("--default-review-status", choices=("reviewed", "weak_label"), default="reviewed")
    parser.add_argument("--project-root", type=Path, default=ROOT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 0 <= args.min_confidence <= 1:
        raise SystemExit("--min-confidence must be between 0 and 1")
    output = args.output.resolve()
    if args.labels and args.page_size:
        raise SystemExit("Use one labels file per page; --labels and --page-size cannot be combined")
    existing_sidecar = args.sidecar.resolve() if args.sidecar else output / "sidecar.json"
    if args.labels and existing_sidecar.is_file():
        result = {"labels": materialize_labels(
            existing_sidecar, args.labels.resolve(), output / "labeled",
            project_root=args.project_root.resolve(), min_confidence=args.min_confidence,
            default_review_status=args.default_review_status,
        )}
    else:
        inputs = image_paths(args.input.resolve())
        metadata = {"id": args.source_id, "url": args.source_url, "license": args.license_name}
        if args.page_size:
            if args.page_size < 1:
                raise SystemExit("--page-size must be positive")
            if output.exists() and any(output.iterdir()):
                raise SystemExit(f"Refusing to overwrite non-empty output: {output}")
            pages = []
            for page_index, offset in enumerate(range(0, len(inputs), args.page_size)):
                page_output = output / f"page-{page_index:03d}"
                page_sidecar = build_contact_sheet(
                    inputs[offset:offset + args.page_size], page_output, columns=args.columns,
                    tile_size=(args.tile_width, args.tile_height), project_root=args.project_root.resolve(),
                    source_metadata=metadata,
                )
                pages.append({"page": page_index, "output": str(page_output), "tiles": len(page_sidecar["tiles"])})
            result = {"pages": pages, "tiles": len(inputs)}
        else:
            if output.exists() and any(output.iterdir()):
                raise SystemExit(f"Refusing to overwrite non-empty output: {output}")
            sidecar = build_contact_sheet(
                inputs, output, columns=args.columns, tile_size=(args.tile_width, args.tile_height),
                project_root=args.project_root.resolve(), source_metadata=metadata,
            )
            result = {"sheet": sidecar["sheet"], "tiles": len(sidecar["tiles"])}
            if args.labels:
                result["labels"] = materialize_labels(
                    output / "sidecar.json", args.labels.resolve(), output / "labeled",
                    project_root=args.project_root.resolve(), min_confidence=args.min_confidence,
                    default_review_status=args.default_review_status,
                )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
