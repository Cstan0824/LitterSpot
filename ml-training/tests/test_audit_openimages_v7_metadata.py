from __future__ import annotations

from contextlib import contextmanager
import io
import sys
from pathlib import Path
from urllib.error import HTTPError

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import audit_openimages_v7_metadata as audit  # noqa: E402


def _class_csv() -> str:
    lines = ["LabelName,DisplayName"]
    lines.extend(f"{spec['labelName']},{spec['displayName']}" for spec in audit.TARGET_CLASSES.values())
    return "\n".join(lines) + "\n"


def _bbox_csv() -> str:
    rows = [audit.BBOX_COLUMNS]
    rows.extend([
        ["img-b", "xclick", "/m/0bjyj5", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
        ["img-a", "xclick", "/m/0bjyj5", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
        ["img-a", "xclick", "/m/01mzpv", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
        ["img-c", "xclick", "/m/05gqfk", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
        ["img-c", "xclick", "/m/04dr76w", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
        ["img-d", "xclick", "/m/01g317", "1", "0", "1", "0", "1", "0", "0", "0", "0", "0"],
    ])
    return "\n".join(",".join(row) for row in rows) + "\n"


def _image_info_csv() -> str:
    rows = [audit.IMAGE_INFORMATION_COLUMNS]
    def row(image_id: str, license_url: str, *, complete: bool = True) -> list[str]:
        author_profile = "https://www.flickr.com/people/example/" if complete else ""
        author = "Author" if complete else ""
        return [
            image_id, "validation", f"https://example.test/{image_id}.jpg",
            f"https://example.test/landing/{image_id}", license_url,
            author_profile, author, "title", "123", "md5", "", "0",
        ]
    rows.extend([
        row("img-a", "https://creativecommons.org/licenses/by/4.0/"),
        row("img-b", "https://creativecommons.org/licenses/by-nc/4.0/", complete=False),
        row("img-c", "https://creativecommons.org/licenses/by-sa/4.0/"),
        row("img-extra", "https://creativecommons.org/licenses/by/4.0/"),
    ])
    return "\n".join(",".join(value for value in row) for row in rows) + "\n"


@contextmanager
def _fake_streams(payloads: dict[str, str]):
    def fake_open(url: str, **kwargs: object):
        del kwargs
        if url not in payloads:
            raise AssertionError(f"unexpected stream URL: {url}")
        return io.StringIO(payloads[url])
    yield fake_open


def test_audit_separates_boxes_declared_licenses_provenance_and_landing_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads = {"class": _class_csv(), "bbox": _bbox_csv(), "info": _image_info_csv()}
    with _fake_streams(payloads) as fake_open:
        @contextmanager
        def open_text(url: str, **kwargs: object):
            del kwargs
            key = {"class-url": "class", "bbox-url": "bbox", "info-url": "info"}[url]
            yield io.StringIO(payloads[key])
        monkeypatch.setattr(audit, "open_text_url", open_text)
        report = audit.audit_openimages(
            split="validation",
            bbox_url="bbox-url",
            image_information_url="info-url",
            class_descriptions_url="class-url",
            candidate_limit=2,
        )

    del fake_open
    classes = report["annotationCounts"]["classes"]
    assert classes["waste_container"]["boxCount"] == 2
    assert classes["waste_container"]["uniqueImageCount"] == 2
    assert classes["chair"]["uniqueImageCount"] == 1
    assert report["annotationCounts"]["families"]["furniture"]["uniqueImageCount"] == 1
    assert report["annotationCounts"]["families"]["carryables"]["boxCount"] == 2
    assert report["annotationCounts"]["families"]["carryables"]["uniqueImageCount"] == 1

    declared = report["declaredCommercialCompatibleCounts"]["allTargetClasses"]
    assert declared["imageCount"] == 2  # img-a and img-c; img-b is BY-NC
    complete = report["completeProvenanceFieldCounts"]["allTargetClasses"]
    assert complete["imageCount"] == 2  # img-a and img-c
    assert complete["fieldCounts"] == {
        "OriginalURL": 3,
        "OriginalLandingURL": 3,
        "License": 3,
        "AuthorProfileURL": 2,
        "Author": 2,
    }
    landing = report["landingPageVerifiedCounts"]["allTargetClasses"]
    assert landing["imageCount"] == 0
    assert report["candidateSelection"]["classIds"]["waste_container"] == ["img-a", "img-b"][:1]
    assert "img-a" in {
        row["ImageID"] for row in report["candidateSelection"]["candidateRows"]
        if "waste_container" in row["classNames"]
    }
    assert report["candidateSelection"]["globalCandidateRowsLimit"] is None
    assert report["candidateSelection"]["candidateRows"][0]["ImageID"] == "img-a"
    assert report["candidateSelection"]["candidateRows"][0]["Title"] == "title"
    assert "Thumbnail300KURL" in report["candidateSelection"]["candidateRows"][0]
    assert report["source"]["pixelsDownloaded"] is False
    assert report["readyForTraining"] is False


def test_license_screen_is_conservative_and_never_named_approval() -> None:
    assert audit.declared_license_allowlisted("https://creativecommons.org/licenses/by/4.0/")
    assert audit.declared_license_allowlisted("https://creativecommons.org/licenses/by-sa/3.0/")
    assert audit.declared_license_allowlisted("https://creativecommons.org/publicdomain/zero/1.0/")
    assert not audit.declared_license_allowlisted("https://creativecommons.org/licenses/by-nc/4.0/")
    assert not audit.declared_license_allowlisted("https://creativecommons.org/licenses/by-nd/4.0/")
    assert "approved" not in " ".join(audit.DECLARED_LICENSE_ALLOWLIST).casefold()


def test_bbox_schema_is_checked_before_streaming(monkeypatch: pytest.MonkeyPatch) -> None:
    @contextmanager
    def open_text(url: str, **kwargs: object):
        del url, kwargs
        yield io.StringIO("ImageID,LabelName\nimg-a,/m/0bjyj5\n")
    monkeypatch.setattr(audit, "open_text_url", open_text)

    with pytest.raises(audit.OpenImagesAuditError, match="schema mismatch"):
        audit.stream_bbox_annotations("bbox-url")


def test_stream_retry_is_bounded_and_honors_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
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
            raise HTTPError("https://example.test", 429, "rate limited", {"Retry-After": "2"}, None)
        return Response(b"ok")

    monkeypatch.setattr(audit, "urlopen", fake_urlopen)
    monkeypatch.setattr(audit.time, "sleep", lambda seconds: sleeps.append(seconds))

    with audit.open_text_url("https://example.test") as handle:
        assert handle.read() == "ok"
    assert calls == 2
    assert sleeps == [2.0]


def test_train_stream_requires_explicit_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(audit, "load_class_mapping", lambda *args, **kwargs: {})
    with pytest.raises(ValueError, match="guarded"):
        audit.audit_openimages(split="train")


def test_candidate_rows_preserve_each_class_quota_instead_of_global_lexical_bias(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bbox_rows = [audit.BBOX_COLUMNS]
    image_rows = [audit.IMAGE_INFORMATION_COLUMNS]
    for index in range(3):
        image_id = f"a-person-{index}"
        bbox_rows.append([
            image_id, "xclick", audit.TARGET_CLASSES["person"]["labelName"],
            "1", "0", "1", "0", "1", "0", "0", "0", "0", "0",
        ])
        image_rows.append([
            image_id, "train", f"https://images.test/{image_id}.jpg",
            f"https://landing.test/{image_id}",
            "https://creativecommons.org/licenses/by/4.0/",
            "https://authors.test/a", "Author", "title", "123", "md5", "", "0",
        ])
    bbox_rows.append([
        "z-bin", "xclick", audit.TARGET_CLASSES["waste_container"]["labelName"],
        "1", "0", "1", "0", "1", "0", "0", "0", "0", "0",
    ])
    image_rows.append([
        "z-bin", "train", "https://images.test/z-bin.jpg",
        "https://landing.test/z-bin", "https://creativecommons.org/licenses/by/4.0/",
        "https://authors.test/b", "Bin Author", "title", "123", "md5", "", "0",
    ])

    @contextmanager
    def open_text(url: str, **kwargs: object):
        del kwargs
        if url == "class-url":
            yield io.StringIO(_class_csv())
        elif url == "bbox-url":
            yield io.StringIO("\n".join(",".join(row) for row in bbox_rows) + "\n")
        elif url == "info-url":
            yield io.StringIO("\n".join(",".join(row) for row in image_rows) + "\n")
        else:
            raise AssertionError(url)

    monkeypatch.setattr(audit, "open_text_url", open_text)
    report = audit.audit_openimages(
        split="validation",
        bbox_url="bbox-url",
        image_information_url="info-url",
        class_descriptions_url="class-url",
        candidate_limit=1,
    )

    candidate_ids = {row["ImageID"] for row in report["candidateSelection"]["candidateRows"]}
    assert candidate_ids == {"a-person-0", "z-bin"}
