"""Discover public bin/waste dataset records through official metadata APIs only.

This tool is deliberately a candidate ledger, not a dataset downloader.  It
queries official JSON APIs from Zenodo, Figshare, DataCite (including the
Mendeley Data DOI prefix), and Hugging Face.  It never opens a file download
URL, never downloads an archive, and never counts a record as sufficient from a
title alone.

Description-derived numbers are marked ``claimed``.  A ``verified`` sample
count is emitted only when the repository exposes an explicit structured count
(currently Hugging Face split ``num_examples`` metadata).  These statuses are
evidence labels, not legal or dataset-readiness approvals.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/public-bin-dataset-candidate-ledger.json"
DEFAULT_USER_AGENT = "LitterSpot/1.0 (public bin dataset metadata discovery)"

SEARCH_TERMS = (
    "garbage bin detection",
    "trash bin detection",
    "waste bin detection",
    "garbage bin",
    "trash bin",
    "waste bin",
    "waste container",
    "litter bin",
    "wheelie bin",
    "open-top bin",
    "open top bin",
    "waste basket",
    "garbage bin overflow",
    "garbage bin fullness",
    "trash bin overflow",
    "trash bin fullness",
    "waste bin overflow",
    "waste bin fullness",
    "trash can",
    "garbage can",
    "waste detection",
    "litter detection",
)

API_ENDPOINTS = {
    "zenodo": "https://zenodo.org/api/records",
    "figshare": "https://api.figshare.com/v2/articles",
    "figshareSearch": "https://api.figshare.com/v2/articles/search",
    "datacite": "https://api.datacite.org/dois",
    "huggingface": "https://huggingface.co/api/datasets",
}

RETRYABLE_STATUS = {429, 503}
MAX_RETRIES = 3
MAX_RETRY_AFTER_SECONDS = 60.0
MENDELEY_DOI_PREFIX = "10.17632/"
# Keep the misspelled name as a compatibility alias for callers of the first
# draft of this script.
MENDEDLEY_DOI_PREFIX = MENDELEY_DOI_PREFIX

COUNT_RE = re.compile(
    r"(?<![\w.])(?P<number>\d+(?:,\d{3})*(?:\.\d+)?)\s*"
    r"(?P<multiplier>[kKmM])?\s*"
    r"(?P<unit>image pairs?|images?|frames?|samples?|instances?|objects?|"
    r"boxes?|annotations?|videos?|sequences?|masks?|crops?|photos?)\b",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")
TITLE_KEY_RE = re.compile(r"[^a-z0-9]+")
ANNOTATION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("COCO", re.compile(r"\bCOCO(?:[- ]format| annotations?)?\b", re.IGNORECASE)),
    ("YOLO", re.compile(r"\bYOLO(?:v[5689]| format| labels?)?\b", re.IGNORECASE)),
    ("Pascal VOC", re.compile(r"\bPascal\s+VOC\b", re.IGNORECASE)),
    ("bounding boxes", re.compile(r"\bbounding\s*boxes?\b|\bbox annotations?\b", re.IGNORECASE)),
    ("segmentation masks", re.compile(r"\b(?:instance\s+)?segmentation\s+masks?\b|\bmask annotations?\b", re.IGNORECASE)),
    ("classification labels", re.compile(r"\bclassification labels?\b|\bimage-level labels?\b", re.IGNORECASE)),
    ("CSV", re.compile(r"\.csv\b|\bCSV\b", re.IGNORECASE)),
    ("JSON", re.compile(r"\.json\b|\bJSON\b", re.IGNORECASE)),
    ("XML", re.compile(r"\.xml\b|\bXML\b", re.IGNORECASE)),
)


class DiscoveryError(RuntimeError):
    """Raised for an unrecoverable API/schema response."""


def _strip_markup(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = TAG_RE.sub(" ", text)
    return WHITESPACE_RE.sub(" ", text).strip()


def _normalise_title(value: Any) -> str:
    return TITLE_KEY_RE.sub("", _strip_markup(value).casefold())


def _normalise_doi(value: Any) -> str:
    raw = str(value or "").strip().casefold()
    raw = re.sub(r"^https?://(dx\.)?doi\.org/", "", raw)
    return raw.rstrip("/ ")


def _parse_number(value: str) -> int | float:
    compact = value.replace(",", "")
    if "." in compact:
        return float(compact)
    return int(compact)


def _parse_claimed_number(value: str, multiplier: str | None) -> int | float:
    number = _parse_number(value)
    if multiplier:
        number *= 1_000 if multiplier.casefold() == "k" else 1_000_000
    if isinstance(number, float) and number.is_integer():
        return int(number)
    return number


def extract_description_counts(text: str, *, evidence_source: str = "description") -> list[dict[str, Any]]:
    """Extract human-readable count claims without treating them as verified."""
    claims: list[dict[str, Any]] = []
    for match in COUNT_RE.finditer(_strip_markup(text)):
        claims.append({
            "value": _parse_claimed_number(match.group("number"), match.group("multiplier")),
            "unit": match.group("unit").casefold(),
            "evidenceSource": evidence_source,
            "verification": "claimed",
            "evidenceText": match.group(0),
        })
    return claims


def extract_annotation_formats(text: str, file_names: list[str]) -> list[str]:
    corpus = f"{_strip_markup(text)} {' '.join(file_names)}"
    formats = {name for name, pattern in ANNOTATION_PATTERNS if pattern.search(corpus)}
    return sorted(formats)


def _retry_after_seconds(error: HTTPError) -> float | None:
    value = error.headers.get("Retry-After") if error.headers is not None else None
    if not value:
        return None
    try:
        return max(0.0, min(MAX_RETRY_AFTER_SECONDS, float(value)))
    except (TypeError, ValueError):
        return None


def fetch_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_payload: dict[str, Any] | None = None,
    user_agent: str = DEFAULT_USER_AGENT,
    timeout: int = 60,
) -> dict[str, Any] | list[Any]:
    query = urlencode({key: value for key, value in (params or {}).items() if value is not None})
    request_url = f"{url}?{query}" if query else url
    body = json.dumps(json_payload).encode("utf-8") if json_payload is not None else None
    headers = {"User-Agent": user_agent, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(request_url, data=body, headers=headers, method="POST" if body is not None else "GET")
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            if not isinstance(payload, (dict, list)):
                raise DiscoveryError(f"Expected JSON object/list from {request_url}")
            return payload
        except HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_STATUS or attempt >= MAX_RETRIES:
                raise DiscoveryError(f"API request failed after {attempt + 1} attempt(s): HTTP {error.code} {request_url}") from error
            time.sleep(_retry_after_seconds(error) or min(2 ** attempt, 30.0))
        except (URLError, TimeoutError, OSError) as error:
            last_error = error
            if attempt >= MAX_RETRIES:
                raise DiscoveryError(f"API request failed after {attempt + 1} attempt(s): {request_url}: {error}") from error
            time.sleep(min(2 ** attempt, 30.0))
    raise DiscoveryError(f"API request failed: {request_url}: {last_error}") from last_error


def _zenodo_hits(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    hits = payload.get("hits", {}).get("hits", []) if isinstance(payload, dict) else []
    return [hit for hit in hits if isinstance(hit, dict)]


def _figshare_hits(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [hit for hit in payload if isinstance(hit, dict)]
    hits = payload.get("results", [])
    return [hit for hit in hits if isinstance(hit, dict)]


def _datacite_hits(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    data = payload.get("data", []) if isinstance(payload, dict) else []
    return [hit for hit in data if isinstance(hit, dict)]


def _hf_hits(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    return [hit for hit in payload if isinstance(hit, dict)] if isinstance(payload, list) else []


def _license_value(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        # Zenodo/Figshare use id/name/url while DataCite rights entries use
        # rightsIdentifier/rights/rightsUri. Preserve the declaration rather
        # than trying to resolve or approve a licence.
        return {
            "id": str(value.get("id", value.get("value", value.get("rightsIdentifier", "")))).strip(),
            "name": str(value.get("name", value.get("title", value.get("rights", "")))).strip(),
            "url": str(value.get("url", value.get("rightsUri", value.get("uri", "")))).strip(),
        }
    if isinstance(value, list):
        # A few APIs expose a list of SPDX identifiers or rights strings.
        values = [str(item).strip() for item in value if str(item).strip()]
        return {"id": values[0] if values else "", "name": "", "url": "", "all": values}
    return {"id": str(value or "").strip(), "name": "", "url": ""}


def _zenodo_files(record: dict[str, Any]) -> list[dict[str, Any]]:
    files = record.get("files", [])
    if isinstance(files, dict):
        files = [files]
    normalized: list[dict[str, Any]] = []
    for file in files if isinstance(files, list) else []:
        if not isinstance(file, dict):
            continue
        links = file.get("links", {}) if isinstance(file.get("links"), dict) else {}
        normalized.append({
            "name": str(file.get("key", file.get("name", ""))).strip(),
            "sizeBytes": file.get("size") if isinstance(file.get("size"), int) else None,
            "checksum": str(file.get("checksum", "")).strip(),
            "downloadUrl": str(links.get("self", file.get("download", ""))).strip(),
        })
    return sorted(normalized, key=lambda item: item["name"])


def _figshare_files(record: dict[str, Any]) -> list[dict[str, Any]]:
    files = record.get("files", [])
    normalized: list[dict[str, Any]] = []
    for file in files if isinstance(files, list) else []:
        if not isinstance(file, dict):
            continue
        normalized.append({
            "name": str(file.get("name", "")).strip(),
            "sizeBytes": file.get("size") if isinstance(file.get("size"), int) else None,
            "checksum": str(file.get("md5", "")).strip(),
            "downloadUrl": str(file.get("download_url", "")).strip(),
        })
    return sorted(normalized, key=lambda item: item["name"])


def _datacite_files(attributes: dict[str, Any]) -> list[dict[str, Any]]:
    sizes = attributes.get("sizes", [])
    formats = attributes.get("formats", [])
    values: list[dict[str, Any]] = []
    for value in sizes if isinstance(sizes, list) else []:
        values.append({"name": "", "sizeBytes": None, "sizeText": str(value), "checksum": "", "downloadUrl": ""})
    for value in formats if isinstance(formats, list) else []:
        if value in sizes:
            continue
        values.append({"name": "", "sizeBytes": None, "sizeText": "", "format": str(value), "checksum": "", "downloadUrl": ""})
    return values


def _hf_files(record: dict[str, Any]) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    revision = str(record.get("sha", "")).strip()
    dataset_id = str(record.get("id", "")).strip()
    for sibling in record.get("siblings", []) if isinstance(record.get("siblings"), list) else []:
        if not isinstance(sibling, dict):
            continue
        name = str(sibling.get("rfilename", "")).strip()
        values.append({
            "name": name,
            "sizeBytes": sibling.get("size") if isinstance(sibling.get("size"), int) else None,
            "checksum": str((sibling.get("lfs") or {}).get("oid", "")) if isinstance(sibling.get("lfs"), dict) else "",
            "downloadUrl": f"https://huggingface.co/datasets/{quote(dataset_id, safe='/')}/resolve/{revision}/{quote(name, safe='/')}" if name and revision else "",
        })
    return sorted(values, key=lambda item: item["name"])


def _structured_counts(provider: str, record: dict[str, Any]) -> list[dict[str, Any]]:
    if provider != "huggingface":
        return []
    info = record.get("dataset_info")
    if not isinstance(info, dict):
        return []
    splits = info.get("splits", {})
    counts: list[dict[str, Any]] = []
    if isinstance(splits, dict):
        for split_name, split_info in sorted(splits.items()):
            if isinstance(split_info, dict) and isinstance(split_info.get("num_examples"), int):
                counts.append({
                    "value": split_info["num_examples"],
                    "unit": "examples",
                    "split": str(split_name),
                    "evidenceSource": "structured_api.dataset_info.splits.num_examples",
                    "verification": "verified",
                })
    return counts


def _description_claims(title: str, description: str, files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    claims = extract_description_counts(title, evidence_source="title")
    claims.extend(extract_description_counts(description, evidence_source="description"))
    return claims


def _contains_phrase(text: str, phrase: str) -> bool:
    """Match a phrase while treating hyphen/space punctuation as equivalent."""
    normalized_text = re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
    normalized_phrase = re.sub(r"[^a-z0-9]+", " ", phrase.casefold()).strip()
    return bool(normalized_phrase) and normalized_phrase in normalized_text


def _text_relevance(title: str, description: str, files: list[dict[str, Any]], term: str) -> dict[str, Any]:
    title_match = _contains_phrase(title, term)
    description_match = _contains_phrase(description, term)
    file_match = any(_contains_phrase(str(file.get("name", "")), term) for file in files)
    annotation_evidence = bool(extract_annotation_formats(description, [str(file.get("name", "")) for file in files]))
    return {
        "queryTerm": term,
        "titleMatch": title_match,
        "descriptionMatch": description_match,
        "fileNameMatch": file_match,
        "annotationEvidence": annotation_evidence,
        "titleOnly": title_match and not description_match and not file_match,
        "hasNonTitleEvidence": description_match or file_match or annotation_evidence,
        "countsTowardSufficiency": bool(annotation_evidence and (description_match or file_match)),
    }


def _base_record(
    *,
    provider: str,
    record_url: str,
    doi: str,
    title: str,
    description: str,
    license_info: dict[str, Any],
    files: list[dict[str, Any]],
    search_terms: list[str],
    source_api_url: str,
    structured_counts: list[dict[str, Any]] | None = None,
    upstream_traceable: bool = True,
    upstream_evidence: list[str] | None = None,
    upstream_references: list[str] | None = None,
) -> dict[str, Any]:
    description = _strip_markup(description)
    title = _strip_markup(title)
    relevance = [_text_relevance(title, description, files, term) for term in sorted(set(search_terms))]
    all_claims = _description_claims(title, description, files)
    structured = structured_counts or []
    counts = structured + all_claims
    return {
        "provider": provider,
        "recordUrl": record_url,
        "doi": doi or None,
        "title": title,
        "descriptionExcerpt": description[:1000],
        "declaredLicense": license_info,
        "files": files,
        "descriptionDerivedSampleCounts": counts,
        "sampleCountVerification": "verified" if structured else ("claimed" if all_claims else "none"),
        "annotationFormats": extract_annotation_formats(description, [str(file.get("name", "")) for file in files]),
        "searchEvidence": relevance,
        "sufficiencyFromTitleOnly": False,
        "countsTowardSufficiency": any(item["countsTowardSufficiency"] for item in relevance),
        "upstreamTraceable": upstream_traceable,
        "upstreamEvidence": upstream_evidence or [],
        "upstreamReferences": upstream_references or [],
        "sourceApiUrl": source_api_url,
        "metadataOnly": True,
        "archivesDownloaded": False,
        "pixelsDownloaded": False,
        "searchTerms": sorted(set(search_terms)),
    }


def _has_query_evidence(record: dict[str, Any]) -> bool:
    """Reject repository search noise while retaining title-only leads."""
    return any(
        bool(evidence.get("titleMatch") or evidence.get("descriptionMatch") or evidence.get("fileNameMatch"))
        for evidence in record.get("searchEvidence", [])
        if isinstance(evidence, dict)
    )


def _zenodo_record(hit: dict[str, Any], term: str) -> dict[str, Any]:
    metadata = hit.get("metadata", {}) if isinstance(hit.get("metadata"), dict) else {}
    links = hit.get("links", {}) if isinstance(hit.get("links"), dict) else {}
    return _base_record(
        provider="zenodo",
        record_url=str(links.get("self_html", f"https://zenodo.org/records/{hit.get('id', '')}")),
        doi=_normalise_doi(hit.get("doi", metadata.get("doi", ""))),
        title=str(metadata.get("title", hit.get("title", ""))),
        description=str(metadata.get("description", "")),
        license_info=_license_value(metadata.get("license")),
        files=_zenodo_files(hit),
        search_terms=[term],
        source_api_url=API_ENDPOINTS["zenodo"],
    )


def _figshare_record(record: dict[str, Any], term: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    item = detail or record
    license_value = item.get("license", item.get("licence", ""))
    if isinstance(license_value, int):
        license_value = {"id": str(license_value), "name": "Figshare numeric licence id"}
    return _base_record(
        provider="figshare",
        record_url=str(item.get("url_public_html", record.get("url_public_html", f"https://figshare.com/articles/{item.get('id', '')}"))),
        doi=_normalise_doi(item.get("doi", record.get("doi", ""))),
        title=str(item.get("title", record.get("title", ""))),
        description=str(item.get("description", "")),
        license_info=_license_value(license_value),
        files=_figshare_files(item),
        search_terms=[term],
        source_api_url=API_ENDPOINTS["figshare"],
    )


def _datacite_record(item: dict[str, Any], term: str) -> dict[str, Any]:
    attributes = item.get("attributes", {}) if isinstance(item.get("attributes"), dict) else {}
    titles = attributes.get("titles", [])
    title = titles[0].get("title", "") if titles and isinstance(titles[0], dict) else ""
    descriptions = attributes.get("descriptions", [])
    description = " ".join(
        str(value.get("description", ""))
        for value in descriptions
        if isinstance(value, dict) and value.get("description")
    )
    rights = attributes.get("rightsList", [])
    license_value = rights[0] if rights and isinstance(rights[0], dict) else (rights[0] if rights else {})
    doi = _normalise_doi(attributes.get("doi", item.get("id", "")))
    return _base_record(
        provider="datacite_mendeley",
        record_url=str(attributes.get("url", f"https://doi.org/{doi}")),
        doi=doi,
        title=str(title),
        description=str(description),
        license_info=_license_value(license_value),
        files=_datacite_files(attributes),
        search_terms=[term],
        source_api_url=API_ENDPOINTS["datacite"],
        structured_counts=[],
        upstream_traceable=True,
        upstream_evidence=["DataCite DOI metadata", "Mendeley Data DOI prefix 10.17632"],
    )


def _hf_record(summary: dict[str, Any], detail: dict[str, Any], term: str) -> dict[str, Any] | None:
    card = detail.get("cardData", {}) if isinstance(detail.get("cardData"), dict) else {}
    tags = detail.get("tags", summary.get("tags", []))
    tag_license = next((str(tag).split(":", 1)[1] for tag in tags if str(tag).startswith("license:")), "")
    license_value = card.get("license", tag_license)
    source_datasets = card.get("source_datasets", [])
    homepage = str(card.get("homepage", "")).strip()
    # A dataset name alone is not provenance. Keep HF records only when the
    # card exposes a source dataset reference or an actual HTTP(S) homepage
    # that can be followed later by a human reviewer. This lane never follows
    # either reference.
    source_refs = [str(value).strip() for value in (source_datasets if isinstance(source_datasets, list) else [source_datasets]) if str(value).strip()]
    parsed_homepage = urlparse(homepage)
    homepage_is_traceable = parsed_homepage.scheme in {"http", "https"} and bool(parsed_homepage.netloc)
    upstream_traceable = bool(source_refs or homepage_is_traceable)
    if not upstream_traceable or not license_value:
        return None
    description = str(card.get("description", card.get("dataset_name", "")))
    upstream_evidence = []
    if source_refs:
        upstream_evidence.append("cardData.source_datasets")
    if homepage_is_traceable:
        upstream_evidence.append("cardData.homepage")
    return _base_record(
        provider="huggingface",
        record_url=f"https://huggingface.co/datasets/{summary.get('id', detail.get('id', ''))}",
        doi="",
        title=str(summary.get("id", detail.get("id", ""))),
        description=description,
        license_info=_license_value(license_value),
        files=_hf_files(detail),
        search_terms=[term],
        source_api_url=API_ENDPOINTS["huggingface"],
        structured_counts=_structured_counts("huggingface", detail),
        upstream_traceable=True,
        upstream_evidence=upstream_evidence,
        upstream_references=source_refs + ([homepage] if homepage_is_traceable else []),
    )


def _non_empty(value: Any) -> bool:
    return value is not None and value != "" and value != [] and value != {}


def _unique_dicts(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    for value in values:
        if value not in unique:
            unique.append(value)
    return unique


def _merge_records(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Merge metadata mirrors without allowing a weak hit to erase evidence."""
    merged = dict(existing)
    for field in ("doi", "title", "descriptionExcerpt", "declaredLicense", "files", "recordUrl", "sourceApiUrl"):
        if not _non_empty(merged.get(field)) and _non_empty(incoming.get(field)):
            merged[field] = incoming[field]

    merged["searchTerms"] = sorted(set(existing.get("searchTerms", [])) | set(incoming.get("searchTerms", [])))
    merged["recordUrls"] = sorted({value for value in (
        *existing.get("recordUrls", [existing.get("recordUrl", "")]),
        incoming.get("recordUrl", ""),
        *incoming.get("recordUrls", []),
    ) if value})
    merged["sourceApis"] = sorted({value for value in (
        *existing.get("sourceApis", [existing.get("sourceApiUrl", "")]),
        incoming.get("sourceApiUrl", ""),
        *incoming.get("sourceApis", []),
    ) if value})
    merged["duplicateProviders"] = sorted({value for value in (
        *existing.get("duplicateProviders", [existing.get("provider", "")]),
        incoming.get("provider", ""),
        *incoming.get("duplicateProviders", []),
    ) if value})
    merged["searchEvidence"] = _unique_dicts([
        *existing.get("searchEvidence", []),
        *incoming.get("searchEvidence", []),
    ])
    merged["files"] = _unique_dicts([
        *existing.get("files", []),
        *incoming.get("files", []),
    ])
    merged["descriptionDerivedSampleCounts"] = _unique_dicts([
        *existing.get("descriptionDerivedSampleCounts", []),
        *incoming.get("descriptionDerivedSampleCounts", []),
    ])
    merged["annotationFormats"] = sorted(set(existing.get("annotationFormats", [])) | set(incoming.get("annotationFormats", [])))
    merged["countsTowardSufficiency"] = bool(existing.get("countsTowardSufficiency") or incoming.get("countsTowardSufficiency"))
    merged["upstreamTraceable"] = bool(existing.get("upstreamTraceable", True) and incoming.get("upstreamTraceable", True))
    merged["upstreamEvidence"] = sorted(set(existing.get("upstreamEvidence", [])) | set(incoming.get("upstreamEvidence", [])))
    merged["upstreamReferences"] = sorted(set(existing.get("upstreamReferences", [])) | set(incoming.get("upstreamReferences", [])))
    verification_rank = {"none": 0, "claimed": 1, "verified": 2}
    statuses = (existing.get("sampleCountVerification", "none"), incoming.get("sampleCountVerification", "none"))
    merged["sampleCountVerification"] = max(statuses, key=lambda value: verification_rank.get(value, -1))
    # These are invariant safety markers; keep them false even if a future
    # provider adapter supplies a download link in its metadata response.
    merged["metadataOnly"] = True
    merged["archivesDownloaded"] = False
    merged["pixelsDownloaded"] = False
    return merged


def deduplicate_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Union records by either identifier. This handles a title-only result
    # arriving before a DOI-bearing mirror without losing the DOI, and also
    # merges a DOI match and title match that point at the same work.
    parent = list(range(len(records)))
    doi_group: dict[str, int] = {}
    title_group: dict[str, int] = {}

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> int:
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            return left_root
        parent[right_root] = left_root
        return left_root

    for index, record in enumerate(records):
        doi = _normalise_doi(record.get("doi", ""))
        title = _normalise_title(record.get("title", ""))
        if not doi and not title:
            continue
        groups: list[int] = []
        if doi and doi in doi_group:
            groups.append(doi_group[doi])
        title_match = title_group.get(title)
        if title_match is not None and title_match not in groups:
            # A normalized title is only a fallback identity. Never collapse
            # two records that each carry different DOI identities merely
            # because their titles happen to be equal.
            has_conflicting_doi = doi and any(
                other_doi and other_doi != doi
                for other_index, other in enumerate(records)
                if find(other_index) == find(title_match)
                for other_doi in [_normalise_doi(other.get("doi", ""))]
            )
            if not has_conflicting_doi:
                groups.append(title_match)
        group = union(index, groups[0]) if groups else index
        for other in groups[1:]:
            group = union(group, other)
        if doi:
            doi_group[doi] = group
        if title and title not in title_group:
            title_group[title] = group
        elif title and title_group[title] == group:
            title_group[title] = group

    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for index, record in enumerate(records):
        # Records with blank identity are intentionally excluded below.
        doi = _normalise_doi(record.get("doi", ""))
        title = _normalise_title(record.get("title", ""))
        if doi or title:
            grouped[find(index)].append(record)

    deduplicated: list[dict[str, Any]] = []
    for group_records in grouped.values():
        item = dict(group_records[0])
        item["searchTerms"] = sorted(set(item.get("searchTerms", [])))
        item["recordUrls"] = [item.get("recordUrl", "")] if item.get("recordUrl") else []
        item["sourceApis"] = [item.get("sourceApiUrl", "")] if item.get("sourceApiUrl") else []
        item["duplicateProviders"] = [item.get("provider", "")] if item.get("provider") else []
        for incoming in group_records[1:]:
            item = _merge_records(item, incoming)
        doi = _normalise_doi(item.get("doi", ""))
        title = _normalise_title(item.get("title", ""))
        item["doi"] = doi or None
        item["dedupeKey"] = f"doi:{doi}" if doi else f"title:{title}"
        deduplicated.append(item)
    return sorted(deduplicated, key=lambda item: (str(item.get("title", "")).casefold(), str(item.get("doi", "")), str(item.get("provider", ""))))


def discover(
    *,
    terms: tuple[str, ...] = SEARCH_TERMS,
    providers: tuple[str, ...] = ("zenodo", "figshare", "datacite", "huggingface"),
    max_results_per_term: int = 10,
    max_detail_records: int = 60,
    user_agent: str = DEFAULT_USER_AGENT,
) -> dict[str, Any]:
    if max_results_per_term < 1 or max_detail_records < 0:
        raise ValueError("max_results_per_term must be positive and max_detail_records non-negative")
    records: list[dict[str, Any]] = []
    api_failures: list[dict[str, str]] = []
    query_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"queries": 0, "hits": 0, "recordsKept": 0, "detailsFetched": 0, "excludedUntraceable": 0, "excludedIrrelevant": 0})
    detail_count: dict[str, int] = defaultdict(int)

    for provider in providers:
        if provider not in API_ENDPOINTS:
            raise ValueError(f"unknown provider: {provider}")
        for term in terms:
            query_stats[provider]["queries"] += 1
            try:
                if provider == "zenodo":
                    payload = fetch_json(API_ENDPOINTS[provider], params={"q": term, "size": max_results_per_term, "page": 1, "sort": "bestmatch"}, user_agent=user_agent)
                    hits = _zenodo_hits(payload)
                    query_stats[provider]["hits"] += len(hits)
                    for hit in hits:
                        item = _zenodo_record(hit, term)
                        if _has_query_evidence(item):
                            records.append(item)
                            query_stats[provider]["recordsKept"] += 1
                        else:
                            query_stats[provider]["excludedIrrelevant"] += 1
                elif provider == "figshare":
                    payload = fetch_json(
                        API_ENDPOINTS["figshareSearch"],
                        json_payload={
                            "search_for": term,
                            "page_size": max_results_per_term,
                            "page": 1,
                            "order": "published_date",
                            "order_direction": "desc",
                        },
                        user_agent=user_agent,
                    )
                    hits = _figshare_hits(payload)
                    query_stats[provider]["hits"] += len(hits)
                    for hit in hits:
                        detail = None
                        article_id = hit.get("id")
                        if article_id is not None and detail_count[provider] < max_detail_records:
                            try:
                                detail = fetch_json(f"{API_ENDPOINTS[provider]}/{article_id}", user_agent=user_agent)
                                if isinstance(detail, dict):
                                    detail_count[provider] += 1
                                    query_stats[provider]["detailsFetched"] += 1
                            except DiscoveryError as error:
                                api_failures.append({"provider": provider, "term": term, "url": f"{API_ENDPOINTS[provider]}/{article_id}", "error": str(error)})
                        item = _figshare_record(hit, term, detail if isinstance(detail, dict) else None)
                        if _has_query_evidence(item):
                            records.append(item)
                            query_stats[provider]["recordsKept"] += 1
                        else:
                            query_stats[provider]["excludedIrrelevant"] += 1
                elif provider == "datacite":
                    payload = fetch_json(API_ENDPOINTS[provider], params={"query": term, "page[size]": max_results_per_term, "page[number]": 1, "sort": "relevance", "prefix": MENDELEY_DOI_PREFIX.rstrip("/")}, user_agent=user_agent)
                    hits = _datacite_hits(payload)
                    query_stats[provider]["hits"] += len(hits)
                    for hit in hits:
                        attributes = hit.get("attributes", {}) if isinstance(hit.get("attributes"), dict) else {}
                        doi = _normalise_doi(attributes.get("doi", hit.get("id", "")))
                        publisher = str(attributes.get("publisher", "")).casefold()
                        if doi.startswith(MENDELEY_DOI_PREFIX) or "mendeley" in publisher:
                            item = _datacite_record(hit, term)
                            if _has_query_evidence(item):
                                records.append(item)
                                query_stats[provider]["recordsKept"] += 1
                            else:
                                query_stats[provider]["excludedIrrelevant"] += 1
                        else:
                            query_stats[provider]["excludedUntraceable"] += 1
                else:
                    payload = fetch_json(API_ENDPOINTS[provider], params={"search": term, "limit": max_results_per_term}, user_agent=user_agent)
                    hits = _hf_hits(payload)
                    query_stats[provider]["hits"] += len(hits)
                    for hit in hits:
                        dataset_id = str(hit.get("id", "")).strip()
                        if not dataset_id or detail_count[provider] >= max_detail_records:
                            continue
                        try:
                            detail = fetch_json(f"{API_ENDPOINTS[provider]}/{quote(dataset_id, safe='/')}", user_agent=user_agent)
                            detail_count[provider] += 1
                            query_stats[provider]["detailsFetched"] += 1
                        except DiscoveryError as error:
                            api_failures.append({"provider": provider, "term": term, "url": f"{API_ENDPOINTS[provider]}/{dataset_id}", "error": str(error)})
                            continue
                        item = _hf_record(hit, detail if isinstance(detail, dict) else {}, term)
                        if item is None:
                            query_stats[provider]["excludedUntraceable"] += 1
                            continue
                        if _has_query_evidence(item):
                            records.append(item)
                            query_stats[provider]["recordsKept"] += 1
                        else:
                            query_stats[provider]["excludedIrrelevant"] += 1
            except DiscoveryError as error:
                api_failures.append({"provider": provider, "term": term, "url": API_ENDPOINTS[provider], "error": str(error)})

    unique_records = deduplicate_records(records)
    for item in unique_records:
        item.setdefault("searchTerms", [])
        item.setdefault("recordUrls", [item.get("recordUrl", "")])
        item.setdefault("sourceApis", [item.get("sourceApiUrl", "")])
        item.setdefault("duplicateProviders", [item.get("provider", "")])
        item["recordCountedAsSufficient"] = False
        item["sufficiencyReason"] = "Candidate discovery metadata is not a sufficiency proof; title-only evidence is never enough and description counts remain claims."
    verification_summary = {
        "candidateRecords": len(unique_records),
        "recordsWithVerifiedCounts": sum(item.get("sampleCountVerification") == "verified" for item in unique_records),
        "recordsWithClaimedCounts": sum(item.get("sampleCountVerification") == "claimed" for item in unique_records),
        "countClaimsByVerification": {
            "verified": sum(
                count.get("verification") == "verified"
                for item in unique_records
                for count in item.get("descriptionDerivedSampleCounts", [])
            ),
            "claimed": sum(
                count.get("verification") == "claimed"
                for item in unique_records
                for count in item.get("descriptionDerivedSampleCounts", [])
            ),
        },
    }
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "searchTerms": list(terms),
        "providers": list(providers),
        "apiEndpoints": API_ENDPOINTS,
        "constraints": {
            "metadataOnly": True,
            "archivesDownloaded": False,
            "pixelsDownloaded": False,
            "titleAloneCannotEstablishSufficiency": True,
            "descriptionCountsDefaultToClaimed": True,
            "deduplication": "DOI first, normalized title fallback",
        },
        "queryStats": {provider: dict(stats) for provider, stats in sorted(query_stats.items())},
        "apiFailures": api_failures,
        "candidateCount": len(unique_records),
        "verificationSummary": verification_summary,
        "candidates": unique_records,
    }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-results-per-term", type=int, default=10)
    parser.add_argument("--max-detail-records", type=int, default=60)
    parser.add_argument("--providers", default=",".join(("zenodo", "figshare", "datacite", "huggingface")))
    args = parser.parse_args()
    try:
        report = discover(
            providers=tuple(item.strip() for item in args.providers.split(",") if item.strip()),
            max_results_per_term=args.max_results_per_term,
            max_detail_records=args.max_detail_records,
        )
    except (OSError, ValueError, DiscoveryError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    output = args.output.resolve()
    _atomic_write_json(output, report)
    print(json.dumps({
        "output": str(output),
        "candidateCount": report["candidateCount"],
        "apiFailures": len(report["apiFailures"]),
        "queryStats": report["queryStats"],
        "metadataOnly": report["constraints"]["metadataOnly"],
        "archivesDownloaded": report["constraints"]["archivesDownloaded"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
