"""Build an Open Images candidate pool from human-verified no-bin labels."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable, Iterator

import audit_openimages_v7_metadata as oi


ROOT = Path(__file__).resolve().parents[2]
WASTE_CONTAINER_LABEL = oi.TARGET_CLASSES["waste_container"]["labelName"]
IMAGE_LABEL_COLUMNS = ("ImageID", "Source", "LabelName", "Confidence")
TRAIN_IMAGE_LABEL_URL = (
    "https://storage.googleapis.com/openimages/v5/"
    "train-annotations-human-imagelabels-boxable.csv"
)
DEFAULT_CONFUSER_AUDIT = (
    ROOT / "artifacts/dataset-readiness/openimages-v7-train-full-candidates.json"
)
DEFAULT_OUTPUT = (
    ROOT / "artifacts/dataset-readiness/openimages-v7-train-verified-no-bin-candidates.json"
)


class VerifiedAbsenceAuditError(RuntimeError):
    """Raised when official metadata violates the expected contract."""


def _author_key(row: dict[str, Any]) -> str:
    value = str(row.get("AuthorProfileURL") or row.get("Author") or "").strip().casefold()
    return value or f"missing:{row.get('ImageID', '')}"


def build_verified_absence_audit(
    image_label_rows: Iterable[dict[str, Any]],
    image_information_rows: Iterable[dict[str, Any]], *,
    confuser_audit: dict[str, Any] | None,
    max_images: int,
    max_per_author: int,
    label_source_url: str,
) -> dict[str, Any]:
    if max_images <= 0 or max_per_author <= 0:
        raise ValueError("max_images and max_per_author must be positive")
    verified_absent_ids = {
        str(row.get("ImageID", ""))
        for row in image_label_rows
        if str(row.get("LabelName", "")) == WASTE_CONTAINER_LABEL
        and str(row.get("Confidence", "")).strip() in {"0", "0.0"}
    }
    verified_absent_ids.discard("")

    metadata: dict[str, dict[str, str]] = {}
    for row in image_information_rows:
        image_id = str(row.get("ImageID", ""))
        if image_id not in verified_absent_ids:
            continue
        metadata[image_id] = {
            field: str(row.get(field, "")).strip() for field in oi.IMAGE_INFORMATION_COLUMNS
        }

    confusers: dict[str, dict[str, Any]] = {}
    if confuser_audit:
        rows = confuser_audit.get("candidateSelection", {}).get("candidateRows", [])
        if not isinstance(rows, list):
            raise VerifiedAbsenceAuditError("confuser candidateRows must be a list")
        confusers = {
            str(row.get("ImageID", "")): row for row in rows if isinstance(row, dict)
        }

    complete_ids = [
        image_id for image_id, row in metadata.items()
        if oi.declared_license_allowlisted(row.get("License", ""))
        and all(row.get(field, "") for field in oi.PROVENANCE_FIELDS)
    ]
    complete_ids.sort(key=lambda image_id: (image_id not in confusers, image_id))
    author_counts = Counter()
    selected_ids: list[str] = []
    for image_id in complete_ids:
        author = _author_key(metadata[image_id])
        if author_counts[author] >= max_per_author:
            continue
        author_counts[author] += 1
        selected_ids.append(image_id)
        if len(selected_ids) >= max_images:
            break

    evidence = {
        "labelName": WASTE_CONTAINER_LABEL,
        "confidence": 0,
        "annotationType": "human_verified_image_label",
        "sourceUrl": label_source_url,
    }
    candidate_rows = []
    for image_id in selected_ids:
        confuser = confusers.get(image_id, {})
        candidate_rows.append({
            "ImageID": image_id,
            "classNames": list(confuser.get("classNames", [])),
            "familyNames": list(confuser.get("familyNames", [])) or ["verified_no_bin"],
            **{
                field: metadata[image_id][field] for field in oi.CANDIDATE_METADATA_FIELDS
            },
            "declaredLicenseAllowlisted": True,
            "completeProvenance": True,
            "landingPageVerified": False,
            "binAbsenceVerified": True,
            "negativeEvidence": dict(evidence),
        })

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "dataset": "Open Images V7",
            "split": "train",
            "downloadPage": oi.DOWNLOAD_PAGE_URL,
            "imageLabels": label_source_url,
            "imageInformation": oi.SPLIT_URLS["train"]["imageInformation"],
            "pixelsDownloaded": False,
        },
        "absenceSummary": {
            "labelName": WASTE_CONTAINER_LABEL,
            "verifiedAbsentImageCount": len(verified_absent_ids),
            "metadataMatchedImageCount": len(metadata),
            "commercialCompatibleCompleteProvenanceCount": len(complete_ids),
            "confuserIntersectionCount": sum(image_id in confusers for image_id in complete_ids),
            "selectedImageCount": len(candidate_rows),
            "maxPerAuthor": max_per_author,
            "selectedAuthorCount": len(author_counts),
        },
        "candidateSelection": {"candidateRows": candidate_rows},
        "readyForTraining": False,
        "readinessBlockers": ["landing pages not independently verified", "pixels not acquired"],
    }


def _csv_rows(url: str, required: tuple[str, ...]) -> Iterator[dict[str, str]]:
    with oi.open_text_url(url) as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != required:
            raise VerifiedAbsenceAuditError(f"schema mismatch for {url}")
        yield from reader


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-label-url", default=TRAIN_IMAGE_LABEL_URL)
    parser.add_argument(
        "--image-information-url", default=oi.SPLIT_URLS["train"]["imageInformation"]
    )
    parser.add_argument("--confuser-audit", type=Path, default=DEFAULT_CONFUSER_AUDIT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-images", type=int, default=500)
    parser.add_argument("--max-per-author", type=int, default=3)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    confuser_audit = (
        json.loads(args.confuser_audit.read_text(encoding="utf-8"))
        if args.confuser_audit.is_file() else None
    )
    report = build_verified_absence_audit(
        _csv_rows(args.image_label_url, IMAGE_LABEL_COLUMNS),
        _csv_rows(args.image_information_url, oi.IMAGE_INFORMATION_COLUMNS),
        confuser_audit=confuser_audit,
        max_images=args.max_images,
        max_per_author=args.max_per_author,
        label_source_url=args.image_label_url,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"output": str(args.output), **report["absenceSummary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
