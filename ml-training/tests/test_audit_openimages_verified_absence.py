from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import audit_openimages_verified_absence as absence  # noqa: E402


def _metadata(image_id: str, author: str) -> dict[str, str]:
    return {
        "ImageID": image_id,
        "Subset": "train",
        "OriginalURL": f"https://pixels.test/{image_id}.jpg",
        "OriginalLandingURL": f"https://landing.test/{image_id}",
        "License": "https://creativecommons.org/licenses/by/2.0/",
        "AuthorProfileURL": f"https://authors.test/{author}",
        "Author": author,
        "Title": f"Title {image_id}",
        "OriginalSize": "123",
        "OriginalMD5": "md5",
        "Thumbnail300KURL": f"https://thumbs.test/{image_id}.jpg",
        "Rotation": "0",
    }


def test_audit_admits_only_verified_absence_and_prioritizes_known_confusers() -> None:
    labels = [
        {"ImageID": "neg-a", "LabelName": "/m/0bjyj5", "Confidence": "0"},
        {"ImageID": "neg-b", "LabelName": "/m/0bjyj5", "Confidence": "0"},
        {"ImageID": "positive", "LabelName": "/m/0bjyj5", "Confidence": "1"},
        {"ImageID": "other", "LabelName": "/m/01mzpv", "Confidence": "0"},
    ]
    metadata = [_metadata("neg-a", "author-a"), _metadata("neg-b", "author-b")]
    confusers = {
        "candidateSelection": {"candidateRows": [{
            "ImageID": "neg-b", "classNames": ["chair"], "familyNames": ["furniture"],
        }]},
    }

    result = absence.build_verified_absence_audit(
        labels, metadata, confuser_audit=confusers, max_images=2, max_per_author=1,
        label_source_url="https://official.test/train-labels.csv",
    )

    rows = result["candidateSelection"]["candidateRows"]
    assert [row["ImageID"] for row in rows] == ["neg-b", "neg-a"]
    assert rows[0]["classNames"] == ["chair"]
    assert all(row["binAbsenceVerified"] is True for row in rows)
    assert rows[0]["negativeEvidence"] == {
        "labelName": "/m/0bjyj5",
        "confidence": 0,
        "annotationType": "human_verified_image_label",
        "sourceUrl": "https://official.test/train-labels.csv",
    }
    assert rows[0]["Title"] == "Title neg-b"
    assert result["absenceSummary"]["verifiedAbsentImageCount"] == 2
    assert result["source"]["pixelsDownloaded"] is False
