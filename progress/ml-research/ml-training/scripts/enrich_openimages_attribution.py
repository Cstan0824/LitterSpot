"""Enrich verified Open Images rows with supplied attribution metadata.

The landing-page verifier deliberately retained only the fields needed to
decide licence evidence.  Before pixels are acquired, this tool joins those
verified rows back to the official image-information CSV so supplied titles
and source identity are preserved.  No image URL is opened.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Iterable, Iterator, TextIO
from urllib.parse import urlparse

from audit_openimages_v7_metadata import IMAGE_INFORMATION_COLUMNS, open_text_url


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VERIFICATION = ROOT / "artifacts/dataset-readiness/openimages-v7-license-verification-full.json"
DEFAULT_CANDIDATE_AUDIT = ROOT / "artifacts/dataset-readiness/openimages-v7-train-full-candidates.json"
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/openimages-v7-license-verification-full-attributed.json"
IDENTITY_MAP = {
    "OriginalURL": "originalUrl",
    "OriginalLandingURL": "landingUrl",
    "License": "declaredLicense",
    "AuthorProfileURL": "declaredAuthorProfileUrl",
    "Author": "declaredAuthor",
}


class AttributionEnrichmentError(RuntimeError):
    """Raised when official metadata cannot be joined without ambiguity."""


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@contextmanager
def _open_csv(source: str) -> Iterator[TextIO]:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        with open_text_url(source) as handle:
            yield handle
        return
    path = Path(source).resolve()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        yield handle


def _metadata_source_sha256(source: str) -> str | None:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        return None
    return sha256(Path(source).resolve().read_bytes()).hexdigest()


def _schema_reader(handle: TextIO, source: str) -> csv.DictReader:
    reader = csv.DictReader(handle)
    fields = tuple(reader.fieldnames or ())
    missing = [field for field in IMAGE_INFORMATION_COLUMNS if field not in fields]
    if missing:
        raise AttributionEnrichmentError(
            f"image-information schema mismatch for {source}: missing {', '.join(missing)}"
        )
    return reader


def enrich_attribution(
    verification: dict[str, Any], *, image_information_source: str,
) -> dict[str, Any]:
    if verification.get("pixelsDownloaded") is not False:
        raise AttributionEnrichmentError("verification input must state pixelsDownloaded=false")
    records = verification.get("records", [])
    if not isinstance(records, list):
        raise AttributionEnrichmentError("verification records must be a list")
    verified_by_id: dict[str, dict[str, Any]] = {}
    for row in records:
        if not isinstance(row, dict) or row.get("status") != "verified":
            continue
        image_id = str(row.get("ImageID", "")).strip()
        if not image_id or image_id in verified_by_id:
            raise AttributionEnrichmentError(f"duplicate or blank verified ImageID: {image_id!r}")
        verified_by_id[image_id] = row

    metadata: dict[str, dict[str, str]] = {}
    rows_scanned = 0
    duplicate_rows = 0
    with _open_csv(image_information_source) as handle:
        reader = _schema_reader(handle, image_information_source)
        for csv_row in reader:
            rows_scanned += 1
            image_id = str(csv_row.get("ImageID", "")).strip()
            if image_id not in verified_by_id:
                continue
            if image_id in metadata:
                duplicate_rows += 1
                continue
            metadata[image_id] = {
                field: str(csv_row.get(field, "")).strip() for field in IMAGE_INFORMATION_COLUMNS
            }

    enriched_records: list[dict[str, Any]] = []
    complete = 0
    identity_mismatches: list[str] = []
    for original in records:
        row = dict(original)
        if row.get("status") != "verified":
            enriched_records.append(row)
            continue
        image_id = str(row.get("ImageID", ""))
        source_row = metadata.get(image_id)
        if source_row is None:
            row.update({
                "attributionComplete": False,
                "attributionFailureReason": "official_image_information_row_missing",
            })
            enriched_records.append(row)
            continue
        mismatched_fields = [
            destination for source, destination in IDENTITY_MAP.items()
            if str(row.get(destination, "")).strip() != source_row[source]
        ]
        if mismatched_fields:
            identity_mismatches.append(f"{image_id}: {', '.join(mismatched_fields)}")
            row.update({
                "attributionComplete": False,
                "attributionFailureReason": "verification_and_official_metadata_identity_mismatch",
                "attributionIdentityMismatchFields": mismatched_fields,
            })
            enriched_records.append(row)
            continue
        title = source_row["Title"]
        is_complete = bool(title)
        row.update({
            "title": title,
            "sourceSplit": source_row["Subset"],
            "openImagesOriginalSize": source_row["OriginalSize"],
            "openImagesOriginalMD5": source_row["OriginalMD5"],
            "thumbnail300KUrl": source_row["Thumbnail300KURL"],
            "noticesCaptureStatus": "not_present_in_open_images_metadata_schema",
            "copyrightNotice": None,
            "licenseNotice": None,
            "disclaimerNotice": None,
            "licensorSpecifiedWorkUri": None,
            "isDerivative": False,
            "changesDescription": None,
            "attributionComplete": is_complete,
            "attributionFailureReason": None if is_complete else "supplied_title_missing",
        })
        if is_complete:
            complete += 1
        enriched_records.append(row)

    verified_count = len(verified_by_id)
    matched_count = len(metadata)
    return {
        **verification,
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "records": enriched_records,
        "attributionEnrichment": {
            "imageInformationSource": image_information_source,
            "imageInformationSha256": _metadata_source_sha256(image_information_source),
            "rowsScanned": rows_scanned,
            "duplicateVerifiedRows": duplicate_rows,
            "identityMismatchCount": len(identity_mismatches),
            "identityMismatches": identity_mismatches,
            "noticeFieldPolicy": (
                "Open Images image-information metadata supplies no copyright, licence-notice, "
                "disclaimer, or licensor-specified-work-URI columns; retain nulls and recheck "
                "the landing page before any public redistribution."
            ),
        },
        "attributionCounts": {
            "verifiedRows": verified_count,
            "metadataMatched": matched_count,
            "complete": complete,
            "missing": verified_count - complete,
        },
        "readyForAcquisition": (
            verified_count > 0
            and matched_count == verified_count
            and complete == verified_count
            and not identity_mismatches
            and duplicate_rows == 0
        ),
        "releasePolicy": "internal_training_only_until_landing_notices_are_rechecked",
    }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verification", type=Path, default=DEFAULT_VERIFICATION)
    parser.add_argument("--candidate-audit", type=Path, default=DEFAULT_CANDIDATE_AUDIT)
    parser.add_argument("--image-information-csv", type=str)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    verification_path = args.verification.resolve()
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if args.image_information_csv:
        source = args.image_information_csv
    else:
        audit = json.loads(args.candidate_audit.read_text(encoding="utf-8"))
        source = str(audit.get("source", {}).get("imageInformationUrl", "")).strip()
        if not source:
            raise AttributionEnrichmentError("candidate audit has no source.imageInformationUrl")
    report = enrich_attribution(verification, image_information_source=source)
    report["inputVerification"] = str(verification_path)
    report["inputVerificationSha256"] = sha256(verification_path.read_bytes()).hexdigest()
    output = args.output.resolve()
    _atomic_write_json(output, report)
    print(json.dumps({
        "output": str(output),
        "attributionCounts": report["attributionCounts"],
        "readyForAcquisition": report["readyForAcquisition"],
        "pixelsDownloaded": report["pixelsDownloaded"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
