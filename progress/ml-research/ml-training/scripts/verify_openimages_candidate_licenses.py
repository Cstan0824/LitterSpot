"""Verify Open Images candidate landing-page evidence without reading pixels.

This tool consumes candidate rows emitted by ``audit_openimages_v7_metadata``.
It requests only ``OriginalLandingURL`` pages and emits one conservative state:

* ``verified``: the HTML exposes the exact declared licence through a
  machine-readable ``rel=license`` link and also contains the declared author
  or author-profile URL;
* ``rejected``: the landing page is permanently gone or exposes a different
  machine-readable Creative Commons licence;
* ``manual_review``: all other outcomes, including access challenges.

Image responses are closed without reading their bodies.  Declared Open Images
metadata alone can never produce ``verified``.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AUDIT = ROOT / "artifacts/dataset-readiness/openimages-v7-train-sufficiency.json"
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/openimages-v7-license-verification-pilot.json"
DEFAULT_USER_AGENT = "LitterSpot/1.0 (Open Images landing-page metadata verifier)"
MAX_HTML_BYTES = 1_000_000
HTML_CONTENT_TYPES = {"text/html", "application/xhtml+xml"}
PERMANENT_GONE_STATUS = {404, 410}
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}


class CandidateVerificationError(RuntimeError):
    """Raised when the input or response contract cannot be verified safely."""


@dataclass(frozen=True)
class LandingResponse:
    status: int
    final_url: str
    content_type: str
    body: bytes | None
    body_read: bool
    error: str | None = None


class EvidenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.license_links: list[str] = []
        self.hrefs: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.casefold(): (value or "") for key, value in attrs}
        href = values.get("href", "").strip()
        if href:
            self.hrefs.append(href)
        rel = {part.casefold() for part in values.get("rel", "").split()}
        if href and "license" in rel and tag.casefold() in {"a", "link"}:
            self.license_links.append(href)

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.text_parts.append(value)


def _normalise_url(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.casefold().removeprefix("www.")
    path = parsed.path.rstrip("/")
    return f"{host}{path}" if host else raw.casefold().rstrip("/")


def _is_cc_license_url(value: str) -> bool:
    normalised = _normalise_license_url(value)
    return normalised.startswith("creativecommons.org/licenses/") or normalised.startswith(
        "creativecommons.org/publicdomain/"
    )


def _normalise_license_url(value: Any) -> str:
    """Canonicalize CC licence, localized deed, and legal-code URLs."""
    normalised = _normalise_url(value)
    if not normalised.startswith("creativecommons.org/"):
        return normalised
    return re.sub(r"/(?:deed(?:\.[a-z-]+)?|legalcode)$", "", normalised, flags=re.IGNORECASE)


def _content_type(value: str) -> str:
    return value.partition(";")[0].strip().casefold()


def _landing_host(value: str) -> str:
    return (urlparse(value).hostname or "").casefold().removeprefix("www.")


def _fixture_response(url: str, fixture: dict[str, Any]) -> LandingResponse:
    status = int(fixture.get("status", 0))
    content_type = _content_type(str(fixture.get("contentType", "")))
    final_url = str(fixture.get("finalUrl", url))
    if _landing_host(final_url) != _landing_host(url):
        return LandingResponse(
            status, final_url, content_type, None, False, "cross_host_redirect",
        )
    if content_type not in HTML_CONTENT_TYPES:
        return LandingResponse(status, final_url, content_type, None, False)
    body = str(fixture.get("body", "")).encode("utf-8")[:MAX_HTML_BYTES]
    return LandingResponse(status, final_url, content_type, body, True)


def _fetch_landing_page(
    url: str, *, timeout: int, user_agent: str, retries: int = 2,
    retry_delay_seconds: float = 1.0,
) -> LandingResponse:
    request = Request(url, headers={
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml",
    })
    response: Any = None
    for attempt in range(retries + 1):
        try:
            response = urlopen(request, timeout=timeout)
            break
        except HTTPError as error:
            if error.code in RETRYABLE_HTTP_STATUS and attempt < retries:
                time.sleep(retry_delay_seconds * (2 ** attempt))
                continue
            content_type = _content_type(error.headers.get("Content-Type", "") if error.headers else "")
            return LandingResponse(error.code, error.geturl(), content_type, None, False, str(error))
        except (URLError, TimeoutError, OSError) as error:
            if attempt < retries:
                time.sleep(retry_delay_seconds * (2 ** attempt))
                continue
            return LandingResponse(0, url, "", None, False, str(error))
    if response is None:  # pragma: no cover - defensive loop guard
        return LandingResponse(0, url, "", None, False, "retry loop exhausted")
    try:
        status = int(getattr(response, "status", response.getcode()))
        final_url = str(response.geturl())
        content_type = _content_type(response.headers.get("Content-Type", ""))
        if _landing_host(final_url) != _landing_host(url):
            return LandingResponse(
                status, final_url, content_type, None, False, "cross_host_redirect",
            )
        if content_type not in HTML_CONTENT_TYPES:
            return LandingResponse(status, final_url, content_type, None, False)
        body = response.read(MAX_HTML_BYTES + 1)
        if len(body) > MAX_HTML_BYTES:
            body = body[:MAX_HTML_BYTES]
        return LandingResponse(status, final_url, content_type, body, True)
    finally:
        response.close()


def _classify(row: dict[str, Any], response: LandingResponse) -> dict[str, Any]:
    base = {
        "ImageID": str(row.get("ImageID", "")),
        "classNames": list(row.get("classNames", [])),
        "familyNames": list(row.get("familyNames", [])),
        "originalUrl": str(row.get("OriginalURL", "")),
        "landingUrl": str(row.get("OriginalLandingURL", "")),
        "finalUrl": response.final_url,
        "declaredLicense": str(row.get("License", "")),
        "declaredAuthorProfileUrl": str(row.get("AuthorProfileURL", "")),
        "declaredAuthor": str(row.get("Author", "")),
        "title": str(row.get("Title", "")),
        "thumbnail300KUrl": str(row.get("Thumbnail300KURL", "")),
        "noticesCaptureStatus": "not_present_in_open_images_metadata_schema",
        "binAbsenceVerified": row.get("binAbsenceVerified") is True,
        "negativeEvidence": row.get("negativeEvidence"),
        "httpStatus": response.status,
        "contentType": response.content_type,
        "responseBodyRead": response.body_read,
        "bodySha256": sha256(response.body).hexdigest() if response.body is not None else None,
        "networkError": response.error,
    }
    if response.status in PERMANENT_GONE_STATUS:
        return {**base, "status": "rejected", "reason": "landing_page_not_found"}
    if response.status < 200 or response.status >= 300:
        return {**base, "status": "manual_review", "reason": "landing_page_unavailable"}
    if response.error == "cross_host_redirect":
        return {**base, "status": "manual_review", "reason": "cross_host_redirect_body_not_read"}
    if not response.body_read or response.body is None:
        return {**base, "status": "manual_review", "reason": "non_html_response_not_read"}

    parser = EvidenceParser()
    parser.feed(response.body.decode("utf-8", errors="replace"))
    expected_license = _normalise_license_url(row.get("License"))
    explicit_cc_licenses = sorted({
        _normalise_license_url(link) for link in parser.license_links if _is_cc_license_url(link)
    })
    exact_license = expected_license in explicit_cc_licenses
    author_profile = _normalise_url(row.get("AuthorProfileURL"))
    normalised_hrefs = {_normalise_url(href) for href in parser.hrefs}
    page_text = " ".join(parser.text_parts).casefold()
    author_name = str(row.get("Author", "")).strip().casefold()
    author_present = bool(
        (author_profile and author_profile in normalised_hrefs)
        or (author_name and author_name in page_text)
    )
    evidence = {
        "explicitLicenseLinks": explicit_cc_licenses,
        "exactDeclaredLicensePresent": exact_license,
        "declaredAuthorPresent": author_present,
    }
    conflicting_licenses = [value for value in explicit_cc_licenses if value != expected_license]
    if exact_license and conflicting_licenses:
        return {
            **base,
            **evidence,
            "status": "manual_review",
            "reason": "conflicting_machine_readable_licenses",
        }
    if exact_license and author_present:
        return {**base, **evidence, "status": "verified", "reason": "exact_license_and_author_on_landing_page"}
    if explicit_cc_licenses and not exact_license:
        return {**base, **evidence, "status": "rejected", "reason": "landing_license_mismatch"}
    return {**base, **evidence, "status": "manual_review", "reason": "machine_readable_evidence_incomplete"}


def _selected_rows(
    audit: dict[str, Any], *, families: set[str], classes: set[str],
    start_index: int, max_candidates: int | None,
) -> list[dict[str, Any]]:
    selection = audit.get("candidateSelection", {})
    rows = selection.get("candidateRows", []) if isinstance(selection, dict) else []
    if not isinstance(rows, list):
        raise CandidateVerificationError("audit candidateSelection.candidateRows must be a list")
    selected: list[dict[str, Any]] = []
    for value in rows:
        if not isinstance(value, dict):
            raise CandidateVerificationError("candidate row must be an object")
        row_families = {str(item) for item in value.get("familyNames", [])}
        row_classes = {str(item) for item in value.get("classNames", [])}
        if families and not (families & row_families):
            continue
        if classes and not (classes & row_classes):
            continue
        selected.append(value)
    stop = start_index + max_candidates if max_candidates is not None else None
    return selected[start_index:stop]


def verify_candidates(
    audit: dict[str, Any], *, fixtures: dict[str, dict[str, Any]] | None = None,
    families: set[str] | None = None, classes: set[str] | None = None,
    start_index: int = 0, max_candidates: int | None = None, timeout: int = 20,
    user_agent: str = DEFAULT_USER_AGENT, retries: int = 2,
    retry_delay_seconds: float = 1.0, between_request_delay_seconds: float = 0.0,
) -> dict[str, Any]:
    if audit.get("source", {}).get("pixelsDownloaded") is not False:
        raise CandidateVerificationError("input must explicitly state source.pixelsDownloaded=false")
    if max_candidates is not None and max_candidates <= 0:
        raise ValueError("max_candidates must be positive when supplied")
    if start_index < 0:
        raise ValueError("start_index must be non-negative")
    if retries < 0 or retry_delay_seconds < 0 or between_request_delay_seconds < 0:
        raise ValueError("retry and delay values must be non-negative")
    family_filter = set(families or ())
    class_filter = set(classes or ())
    rows = _selected_rows(
        audit, families=family_filter, classes=class_filter,
        start_index=start_index, max_candidates=max_candidates,
    )
    records: list[dict[str, Any]] = []
    fixture_map = fixtures or {}
    for index, row in enumerate(rows):
        landing_url = str(row.get("OriginalLandingURL", "")).strip()
        parsed = urlparse(landing_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            response = LandingResponse(0, landing_url, "", None, False, "invalid landing URL")
        elif landing_url in fixture_map:
            response = _fixture_response(landing_url, fixture_map[landing_url])
        elif fixtures is not None:
            response = LandingResponse(0, landing_url, "", None, False, "fixture missing")
        else:
            response = _fetch_landing_page(
                landing_url,
                timeout=timeout,
                user_agent=user_agent,
                retries=retries,
                retry_delay_seconds=retry_delay_seconds,
            )
        records.append(_classify(row, response))
        if fixtures is None and between_request_delay_seconds and index + 1 < len(rows):
            time.sleep(between_request_delay_seconds)
    counts = Counter(record["status"] for record in records)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDataset": audit.get("source", {}).get("dataset"),
        "candidateCount": len(records),
        "filters": {"families": sorted(family_filter), "classes": sorted(class_filter)},
        "candidateWindow": {"startIndex": start_index, "maxCandidates": max_candidates},
        "fixtureMode": fixtures is not None,
        "pixelsDownloaded": False,
        "landingPageBodiesOnly": True,
        "counts": {name: counts.get(name, 0) for name in ("verified", "rejected", "manual_review")},
        "verifiedImageIds": sorted(
            record["ImageID"] for record in records if record["status"] == "verified"
        ),
        "records": records,
    }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--response-fixtures", type=Path)
    parser.add_argument("--family", action="append", default=[])
    parser.add_argument("--class-name", action="append", default=[])
    parser.add_argument("--max-candidates", type=int)
    parser.add_argument("--start-index", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--retry-delay-seconds", type=float, default=1.0)
    parser.add_argument("--between-request-delay-seconds", type=float, default=0.25)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    audit_path = args.audit.resolve()
    output_path = args.output.resolve()
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    fixtures: dict[str, dict[str, Any]] | None = None
    if args.response_fixtures:
        fixture_payload = json.loads(args.response_fixtures.read_text(encoding="utf-8"))
        fixtures = fixture_payload.get("responses", fixture_payload)
        if not isinstance(fixtures, dict):
            raise CandidateVerificationError("response fixtures must be an object or contain responses")
    result = verify_candidates(
        audit,
        fixtures=fixtures,
        families=set(args.family),
        classes=set(args.class_name),
        start_index=args.start_index,
        max_candidates=args.max_candidates,
        timeout=args.timeout,
        retries=args.retries,
        retry_delay_seconds=args.retry_delay_seconds,
        between_request_delay_seconds=args.between_request_delay_seconds,
    )
    result["inputAudit"] = str(audit_path)
    _atomic_write_json(output_path, result)
    print(json.dumps({
        "output": str(output_path),
        "candidateCount": result["candidateCount"],
        "counts": result["counts"],
        "pixelsDownloaded": result["pixelsDownloaded"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
