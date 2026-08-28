from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import enrich_openimages_attribution as enrich  # noqa: E402


def _record(image_id: str, status: str) -> dict[str, object]:
    return {
        "ImageID": image_id,
        "classNames": ["waste_container"],
        "familyNames": ["bin_positive"],
        "originalUrl": f"https://pixels.test/{image_id}.jpg",
        "landingUrl": f"https://photos.test/{image_id}",
        "declaredLicense": "https://creativecommons.org/licenses/by/2.0/",
        "declaredAuthorProfileUrl": "https://photos.test/people/author/",
        "declaredAuthor": "Author",
        "status": status,
        "reason": "fixture",
    }


def test_cli_enriches_verified_rows_from_official_image_information_csv(tmp_path: Path) -> None:
    verification_path = tmp_path / "verification.json"
    csv_path = tmp_path / "train-images.csv"
    output_path = tmp_path / "attributed.json"
    verification_path.write_text(json.dumps({
        "schemaVersion": 1,
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "records": [_record("verified-id", "verified"), _record("rejected-id", "rejected")],
    }), encoding="utf-8")
    columns = [
        "ImageID", "Subset", "OriginalURL", "OriginalLandingURL", "License",
        "AuthorProfileURL", "Author", "Title", "OriginalSize", "OriginalMD5",
        "Thumbnail300KURL", "Rotation",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerow({
            "ImageID": "verified-id",
            "Subset": "train",
            "OriginalURL": "https://pixels.test/verified-id.jpg",
            "OriginalLandingURL": "https://photos.test/verified-id",
            "License": "https://creativecommons.org/licenses/by/2.0/",
            "AuthorProfileURL": "https://photos.test/people/author/",
            "Author": "Author",
            "Title": "A supplied bin title",
            "OriginalSize": "1234",
            "OriginalMD5": "abc123",
            "Thumbnail300KURL": "https://thumbs.test/verified-id.jpg",
            "Rotation": "0",
        })

    assert enrich.main([
        "--verification", str(verification_path),
        "--image-information-csv", str(csv_path),
        "--output", str(output_path),
    ]) == 0

    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["readyForAcquisition"] is True
    assert result["attributionCounts"] == {
        "verifiedRows": 1,
        "metadataMatched": 1,
        "complete": 1,
        "missing": 0,
    }
    verified = next(record for record in result["records"] if record["ImageID"] == "verified-id")
    assert verified["title"] == "A supplied bin title"
    assert verified["sourceSplit"] == "train"
    assert verified["openImagesOriginalMD5"] == "abc123"
    assert verified["thumbnail300KUrl"] == "https://thumbs.test/verified-id.jpg"
    assert verified["noticesCaptureStatus"] == "not_present_in_open_images_metadata_schema"
    assert verified["copyrightNotice"] is None
    assert verified["licenseNotice"] is None
    assert verified["disclaimerNotice"] is None
    assert verified["licensorSpecifiedWorkUri"] is None
    assert verified["isDerivative"] is False
    assert verified["changesDescription"] is None
