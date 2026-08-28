"""Acquire only landing-page-verified Open Images assets with attribution.

The input is the JSON result from ``verify_openimages_candidate_licenses``.
Rows not marked ``verified`` are never requested.  Every retained image is
decoded, hashed, written atomically, and represented in an attribution
manifest.  Test fixtures can supply image bytes without network access.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import re
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VERIFICATION = ROOT / "artifacts/dataset-readiness/openimages-v7-license-verification-full.json"
DEFAULT_OUTPUT_DIR = ROOT / "ml-training/data/public/openimages-v7-verified/images"
DEFAULT_MANIFEST = ROOT / "ml-training/data/public/openimages-v7-verified/manifest.json"
DEFAULT_USER_AGENT = "LitterSpot/1.0 (verified Open Images acquisition)"
MAX_IMAGE_BYTES = 40_000_000
RETRYABLE_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}
REQUIRED_ATTRIBUTION_FIELDS = (
    "ImageID",
    "originalUrl",
    "landingUrl",
    "declaredLicense",
    "declaredAuthorProfileUrl",
    "declaredAuthor",
    "title",
    "noticesCaptureStatus",
)
FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}


class AcquisitionError(RuntimeError):
    """Raised when the acquisition contract cannot be satisfied safely."""


class AssetRejectedError(AcquisitionError):
    """Raised for a deterministic asset problem that a retry cannot repair."""


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _fixture_bytes(url: str, fixture: dict[str, Any]) -> tuple[int, str, bytes, str]:
    status = int(fixture.get("status", 0))
    content_type = str(fixture.get("contentType", "")).partition(";")[0].strip().casefold()
    final_url = str(fixture.get("finalUrl", url))
    encoded = str(fixture.get("bodyBase64", ""))
    try:
        body = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise AcquisitionError(f"invalid base64 fixture for {url}") from error
    return status, content_type, body, final_url


def _fetch_bytes(
    url: str, *, timeout: int, user_agent: str, retries: int,
    retry_delay_seconds: float,
) -> tuple[int, str, bytes, str]:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "image/*"})
    response: Any = None
    for attempt in range(retries + 1):
        try:
            response = urlopen(request, timeout=timeout)
            break
        except HTTPError as error:
            if error.code in RETRYABLE_HTTP_STATUS and attempt < retries:
                retry_after = error.headers.get("Retry-After") if error.headers else None
                try:
                    delay = max(0.0, min(60.0, float(retry_after)))
                except (TypeError, ValueError):
                    delay = retry_delay_seconds * (2 ** attempt)
                time.sleep(delay)
                continue
            return error.code, "", b"", error.geturl()
        except (URLError, TimeoutError, OSError) as error:
            if attempt < retries:
                time.sleep(retry_delay_seconds * (2 ** attempt))
                continue
            raise AcquisitionError(str(error)) from error
    if response is None:  # pragma: no cover - defensive retry loop guard
        raise AcquisitionError("asset retry loop exhausted")
    try:
        status = int(getattr(response, "status", response.getcode()))
        content_type = str(response.headers.get("Content-Type", "")).partition(";")[0].strip().casefold()
        body = response.read(MAX_IMAGE_BYTES + 1)
        if len(body) > MAX_IMAGE_BYTES:
            raise AssetRejectedError(f"image exceeds {MAX_IMAGE_BYTES} bytes")
        return status, content_type, body, str(response.geturl())
    finally:
        response.close()


def _validate_image(payload: bytes) -> tuple[str, int, int]:
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image_format = str(image.format or "").upper()
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise AssetRejectedError("response body is not a valid supported image") from error
    extension = FORMAT_EXTENSIONS.get(image_format)
    if extension is None:
        raise AssetRejectedError(f"unsupported image format: {image_format or 'unknown'}")
    if width <= 0 or height <= 0:
        raise AssetRejectedError("image dimensions must be positive")
    return extension, width, height


def _attribution_complete(row: dict[str, Any]) -> bool:
    return all(str(row.get(field, "")).strip() for field in REQUIRED_ATTRIBUTION_FIELDS)


def _validated_existing_record(record: dict[str, Any], output_dir: Path) -> bool:
    filename = str(record.get("localFilename", ""))
    if not filename or Path(filename).name != filename:
        return False
    path = output_dir / filename
    if not path.is_file():
        return False
    payload = path.read_bytes()
    if sha256(payload).hexdigest() != str(record.get("sha256", "")):
        return False
    if len(payload) != int(record.get("byteCount", -1)):
        return False
    try:
        extension, width, height = _validate_image(payload)
    except AcquisitionError:
        return False
    return (
        path.suffix.casefold() == extension
        and width == int(record.get("width", -1))
        and height == int(record.get("height", -1))
    )


def _acquisition_report(
    verification: dict[str, Any], verified_rows: list[dict[str, Any]],
    selected: list[dict[str, Any]], records: list[dict[str, Any]],
) -> dict[str, Any]:
    counts = Counter(record["status"] for record in records)
    all_rows = verification.get("records", [])
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDataset": verification.get("sourceDataset"),
        "eligibleVerifiedRows": len(verified_rows),
        "selectedVerifiedRows": len(selected),
        "selectedImageIds": [str(row.get("ImageID", "")) for row in selected],
        "processedSelectedRows": len(records),
        "excludedNonVerifiedRows": len(all_rows) - len(verified_rows),
        "pixelsDownloaded": counts["downloaded"] > 0,
        "counts": {
            "downloaded": counts["downloaded"],
            "reused": counts["reused"],
            "failed": counts["failed"],
            "rejected": counts["rejected"],
        },
        "records": list(records),
    }


def acquire_verified(
    verification: dict[str, Any], *, output_dir: Path,
    fixtures: dict[str, dict[str, Any]] | None = None,
    max_images: int | None = None, timeout: int = 30,
    user_agent: str = DEFAULT_USER_AGENT,
    prior_records: dict[str, dict[str, Any]] | None = None,
    retries: int = 2, retry_delay_seconds: float = 1.0,
    request_delay_seconds: float = 0.0,
    prefer_thumbnail: bool = False,
    openimages_s3_split: str | None = None,
    progress_callback: Any = None,
) -> dict[str, Any]:
    if verification.get("pixelsDownloaded") is not False:
        raise AcquisitionError("verification input must state pixelsDownloaded=false")
    rows = verification.get("records", [])
    if not isinstance(rows, list):
        raise AcquisitionError("verification records must be a list")
    if max_images is not None and max_images <= 0:
        raise ValueError("max_images must be positive when supplied")
    if retries < 0 or retry_delay_seconds < 0 or request_delay_seconds < 0:
        raise ValueError("retries and request delays must be non-negative")
    if openimages_s3_split not in {None, "train", "validation", "test"}:
        raise ValueError("openimages_s3_split must be train, validation, or test")
    verified_rows = [row for row in rows if isinstance(row, dict) and row.get("status") == "verified"]
    selected = verified_rows[:max_images] if max_images is not None else verified_rows
    records: list[dict[str, Any]] = []
    live_requests = 0

    def emit(record: dict[str, Any]) -> None:
        records.append(record)
        if progress_callback is not None:
            progress_callback(_acquisition_report(verification, verified_rows, selected, records))

    for row in selected:
        base = {
            field: row.get(field) for field in (
                "ImageID", "classNames", "familyNames", "originalUrl", "landingUrl",
                "thumbnail300KUrl",
                "declaredLicense", "declaredAuthorProfileUrl", "declaredAuthor",
                "title", "noticesCaptureStatus", "copyrightNotice", "licenseNotice",
                "disclaimerNotice", "licensorSpecifiedWorkUri",
                "binAbsenceVerified", "negativeEvidence",
            )
        }
        if not _attribution_complete(row):
            emit({**base, "status": "rejected", "reason": "incomplete_attribution"})
            continue
        image_id = str(row["ImageID"])
        if not re.fullmatch(r"[A-Za-z0-9_-]+", image_id):
            emit({**base, "status": "rejected", "reason": "unsafe_image_id"})
            continue
        prior = (prior_records or {}).get(image_id)
        if prior is not None and prior.get("status") in {"downloaded", "reused"}:
            if _validated_existing_record(prior, output_dir):
                emit({
                    **prior,
                    **base,
                    "status": "reused",
                    "reason": "validated_existing_asset",
                })
                continue
        thumbnail_url = str(row.get("thumbnail300KUrl", "")).strip()
        if openimages_s3_split:
            url = (
                "https://open-images-dataset.s3.amazonaws.com/"
                f"{openimages_s3_split}/{image_id}.jpg"
            )
            acquisition_source = f"openImagesS3:{openimages_s3_split}"
        elif prefer_thumbnail and thumbnail_url:
            url = thumbnail_url
            acquisition_source = "thumbnail300KUrl"
        else:
            url = str(row["originalUrl"])
            acquisition_source = "originalUrl"
        base.update({"assetUrl": url, "acquisitionSource": acquisition_source})
        try:
            if fixtures is not None:
                fixture = fixtures.get(url)
                if fixture is None:
                    raise AcquisitionError("asset fixture missing")
                status, content_type, payload, final_url = _fixture_bytes(url, fixture)
            else:
                if live_requests and request_delay_seconds:
                    time.sleep(request_delay_seconds)
                live_requests += 1
                status, content_type, payload, final_url = _fetch_bytes(
                    url,
                    timeout=timeout,
                    user_agent=user_agent,
                    retries=retries,
                    retry_delay_seconds=retry_delay_seconds,
                )
            if status < 200 or status >= 300:
                error_type = AcquisitionError if status in RETRYABLE_HTTP_STATUS else AssetRejectedError
                raise error_type(f"HTTP {status}")
            if not content_type.startswith("image/"):
                raise AssetRejectedError(f"non-image content type: {content_type or 'missing'}")
            extension, width, height = _validate_image(payload)
            destination = output_dir / f"{image_id}{extension}"
            if destination.exists():
                raise AcquisitionError("destination already exists without resumable manifest evidence")
            _atomic_write_bytes(destination, payload)
            emit({
                **base,
                "status": "downloaded",
                "reason": "verified_asset_acquired",
                "finalAssetUrl": final_url,
                "contentType": content_type,
                "localFilename": destination.name,
                "sha256": sha256(payload).hexdigest(),
                "byteCount": len(payload),
                "width": width,
                "height": height,
            })
        except AssetRejectedError as error:
            emit({**base, "status": "rejected", "reason": str(error)})
        except AcquisitionError as error:
            emit({**base, "status": "failed", "reason": str(error)})

    return _acquisition_report(verification, verified_rows, selected, records)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verification", type=Path, default=DEFAULT_VERIFICATION)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--asset-fixtures", type=Path)
    parser.add_argument("--max-images", type=int)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--retry-delay-seconds", type=float, default=1.0)
    parser.add_argument("--request-delay-seconds", type=float, default=0.0)
    parser.add_argument("--prefer-thumbnail", action="store_true")
    parser.add_argument("--openimages-s3-split", choices=("train", "validation", "test"))
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    verification_path = args.verification.resolve()
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    verification_sha = sha256(verification_path.read_bytes()).hexdigest()
    output_dir = args.output_dir.resolve()
    manifest_path = args.manifest.resolve()
    checkpoint_path = (
        args.checkpoint.resolve()
        if args.checkpoint
        else manifest_path.with_name(f"{manifest_path.stem}.checkpoint.json")
    )
    prior_records: dict[str, dict[str, Any]] | None = None
    if args.resume:
        resume_source = checkpoint_path if checkpoint_path.is_file() else manifest_path
        if not resume_source.is_file():
            raise AcquisitionError(
                f"neither resume checkpoint nor manifest exists: {checkpoint_path}, {manifest_path}"
            )
        prior = json.loads(resume_source.read_text(encoding="utf-8"))
        if prior.get("verificationArtifactSha256") != verification_sha:
            raise AcquisitionError("resume verification artifact hash changed")
        if prior.get("outputDirectory") != str(output_dir):
            raise AcquisitionError("resume output directory changed")
        verified_rows = [
            row for row in verification.get("records", [])
            if isinstance(row, dict) and row.get("status") == "verified"
        ]
        selected = verified_rows[:args.max_images] if args.max_images is not None else verified_rows
        expected_ids = [str(row.get("ImageID", "")) for row in selected]
        observed_ids = [str(value) for value in prior.get("selectedImageIds", [])]
        if not observed_ids and prior.get("processedSelectedRows") == prior.get("selectedVerifiedRows"):
            observed_ids = [str(row.get("ImageID", "")) for row in prior.get("records", [])]
        if observed_ids != expected_ids:
            raise AcquisitionError("resume selection changed")
        prior_records = {
            str(row.get("ImageID", "")): row for row in prior.get("records", [])
            if isinstance(row, dict)
        }
    fixtures: dict[str, dict[str, Any]] | None = None
    if args.asset_fixtures:
        fixture_payload = json.loads(args.asset_fixtures.read_text(encoding="utf-8"))
        fixtures = fixture_payload.get("responses", fixture_payload)
        if not isinstance(fixtures, dict):
            raise AcquisitionError("asset fixtures must be an object or contain responses")
    def write_progress(partial: dict[str, Any]) -> None:
        partial["verificationArtifact"] = str(verification_path)
        partial["verificationArtifactSha256"] = verification_sha
        partial["outputDirectory"] = str(output_dir)
        partial["checkpoint"] = str(checkpoint_path)
        partial["complete"] = False
        _atomic_write_json(checkpoint_path, partial)

    report = acquire_verified(
        verification,
        output_dir=output_dir,
        fixtures=fixtures,
        max_images=args.max_images,
        timeout=args.timeout,
        prior_records=prior_records,
        retries=args.retries,
        retry_delay_seconds=args.retry_delay_seconds,
        request_delay_seconds=args.request_delay_seconds,
        prefer_thumbnail=args.prefer_thumbnail,
        openimages_s3_split=args.openimages_s3_split,
        progress_callback=write_progress,
    )
    report["verificationArtifact"] = str(verification_path)
    report["verificationArtifactSha256"] = verification_sha
    report["outputDirectory"] = str(output_dir)
    report["checkpoint"] = str(checkpoint_path)
    report["complete"] = report["counts"]["failed"] == 0
    _atomic_write_json(checkpoint_path, report)
    if report["complete"]:
        _atomic_write_json(manifest_path, report)
    print(json.dumps({
        "manifest": str(manifest_path),
        "checkpoint": str(checkpoint_path),
        "selectedVerifiedRows": report["selectedVerifiedRows"],
        "counts": report["counts"],
        "complete": report["complete"],
        "pixelsDownloaded": report["pixelsDownloaded"],
    }, indent=2))
    return 0 if report["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
