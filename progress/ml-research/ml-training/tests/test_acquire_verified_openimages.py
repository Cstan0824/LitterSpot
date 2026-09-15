from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import acquire_verified_openimages as acquire  # noqa: E402


def _png_bytes() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (2, 3), (12, 34, 56)).save(stream, format="PNG")
    return stream.getvalue()


def _record(
    image_id: str, *, status: str = "verified", author: str = "Bin Author",
    title: str = "Theme park bin candidate",
) -> dict[str, object]:
    return {
        "ImageID": image_id,
        "classNames": ["waste_container"],
        "familyNames": ["bin_positive"],
        "originalUrl": f"https://pixels.test/{image_id}.png",
        "thumbnail300KUrl": f"https://thumbs.test/{image_id}.png",
        "landingUrl": f"https://photos.test/{image_id}",
        "declaredLicense": "https://creativecommons.org/licenses/by/2.0/",
        "declaredAuthorProfileUrl": "https://photos.test/people/bin-author/",
        "declaredAuthor": author,
        "title": title,
        "noticesCaptureStatus": "not_present_in_open_images_metadata_schema",
        "binAbsenceVerified": True,
        "negativeEvidence": {"labelName": "/m/0bjyj5", "confidence": 0},
        "copyrightNotice": None,
        "licenseNotice": None,
        "disclaimerNotice": None,
        "licensorSpecifiedWorkUri": None,
        "status": status,
        "reason": "fixture",
    }


def test_cli_downloads_only_verified_complete_attribution_rows(tmp_path: Path) -> None:
    png = _png_bytes()
    verification = {
        "schemaVersion": 1,
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "records": [
            _record("good"),
            _record("manual", status="manual_review"),
            _record("missing-author", author=""),
            _record("missing-title", title=""),
        ],
    }
    verification_path = tmp_path / "verification.json"
    fixtures_path = tmp_path / "fixtures.json"
    output_dir = tmp_path / "images"
    manifest_path = tmp_path / "manifest.json"
    verification_path.write_text(json.dumps(verification), encoding="utf-8")
    fixtures_path.write_text(json.dumps({
        "responses": {
            "https://pixels.test/good.png": {
                "status": 200,
                "contentType": "image/png",
                "bodyBase64": base64.b64encode(png).decode("ascii"),
            }
        }
    }), encoding="utf-8")

    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(output_dir),
        "--manifest", str(manifest_path),
        "--asset-fixtures", str(fixtures_path),
    ]) == 0

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["counts"] == {
        "downloaded": 1,
        "reused": 0,
        "failed": 0,
        "rejected": 2,
    }
    assert manifest["eligibleVerifiedRows"] == 3
    assert manifest["excludedNonVerifiedRows"] == 1
    assert manifest["pixelsDownloaded"] is True
    assert len(manifest["records"]) == 3

    acquired = next(record for record in manifest["records"] if record["ImageID"] == "good")
    assert acquired["status"] == "downloaded"
    assert acquired["sha256"] == hashlib.sha256(png).hexdigest()
    assert acquired["width"] == 2
    assert acquired["height"] == 3
    assert acquired["declaredAuthor"] == "Bin Author"
    assert acquired["title"] == "Theme park bin candidate"
    assert acquired["noticesCaptureStatus"] == "not_present_in_open_images_metadata_schema"
    assert acquired["binAbsenceVerified"] is True
    assert acquired["negativeEvidence"] == {"labelName": "/m/0bjyj5", "confidence": 0}
    assert acquired["declaredLicense"] == "https://creativecommons.org/licenses/by/2.0/"
    assert (output_dir / acquired["localFilename"]).read_bytes() == png

    rejected = next(record for record in manifest["records"] if record["ImageID"] == "missing-author")
    assert rejected["status"] == "rejected"
    assert rejected["reason"] == "incomplete_attribution"
    missing_title = next(record for record in manifest["records"] if record["ImageID"] == "missing-title")
    assert missing_title["status"] == "rejected"
    assert missing_title["reason"] == "incomplete_attribution"
    assert not (output_dir / "manual.png").exists()


def test_acquisition_can_prefer_the_published_thumbnail_asset(tmp_path: Path) -> None:
    png = _png_bytes()
    record = _record("thumbnail")
    report = acquire.acquire_verified(
        {"sourceDataset": "Open Images V7", "pixelsDownloaded": False, "records": [record]},
        output_dir=tmp_path,
        fixtures={
            "https://thumbs.test/thumbnail.png": {
                "status": 200, "contentType": "image/png",
                "bodyBase64": base64.b64encode(png).decode("ascii"),
            },
        },
        prefer_thumbnail=True,
    )

    acquired = report["records"][0]
    assert acquired["status"] == "downloaded"
    assert acquired["acquisitionSource"] == "thumbnail300KUrl"
    assert acquired["assetUrl"] == "https://thumbs.test/thumbnail.png"
    assert acquired["originalUrl"] == "https://pixels.test/thumbnail.png"


def test_acquisition_can_use_the_official_openimages_s3_asset(tmp_path: Path) -> None:
    png = _png_bytes()
    record = _record("s3-image")
    s3_url = "https://open-images-dataset.s3.amazonaws.com/train/s3-image.jpg"
    report = acquire.acquire_verified(
        {"sourceDataset": "Open Images V7", "pixelsDownloaded": False, "records": [record]},
        output_dir=tmp_path,
        fixtures={s3_url: {
            "status": 200, "contentType": "image/png",
            "bodyBase64": base64.b64encode(png).decode("ascii"),
        }},
        openimages_s3_split="train",
    )

    acquired = report["records"][0]
    assert acquired["status"] == "downloaded"
    assert acquired["acquisitionSource"] == "openImagesS3:train"
    assert acquired["assetUrl"] == s3_url


def test_cli_resume_reuses_only_hash_and_dimension_validated_asset(tmp_path: Path) -> None:
    png = _png_bytes()
    verification_path = tmp_path / "verification.json"
    fixtures_path = tmp_path / "fixtures.json"
    empty_fixtures_path = tmp_path / "empty-fixtures.json"
    output_dir = tmp_path / "images"
    manifest_path = tmp_path / "manifest.json"
    verification_path.write_text(json.dumps({
        "schemaVersion": 2,
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "records": [_record("resume-good")],
    }), encoding="utf-8")
    fixtures_path.write_text(json.dumps({"responses": {
        "https://pixels.test/resume-good.png": {
            "status": 200,
            "contentType": "image/png",
            "bodyBase64": base64.b64encode(png).decode("ascii"),
        }
    }}), encoding="utf-8")
    empty_fixtures_path.write_text(json.dumps({"responses": {}}), encoding="utf-8")

    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(output_dir),
        "--manifest", str(manifest_path),
        "--asset-fixtures", str(fixtures_path),
    ]) == 0
    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(output_dir),
        "--manifest", str(manifest_path),
        "--asset-fixtures", str(empty_fixtures_path),
        "--resume",
    ]) == 0

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["counts"] == {
        "downloaded": 0,
        "reused": 1,
        "failed": 0,
        "rejected": 0,
    }
    record = manifest["records"][0]
    assert record["status"] == "reused"
    assert record["sha256"] == hashlib.sha256(png).hexdigest()
    assert record["reason"] == "validated_existing_asset"


def test_cli_retries_transient_http_failure_before_acquiring(tmp_path: Path) -> None:
    png = _png_bytes()
    calls = 0

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            nonlocal calls
            calls += 1
            if calls == 1:
                self.send_response(503)
                self.send_header("Retry-After", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)

        def log_message(self, format: str, *args: object) -> None:
            del format, args

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        row = _record("retry-good")
        row["originalUrl"] = f"http://127.0.0.1:{server.server_port}/retry.png"
        verification_path = tmp_path / "verification.json"
        manifest_path = tmp_path / "manifest.json"
        verification_path.write_text(json.dumps({
            "schemaVersion": 2,
            "sourceDataset": "Open Images V7",
            "pixelsDownloaded": False,
            "records": [row],
        }), encoding="utf-8")

        assert acquire.main([
            "--verification", str(verification_path),
            "--output-dir", str(tmp_path / "images"),
            "--manifest", str(manifest_path),
            "--timeout", "2",
            "--retries", "1",
            "--retry-delay-seconds", "0",
        ]) == 0
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert calls == 2
    assert manifest["counts"]["downloaded"] == 1


def test_incomplete_run_writes_checkpoint_not_final_then_resumes(tmp_path: Path) -> None:
    png = _png_bytes()
    verification_path = tmp_path / "verification.json"
    first_fixtures = tmp_path / "first.json"
    second_fixtures = tmp_path / "second.json"
    output_dir = tmp_path / "images"
    manifest_path = tmp_path / "manifest.json"
    checkpoint_path = tmp_path / "checkpoint.json"
    verification_path.write_text(json.dumps({
        "schemaVersion": 2,
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "records": [_record("checkpoint-a"), _record("checkpoint-b")],
    }), encoding="utf-8")
    first_fixtures.write_text(json.dumps({"responses": {
        "https://pixels.test/checkpoint-a.png": {
            "status": 200, "contentType": "image/png",
            "bodyBase64": base64.b64encode(png).decode("ascii"),
        }
    }}), encoding="utf-8")
    second_fixtures.write_text(json.dumps({"responses": {
        "https://pixels.test/checkpoint-b.png": {
            "status": 200, "contentType": "image/png",
            "bodyBase64": base64.b64encode(png).decode("ascii"),
        }
    }}), encoding="utf-8")

    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(output_dir),
        "--manifest", str(manifest_path),
        "--checkpoint", str(checkpoint_path),
        "--asset-fixtures", str(first_fixtures),
    ]) == 2
    assert not manifest_path.exists()
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    assert checkpoint["complete"] is False
    assert checkpoint["counts"]["downloaded"] == 1
    assert checkpoint["counts"]["failed"] == 1

    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(output_dir),
        "--manifest", str(manifest_path),
        "--checkpoint", str(checkpoint_path),
        "--asset-fixtures", str(second_fixtures),
        "--resume",
    ]) == 0
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["counts"] == {
        "downloaded": 1,
        "reused": 1,
        "failed": 0,
        "rejected": 0,
    }
    assert json.loads(checkpoint_path.read_text(encoding="utf-8"))["complete"] is True


def test_acquisition_emits_checkpoint_state_after_each_selected_row(tmp_path: Path) -> None:
    png = _png_bytes()
    rows = [_record("progress-a"), _record("progress-b")]
    fixtures = {
        str(row["originalUrl"]): {
            "status": 200,
            "contentType": "image/png",
            "bodyBase64": base64.b64encode(png).decode("ascii"),
        }
        for row in rows
    }
    snapshots: list[dict[str, object]] = []

    result = acquire.acquire_verified(
        {
            "sourceDataset": "Open Images V7",
            "pixelsDownloaded": False,
            "records": rows,
        },
        output_dir=tmp_path / "images",
        fixtures=fixtures,
        progress_callback=lambda report: snapshots.append(report),
    )

    assert [snapshot["processedSelectedRows"] for snapshot in snapshots] == [1, 2]
    assert snapshots[0]["counts"]["downloaded"] == 1
    assert snapshots[1]["counts"]["downloaded"] == 2
    assert result["processedSelectedRows"] == 2


def test_deterministic_asset_problem_is_rejected_without_blocking_manifest(tmp_path: Path) -> None:
    verification_path = tmp_path / "verification.json"
    fixtures_path = tmp_path / "fixtures.json"
    manifest_path = tmp_path / "manifest.json"
    row = _record("gone")
    verification_path.write_text(json.dumps({
        "schemaVersion": 2,
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "records": [row],
    }), encoding="utf-8")
    fixtures_path.write_text(json.dumps({"responses": {
        str(row["originalUrl"]): {
            "status": 404,
            "contentType": "text/html",
            "bodyBase64": "",
        }
    }}), encoding="utf-8")

    assert acquire.main([
        "--verification", str(verification_path),
        "--output-dir", str(tmp_path / "images"),
        "--manifest", str(manifest_path),
        "--asset-fixtures", str(fixtures_path),
    ]) == 0

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["complete"] is True
    assert manifest["counts"] == {
        "downloaded": 0,
        "reused": 0,
        "failed": 0,
        "rejected": 1,
    }
    assert manifest["records"][0]["reason"] == "HTTP 404"


def test_live_acquisition_throttles_between_requests(tmp_path: Path, monkeypatch: object) -> None:
    png = _png_bytes()
    sleeps: list[float] = []

    monkeypatch.setattr(acquire, "_fetch_bytes", lambda *args, **kwargs: (200, "image/png", png, args[0]))
    monkeypatch.setattr(acquire.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = acquire.acquire_verified(
        {
            "sourceDataset": "Open Images V7",
            "pixelsDownloaded": False,
            "records": [_record("throttle-a"), _record("throttle-b")],
        },
        output_dir=tmp_path / "images",
        request_delay_seconds=1.5,
    )

    assert result["counts"]["downloaded"] == 2
    assert sleeps == [1.5]
