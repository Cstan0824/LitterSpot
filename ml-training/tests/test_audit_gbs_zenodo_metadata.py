from __future__ import annotations

import io
import json
import sys
from urllib.error import HTTPError
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import audit_gbs_zenodo_metadata as audit  # noqa: E402
from audit_gbs_zenodo_metadata import (  # noqa: E402
    EXPECTED_LICENSE_ID,
    MetadataAuditError,
    summarize_annotations,
    validate_record,
)


def official_record(*, license_id: str = EXPECTED_LICENSE_ID) -> dict:
    return {
        "id": 14711706,
        "doi": "10.5281/zenodo.14711706",
        "conceptrecid": "14711705",
        "conceptdoi": "10.5281/zenodo.14711705",
        "metadata": {
            "title": "the Garbage Bin Status (GBS) Dataset",
            "publication_date": "2025-01-21",
            "access_right": "open",
            "license": {"id": license_id},
            "creators": [{"name": "Yang, Liwen"}],
        },
        "links": {"self_html": "https://zenodo.org/records/14711706"},
        "files": [{
            "id": "file-id",
            "key": "GBS.zip",
            "size": 5_160_729_448,
            "checksum": "md5:archive",
            "links": {"self": "https://zenodo.org/api/records/14711706/files/GBS.zip/content"},
        }],
    }


def test_summary_counts_unique_images_and_boxes_by_official_category() -> None:
    coco = {
        "images": [
            {"id": 1, "width": 100, "height": 100},
            {"id": 1, "width": 100, "height": 100},
            {"id": 2, "width": 100, "height": 100},
            {"id": 3, "width": 100, "height": 100},
        ],
        "categories": [
            {"id": 0, "name": "overflow"},
            {"id": 1, "name": "garbage_bin"},
            {"id": 2, "name": "garbage"},
        ],
        "annotations": [
            {"id": 1, "image_id": 1, "category_id": 0, "bbox": [1, 2, 10, 20]},
            {"id": 2, "image_id": 1, "category_id": 1, "bbox": [5, 5, 20, 20]},
            {"id": 3, "image_id": 2, "category_id": 1, "bbox": [10, 10, 30, 30]},
            {"id": 4, "image_id": 3, "category_id": 2, "bbox": [0, 0, 5, 5]},
        ],
    }

    report = summarize_annotations(coco, validate_record(official_record()))

    assert report["counts"] == {
        "recordImageRows": 4,
        "uniqueImageIds": 3,
        "duplicateImageRows": 1,
        "annotatedUniqueImages": 3,
        "unannotatedUniqueImages": 0,
        "annotationRows": 4,
        "unknownCategoryRows": 0,
    }
    assert report["categoryCounts"]["garbage_bin"] == {
        "categoryId": 1,
        "boxes": 2,
        "uniqueImages": 2,
        "validBoundingBoxes": 2,
    }
    assert report["categoryCounts"]["overflow"]["uniqueImages"] == 1
    assert report["derivedCounts"]["explicitBinUniqueImages"] == 2
    assert report["derivedCounts"]["explicitBinBoxes"] == 2
    assert report["derivedCounts"]["binRelatedCandidateUniqueImages"] == 2
    assert report["derivedCounts"]["binRelatedCandidateBoxes"] == 3
    assert report["derivedCounts"]["contextGarbageBoxes"] == 1
    assert report["categoryIntersections"] == {
        "garbageBinOnly": 1,
        "overflowOnly": 0,
        "garbageBinAndOverflow": 1,
        "garbageOnly": 1,
    }
    assert report["derivedCounts"]["candidateStateImages"] == {
        "nonOverflow": 1,
        "overflow": 1,
        "warning": "Category absence/presence creates review candidates only; it does not prove normal or overflow state.",
    }
    assert report["metadataSufficiency"]["gates"]["appearanceFamilyQuotasProven"]["passed"] is False
    assert report["metadataSufficiency"]["gates"]["recordLicense"]["passed"] is True
    assert report["metadataSufficiency"]["gates"]["perImagePixelProvenance"]["passed"] is False
    assert report["metadataSufficiency"]["readyForPixelTraining"] is False


def test_license_gate_rejects_non_cc_by_record() -> None:
    with pytest.raises(MetadataAuditError, match="license gate failed"):
        validate_record(official_record(license_id="cc0-1.0"))


def test_range_request_retries_rate_limit_and_honors_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        status = 206
        headers = {"Content-Range": "bytes 0-3/4"}

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return b"data"

    calls = 0
    sleeps: list[float] = []

    def fake_urlopen(request: object, timeout: int) -> Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPError("https://example.test/archive.zip", 429, "rate limited", {"Retry-After": "2"}, None)
        return Response()

    monkeypatch.setattr(audit, "urlopen", fake_urlopen)
    monkeypatch.setattr(audit, "_wait_for_range_slot", lambda: None)
    monkeypatch.setattr(audit.time, "sleep", lambda seconds: sleeps.append(seconds))

    assert audit._range_request("https://example.test/archive.zip", 0, 4, "test-agent") == b"data"
    assert calls == 2
    assert sleeps == [2.0]


def test_range_request_stops_after_bounded_retry_count(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def fake_urlopen(request: object, timeout: int) -> object:
        nonlocal calls
        calls += 1
        raise HTTPError("https://example.test/archive.zip", 503, "unavailable", {"Retry-After": "0"}, None)

    monkeypatch.setattr(audit, "urlopen", fake_urlopen)
    monkeypatch.setattr(audit, "_wait_for_range_slot", lambda: None)
    monkeypatch.setattr(audit.time, "sleep", lambda seconds: None)

    with pytest.raises(MetadataAuditError, match="after 6 attempt"):
        audit._range_request("https://example.test/archive.zip", 0, 4, "test-agent")
    assert calls == audit.MAX_RANGE_RETRIES + 1


def test_fetch_json_retries_503_with_capped_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    sleeps: list[float] = []

    class Response(io.BytesIO):
        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            self.close()

    def fake_urlopen(request: object, timeout: int) -> Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPError("https://example.test/record", 503, "unavailable", {"Retry-After": "9999"}, None)
        return Response(json.dumps({"id": 14711706}).encode("utf-8"))

    monkeypatch.setattr(audit, "urlopen", fake_urlopen)
    monkeypatch.setattr(audit.time, "sleep", lambda seconds: sleeps.append(seconds))

    assert audit.fetch_json("https://example.test/record") == {"id": 14711706}
    assert calls == 2
    assert sleeps == [audit.MAX_RETRY_AFTER_SECONDS]
