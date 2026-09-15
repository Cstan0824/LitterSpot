"""Count the official GBS annotation entry without downloading its image archive.

The GBS Zenodo record contains one multi-gigabyte ``GBS.zip`` file.  This
script reads the record metadata, fetches only the ZIP central directory and
the compressed ``Annotations/GBS_coco.json`` member through HTTP range
requests, and counts the COCO categories used by the existing GBS importer.
It never downloads or extracts the image members.

The report is intentionally conservative: source metadata can prove the
number of annotated image IDs and boxes, but it cannot prove that the images
contain the required wheeled, cylindrical, basket, indoor, or theme-park
appearance families.  Pixel review remains a separate gate.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import re
import struct
import time
import zlib
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RECORD_ID = 14711706
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/gbs-zenodo-14711706-sufficiency.json"
DEFAULT_USER_AGENT = "LitterSpot/1.0 (metadata-only dataset sufficiency audit)"
EXPECTED_TITLE = "the Garbage Bin Status (GBS) Dataset"
EXPECTED_FILE_KEY = "GBS.zip"
ANNOTATION_MEMBER = "Annotations/GBS_coco.json"
EXPECTED_LICENSE_ID = "cc-by-4.0"
DIRECT_BIN_CATEGORY = "garbage_bin"
BIN_RELATED_CATEGORIES = {DIRECT_BIN_CATEGORY, "overflow"}
CONTEXT_CATEGORY = "garbage"
MINIMUM_BIN_IMAGES = 1_200
MINIMUM_OVERFLOW_IMAGES = 300
MAX_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024
MAX_ANNOTATION_COMPRESSED_BYTES = 128 * 1024 * 1024
TAIL_BYTES = 16 * 1024 * 1024
RANGE_RE = re.compile(r"bytes\s+(\d+)-(\d+)/(\d+)")
RETRYABLE_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}
MAX_RANGE_RETRIES = 5
MAX_JSON_RETRIES = 3
RANGE_REQUEST_MIN_INTERVAL_SECONDS = 0.60
MAX_RETRY_AFTER_SECONDS = 60.0
_LAST_RANGE_REQUEST_AT = 0.0


class MetadataAuditError(RuntimeError):
    """Raised when the official record cannot be safely audited."""


def fetch_json(url: str, user_agent: str = DEFAULT_USER_AGENT) -> dict[str, Any]:
    """Fetch a JSON object with bounded handling for transient HTTP failures.

    Zenodo occasionally answers the record endpoint with a rate-limit or
    temporary-unavailable response even though the archive itself is healthy.
    Honour a numeric or HTTP-date ``Retry-After`` value, cap the wait, and
    stop after a small fixed number of attempts.  This keeps acquisition
    resumable without turning a service outage into an unbounded process.
    """
    request = Request(url, headers={"User-Agent": user_agent})
    last_error: HTTPError | None = None
    for attempt in range(MAX_JSON_RETRIES + 1):
        try:
            with urlopen(request, timeout=60) as response:
                payload = json.load(response)
            break
        except HTTPError as error:
            last_error = error
            if error.code not in {429, 503} or attempt >= MAX_JSON_RETRIES:
                raise MetadataAuditError(
                    f"JSON request {url} failed after {attempt + 1} attempt(s): HTTP {error.code}"
                ) from error
            retry_after = _retry_after_seconds(error)
            delay = retry_after if retry_after is not None else min(2 ** attempt, 30.0)
            time.sleep(delay)
    else:  # pragma: no cover - loop always returns or raises
        raise MetadataAuditError(f"JSON request {url} failed: {last_error}") from last_error
    if not isinstance(payload, dict):
        raise MetadataAuditError(f"Expected JSON object from {url}")
    return payload


def validate_record(
    record: dict[str, Any],
    *,
    record_id: int = DEFAULT_RECORD_ID,
    expected_file_key: str = EXPECTED_FILE_KEY,
) -> dict[str, Any]:
    """Validate and normalize the official record metadata used by the audit."""
    if int(record.get("id", -1)) != record_id:
        raise MetadataAuditError(f"Unexpected Zenodo record id: {record.get('id')!r}")
    title = str(record.get("metadata", {}).get("title", "")).strip()
    if title != EXPECTED_TITLE:
        raise MetadataAuditError(f"Unexpected Zenodo dataset title: {title!r}")
    metadata = record.get("metadata")
    if not isinstance(metadata, dict):
        raise MetadataAuditError("Zenodo record has no metadata object")
    license_info = metadata.get("license")
    license_id = str(license_info.get("id", "")).strip().lower() if isinstance(license_info, dict) else ""
    if license_id != EXPECTED_LICENSE_ID:
        raise MetadataAuditError(
            f"GBS license gate failed: expected {EXPECTED_LICENSE_ID!r}, observed {license_id or '<missing>'!r}"
        )
    files = record.get("files")
    if not isinstance(files, list):
        raise MetadataAuditError("Zenodo record has no files array")
    candidates = [item for item in files if isinstance(item, dict) and item.get("key") == expected_file_key]
    if len(candidates) != 1:
        raise MetadataAuditError(f"Expected exactly one {expected_file_key!r} file; found {len(candidates)}")
    archive = candidates[0]
    archive_url = archive.get("links", {}).get("self")
    if not isinstance(archive_url, str) or not archive_url:
        raise MetadataAuditError("GBS archive has no official content URL")
    size = archive.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise MetadataAuditError(f"GBS archive has invalid size: {size!r}")
    return {
        "recordId": int(record["id"]),
        "recordUrl": str(record.get("links", {}).get("self_html", f"https://zenodo.org/records/{record_id}")),
        "doi": str(record.get("doi", metadata.get("doi", ""))),
        "conceptRecordId": str(record.get("conceptrecid", "")),
        "conceptDoi": str(record.get("conceptdoi", "")),
        "title": title,
        "publicationDate": metadata.get("publication_date"),
        "accessRight": metadata.get("access_right"),
        "creatorIds": [str(item.get("name", "")) for item in metadata.get("creators", []) if isinstance(item, dict)],
        "license": {
            "id": license_id,
            "url": "https://creativecommons.org/licenses/by/4.0/",
            "scope": "Zenodo dataset record",
        },
        "file": {
            "id": str(archive.get("id", "")),
            "key": expected_file_key,
            "sizeBytes": size,
            "checksum": str(archive.get("checksum", "")),
            "contentUrl": archive_url,
        },
    }


def _retry_after_seconds(error: HTTPError) -> float | None:
    value = error.headers.get("Retry-After") if error.headers is not None else None
    if not value:
        return None
    try:
        return max(0.0, min(MAX_RETRY_AFTER_SECONDS, float(value)))
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return None
        return max(0.0, min(MAX_RETRY_AFTER_SECONDS, (retry_at - datetime.now(timezone.utc)).total_seconds()))


def _wait_for_range_slot() -> None:
    global _LAST_RANGE_REQUEST_AT
    now = time.monotonic()
    wait_seconds = RANGE_REQUEST_MIN_INTERVAL_SECONDS - (now - _LAST_RANGE_REQUEST_AT)
    if wait_seconds > 0:
        time.sleep(wait_seconds)
    _LAST_RANGE_REQUEST_AT = time.monotonic()


def _range_request(url: str, start: int, length: int, user_agent: str) -> bytes:
    if start < 0 or length <= 0:
        raise ValueError("range start must be non-negative and length must be positive")
    end = start + length - 1
    request = Request(
        url,
        headers={"User-Agent": user_agent, "Range": f"bytes={start}-{end}"},
    )
    last_error: Exception | None = None
    for attempt in range(MAX_RANGE_RETRIES + 1):
        _wait_for_range_slot()
        try:
            with urlopen(request, timeout=120) as response:
                if response.status != 206:
                    raise MetadataAuditError(
                        f"Zenodo did not honor byte range {start}-{end}; got HTTP {response.status}. "
                        "Refusing to download the full image archive."
                    )
                content_range = response.headers.get("Content-Range", "")
                match = RANGE_RE.fullmatch(content_range.strip())
                if not match or int(match.group(1)) != start or int(match.group(2)) != end:
                    raise MetadataAuditError(f"Unexpected Content-Range for {start}-{end}: {content_range!r}")
                data = response.read()
            if len(data) != length:
                raise MetadataAuditError(f"Short ranged response: expected {length}, received {len(data)}")
            return data
        except HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_HTTP_STATUS or attempt >= MAX_RANGE_RETRIES:
                raise MetadataAuditError(
                    f"Zenodo range request {start}-{end} failed after {attempt + 1} attempt(s): HTTP {error.code}"
                ) from error
            retry_after = _retry_after_seconds(error)
            delay = retry_after if retry_after is not None else min(2 ** attempt, 30.0)
            time.sleep(delay)
    raise MetadataAuditError(f"Zenodo range request {start}-{end} failed: {last_error}") from last_error


def _zip64_directory(url: str, archive_size: int, user_agent: str) -> tuple[int, int, int, int]:
    """Return central-directory start, size, entry count, and fetched tail bytes."""
    tail_length = min(TAIL_BYTES, archive_size)
    tail_start = archive_size - tail_length
    tail = _range_request(url, tail_start, tail_length, user_agent)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise MetadataAuditError("ZIP end-of-central-directory record was not found in archive tail")
    _, _, _, entries_disk, entries_total, directory_size, directory_offset, _ = struct.unpack_from(
        "<4s4H2LH", tail, eocd
    )
    if directory_size != 0xFFFFFFFF and directory_offset != 0xFFFFFFFF:
        return directory_offset, directory_size, entries_total, tail_length

    locator = tail.rfind(b"PK\x06\x07", 0, eocd)
    if locator < 0:
        raise MetadataAuditError("ZIP64 locator was not found for a ZIP64 archive")
    _, _, zip64_offset, _ = struct.unpack_from("<4sLQL", tail, locator)
    zip64 = _range_request(url, zip64_offset, 56, user_agent)
    values = struct.unpack_from("<4sQ2H2I4Q", zip64, 0)
    if values[0] != b"PK\x06\x06":
        raise MetadataAuditError("Invalid ZIP64 end-of-central-directory signature")
    _, _, _, _, _, _, _, entries_total, directory_size, directory_offset = values
    if directory_size > MAX_CENTRAL_DIRECTORY_BYTES:
        raise MetadataAuditError(f"ZIP central directory is unexpectedly large: {directory_size} bytes")
    return directory_offset, directory_size, entries_total, tail_length


def _zip64_extra_values(extra: bytes, needs: int) -> list[int]:
    values: list[int] = []
    cursor = 0
    while cursor + 4 <= len(extra):
        field_id, field_size = struct.unpack_from("<HH", extra, cursor)
        body = extra[cursor + 4:cursor + 4 + field_size]
        if field_id == 1:
            for offset in range(0, len(body) - 7, 8):
                values.append(struct.unpack_from("<Q", body, offset)[0])
            break
        cursor += 4 + field_size
    if len(values) < needs:
        raise MetadataAuditError("ZIP64 entry is missing required extended values")
    return values


def _find_zip_entry(directory: bytes, entry_count: int, member_name: str) -> dict[str, Any]:
    cursor = 0
    for _ in range(entry_count):
        if directory[cursor:cursor + 4] != b"PK\x01\x02":
            raise MetadataAuditError(f"Invalid ZIP central-directory signature at byte {cursor}")
        values = struct.unpack_from("<4s6H3I5H2I", directory, cursor)
        compressed_size, uncompressed_size = values[8:10]
        name_length, extra_length, comment_length = values[10:13]
        name_start = cursor + 46
        name = directory[name_start:name_start + name_length].decode("utf-8", "replace")
        extra_start = name_start + name_length
        extra = directory[extra_start:extra_start + extra_length]
        cursor = extra_start + extra_length + comment_length
        if name.casefold() != member_name.casefold():
            continue
        zip64_needs = int(compressed_size == 0xFFFFFFFF) + int(uncompressed_size == 0xFFFFFFFF) + int(values[16] == 0xFFFFFFFF)
        zip64_values = iter(_zip64_extra_values(extra, zip64_needs)) if zip64_needs else iter(())
        if compressed_size == 0xFFFFFFFF:
            compressed_size = next(zip64_values)
        if uncompressed_size == 0xFFFFFFFF:
            uncompressed_size = next(zip64_values)
        local_offset = values[16]
        if local_offset == 0xFFFFFFFF:
            local_offset = next(zip64_values)
        return {
            "name": name,
            "compression": values[4],
            "compressedSize": compressed_size,
            "uncompressedSize": uncompressed_size,
            "localHeaderOffset": local_offset,
        }
    raise MetadataAuditError(f"ZIP member not found: {member_name}")


def _read_remote_member(
    archive_url: str,
    archive_size: int,
    member_name: str,
    user_agent: str,
    *,
    image_member: bool = False,
    max_compressed_bytes: int = MAX_ANNOTATION_COMPRESSED_BYTES,
) -> tuple[bytes, dict[str, Any]]:
    directory_offset, directory_size, entry_count, tail_bytes = _zip64_directory(archive_url, archive_size, user_agent)
    if directory_size > MAX_CENTRAL_DIRECTORY_BYTES:
        raise MetadataAuditError(f"ZIP central directory is unexpectedly large: {directory_size} bytes")
    directory = _range_request(archive_url, directory_offset, directory_size, user_agent)
    entry = _find_zip_entry(directory, entry_count, member_name)
    if entry["compressedSize"] > max_compressed_bytes:
        raise MetadataAuditError(
            f"Annotation member is unexpectedly large: {entry['compressedSize']} bytes"
        )
    header = _range_request(archive_url, entry["localHeaderOffset"], 30, user_agent)
    values = struct.unpack_from("<4s5H3I2H", header, 0)
    if values[0] != b"PK\x03\x04":
        raise MetadataAuditError("Invalid local ZIP header for annotation member")
    name_length, extra_length = values[9:11]
    header_tail = _range_request(
        archive_url,
        entry["localHeaderOffset"] + 30,
        name_length + extra_length,
        user_agent,
    )
    local_name = header_tail[:name_length].decode("utf-8", "replace")
    if local_name.casefold() != member_name.casefold():
        raise MetadataAuditError(f"Local ZIP member name mismatch: {local_name!r}")
    data_start = entry["localHeaderOffset"] + 30 + name_length + extra_length
    payload = _range_request(archive_url, data_start, entry["compressedSize"], user_agent)
    if entry["compression"] == 0:
        content = payload
    elif entry["compression"] == 8:
        content = zlib.decompress(payload, -15)
    else:
        raise MetadataAuditError(f"Unsupported ZIP compression method: {entry['compression']}")
    if len(content) != entry["uncompressedSize"]:
        raise MetadataAuditError(
            f"Annotation size mismatch: expected {entry['uncompressedSize']}, received {len(content)}"
        )
    entry = {
        **entry,
        "centralDirectoryOffset": directory_offset,
        "centralDirectorySize": directory_size,
        "centralDirectoryEntries": entry_count,
        "tailRangeBytes": tail_bytes,
        "rangeReadBytes": tail_bytes + 56 + directory_size + 30 + name_length + extra_length + entry["compressedSize"],
        "imageMembersDownloaded": image_member,
    }
    return content, entry


def _valid_box(annotation: dict[str, Any], image_by_id: dict[int, dict[str, Any]]) -> bool:
    bbox = annotation.get("bbox")
    image = image_by_id.get(int(annotation.get("image_id", -1)))
    if not isinstance(bbox, list) or len(bbox) != 4 or image is None:
        return False
    try:
        x, y, width, height = (float(value) for value in bbox)
        image_width, image_height = float(image.get("width", 0)), float(image.get("height", 0))
    except (TypeError, ValueError):
        return False
    if not all(math.isfinite(value) for value in (x, y, width, height, image_width, image_height)):
        return False
    return image_width > 0 and image_height > 0 and width > 0 and height > 0


def summarize_annotations(coco: dict[str, Any], official_source: dict[str, Any]) -> dict[str, Any]:
    """Summarize COCO image/box counts while retaining the official source IDs."""
    images = coco.get("images")
    annotations = coco.get("annotations")
    categories = coco.get("categories")
    if not isinstance(images, list) or not isinstance(annotations, list) or not isinstance(categories, list):
        raise MetadataAuditError("GBS annotation JSON must contain images, annotations, and categories arrays")
    category_by_id = {int(item["id"]): str(item["name"]) for item in categories if isinstance(item, dict) and "id" in item and "name" in item}
    image_by_id = {int(item["id"]): item for item in images if isinstance(item, dict) and "id" in item}
    category_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unknown_category_rows = 0
    for annotation in annotations:
        if not isinstance(annotation, dict):
            unknown_category_rows += 1
            continue
        try:
            category_name = category_by_id[int(annotation["category_id"])]
        except (KeyError, TypeError, ValueError):
            unknown_category_rows += 1
            continue
        category_rows[category_name].append(annotation)

    category_counts: dict[str, Any] = {}
    for category_name, rows in sorted(category_rows.items()):
        image_ids = {int(row["image_id"]) for row in rows if str(row.get("image_id", "")).lstrip("-").isdigit()}
        category_id = next((key for key, value in category_by_id.items() if value == category_name), None)
        category_counts[category_name] = {
            "categoryId": category_id,
            "boxes": len(rows),
            "uniqueImages": len(image_ids),
            "validBoundingBoxes": sum(_valid_box(row, image_by_id) for row in rows),
        }

    bin_related_ids = set()
    for name in BIN_RELATED_CATEGORIES:
        bin_related_ids.update(
            int(row["image_id"])
            for row in category_rows.get(name, [])
            if str(row.get("image_id", "")).lstrip("-").isdigit()
        )
    garbage_bin_ids = {
        int(row["image_id"])
        for row in category_rows.get("garbage_bin", [])
        if str(row.get("image_id", "")).lstrip("-").isdigit()
    }
    overflow_ids = {
        int(row["image_id"])
        for row in category_rows.get("overflow", [])
        if str(row.get("image_id", "")).lstrip("-").isdigit()
    }
    garbage_ids = {
        int(row["image_id"])
        for row in category_rows.get("garbage", [])
        if str(row.get("image_id", "")).lstrip("-").isdigit()
    }
    all_annotated_ids = {
        int(row["image_id"])
        for row in annotations
        if isinstance(row, dict) and str(row.get("image_id", "")).lstrip("-").isdigit()
    }
    image_ids = [int(item["id"]) for item in images if isinstance(item, dict) and "id" in item]
    source_summary = {
        "recordImageRows": len(images),
        "uniqueImageIds": len(set(image_ids)),
        "duplicateImageRows": len(images) - len(set(image_ids)),
        "annotatedUniqueImages": len(all_annotated_ids),
        "unannotatedUniqueImages": len(set(image_ids) - all_annotated_ids),
        "annotationRows": len(annotations),
        "unknownCategoryRows": unknown_category_rows,
    }
    metadata_gates = {
        "recordLicense": {
            "observed": official_source["license"]["id"],
            "required": EXPECTED_LICENSE_ID,
            "passed": official_source["license"]["id"] == EXPECTED_LICENSE_ID,
        },
        "perImagePixelProvenance": {
            "value": False,
            "passed": False,
            "reason": (
                "GBS COCO rows do not identify whether each pixel is field-captured, web-crawled, generated, "
                "or an augmentation, nor retain an original pixel licence/landing page. Record-level CC BY 4.0 "
                "does not by itself prove the upstream rights of every mixed-provenance image."
            ),
        },
        "explicitBinUniqueImages": {
            "value": len(garbage_bin_ids),
            "minimum": MINIMUM_BIN_IMAGES,
            "passed": len(garbage_bin_ids) >= MINIMUM_BIN_IMAGES,
        },
        "overflowUniqueImages": {
            "value": category_counts.get("overflow", {}).get("uniqueImages", 0),
            "minimum": MINIMUM_OVERFLOW_IMAGES,
            "passed": category_counts.get("overflow", {}).get("uniqueImages", 0) >= MINIMUM_OVERFLOW_IMAGES,
        },
        "appearanceFamilyQuotasProven": {
            "value": False,
            "passed": False,
            "reason": "COCO annotation metadata has no wheeled/cylindrical/basket/theme-park appearance-family labels; pixels must be reviewed.",
        },
    }
    return {
        "schemaVersion": 1,
        "dataset": "gbs",
        "officialSource": official_source,
        "annotationMember": ANNOTATION_MEMBER,
        "categories": category_by_id,
        "counts": source_summary,
        "categoryCounts": category_counts,
        "categoryIntersections": {
            "garbageBinOnly": len(garbage_bin_ids - overflow_ids),
            "overflowOnly": len(overflow_ids - garbage_bin_ids),
            "garbageBinAndOverflow": len(garbage_bin_ids & overflow_ids),
            "garbageOnly": len(garbage_ids - garbage_bin_ids - overflow_ids),
        },
        "derivedCounts": {
            "explicitBinCategory": DIRECT_BIN_CATEGORY,
            "explicitBinUniqueImages": len(garbage_bin_ids),
            "explicitBinBoxes": category_counts.get(DIRECT_BIN_CATEGORY, {}).get("boxes", 0),
            "binRelatedCategories": sorted(BIN_RELATED_CATEGORIES),
            "binRelatedCandidateUniqueImages": len(bin_related_ids),
            "binRelatedCandidateBoxes": sum(
                category_counts.get(name, {}).get("boxes", 0) for name in BIN_RELATED_CATEGORIES
            ),
            "contextGarbageUniqueImages": category_counts.get(CONTEXT_CATEGORY, {}).get("uniqueImages", 0),
            "contextGarbageBoxes": category_counts.get(CONTEXT_CATEGORY, {}).get("boxes", 0),
            "candidateStateImages": {
                "nonOverflow": len(garbage_bin_ids - overflow_ids),
                "overflow": len(overflow_ids),
                "warning": (
                    "Category absence/presence creates review candidates only; it does not prove normal or overflow state."
                ),
            },
        },
        "metadataSufficiency": {
            "passed": all(gate["passed"] for gate in metadata_gates.values() if "passed" in gate),
            "gates": metadata_gates,
            "readyForPixelTraining": False,
            "decision": "metadata-counts-sufficient-but-appearance-review-required",
        },
        "appearanceFamilyQuotaNote": (
            "The counts prove annotation volume only. They do not prove coverage of the green wheeled, "
            "black cylindrical/open-top, basket-like, indoor, theme-park, or chair-confuser families."
        ),
    }


def audit_record(
    record_id: int = DEFAULT_RECORD_ID,
    *,
    output: Path | None = None,
    annotation_json: Path | None = None,
    user_agent: str = DEFAULT_USER_AGENT,
) -> dict[str, Any]:
    api_url = f"https://zenodo.org/api/records/{record_id}"
    record = fetch_json(api_url, user_agent)
    official_source = validate_record(record, record_id=record_id)
    if annotation_json is not None:
        content = annotation_json.read_bytes()
        archive_access = {
            "mode": "local-annotation-json",
            "imageMembersDownloaded": False,
            "rangeReadBytes": 0,
            "annotationBytes": len(content),
        }
    else:
        content, entry = _read_remote_member(
            official_source["file"]["contentUrl"],
            official_source["file"]["sizeBytes"],
            ANNOTATION_MEMBER,
            user_agent,
        )
        archive_access = {"mode": "http-range-annotation-only", **entry, "annotationBytes": len(content)}
    try:
        coco = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MetadataAuditError(f"GBS annotation member is not valid UTF-8 JSON: {error}") from error
    report = summarize_annotations(coco, official_source)
    report["archiveAccess"] = archive_access
    if output is not None:
        output = output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-id", type=int, default=DEFAULT_RECORD_ID)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--annotation-json",
        type=Path,
        help="Optional extracted annotation JSON; avoids all archive range reads while preserving record validation.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report = audit_record(
            args.record_id,
            output=args.output,
            annotation_json=args.annotation_json.resolve() if args.annotation_json else None,
        )
    except (OSError, MetadataAuditError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps({
        "output": str(args.output.resolve()),
        "record": report["officialSource"],
        "counts": report["counts"],
        "categoryCounts": report["categoryCounts"],
        "derivedCounts": report["derivedCounts"],
        "metadataSufficiency": report["metadataSufficiency"],
        "archiveAccess": report["archiveAccess"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
