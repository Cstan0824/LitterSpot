from __future__ import annotations

import json
import io
import sys
from pathlib import Path
from urllib.error import URLError

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import verify_openimages_candidate_licenses as verify  # noqa: E402


def _audit(rows: list[dict[str, object]]) -> dict[str, object]:
    return {
        "source": {"dataset": "Open Images V7", "pixelsDownloaded": False},
        "candidateSelection": {"candidateRows": rows},
    }


def _row(image_id: str, landing_url: str) -> dict[str, object]:
    return {
        "ImageID": image_id,
        "classNames": ["waste_container"],
        "familyNames": ["bin_positive"],
        "OriginalURL": f"https://pixels.test/{image_id}.jpg",
        "OriginalLandingURL": landing_url,
        "License": "https://creativecommons.org/licenses/by/2.0/",
        "AuthorProfileURL": "https://photos.test/people/bin-author/",
        "Author": "Bin Author",
        "Title": "Theme park bin candidate",
        "Thumbnail300KURL": f"https://openimages.test/{image_id}.jpg",
        "binAbsenceVerified": True,
        "negativeEvidence": {"labelName": "/m/0bjyj5", "confidence": 0},
        "declaredLicenseAllowlisted": True,
        "completeProvenance": True,
    }


def test_fixture_pilot_emits_verified_rejected_and_manual_review_without_pixels(
    tmp_path: Path,
) -> None:
    rows = [
        _row("verified", "https://photos.test/verified"),
        _row("removed", "https://photos.test/removed"),
        _row("ambiguous", "https://photos.test/ambiguous"),
    ]
    audit_path = tmp_path / "audit.json"
    fixture_path = tmp_path / "responses.json"
    output_path = tmp_path / "result.json"
    audit_path.write_text(json.dumps(_audit(rows)), encoding="utf-8")
    fixture_path.write_text(json.dumps({
        "responses": {
            "https://photos.test/verified": {
                "status": 200,
                "contentType": "text/html",
                "body": (
                    '<a rel="license" href="https://creativecommons.org/licenses/by/2.0/">CC BY</a>'
                    '<a href="https://photos.test/people/bin-author/">Bin Author</a>'
                ),
            },
            "https://photos.test/removed": {
                "status": 404,
                "contentType": "text/html",
                "body": "not found",
            },
            "https://photos.test/ambiguous": {
                "status": 200,
                "contentType": "text/html",
                "body": "Bin Author, all rights reserved",
            },
        }
    }), encoding="utf-8")

    assert verify.main([
        "--audit", str(audit_path),
        "--response-fixtures", str(fixture_path),
        "--output", str(output_path),
        "--family", "bin_positive",
    ]) == 0

    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["counts"] == {"verified": 1, "rejected": 1, "manual_review": 1}
    assert result["verifiedImageIds"] == ["verified"]
    assert result["pixelsDownloaded"] is False
    assert result["landingPageBodiesOnly"] is True
    assert {record["status"] for record in result["records"]} == {
        "verified", "rejected", "manual_review",
    }
    verified_record = next(record for record in result["records"] if record["ImageID"] == "verified")
    assert verified_record["originalUrl"] == "https://pixels.test/verified.jpg"
    assert verified_record["declaredAuthorProfileUrl"] == "https://photos.test/people/bin-author/"
    assert verified_record["title"] == "Theme park bin candidate"
    assert verified_record["thumbnail300KUrl"] == "https://openimages.test/verified.jpg"
    assert verified_record["noticesCaptureStatus"] == "not_present_in_open_images_metadata_schema"
    assert verified_record["binAbsenceVerified"] is True
    assert verified_record["negativeEvidence"] == {
        "labelName": "/m/0bjyj5", "confidence": 0,
    }


def test_image_content_type_is_never_read_or_admitted(tmp_path: Path) -> None:
    row = _row("redirected-to-pixel", "https://photos.test/pixel")
    result = verify.verify_candidates(
        _audit([row]),
        fixtures={
            "https://photos.test/pixel": {
                "status": 200,
                "contentType": "image/jpeg",
                "body": "pretend-pixel-bytes",
            }
        },
        families={"bin_positive"},
    )

    record = result["records"][0]
    assert record["status"] == "manual_review"
    assert record["reason"] == "non_html_response_not_read"
    assert record["responseBodyRead"] is False
    assert record["bodySha256"] is None


def test_declared_license_metadata_alone_cannot_verify_candidate() -> None:
    row = _row("metadata-only", "https://photos.test/metadata-only")
    result = verify.verify_candidates(
        _audit([row]),
        fixtures={
            "https://photos.test/metadata-only": {
                "status": 200,
                "contentType": "text/html",
                "body": "<html><title>A bin</title></html>",
            }
        },
        families={"bin_positive"},
    )

    assert result["records"][0]["status"] == "manual_review"
    assert result["verifiedImageIds"] == []


def test_candidate_window_supports_deterministic_chunked_verification() -> None:
    rows = [
        _row("first", "https://photos.test/first"),
        _row("second", "https://photos.test/second"),
        _row("third", "https://photos.test/third"),
    ]
    result = verify.verify_candidates(
        _audit(rows), fixtures={}, start_index=1, max_candidates=1,
    )

    assert [record["ImageID"] for record in result["records"]] == ["second"]
    assert result["candidateWindow"] == {"startIndex": 1, "maxCandidates": 1}


def test_conflicting_machine_readable_licenses_cannot_verify_candidate() -> None:
    row = _row("conflict", "https://photos.test/conflict")
    result = verify.verify_candidates(
        _audit([row]),
        fixtures={
            "https://photos.test/conflict": {
                "status": 200,
                "contentType": "text/html",
                "body": (
                    '<a rel="license" href="https://creativecommons.org/licenses/by/2.0/">CC BY 2</a>'
                    '<a rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4</a>'
                    '<a href="https://photos.test/people/bin-author/">Bin Author</a>'
                ),
            }
        },
        families={"bin_positive"},
    )

    record = result["records"][0]
    assert record["status"] == "manual_review"
    assert record["reason"] == "conflicting_machine_readable_licenses"
    assert result["verifiedImageIds"] == []


def test_localized_cc_deed_url_is_same_license_instrument() -> None:
    row = _row("localized-deed", "https://photos.test/localized-deed")
    result = verify.verify_candidates(
        _audit([row]),
        fixtures={
            "https://photos.test/localized-deed": {
                "status": 200,
                "contentType": "text/html",
                "body": (
                    '<a rel="license" href="https://creativecommons.org/licenses/by/2.0/deed.en">CC BY 2</a>'
                    '<a href="https://photos.test/people/bin-author/">Bin Author</a>'
                ),
            }
        },
        families={"bin_positive"},
    )

    assert result["records"][0]["status"] == "verified"
    assert result["verifiedImageIds"] == ["localized-deed"]


def test_live_fetch_retries_transient_connection_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0
    sleeps: list[float] = []

    class Response(io.BytesIO):
        status = 200
        headers = {"Content-Type": "text/html; charset=utf-8"}

        def getcode(self) -> int:
            return self.status

        def geturl(self) -> str:
            return "https://photos.test/retry"

    def fake_urlopen(request: object, timeout: int) -> Response:
        del request, timeout
        nonlocal calls
        calls += 1
        if calls == 1:
            raise URLError("connection reset")
        return Response(b"<html>ok</html>")

    monkeypatch.setattr(verify, "urlopen", fake_urlopen)
    monkeypatch.setattr(verify.time, "sleep", lambda seconds: sleeps.append(seconds))

    response = verify._fetch_landing_page(
        "https://photos.test/retry",
        timeout=1,
        user_agent="test",
        retries=2,
        retry_delay_seconds=0.5,
    )

    assert response.status == 200
    assert response.body == b"<html>ok</html>"
    assert calls == 2
    assert sleeps == [0.5]


def test_cross_host_redirect_body_is_not_read_even_if_labeled_html() -> None:
    row = _row("redirect", "https://photos.test/redirect")
    result = verify.verify_candidates(
        _audit([row]),
        fixtures={
            "https://photos.test/redirect": {
                "status": 200,
                "finalUrl": "https://pixels.test/redirect.jpg",
                "contentType": "text/html",
                "body": "pretend-pixels-mislabeled-as-html",
            }
        },
        families={"bin_positive"},
    )

    record = result["records"][0]
    assert record["status"] == "manual_review"
    assert record["reason"] == "cross_host_redirect_body_not_read"
    assert record["responseBodyRead"] is False
    assert record["bodySha256"] is None
