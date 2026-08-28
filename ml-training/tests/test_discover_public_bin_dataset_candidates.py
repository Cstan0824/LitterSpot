from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from urllib.error import HTTPError

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import discover_public_bin_dataset_candidates as discover  # noqa: E402


def test_description_counts_are_claimed_and_support_unformatted_thousands() -> None:
    claims = discover.extract_description_counts(
        "The release contains 1200 images, 1,200 boxes, and 12 image pairs."
    )

    assert [(item["value"], item["unit"], item["verification"]) for item in claims] == [
        (1200, "images", "claimed"),
        (1200, "boxes", "claimed"),
        (12, "image pairs", "claimed"),
    ]


def test_search_terms_cover_requested_bin_detection_and_state_variants() -> None:
    required = {
        "garbage bin detection",
        "trash bin detection",
        "waste bin detection",
        "waste container",
        "litter bin",
        "wheelie bin",
        "open-top bin",
        "waste basket",
        "garbage bin overflow",
        "garbage bin fullness",
    }

    assert required <= set(discover.SEARCH_TERMS)
    assert len(discover.SEARCH_TERMS) == len(set(discover.SEARCH_TERMS))


def test_short_count_suffixes_are_claimed_and_hyphenated_terms_match() -> None:
    claims = discover.extract_description_counts("The card reports 1.5k images and 2M boxes.")
    assert [(item["value"], item["unit"], item["verification"]) for item in claims] == [
        (1500, "images", "claimed"),
        (2_000_000, "boxes", "claimed"),
    ]

    relevance = discover._text_relevance(
        "Open top bin dataset",
        "An open-top bin image collection",
        [],
        "open-top bin",
    )
    assert relevance["titleMatch"] is True
    assert relevance["descriptionMatch"] is True


def test_huggingface_requires_traceable_source_and_keeps_structured_count_verified() -> None:
    summary = {"id": "example/bin-dataset", "tags": ["license:cc-by-4.0"]}
    detail = {
        "id": "example/bin-dataset",
        "sha": "abc123",
        "cardData": {
            "license": "cc-by-4.0",
            "description": "12 images with COCO bounding boxes",
            "source_datasets": ["upstream/bin-record"],
        },
        "dataset_info": {"splits": {"train": {"num_examples": 12}}},
        "siblings": [{"rfilename": "annotations.json", "size": 321}],
    }

    item = discover._hf_record(summary, detail, "waste bin")
    assert item is not None
    assert item["sampleCountVerification"] == "verified"
    assert {entry["verification"] for entry in item["descriptionDerivedSampleCounts"]} == {"verified", "claimed"}
    assert item["files"] == [{
        "name": "annotations.json",
        "sizeBytes": 321,
        "checksum": "",
        "downloadUrl": "https://huggingface.co/datasets/example/bin-dataset/resolve/abc123/annotations.json",
    }]

    untraceable = dict(detail)
    untraceable["cardData"] = {"license": "cc-by-4.0", "description": "12 images"}
    assert discover._hf_record(summary, untraceable, "waste bin") is None

    invalid_homepage = dict(detail)
    invalid_homepage["cardData"] = {
        "license": "cc-by-4.0",
        "description": "12 images",
        "homepage": "not-a-url",
    }
    assert discover._hf_record(summary, invalid_homepage, "waste bin") is None


def test_deduplicate_records_prefers_doi_then_normalized_title() -> None:
    common = {
        "recordUrl": "https://example.test/one",
        "sourceApiUrl": "https://example.test/api",
        "searchEvidence": [],
        "files": [],
        "descriptionDerivedSampleCounts": [],
        "annotationFormats": [],
        "countsTowardSufficiency": False,
        "upstreamTraceable": True,
        "upstreamEvidence": [],
        "sampleCountVerification": "none",
    }
    records = [
        {**common, "provider": "zenodo", "doi": "10.5281/example", "title": "Bin Study"},
        {**common, "provider": "figshare", "doi": "10.5281/example", "title": "Different mirror title", "recordUrl": "https://example.test/two"},
        {**common, "provider": "datacite_mendeley", "doi": "", "title": "Waste Bin Study", "recordUrl": "https://example.test/three"},
        {**common, "provider": "zenodo", "doi": "", "title": "waste-bin study", "recordUrl": "https://example.test/four"},
    ]

    unique = discover.deduplicate_records(records)

    assert len(unique) == 2
    doi_group = next(item for item in unique if item["doi"] == "10.5281/example")
    assert doi_group["duplicateProviders"] == ["figshare", "zenodo"]
    assert len(doi_group["recordUrls"]) == 2
    title_group = next(item for item in unique if item["doi"] is None or item["doi"] == "")
    assert title_group["duplicateProviders"] == ["datacite_mendeley", "zenodo"]


def test_deduplication_promotes_doi_when_title_only_hit_arrives_first() -> None:
    base = {
        "recordUrl": "https://example.test/one",
        "sourceApiUrl": "https://example.test/api",
        "searchEvidence": [],
        "files": [],
        "descriptionDerivedSampleCounts": [],
        "annotationFormats": [],
        "countsTowardSufficiency": False,
        "upstreamTraceable": True,
        "upstreamEvidence": [],
        "sampleCountVerification": "none",
    }
    unique = discover.deduplicate_records([
        {**base, "provider": "figshare", "doi": "", "title": "Wheelie Bin Dataset"},
        {**base, "provider": "zenodo", "doi": "https://doi.org/10.5281/example", "title": "Wheelie Bin Dataset", "recordUrl": "https://example.test/two"},
    ])

    assert len(unique) == 1
    assert unique[0]["doi"] == "10.5281/example"
    assert unique[0]["dedupeKey"] == "doi:10.5281/example"
    assert unique[0]["duplicateProviders"] == ["figshare", "zenodo"]


def test_distinct_dois_are_not_collapsed_by_equal_titles() -> None:
    common = {
        "recordUrl": "https://example.test/one",
        "sourceApiUrl": "https://example.test/api",
        "searchEvidence": [],
        "files": [],
        "descriptionDerivedSampleCounts": [],
        "annotationFormats": [],
        "countsTowardSufficiency": False,
        "upstreamTraceable": True,
        "upstreamEvidence": [],
        "sampleCountVerification": "none",
    }
    unique = discover.deduplicate_records([
        {**common, "provider": "zenodo", "doi": "10.5281/one", "title": "Waste bin dataset"},
        {**common, "provider": "figshare", "doi": "10.5281/two", "title": "Waste bin dataset", "recordUrl": "https://example.test/two"},
    ])

    assert len(unique) == 2
    assert {item["doi"] for item in unique} == {"10.5281/one", "10.5281/two"}


def test_datacite_rights_metadata_is_preserved_as_declared() -> None:
    item = discover._datacite_record(
        {
            "id": "10.17632/example.1",
            "attributes": {
                "doi": "10.17632/example.1",
                "titles": [{"title": "Waste container images"}],
                "descriptions": [{"description": "100 images"}],
                "rightsList": [{
                    "rights": "Creative Commons Attribution 4.0",
                    "rightsIdentifier": "cc-by-4.0",
                    "rightsUri": "https://creativecommons.org/licenses/by/4.0/",
                }],
            },
        },
        "waste container",
    )

    assert item["declaredLicense"] == {
        "id": "cc-by-4.0",
        "name": "Creative Commons Attribution 4.0",
        "url": "https://creativecommons.org/licenses/by/4.0/",
    }


def test_discovery_records_metadata_without_following_file_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    api_calls: list[tuple[str, dict[str, object] | None]] = []

    payload = {
        "hits": {
            "hits": [{
                "id": 123,
                "doi": "10.5281/zenodo.123",
                "metadata": {
                    "title": "Waste bin images",
                    "description": "1200 images with COCO annotations in JSON.",
                    "license": {"id": "cc-by-4.0"},
                },
                "links": {"self_html": "https://zenodo.org/records/123"},
                "files": [{
                    "key": "annotations.json",
                    "size": 987,
                    "links": {"self": "https://zenodo.org/api/records/123/files/annotations.json/content"},
                }],
            }],
        },
    }

    def fake_fetch_json(url: str, *, params: dict[str, object] | None = None, **kwargs: object):
        del kwargs
        api_calls.append((url, params))
        assert url == discover.API_ENDPOINTS["zenodo"]
        return payload

    monkeypatch.setattr(discover, "fetch_json", fake_fetch_json)
    report = discover.discover(
        terms=("waste bin",),
        providers=("zenodo",),
        max_results_per_term=1,
    )

    assert len(api_calls) == 1
    assert report["constraints"]["metadataOnly"] is True
    assert report["constraints"]["archivesDownloaded"] is False
    assert report["constraints"]["pixelsDownloaded"] is False
    assert report["candidateCount"] == 1
    candidate = report["candidates"][0]
    assert candidate["doi"] == "10.5281/zenodo.123"
    assert candidate["files"][0]["name"] == "annotations.json"
    assert candidate["files"][0]["sizeBytes"] == 987
    assert candidate["sampleCountVerification"] == "claimed"
    assert candidate["descriptionDerivedSampleCounts"][0]["verification"] == "claimed"
    assert candidate["annotationFormats"] == ["COCO", "JSON"]
    assert candidate["recordCountedAsSufficient"] is False
    assert candidate["sufficiencyFromTitleOnly"] is False
    assert all("download" not in url.casefold() for url, _ in api_calls)


def test_figshare_search_uses_official_metadata_post_and_detail_only(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object] | None]] = []

    def fake_fetch_json(
        url: str,
        *,
        params: dict[str, object] | None = None,
        json_payload: dict[str, object] | None = None,
        **kwargs: object,
    ):
        del kwargs
        calls.append((url, params or json_payload))
        if url == discover.API_ENDPOINTS["figshareSearch"]:
            return [{
                "id": 123,
                "title": "Waste bin images",
                "doi": "10.6084/m9.figshare.123.v1",
                "url_public_html": "https://figshare.com/articles/dataset/Waste_bin_images/123",
            }]
        assert url == f"{discover.API_ENDPOINTS['figshare']}/123"
        return {
            "id": 123,
            "title": "Waste bin images",
            "description": "120 images with COCO JSON annotations.",
            "license": {"name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/"},
            "files": [{"name": "annotations.json", "size": 987, "md5": "abc"}],
            "url_public_html": "https://figshare.com/articles/dataset/Waste_bin_images/123",
        }

    monkeypatch.setattr(discover, "fetch_json", fake_fetch_json)
    report = discover.discover(
        terms=("waste bin",),
        providers=("figshare",),
        max_results_per_term=1,
        max_detail_records=1,
    )

    assert [url for url, _ in calls] == [discover.API_ENDPOINTS["figshareSearch"], f"{discover.API_ENDPOINTS['figshare']}/123"]
    assert report["queryStats"]["figshare"]["recordsKept"] == 1
    assert report["candidates"][0]["files"][0]["name"] == "annotations.json"


def test_fetch_json_caps_retry_after_and_retries_429(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    sleeps: list[float] = []

    class Response(io.BytesIO):
        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            self.close()

    def fake_urlopen(request: object, timeout: int) -> Response:
        del request, timeout
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPError("https://example.test/api", 429, "rate limited", {"Retry-After": "9999"}, None)
        return Response(json.dumps({"ok": True}).encode("utf-8"))

    monkeypatch.setattr(discover, "urlopen", fake_urlopen)
    monkeypatch.setattr(discover.time, "sleep", lambda seconds: sleeps.append(seconds))

    assert discover.fetch_json("https://example.test/api") == {"ok": True}
    assert calls == 2
    assert sleeps == [discover.MAX_RETRY_AFTER_SECONDS]


def test_fetch_json_posts_metadata_search_payload_without_touching_file_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class Response(io.BytesIO):
        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            self.close()

    def fake_urlopen(request: object, timeout: int) -> Response:
        del timeout
        captured["method"] = request.get_method()  # type: ignore[attr-defined]
        captured["url"] = request.full_url  # type: ignore[attr-defined]
        captured["body"] = request.data  # type: ignore[attr-defined]
        return Response(b"[]")

    monkeypatch.setattr(discover, "urlopen", fake_urlopen)
    assert discover.fetch_json(
        discover.API_ENDPOINTS["figshareSearch"],
        json_payload={"search_for": "waste container", "page_size": 3},
    ) == []
    assert captured["method"] == "POST"
    assert captured["url"] == discover.API_ENDPOINTS["figshareSearch"]
    assert json.loads(captured["body"].decode("utf-8")) == {"search_for": "waste container", "page_size": 3}
