"""Stream a metadata-only Open Images V7 box/licence audit.

The official Open Images download page links the validation bounding-box CSV
at a legacy ``v5`` URL and the matching validation image-information CSV under
the ``2018_04`` path.  Those URLs are intentional: this script preserves the
official source contract instead of silently replacing it with a mirror.

Only CSV metadata is read.  No image URL is opened and no training manifest is
created.  The report keeps four separate concepts apart:

* annotation box/image counts;
* images whose *declared* ``License`` URL matches a conservative commercial-
  compatible allowlist (a screening result, not legal approval);
* images with complete provenance fields;
* independently landing-page-verified IDs supplied through an explicit
  verification file (zero when no such file is supplied).

The validation split is the default smoke path.  The larger train stream is
guarded by ``--allow-large-train`` so a casual invocation cannot start it.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import time
from typing import Any, Iterator, TextIO
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/openimages-v7-validation-audit.json"
DEFAULT_USER_AGENT = "LitterSpot/1.0 (Open Images V7 metadata-only audit)"

DOWNLOAD_PAGE_URL = "https://storage.googleapis.com/openimages/web/download_v7.html"
CLASS_DESCRIPTIONS_URL = "https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv"

# These are the exact URLs linked by the official V7 download page.  The
# validation/test box files retain the v5 path; the train box file retains the
# v6 path.  We do not rewrite them to imply a different release endpoint.
SPLIT_URLS: dict[str, dict[str, str]] = {
    "validation": {
        "bbox": "https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv",
        "imageInformation": "https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv",
    },
    "test": {
        "bbox": "https://storage.googleapis.com/openimages/v5/test-annotations-bbox.csv",
        "imageInformation": "https://storage.googleapis.com/openimages/2018_04/test/test-images-with-rotation.csv",
    },
    "train": {
        "bbox": "https://storage.googleapis.com/openimages/v6/oidv6-train-annotations-bbox.csv",
        "imageInformation": "https://storage.googleapis.com/openimages/2018_04/train/train-images-boxable-with-rotation.csv",
    },
}

BBOX_COLUMNS = (
    "ImageID", "Source", "LabelName", "Confidence", "XMin", "XMax",
    "YMin", "YMax", "IsOccluded", "IsTruncated", "IsGroupOf",
    "IsDepiction", "IsInside",
)
IMAGE_INFORMATION_COLUMNS = (
    "ImageID", "Subset", "OriginalURL", "OriginalLandingURL", "License",
    "AuthorProfileURL", "Author", "Title", "OriginalSize", "OriginalMD5",
    "Thumbnail300KURL", "Rotation",
)
PROVENANCE_FIELDS = (
    "OriginalURL", "OriginalLandingURL", "License", "AuthorProfileURL", "Author",
)
CANDIDATE_METADATA_FIELDS = (*PROVENANCE_FIELDS, "Title", "Thumbnail300KURL")

# MIDs are retained from the project research record and are verified against
# the official V7 class-description CSV at runtime.
TARGET_CLASSES: dict[str, dict[str, str]] = {
    "waste_container": {"labelName": "/m/0bjyj5", "displayName": "Waste container"},
    "chair": {"labelName": "/m/01mzpv", "displayName": "Chair"},
    "person": {"labelName": "/m/01g317", "displayName": "Person"},
    "table": {"labelName": "/m/04bcr3", "displayName": "Table"},
    "cart": {"labelName": "/m/018p4k", "displayName": "Cart"},
    "traffic_sign": {"labelName": "/m/01mqdt", "displayName": "Traffic sign"},
    "plastic_bag": {"labelName": "/m/05gqfk", "displayName": "Plastic bag"},
    "bottle": {"labelName": "/m/04dr76w", "displayName": "Bottle"},
    "barrel": {"labelName": "/m/02zn6n", "displayName": "Barrel"},
    "box": {"labelName": "/m/025dyy", "displayName": "Box"},
    "picnic_basket": {"labelName": "/m/07kng9", "displayName": "Picnic basket"},
    "wheelchair": {"labelName": "/m/0qmmr", "displayName": "Wheelchair"},
    "handbag": {"labelName": "/m/080hkjn", "displayName": "Handbag"},
    "backpack": {"labelName": "/m/01940j", "displayName": "Backpack"},
}

# Families are unions, not sums.  An image with both a bottle and a plastic
# bag contributes once to ``carryables`` while remaining visible in each class.
TARGET_FAMILIES: dict[str, tuple[str, ...]] = {
    "bin_positive": ("waste_container",),
    "furniture": ("chair", "table"),
    "people": ("person",),
    "mobility_and_carts": ("cart", "wheelchair"),
    "signs": ("traffic_sign",),
    "carryables": ("plastic_bag", "bottle", "handbag", "backpack", "picnic_basket"),
    "container_like": ("barrel", "box"),
}

# URL forms that normally indicate a commercial-compatible Creative Commons
# declaration.  BY-SA remains in the screen because it permits commercial use
# with share-alike obligations; BY-NC and BY-ND are deliberately excluded.
DECLARED_LICENSE_ALLOWLIST = {
    "creativecommons.org/licenses/by/2.0",
    "creativecommons.org/licenses/by/3.0",
    "creativecommons.org/licenses/by/4.0",
    "creativecommons.org/licenses/by-sa/2.0",
    "creativecommons.org/licenses/by-sa/3.0",
    "creativecommons.org/licenses/by-sa/4.0",
    "creativecommons.org/publicdomain/zero/1.0",
    "creativecommons.org/publicdomain/mark/1.0",
}

MAX_HTTP_RETRIES = 4
MAX_RETRY_AFTER_SECONDS = 60.0
RETRYABLE_HTTP_STATUS = {429, 503}


class OpenImagesAuditError(RuntimeError):
    """Raised when the official metadata contract cannot be audited safely."""


@dataclass
class AnnotationIndex:
    box_counts: Counter[str]
    image_ids_by_class: dict[str, set[str]]
    image_ids_by_family: dict[str, set[str]]
    class_names_by_image: dict[str, set[str]]
    family_names_by_image: dict[str, set[str]]
    scanned_rows: int
    target_rows: int


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _retry_after_seconds(error: HTTPError) -> float | None:
    value = error.headers.get("Retry-After") if error.headers is not None else None
    if not value:
        return None
    try:
        return max(0.0, min(MAX_RETRY_AFTER_SECONDS, float(value)))
    except (TypeError, ValueError):
        return None


@contextmanager
def open_text_url(
    url: str,
    *,
    user_agent: str = DEFAULT_USER_AGENT,
    timeout: int = 120,
) -> Iterator[TextIO]:
    """Open a UTF-8 CSV stream with bounded retry handling for 429/503."""
    request = Request(url, headers={"User-Agent": user_agent})
    last_error: HTTPError | None = None
    response: Any = None
    for attempt in range(MAX_HTTP_RETRIES + 1):
        try:
            response = urlopen(request, timeout=timeout)
            break
        except HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_HTTP_STATUS or attempt >= MAX_HTTP_RETRIES:
                raise OpenImagesAuditError(
                    f"Open Images stream failed after {attempt + 1} attempt(s): HTTP {error.code} {url}"
                ) from error
            delay = _retry_after_seconds(error)
            time.sleep(delay if delay is not None else min(2 ** attempt, 30.0))
    if response is None:  # pragma: no cover - defensive loop guard
        raise OpenImagesAuditError(f"Open Images stream failed: {last_error}") from last_error
    try:
        # Do not use response.text: wrapping the byte stream keeps the CSV
        # reader incremental and avoids materializing a large validation file.
        yield io.TextIOWrapper(response, encoding="utf-8-sig", newline="")
    finally:
        response.close()


def _read_csv_header(handle: TextIO, *, required: tuple[str, ...], url: str) -> csv.DictReader:
    reader = csv.DictReader(handle)
    fieldnames = tuple(reader.fieldnames or ())
    missing = [column for column in required if column not in fieldnames]
    if missing:
        raise OpenImagesAuditError(
            f"Official CSV schema mismatch for {url}: missing {', '.join(missing)}; observed {fieldnames}"
        )
    return reader


def load_class_mapping(
    url: str = CLASS_DESCRIPTIONS_URL,
    *,
    user_agent: str = DEFAULT_USER_AGENT,
) -> dict[str, str]:
    """Read official V7 MID -> display-name mapping and verify target classes."""
    mapping: dict[str, str] = {}
    with open_text_url(url, user_agent=user_agent) as handle:
        reader = _read_csv_header(handle, required=("LabelName", "DisplayName"), url=url)
        for row in reader:
            label = str(row.get("LabelName", "")).strip()
            name = str(row.get("DisplayName", "")).strip()
            if label and name:
                mapping[label] = name
    mismatches = [
        f"{key}: expected {spec['labelName']}={spec['displayName']!r}, observed {mapping.get(spec['labelName'])!r}"
        for key, spec in TARGET_CLASSES.items()
        if mapping.get(spec["labelName"]) != spec["displayName"]
    ]
    if mismatches:
        raise OpenImagesAuditError("Official V7 target class mapping changed: " + "; ".join(mismatches))
    return mapping


def _empty_annotation_index() -> AnnotationIndex:
    return AnnotationIndex(
        box_counts=Counter(),
        image_ids_by_class={name: set() for name in TARGET_CLASSES},
        image_ids_by_family={name: set() for name in TARGET_FAMILIES},
        class_names_by_image=defaultdict(set),
        family_names_by_image=defaultdict(set),
        scanned_rows=0,
        target_rows=0,
    )


def stream_bbox_annotations(
    url: str,
    *,
    user_agent: str = DEFAULT_USER_AGENT,
) -> AnnotationIndex:
    """Stream target rows and retain only overlap-safe ID sets/counters."""
    by_label = {spec["labelName"]: name for name, spec in TARGET_CLASSES.items()}
    class_to_families: dict[str, list[str]] = defaultdict(list)
    for family, classes in TARGET_FAMILIES.items():
        for class_name in classes:
            class_to_families[class_name].append(family)
    result = _empty_annotation_index()
    with open_text_url(url, user_agent=user_agent) as handle:
        reader = _read_csv_header(handle, required=BBOX_COLUMNS, url=url)
        for row in reader:
            result.scanned_rows += 1
            class_name = by_label.get(str(row.get("LabelName", "")).strip())
            if class_name is None:
                continue
            image_id = str(row.get("ImageID", "")).strip()
            if not image_id:
                continue
            result.target_rows += 1
            result.box_counts[class_name] += 1
            result.image_ids_by_class[class_name].add(image_id)
            result.class_names_by_image[image_id].add(class_name)
            for family in class_to_families[class_name]:
                result.image_ids_by_family[family].add(image_id)
                result.family_names_by_image[image_id].add(family)
    return result


def _normalise_license(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.casefold().removeprefix("www.")
    path = parsed.path.rstrip("/")
    return f"{host}{path}" if host else raw.rstrip("/")


def declared_license_allowlisted(value: Any) -> bool:
    return _normalise_license(value) in DECLARED_LICENSE_ALLOWLIST


def _provenance_complete(row: dict[str, Any]) -> bool:
    return all(str(row.get(field, "")).strip() for field in PROVENANCE_FIELDS)


def _read_verified_landing_ids(path: Path | None) -> set[str]:
    """Read explicit verification IDs; no landing pages are fetched by this tool."""
    if path is None:
        return set()
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    if path.suffix.casefold() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            values = payload.get("verifiedImageIds", payload.get("imageIds", []))
        else:
            values = payload
        if not isinstance(values, list):
            raise ValueError("landing verification JSON must be a list or an object with imageIds")
        return {str(value).strip() for value in values if str(value).strip()}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if "ImageID" not in (reader.fieldnames or ()):
            raise ValueError("landing verification CSV must contain ImageID")
        verified: set[str] = set()
        for row in reader:
            flag = str(row.get("verified", row.get("LandingPageVerified", "true"))).strip().casefold()
            if flag in {"1", "true", "yes", "verified"}:
                value = str(row.get("ImageID", "")).strip()
                if value:
                    verified.add(value)
        return verified


def _counts_for_ids(
    image_ids: set[str],
    metadata: dict[str, dict[str, Any]],
    verified_landing_ids: set[str],
) -> dict[str, Any]:
    matched = image_ids & metadata.keys()
    declared = {image_id for image_id in matched if metadata[image_id]["declaredLicenseAllowlisted"]}
    complete = {image_id for image_id in matched if metadata[image_id]["completeProvenance"]}
    landing = matched & verified_landing_ids
    license_counts = Counter(str(metadata[image_id]["License"]) for image_id in declared)
    field_counts = {
        field: sum(bool(str(metadata[image_id].get(field, "")).strip()) for image_id in matched)
        for field in PROVENANCE_FIELDS
    }
    return {
        "uniqueImageCount": len(image_ids),
        "imageInformationMatchedCount": len(matched),
        "imageInformationMissingCount": len(image_ids - metadata.keys()),
        "declaredCommercialCompatible": {
            "imageCount": len(declared),
            "licenseCounts": dict(sorted(license_counts.items())),
        },
        "completeProvenance": {"imageCount": len(complete), "fieldCounts": field_counts},
        "landingPageVerified": {"imageCount": len(landing)},
    }


def _candidate_ids(
    image_ids: set[str],
    metadata: dict[str, dict[str, Any]],
    limit: int,
) -> list[str]:
    eligible = sorted(
        image_id
        for image_id in image_ids
        if image_id in metadata
        and metadata[image_id]["declaredLicenseAllowlisted"]
        and metadata[image_id]["completeProvenance"]
    )
    return eligible[:limit]


def _source_identity(urls: dict[str, str], split: str) -> dict[str, Any]:
    return {
        "dataset": "Open Images V7",
        "split": split,
        "downloadPageUrl": DOWNLOAD_PAGE_URL,
        "classDescriptionsUrl": CLASS_DESCRIPTIONS_URL,
        "bboxUrl": urls["bbox"],
        "imageInformationUrl": urls["imageInformation"],
        "metadataOnly": True,
        "pixelsDownloaded": False,
    }


def audit_openimages(
    *,
    split: str = "validation",
    bbox_url: str | None = None,
    image_information_url: str | None = None,
    class_descriptions_url: str = CLASS_DESCRIPTIONS_URL,
    candidate_limit: int = 100,
    landing_verified: Path | None = None,
    user_agent: str = DEFAULT_USER_AGENT,
    allow_large_train: bool = False,
) -> dict[str, Any]:
    if split not in SPLIT_URLS:
        raise ValueError(f"unsupported Open Images split: {split}")
    if split == "train" and not allow_large_train:
        raise ValueError("train audit is guarded; pass allow_large_train=True explicitly")
    if candidate_limit < 0:
        raise ValueError("candidate_limit must be non-negative")
    urls = {
        "bbox": bbox_url or SPLIT_URLS[split]["bbox"],
        "imageInformation": image_information_url or SPLIT_URLS[split]["imageInformation"],
    }
    load_class_mapping(class_descriptions_url, user_agent=user_agent)
    annotations = stream_bbox_annotations(urls["bbox"], user_agent=user_agent)
    verified_landing_ids = _read_verified_landing_ids(landing_verified)
    target_image_ids = set(annotations.class_names_by_image)
    metadata: dict[str, dict[str, Any]] = {}
    duplicate_metadata_rows = 0
    image_information_rows = 0
    with open_text_url(urls["imageInformation"], user_agent=user_agent) as handle:
        reader = _read_csv_header(handle, required=IMAGE_INFORMATION_COLUMNS, url=urls["imageInformation"])
        for row in reader:
            image_information_rows += 1
            image_id = str(row.get("ImageID", "")).strip()
            if image_id not in target_image_ids:
                continue
            if image_id in metadata:
                duplicate_metadata_rows += 1
                continue
            metadata[image_id] = {
                **{field: str(row.get(field, "")).strip() for field in IMAGE_INFORMATION_COLUMNS},
                "declaredLicenseAllowlisted": declared_license_allowlisted(row.get("License")),
                "completeProvenance": _provenance_complete(row),
            }

    class_report: dict[str, Any] = {}
    for class_name, spec in TARGET_CLASSES.items():
        image_ids = annotations.image_ids_by_class[class_name]
        details = _counts_for_ids(image_ids, metadata, verified_landing_ids)
        details.update({
            "labelName": spec["labelName"],
            "displayName": spec["displayName"],
            "boxCount": annotations.box_counts[class_name],
            "candidateIds": _candidate_ids(image_ids, metadata, candidate_limit),
        })
        class_report[class_name] = details

    family_report: dict[str, Any] = {}
    for family_name, class_names in TARGET_FAMILIES.items():
        image_ids = annotations.image_ids_by_family[family_name]
        details = _counts_for_ids(image_ids, metadata, verified_landing_ids)
        details.update({
            "classes": list(class_names),
            "boxCount": sum(annotations.box_counts[class_name] for class_name in class_names),
            "candidateIds": _candidate_ids(image_ids, metadata, candidate_limit),
        })
        family_report[family_name] = details

    # Keep the per-class quota intact.  A second global lexical slice biases
    # the sample toward whichever high-volume class happens to own the lowest
    # IDs (the train pilot selected people and no bins).  The union is still
    # bounded by ``candidate_limit * len(TARGET_CLASSES)``.
    candidate_union = sorted({
        image_id
        for class_name in TARGET_CLASSES
        for image_id in class_report[class_name]["candidateIds"]
    })
    candidate_rows = [
        {
            "ImageID": image_id,
            "classNames": sorted(annotations.class_names_by_image[image_id]),
            "familyNames": sorted(annotations.family_names_by_image[image_id]),
            **{field: metadata[image_id][field] for field in CANDIDATE_METADATA_FIELDS},
            "declaredLicenseAllowlisted": metadata[image_id]["declaredLicenseAllowlisted"],
            "completeProvenance": metadata[image_id]["completeProvenance"],
            "landingPageVerified": image_id in verified_landing_ids,
        }
        for image_id in candidate_union
        if image_id in metadata
    ]

    all_target_counts = _counts_for_ids(target_image_ids, metadata, verified_landing_ids)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": _source_identity(urls, split),
        "officialSchemas": {
            "bboxRequiredColumns": list(BBOX_COLUMNS),
            "imageInformationRequiredColumns": list(IMAGE_INFORMATION_COLUMNS),
            "provenanceFields": list(PROVENANCE_FIELDS),
        },
        "classMapping": {
            "sourceUrl": class_descriptions_url,
            "mappingVerifiedAgainstOfficialV7": True,
            "targetClasses": TARGET_CLASSES,
        },
        "declaredLicensePolicy": {
            "allowlist": sorted(DECLARED_LICENSE_ALLOWLIST),
            "screeningOnly": True,
            "licenseScreenOnly": True,
            "excludedFamilies": ["by-nc", "by-nd"],
        },
        "scan": {
            "bboxRowsScanned": annotations.scanned_rows,
            "targetBoxRows": annotations.target_rows,
            "imageInformationRowsScanned": image_information_rows,
            "targetImageInformationRowsMatched": len(metadata),
            "duplicateTargetImageInformationRows": duplicate_metadata_rows,
            "targetUniqueImageCount": len(target_image_ids),
        },
        "annotationCounts": {
            "classes": class_report,
            "families": family_report,
            "allTargetClasses": {
                "boxCount": sum(annotations.box_counts.values()),
                **all_target_counts,
            },
        },
        "declaredCommercialCompatibleCounts": {
            "classes": {name: details["declaredCommercialCompatible"] for name, details in class_report.items()},
            "families": {name: details["declaredCommercialCompatible"] for name, details in family_report.items()},
            "allTargetClasses": all_target_counts["declaredCommercialCompatible"],
        },
        "completeProvenanceFieldCounts": {
            "requiredFields": list(PROVENANCE_FIELDS),
            "classes": {name: details["completeProvenance"] for name, details in class_report.items()},
            "families": {name: details["completeProvenance"] for name, details in family_report.items()},
            "allTargetClasses": all_target_counts["completeProvenance"],
        },
        "landingPageVerifiedCounts": {
            "verifiedInput": str(landing_verified.resolve()) if landing_verified else None,
            "independentVerificationPerformed": bool(landing_verified),
            "classes": {name: details["landingPageVerified"] for name, details in class_report.items()},
            "families": {name: details["landingPageVerified"] for name, details in family_report.items()},
            "allTargetClasses": all_target_counts["landingPageVerified"],
        },
        "candidateSelection": {
            "limitPerClassAndFamily": candidate_limit,
            "globalCandidateRowsLimit": None,
            "selectionMethod": (
                "union of each class's lexicographically sorted ImageID quota after "
                "declared-license allowlist and complete-provenance screening"
            ),
            "licenseScreenOnly": True,
            "landingPageVerificationStillRequired": True,
            "classIds": {name: details["candidateIds"] for name, details in class_report.items()},
            "familyIds": {name: details["candidateIds"] for name, details in family_report.items()},
            "candidateRows": candidate_rows,
        },
        "warnings": [
            "Declared license URLs are source metadata and are not legal approval.",
            "No landing pages were fetched; landingPageVerified counts are zero unless an explicit verification file is supplied.",
            "No image pixels were fetched or admitted to training.",
        ],
        "readyForTraining": False,
        "trainingUse": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=sorted(SPLIT_URLS), default="validation")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--candidate-limit", type=int, default=100)
    parser.add_argument("--landing-verified", type=Path)
    parser.add_argument("--bbox-url", type=str)
    parser.add_argument("--image-information-url", type=str)
    parser.add_argument("--class-descriptions-url", type=str, default=CLASS_DESCRIPTIONS_URL)
    parser.add_argument("--allow-large-train", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report = audit_openimages(
            split=args.split,
            bbox_url=args.bbox_url,
            image_information_url=args.image_information_url,
            class_descriptions_url=args.class_descriptions_url,
            candidate_limit=args.candidate_limit,
            landing_verified=args.landing_verified,
            allow_large_train=args.allow_large_train,
        )
    except (OSError, ValueError, OpenImagesAuditError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    output = args.output.resolve()
    _atomic_write_json(output, report)
    print(json.dumps({
        "output": str(output),
        "split": report["source"]["split"],
        "bboxRowsScanned": report["scan"]["bboxRowsScanned"],
        "targetBoxRows": report["scan"]["targetBoxRows"],
        "targetUniqueImageCount": report["scan"]["targetUniqueImageCount"],
        "declaredCommercialCompatible": report["declaredCommercialCompatibleCounts"]["allTargetClasses"],
        "completeProvenance": report["completeProvenanceFieldCounts"]["allTargetClasses"],
        "landingPageVerified": report["landingPageVerifiedCounts"]["allTargetClasses"],
        "candidateRows": len(report["candidateSelection"]["candidateRows"]),
        "readyForTraining": report["readyForTraining"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
