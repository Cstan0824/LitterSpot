"""Materialize a deterministic, stratified visual audit sample from GBS.

The official GBS record contains a multi-gigabyte ZIP archive.  This command
reuses the metadata-only ZIP range reader to fetch the annotation member and
then only the selected JPEG members.  It writes original images, derived
instance crops, colored-box previews, paginated contact sheets, and a
provenance manifest.  It does not use the WhatsApp media, infer appearance
families, or create training labels.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import UTC, datetime
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import random
import struct
from typing import Any
import zlib

from PIL import Image, ImageDraw, ImageFont

from audit_gbs_zenodo_metadata import (
    ANNOTATION_MEMBER,
    DEFAULT_RECORD_ID,
    DEFAULT_USER_AGENT,
    MetadataAuditError,
    _find_zip_entry,
    _range_request,
    _zip64_directory,
    fetch_json,
    validate_record,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/gbs-visual-sample"
DEFAULT_TOTAL = 300
DEFAULT_SEED = 42
DEFAULT_PAGE_SIZE = 100
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
STRATA = ("garbage_bin_only", "overflow_present", "mixed_garbage_context")
STRATUM_DEFINITIONS = {
    "garbage_bin_only": "image has garbage_bin and no overflow or garbage annotation",
    "overflow_present": "image has at least one overflow annotation, including mixed images",
    "mixed_garbage_context": "image has garbage and no overflow, including garbage_bin+garbage images",
}
CATEGORY_COLORS = {
    "garbage_bin": "#22c55e",
    "overflow": "#ef4444",
    "garbage": "#f59e0b",
}
MAX_IMAGE_COMPRESSED_BYTES = 32 * 1024 * 1024
CHECKPOINT_FILENAME = "checkpoint.json"
CHECKPOINT_SCHEMA_VERSION = 2
PIXEL_DIRECTORIES = ("images", "annotated", "crops", "contact-sheets")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write a checkpoint/manifest by replacing one complete JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    """Write a binary pixel artifact without exposing a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MetadataAuditError(f"Checkpoint is not valid JSON: {path}") from error
    if not isinstance(payload, dict):
        raise MetadataAuditError(f"Checkpoint must be a JSON object: {path}")
    return payload


def _relative_path(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")


def _path_from_row(value: Any, workspace: Path) -> Path:
    path = Path(str(value))
    return path if path.is_absolute() else workspace / path


def _readable_image(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        with Image.open(path) as image:
            image.verify()
    except (OSError, ValueError):
        return False
    return True


def _row_artifacts_are_valid(row: dict[str, Any], workspace: Path) -> bool:
    """Validate every pixel referenced by a checkpoint row before resuming it."""
    try:
        original_meta = row["original"]
        original = _path_from_row(original_meta["path"], workspace)
        original_payload = original.read_bytes()
        if sha256_bytes(original_payload) != str(original_meta["sha256"]):
            return False
        if int(original_meta.get("bytes", len(original_payload))) != len(original_payload):
            return False
        annotated = _path_from_row(row["annotatedPath"], workspace)
        if not _readable_image(annotated):
            return False
        expected_annotated_sha = row.get("annotatedSha256")
        if expected_annotated_sha and sha256_bytes(annotated.read_bytes()) != str(expected_annotated_sha):
            return False
        expected_annotated_bytes = row.get("annotatedBytes")
        if expected_annotated_bytes is not None and int(expected_annotated_bytes) != annotated.stat().st_size:
            return False
        for crop in row.get("crops", []):
            crop_path = _path_from_row(crop["path"], workspace)
            crop_payload = crop_path.read_bytes()
            if not _readable_image(crop_path):
                return False
            if sha256_bytes(crop_payload) != str(crop["sha256"]):
                return False
            if int(crop.get("bytes", len(crop_payload))) != len(crop_payload):
                return False
    except (KeyError, OSError, TypeError, ValueError):
        return False
    return True


def _normalize_row_paths(row: dict[str, Any], workspace: Path) -> dict[str, Any]:
    normalized = json.loads(json.dumps(row))
    normalized["original"]["path"] = _relative_path(_path_from_row(normalized["original"]["path"], workspace), workspace)
    normalized["annotatedPath"] = _relative_path(_path_from_row(normalized["annotatedPath"], workspace), workspace)
    for crop in normalized.get("crops", []):
        crop["path"] = _relative_path(_path_from_row(crop["path"], workspace), workspace)
    return normalized


def completed_rows_by_id(
    checkpoint: dict[str, Any],
    selected: list[dict[str, Any]],
    workspace: Path,
) -> dict[int, dict[str, Any]]:
    """Return only checkpoint rows that are complete and still reference pixels.

    Rows are keyed by source ID so the acquisition loop can skip them before
    opening the archive.  A duplicate or malformed row is not considered
    complete; it will be rebuilt and checkpointed on the next attempt.
    """
    selected_ids = {int(row["imageId"]) for row in selected}
    completed: dict[int, dict[str, Any]] = {}
    rows = checkpoint.get("completed", [])
    if not isinstance(rows, list):
        return completed
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            image_id = int(row["source"]["imageId"])
        except (KeyError, TypeError, ValueError):
            continue
        if image_id not in selected_ids or image_id in completed:
            continue
        if _row_artifacts_are_valid(row, workspace):
            completed[image_id] = _normalize_row_paths(row, workspace)
    return completed


def resume_completed_ids(
    checkpoint: dict[str, Any],
    selected: list[dict[str, Any]],
    workspace: Path,
) -> set[int]:
    """Return selected IDs whose checkpoint row still points to a valid original."""
    # Keep this lightweight helper for callers that only need to inspect the
    # source-original checkpoint invariant.  The acquisition loop uses the
    # stricter ``completed_rows_by_id`` validation above.
    selected_ids = {int(row["imageId"]) for row in selected}
    completed: set[int] = set()
    for row in checkpoint.get("completed", []):
        if not isinstance(row, dict):
            continue
        try:
            image_id = int(row["source"]["imageId"])
            original = _path_from_row(row["original"]["path"], workspace)
            expected_sha = str(row["original"]["sha256"])
        except (KeyError, TypeError, ValueError):
            continue
        if image_id not in selected_ids or not original.is_file():
            continue
        if sha256_bytes(original.read_bytes()) == expected_sha:
            completed.add(image_id)
    return completed


def _category_index(coco: dict[str, Any]) -> dict[int, str]:
    categories = coco.get("categories")
    if not isinstance(categories, list):
        raise MetadataAuditError("GBS annotation JSON has no categories array")
    return {
        int(row["id"]): str(row["name"])
        for row in categories
        if isinstance(row, dict) and "id" in row and "name" in row
    }


def annotation_index(coco: dict[str, Any]) -> tuple[dict[int, dict[str, Any]], dict[int, list[dict[str, Any]]], dict[int, str]]:
    images = coco.get("images")
    annotations = coco.get("annotations")
    if not isinstance(images, list) or not isinstance(annotations, list):
        raise MetadataAuditError("GBS annotation JSON must contain images and annotations arrays")
    categories = _category_index(coco)
    images_by_id = {
        int(row["id"]): row
        for row in images
        if isinstance(row, dict) and "id" in row
    }
    annotations_by_image: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in annotations:
        if not isinstance(row, dict):
            continue
        try:
            image_id = int(row["image_id"])
            int(row["category_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if int(row["category_id"]) in categories:
            annotations_by_image[image_id].append(row)
    return images_by_id, annotations_by_image, categories


def assign_stratum(rows: list[dict[str, Any]], categories: dict[int, str]) -> str | None:
    names = {
        categories[int(row["category_id"])]
        for row in rows
        if str(row.get("category_id", "")).lstrip("-").isdigit()
        and int(row["category_id"]) in categories
    }
    if "overflow" in names:
        return "overflow_present"
    if "garbage_bin" in names and "garbage" not in names:
        return "garbage_bin_only"
    if "garbage" in names:
        return "mixed_garbage_context"
    return None


def _allocate_quotas(available: dict[str, int], total: int) -> dict[str, int]:
    if total < 0:
        raise ValueError("total must be non-negative")
    quotas = {stratum: min(total // len(STRATA), available.get(stratum, 0)) for stratum in STRATA}
    remaining = min(total, sum(available.values())) - sum(quotas.values())
    while remaining > 0:
        progressed = False
        for stratum in STRATA:
            if quotas[stratum] < available.get(stratum, 0):
                quotas[stratum] += 1
                remaining -= 1
                progressed = True
                if remaining == 0:
                    break
        if not progressed:
            break
    return quotas


def stratified_sample(
    image_rows: list[dict[str, Any]],
    annotations_by_image: dict[int, list[dict[str, Any]]],
    categories: dict[int, str],
    *,
    total: int = DEFAULT_TOTAL,
    seed: int = DEFAULT_SEED,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Select unique source image IDs with deterministic disjoint strata."""
    candidates: dict[str, list[dict[str, Any]]] = {stratum: [] for stratum in STRATA}
    unique_rows: dict[int, dict[str, Any]] = {}
    for row in image_rows:
        if not isinstance(row, dict) or "id" not in row:
            continue
        image_id = int(row["id"])
        unique_rows.setdefault(image_id, row)
    for image_id, row in sorted(unique_rows.items()):
        stratum = assign_stratum(annotations_by_image.get(image_id, []), categories)
        if stratum is not None:
            candidates[stratum].append(row)

    available = {stratum: len(candidates[stratum]) for stratum in STRATA}
    quotas = _allocate_quotas(available, total)
    selected: list[dict[str, Any]] = []
    for stratum in STRATA:
        pool = list(candidates[stratum])
        random.Random(seed + STRATA.index(stratum) * 1_000_003).shuffle(pool)
        for row in pool[:quotas[stratum]]:
            selected.append({
                "imageId": int(row["id"]),
                "stratum": stratum,
                "fileName": str(row.get("file_name", "")),
            })
    selected.sort(key=lambda row: (STRATA.index(row["stratum"]), row["imageId"]))
    report = {
        "seed": seed,
        "requested": total,
        "availableCounts": available,
        "quotas": quotas,
        "stratumCounts": {stratum: sum(row["stratum"] == stratum for row in selected) for stratum in STRATA},
        "selected": len(selected),
        "uniqueImageIds": len({row["imageId"] for row in selected}),
        "selectionMethod": "seeded selection from sorted official COCO image IDs; no WhatsApp similarity or embeddings",
    }
    return selected, report


def _archive_image_member(file_name: str) -> str:
    normalized = file_name.replace("\\", "/").lstrip("/")
    return normalized if normalized.casefold().startswith("images/") else f"Images/{normalized}"


def _safe_suffix(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    return suffix if suffix in IMAGE_SUFFIXES else ".jpg"


def _read_indexed_member(
    archive_url: str,
    entry: dict[str, Any],
    member_name: str,
    user_agent: str,
) -> tuple[bytes, int]:
    if entry["compressedSize"] > MAX_IMAGE_COMPRESSED_BYTES:
        raise MetadataAuditError(f"Selected image member is unexpectedly large: {entry['compressedSize']} bytes")
    local_offset = int(entry["localHeaderOffset"])
    header = _range_request(archive_url, local_offset, 30, user_agent)
    values = struct.unpack_from("<4s5H3I2H", header, 0)
    if values[0] != b"PK\x03\x04":
        raise MetadataAuditError(f"Invalid local ZIP header for {member_name}")
    name_length, extra_length = values[9:11]
    header_tail = _range_request(archive_url, local_offset + 30, name_length + extra_length, user_agent)
    local_name = header_tail[:name_length].decode("utf-8", "replace")
    if local_name.casefold() != member_name.casefold():
        raise MetadataAuditError(f"Local ZIP member name mismatch: {local_name!r}")
    data_start = local_offset + 30 + name_length + extra_length
    payload = _range_request(archive_url, data_start, int(entry["compressedSize"]), user_agent)
    if entry["compression"] == 0:
        content = payload
    elif entry["compression"] == 8:
        content = zlib.decompress(payload, -15)
    else:
        raise MetadataAuditError(f"Unsupported ZIP compression method for {member_name}: {entry['compression']}")
    if len(content) != int(entry["uncompressedSize"]):
        raise MetadataAuditError(f"Selected member size mismatch for {member_name}")
    return content, 30 + name_length + extra_length + len(payload)


def _clip_box(annotation: dict[str, Any], width: int, height: int) -> tuple[float, float, float, float] | None:
    bbox = annotation.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    try:
        x, y, box_width, box_height = (float(value) for value in bbox)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (x, y, box_width, box_height)) or box_width <= 0 or box_height <= 0:
        return None
    return (
        max(0.0, min(float(width), x)),
        max(0.0, min(float(height), y)),
        max(0.0, min(float(width), x + box_width)),
        max(0.0, min(float(height), y + box_height)),
    )


def _font() -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", 16)
    except OSError:
        return ImageFont.load_default()


def _annotate_image(image: Image.Image, rows: list[dict[str, Any]], categories: dict[int, str]) -> Image.Image:
    annotated = image.convert("RGB").copy()
    draw = ImageDraw.Draw(annotated)
    font = _font()
    for row in rows:
        category = categories.get(int(row.get("category_id", -1)), "unknown")
        box = _clip_box(row, annotated.width, annotated.height)
        if box is None:
            continue
        color = CATEGORY_COLORS.get(category, "#a855f7")
        x1, y1, x2, y2 = box
        draw.rectangle((x1, y1, x2, y2), outline=color, width=max(2, round(min(annotated.size) / 300)))
        label = f"{category} #{row.get('id', '?')}"
        label_box = draw.textbbox((x1, y1), label, font=font)
        draw.rectangle(label_box, fill=color)
        draw.text((label_box[0] + 2, label_box[1] + 1), label, fill="#111827", font=font)
    return annotated


def _write_crop(
    image: Image.Image,
    annotation: dict[str, Any],
    category: str,
    destination: Path,
    output_root: Path,
) -> dict[str, Any] | None:
    box = _clip_box(annotation, image.width, image.height)
    if box is None:
        return None
    x1, y1, x2, y2 = box
    context_x = max(8.0, (x2 - x1) * 0.15)
    context_y = max(8.0, (y2 - y1) * 0.15)
    crop_box = (
        max(0, math.floor(x1 - context_x)),
        max(0, math.floor(y1 - context_y)),
        min(image.width, math.ceil(x2 + context_x)),
        min(image.height, math.ceil(y2 + context_y)),
    )
    crop = image.crop(crop_box).convert("RGB")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not _readable_image(destination):
        buffer = BytesIO()
        crop.save(buffer, format="JPEG", quality=95)
        _atomic_write_bytes(destination, buffer.getvalue())
    payload = destination.read_bytes()
    return {
        "annotationId": int(annotation["id"]),
        "category": category,
        "path": str(destination.relative_to(output_root)).replace("\\", "/"),
        "sha256": sha256_bytes(payload),
        "bytes": len(payload),
        "cropBoxPixels": list(crop_box),
    }


def render_contact_sheets(
    rows: list[dict[str, Any]],
    output: Path,
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    root: Path | None = None,
) -> dict[str, Any]:
    if page_size < 1:
        raise ValueError("page_size must be positive")
    output.mkdir(parents=True, exist_ok=True)
    tile_width, tile_height, header_height, columns = 256, 216, 24, 5
    pages: list[dict[str, Any]] = []
    font = _font()
    for page_index in range(0, len(rows), page_size):
        page_rows = rows[page_index:page_index + page_size]
        rendered_rows = (len(page_rows) + columns - 1) // columns
        sheet = Image.new("RGB", (columns * tile_width, max(1, rendered_rows) * tile_height), "#1f2937")
        draw = ImageDraw.Draw(sheet)
        sample_ids: list[str] = []
        for index, row in enumerate(page_rows):
            sample_id = str(row["sampleId"])
            sample_ids.append(sample_id)
            column, line = index % columns, index // columns
            tile_x, tile_y = column * tile_width, line * tile_height
            image_path = Path(str(row["annotatedPath"]))
            if not image_path.is_absolute() and root is not None:
                image_path = root / image_path
            with Image.open(image_path) as source:
                image = source.convert("RGB")
            content_width, content_height = tile_width - 8, tile_height - header_height - 8
            scale = min(content_width / image.width, content_height / image.height)
            rendered = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
            paste_x = tile_x + (tile_width - rendered.width) // 2
            paste_y = tile_y + header_height + (content_height - rendered.height) // 2
            sheet.paste(rendered, (paste_x, paste_y))
            draw.rectangle((tile_x, tile_y, tile_x + tile_width - 1, tile_y + header_height - 1), fill="#111827")
            draw.text(
                (tile_x + 4, tile_y + 5),
                f"{sample_id}  {row.get('stratum', 'unclassified')}",
                fill="#f9fafb",
                font=font,
            )
            draw.rectangle((tile_x, tile_y, tile_x + tile_width - 1, tile_y + tile_height - 1), outline="#64748b", width=1)
        filename = f"contact-sheet-{page_index // page_size + 1:03d}.jpg"
        sheet.save(output / filename, quality=90)
        payload = (output / filename).read_bytes()
        pages.append({
            "path": f"contact-sheets/{filename}",
            "sampleIds": sample_ids,
            "sha256": sha256_bytes(payload),
            "bytes": len(payload),
        })
    return {"pageSize": page_size, "pages": pages}


def _safe_workspace_path(value: Any, workspace: Path) -> Path:
    path = _path_from_row(value, workspace).resolve()
    try:
        path.relative_to(workspace.resolve())
    except ValueError as error:
        raise MetadataAuditError(f"Artifact path escapes sample workspace: {value!r}") from error
    return path


def _referenced_pixel_paths(
    rows: list[dict[str, Any]],
    contact_sheet: dict[str, Any],
    workspace: Path,
) -> set[Path]:
    referenced: set[Path] = set()
    for row in rows:
        referenced.add(_safe_workspace_path(row["original"]["path"], workspace))
        referenced.add(_safe_workspace_path(row["annotatedPath"], workspace))
        for crop in row.get("crops", []):
            referenced.add(_safe_workspace_path(crop["path"], workspace))
    for page in contact_sheet.get("pages", []):
        if isinstance(page, dict) and "path" in page:
            referenced.add(_safe_workspace_path(page["path"], workspace))
    return referenced


def prune_unreferenced_pixels(
    rows: list[dict[str, Any]],
    contact_sheet: dict[str, Any],
    workspace: Path,
) -> list[str]:
    """Remove stale image files left by failed attempts before finalization."""
    referenced = _referenced_pixel_paths(rows, contact_sheet, workspace)
    removed: list[str] = []
    for directory_name in PIXEL_DIRECTORIES:
        directory = workspace / directory_name
        if not directory.is_dir():
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or path.resolve() in referenced:
                continue
            if path.suffix.lower() in IMAGE_SUFFIXES or path.name.startswith(".") or path.suffix.lower() == ".tmp":
                removed.append(_relative_path(path, workspace))
                path.unlink()
    return sorted(removed)


def validate_final_materialization(
    rows: list[dict[str, Any]],
    selected: list[dict[str, Any]],
    contact_sheet: dict[str, Any],
    workspace: Path,
) -> dict[str, Any]:
    """Fail closed unless the final manifest can account for every pixel."""
    selected_ids = [int(row["imageId"]) for row in selected]
    row_ids = [int(row["source"]["imageId"]) for row in rows]
    if row_ids != selected_ids:
        raise MetadataAuditError("Final sample rows do not match deterministic selected source IDs")
    if len(row_ids) != len(set(row_ids)):
        raise MetadataAuditError("Final sample contains duplicate source image IDs")
    selected_counts = {stratum: sum(row["stratum"] == stratum for row in selected) for stratum in STRATA}
    row_counts = {stratum: sum(row["stratum"] == stratum for row in rows) for stratum in STRATA}
    if row_counts != selected_counts:
        raise MetadataAuditError(f"Final strata counts changed: expected {selected_counts}, observed {row_counts}")

    for row in rows:
        original_meta = row.get("original")
        if not isinstance(original_meta, dict):
            raise MetadataAuditError("Final row has no original metadata")
        original = _safe_workspace_path(original_meta.get("path"), workspace)
        payload = original.read_bytes()
        if sha256_bytes(payload) != str(original_meta.get("sha256")):
            raise MetadataAuditError(f"Original checksum mismatch: {original}")
        if int(original_meta.get("bytes", -1)) != len(payload):
            raise MetadataAuditError(f"Original byte count mismatch: {original}")
        annotated = _safe_workspace_path(row.get("annotatedPath"), workspace)
        if not _readable_image(annotated):
            raise MetadataAuditError(f"Annotated image is unreadable: {annotated}")
        if "annotatedSha256" in row and sha256_bytes(annotated.read_bytes()) != str(row["annotatedSha256"]):
            raise MetadataAuditError(f"Annotated checksum mismatch: {annotated}")
        if "annotatedBytes" in row and int(row["annotatedBytes"]) != annotated.stat().st_size:
            raise MetadataAuditError(f"Annotated byte count mismatch: {annotated}")
        for crop in row.get("crops", []):
            crop_path = _safe_workspace_path(crop.get("path"), workspace)
            crop_payload = crop_path.read_bytes()
            if not _readable_image(crop_path) or sha256_bytes(crop_payload) != str(crop.get("sha256")):
                raise MetadataAuditError(f"Crop checksum or readability check failed: {crop_path}")
            if int(crop.get("bytes", -1)) != len(crop_payload):
                raise MetadataAuditError(f"Crop byte count mismatch: {crop_path}")

    referenced = _referenced_pixel_paths(rows, contact_sheet, workspace)
    missing = sorted(_relative_path(path, workspace) for path in referenced if not path.is_file())
    if missing:
        raise MetadataAuditError(f"Final manifest references missing pixels: {missing}")
    orphaned: list[str] = []
    for directory_name in PIXEL_DIRECTORIES:
        directory = workspace / directory_name
        if not directory.is_dir():
            continue
        for path in directory.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and path.resolve() not in referenced:
                orphaned.append(_relative_path(path, workspace))
    if orphaned:
        raise MetadataAuditError(f"Final sample contains unreferenced pixels: {sorted(orphaned)}")
    return {
        "referencedPixelCount": len(referenced),
        "orphanedPixelCount": 0,
        "stratumCounts": row_counts,
    }


def _write_incomplete_report(
    workspace: Path,
    selection: dict[str, Any],
    rows: list[dict[str, Any]],
    resumed_ids: set[int],
    failures: list[dict[str, Any]],
    *,
    final_manifest_written: bool = False,
) -> None:
    _atomic_write_json(
        workspace / "incomplete-report.json",
        {
            "schemaVersion": 1,
            "selection": selection,
            "completedCount": len(rows),
            "completedStratumCounts": {
                stratum: sum(row["stratum"] == stratum for row in rows) for stratum in STRATA
            },
            "resumedImageIds": sorted(resumed_ids),
            "failures": failures,
            "finalManifestWritten": final_manifest_written,
        },
    )


def _materialize_sample(
    selected: dict[str, Any],
    *,
    annotations_by_image: dict[int, list[dict[str, Any]]],
    categories: dict[int, str],
    official_source: dict[str, Any],
    archive_url: str,
    archive_size: int,
    directory: bytes,
    directory_entries: int,
    destination: Path,
    sample_index: int,
    user_agent: str,
) -> tuple[dict[str, Any], int]:
    image_id = int(selected["imageId"])
    member_name = _archive_image_member(selected["fileName"])
    stem = f"source-{image_id:06d}"
    suffix = _safe_suffix(selected["fileName"])
    original_directory = destination / "images" / selected["stratum"]
    original_path = original_directory / f"{stem}{suffix}"
    if not original_path.exists():
        existing_candidates = sorted(original_directory.glob(f"{stem}.*")) if original_directory.exists() else []
        if len(existing_candidates) == 1:
            original_path = existing_candidates[0]
    reused_existing_original = False
    if original_path.exists():
        candidate = original_path.read_bytes()
        if _readable_image(original_path):
            payload = candidate
            reused_existing_original = True
            range_bytes = 0
        else:
            payload = b""
            range_bytes = 0
    else:
        payload = b""
        range_bytes = 0
    if not reused_existing_original:
        entry = _find_zip_entry(directory, directory_entries, member_name)
        payload, range_bytes = _read_indexed_member(archive_url, entry, member_name, user_agent)
    try:
        with Image.open(BytesIO(payload)) as opened:
            opened.verify()
        with Image.open(BytesIO(payload)) as opened:
            image = opened.convert("RGB")
            width, height = image.size
    except Exception as error:
        raise MetadataAuditError(f"Image {image_id} could not be decoded: {error}") from error

    annotated_path = destination / "annotated" / selected["stratum"] / f"{stem}.jpg"
    original_path.parent.mkdir(parents=True, exist_ok=True)
    annotated_path.parent.mkdir(parents=True, exist_ok=True)
    if not reused_existing_original:
        _atomic_write_bytes(original_path, payload)
    if not _readable_image(annotated_path):
        annotated = _annotate_image(image, annotations_by_image[image_id], categories)
        buffer = BytesIO()
        annotated.save(buffer, format="JPEG", quality=92)
        _atomic_write_bytes(annotated_path, buffer.getvalue())

    labels: list[dict[str, Any]] = []
    crops: list[dict[str, Any]] = []
    for annotation in sorted(annotations_by_image[image_id], key=lambda row: int(row.get("id", 0))):
        category_id = int(annotation["category_id"])
        category = categories[category_id]
        labels.append({
            "annotationId": int(annotation["id"]),
            "categoryId": category_id,
            "category": category,
            "bbox": list(annotation.get("bbox", [])),
            "area": annotation.get("area"),
            "iscrowd": annotation.get("iscrowd", 0),
        })
        crop_destination = destination / "crops" / selected["stratum"] / f"{stem}-ann-{int(annotation['id']):06d}-{category}.jpg"
        crop = _write_crop(image, annotation, category, crop_destination, destination)
        if crop is not None:
            crops.append(crop)

    original_bytes = original_path.read_bytes()
    return {
        "sampleId": f"gbs-visual-{sample_index:04d}",
        "stratum": selected["stratum"],
        "source": {
            "recordId": official_source["recordId"],
            "recordUrl": official_source["recordUrl"],
            "doi": official_source["doi"],
            "imageId": image_id,
            "groupId": f"gbs-image-{image_id}",
            "fileName": selected["fileName"],
            "archiveMember": member_name,
            "annotationIds": [row["annotationId"] for row in labels],
        },
        "license": official_source["license"],
        "labels": labels,
        "original": {
            "path": str(original_path.relative_to(destination)).replace("\\", "/"),
            "sha256": sha256_bytes(original_bytes),
            "bytes": len(original_bytes),
            "width": width,
            "height": height,
        },
        "annotatedPath": str(annotated_path.relative_to(destination)).replace("\\", "/"),
        "annotatedSha256": sha256_bytes(annotated_path.read_bytes()),
        "annotatedBytes": annotated_path.stat().st_size,
        "crops": crops,
        "rangeReadBytes": range_bytes,
        "reusedExistingOriginal": reused_existing_original,
    }, range_bytes


def sample_record(
    record_id: int = DEFAULT_RECORD_ID,
    *,
    output: Path = DEFAULT_OUTPUT,
    total: int = DEFAULT_TOTAL,
    seed: int = DEFAULT_SEED,
    page_size: int = DEFAULT_PAGE_SIZE,
    resume_from: Path | None = None,
    user_agent: str = DEFAULT_USER_AGENT,
) -> dict[str, Any]:
    if total < 1:
        raise ValueError("total must be positive")
    if page_size < 1:
        raise ValueError("page_size must be positive")
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Refusing to overwrite non-empty visual sample output: {output}")
    if resume_from is not None:
        workspace = resume_from.resolve()
        if workspace == output:
            raise ValueError("resume_from must be different from output")
        if not workspace.is_dir():
            raise FileNotFoundError(f"Resume directory does not exist: {workspace}")
        if (workspace / "manifest.json").exists():
            raise FileExistsError(f"Resume directory already has a final manifest: {workspace}")
    else:
        workspace = output.with_name(f"{output.name}.partial-{os.getpid()}")
        if workspace.exists():
            raise FileExistsError(f"Refusing to overwrite existing partial output: {workspace}")
        workspace.mkdir(parents=True, exist_ok=False)

    checkpoint_path = workspace / CHECKPOINT_FILENAME
    checkpoint = _load_checkpoint(checkpoint_path)
    if resume_from is not None and any(workspace.iterdir()) and not checkpoint:
        raise MetadataAuditError(
            f"Resume directory has pixel files but no usable {CHECKPOINT_FILENAME}: {workspace}"
        )
    record = fetch_json(f"https://zenodo.org/api/records/{record_id}", user_agent)
    official_source = validate_record(record, record_id=record_id)
    archive_url = official_source["file"]["contentUrl"]
    archive_size = official_source["file"]["sizeBytes"]
    from audit_gbs_zenodo_metadata import _read_remote_member  # local import keeps the audit module standalone
    annotation_payload, annotation_entry = _read_remote_member(
        archive_url, archive_size, ANNOTATION_MEMBER, user_agent
    )
    try:
        coco = json.loads(annotation_payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MetadataAuditError(f"GBS annotation member is not valid JSON: {error}") from error
    image_rows = coco.get("images")
    images_by_id, annotations_by_image, categories = annotation_index(coco)
    if not isinstance(image_rows, list):
        raise MetadataAuditError("GBS annotation JSON has no images array")
    selected, selection = stratified_sample(image_rows, annotations_by_image, categories, total=total, seed=seed)
    selection = {
        **selection,
        "selectedImageIds": [int(row["imageId"]) for row in selected],
        "selectedRows": json.loads(json.dumps(selected)),
    }
    previous_selection = checkpoint.get("selection")
    if isinstance(previous_selection, dict):
        previous_ids = previous_selection.get("selectedImageIds")
        if previous_ids is None:
            previous_ids = [
                int(row["source"]["imageId"])
                for row in checkpoint.get("completed", [])
                if isinstance(row, dict) and isinstance(row.get("source"), dict) and "imageId" in row["source"]
            ]
        if previous_ids and list(map(int, previous_ids)) != selection["selectedImageIds"]:
            raise MetadataAuditError("Resume checkpoint selection does not match the current seed/total")
        for key in ("seed", "requested", "quotas"):
            if key in previous_selection and previous_selection.get(key) != selection.get(key):
                raise MetadataAuditError(f"Resume checkpoint {key} does not match the current selection")

    completed = completed_rows_by_id(checkpoint, selected, workspace)
    resumed_ids = set(completed)
    rows_by_id: dict[int, dict[str, Any]] = dict(completed)
    rows = [rows_by_id[int(row["imageId"])] for row in selected if int(row["imageId"]) in rows_by_id]
    failures: list[dict[str, Any]] = []
    image_range_bytes = 0
    directory_offset = directory_size = directory_entries = tail_bytes = 0
    directory = b""
    pending = [row for row in selected if int(row["imageId"]) not in completed]

    def checkpoint_payload() -> dict[str, Any]:
        ordered_rows = [rows_by_id[int(row["imageId"])] for row in selected if int(row["imageId"]) in rows_by_id]
        return {
            "schemaVersion": CHECKPOINT_SCHEMA_VERSION,
            "selection": selection,
            "completedCount": len(ordered_rows),
            "completed": ordered_rows,
        }

    # Persist selection before the first image request so an interrupted run
    # can resume with exactly the same deterministic strata.
    _atomic_write_json(checkpoint_path, checkpoint_payload())

    if pending:
        directory_offset, directory_size, directory_entries, tail_bytes = _zip64_directory(
            archive_url, archive_size, user_agent
        )
        directory = _range_request(archive_url, directory_offset, directory_size, user_agent)
    for sample_index, selected_row in enumerate(selected, start=1):
        image_id = int(selected_row["imageId"])
        if image_id in completed:
            continue
        try:
            row, range_bytes = _materialize_sample(
                selected_row,
                annotations_by_image=annotations_by_image,
                categories=categories,
                official_source=official_source,
                archive_url=archive_url,
                archive_size=archive_size,
                directory=directory,
                directory_entries=directory_entries,
                destination=workspace,
                sample_index=sample_index,
                user_agent=user_agent,
            )
            row = _normalize_row_paths(row, workspace)
            rows_by_id[image_id] = row
            rows = [rows_by_id[int(item["imageId"])] for item in selected if int(item["imageId"]) in rows_by_id]
            image_range_bytes += range_bytes
            _atomic_write_json(checkpoint_path, checkpoint_payload())
        except (OSError, MetadataAuditError, ValueError) as error:
            failures.append({"imageId": image_id, "stratum": selected_row["stratum"], "error": str(error)})
            failures.extend(
                {
                    "imageId": remaining["imageId"],
                    "stratum": remaining["stratum"],
                    "error": "not attempted after bounded range failure",
                }
                for remaining in selected[sample_index:]
                if int(remaining["imageId"]) not in rows_by_id
            )
            break

    if failures or len(rows) != len(selected):
        _write_incomplete_report(workspace, selection, rows, resumed_ids, failures)
        raise MetadataAuditError(
            f"visual sample incomplete ({len(rows)}/{len(selected)} images); "
            f"partial output kept at {workspace}"
        )

    try:
        contact_sheet = render_contact_sheets(
            rows,
            workspace / "contact-sheets",
            page_size=page_size,
            root=workspace,
        )
        _atomic_write_json(workspace / "contact-sheets/contact-sheet-index.json", contact_sheet)
        removed_pixels = prune_unreferenced_pixels(rows, contact_sheet, workspace)
        final_audit = validate_final_materialization(rows, selected, contact_sheet, workspace)
    except (OSError, MetadataAuditError, ValueError, KeyError, TypeError) as error:
        failures.append({"phase": "finalization", "error": str(error)})
        _write_incomplete_report(workspace, selection, rows, resumed_ids, failures)
        raise MetadataAuditError(
            f"visual sample finalization failed; partial output kept at {workspace}: {error}"
        ) from error

    total_selected_image_bytes = sum(int(row["original"]["bytes"]) for row in rows)
    resumed_image_range_bytes = sum(int(row.get("rangeReadBytes", 0)) for row in rows if int(row["source"]["imageId"]) in resumed_ids)
    manifest = {
        "schemaVersion": 2,
        "dataset": "gbs",
        "generatedAt": datetime.now(UTC).isoformat(),
        "officialSource": official_source,
        "selection": {
            **selection,
            "strata": STRATUM_DEFINITIONS,
            "appearanceFamiliesAutomaticallyClassified": False,
            "whatsappMediaUsed": False,
        },
        "categoryColors": CATEGORY_COLORS,
        "samples": rows,
        "failures": failures,
        "contactSheets": contact_sheet,
        "archiveAccess": {
            "mode": "http-range-selected-image-members-only",
            "annotationMember": ANNOTATION_MEMBER,
            "annotationRangeReadBytes": annotation_entry["rangeReadBytes"],
            "centralDirectoryRangeReadBytes": tail_bytes + directory_size,
            "selectedImageRangeReadBytes": image_range_bytes,
            "resumedSelectedImageRangeReadBytes": resumed_image_range_bytes,
            "totalSelectedImageRangeReadBytes": sum(int(row.get("rangeReadBytes", 0)) for row in rows),
            "selectedImagePayloadBytes": total_selected_image_bytes,
            "totalRangeReadBytes": annotation_entry["rangeReadBytes"] + tail_bytes + directory_size + image_range_bytes,
            "imageMembersDownloaded": bool(rows),
            "imageMemberCount": len(rows),
            "fullArchiveDownloaded": False,
            "resumedExistingImageCount": len(resumed_ids),
        },
        "finalizationAudit": {**final_audit, "removedUnreferencedPixels": removed_pixels},
        "readyForTraining": False,
        "trainingUse": False,
        "reviewNote": "This is a visual audit sample only. Reviewers must assess appearance families manually; no appearance class was inferred.",
    }
    # This is the first and only final-manifest write.  It occurs after all
    # rows, checksums, byte counts, contact sheets, and orphan checks pass.
    _atomic_write_json(workspace / "manifest.json", manifest)
    if output.exists():
        output.rmdir()
    workspace.replace(output)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-id", type=int, default=DEFAULT_RECORD_ID)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--total", type=int, default=DEFAULT_TOTAL)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--resume-from", type=Path, default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = sample_record(
            args.record_id,
            output=args.output,
            total=args.total,
            seed=args.seed,
            page_size=args.page_size,
            resume_from=args.resume_from,
        )
    except (FileExistsError, OSError, MetadataAuditError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps({
        "output": str(args.output.resolve()),
        "selected": len(manifest["samples"]),
        "failures": len(manifest["failures"]),
        "stratumCounts": manifest["selection"]["stratumCounts"],
        "archiveAccess": manifest["archiveAccess"],
        "readyForTraining": manifest["readyForTraining"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
