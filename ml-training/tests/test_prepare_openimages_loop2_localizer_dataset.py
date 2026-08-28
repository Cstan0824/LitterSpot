from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import prepare_openimages_loop2_localizer_dataset as prepare  # noqa: E402


def _write_base(root: Path) -> None:
    for split, image_id in (("train", "train-bin"), ("valid", "valid-bin"), ("test", "test-bin")):
        image = root / split / "images" / f"{image_id}.jpg"
        label = root / split / "labels" / f"{image_id}.txt"
        image.parent.mkdir(parents=True, exist_ok=True)
        label.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(f"pixels-{image_id}".encode())
        label.write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")
    (root / "build-report.json").write_text(json.dumps({
        "splits": {
            "train": {"imageIds": ["train-bin"]},
            "valid": {"imageIds": ["valid-bin"]},
            "test": {"imageIds": ["test-bin"]},
        },
    }), encoding="utf-8")


def test_builder_adds_only_verified_absence_without_heldout_author_leakage(tmp_path: Path) -> None:
    base = tmp_path / "base"
    _write_base(base)
    base_acquisition = tmp_path / "base-acquisition.json"
    base_acquisition.write_text(json.dumps({"records": [
        {"ImageID": "train-bin", "declaredAuthorProfileUrl": "author-train"},
        {"ImageID": "valid-bin", "declaredAuthorProfileUrl": "author-heldout"},
        {"ImageID": "test-bin", "declaredAuthorProfileUrl": "author-test"},
    ]}), encoding="utf-8")

    negative_images = tmp_path / "negative-images"
    negative_images.mkdir()
    for image_id in ("good", "unverified", "source-only", "heldout-author"):
        (negative_images / f"{image_id}.jpg").write_bytes(f"pixels-{image_id}".encode())
    negative_acquisition = tmp_path / "negative-acquisition.json"
    negative_acquisition.write_text(json.dumps({
        "complete": True,
        "outputDirectory": str(negative_images),
        "records": [
            {
                "ImageID": "good", "status": "downloaded", "localFilename": "good.jpg",
                "sha256": hashlib.sha256(b"pixels-good").hexdigest(),
                "declaredAuthorProfileUrl": "author-new", "binAbsenceVerified": True,
                "visualReviewStatus": "reviewed_no_bin",
                "negativeEvidence": {"labelName": "/m/0bjyj5", "confidence": 0},
            },
            {
                "ImageID": "unverified", "status": "downloaded", "localFilename": "unverified.jpg",
                "sha256": hashlib.sha256(b"pixels-unverified").hexdigest(),
                "declaredAuthorProfileUrl": "author-other", "binAbsenceVerified": False,
                "visualReviewStatus": "reviewed_no_bin",
            },
            {
                "ImageID": "source-only", "status": "downloaded",
                "localFilename": "source-only.jpg",
                "sha256": hashlib.sha256(b"pixels-source-only").hexdigest(),
                "declaredAuthorProfileUrl": "author-source", "binAbsenceVerified": True,
            },
            {
                "ImageID": "heldout-author", "status": "downloaded",
                "localFilename": "heldout-author.jpg",
                "sha256": hashlib.sha256(b"pixels-heldout-author").hexdigest(),
                "declaredAuthorProfileUrl": "author-heldout", "binAbsenceVerified": True,
                "visualReviewStatus": "reviewed_no_bin",
            },
        ],
    }), encoding="utf-8")

    destination = tmp_path / "loop2"
    report = prepare.prepare(
        base, base_acquisition, negative_acquisition, destination, image_mode="copy",
    )

    assert report["counts"]["addedVerifiedNegatives"] == 1
    assert report["exclusions"] == {
        "absenceNotVerified": 1, "heldoutAuthorOverlap": 1, "visualReviewMissing": 1,
    }
    assert (destination / "train/images/good.jpg").read_bytes() == b"pixels-good"
    assert (destination / "train/labels/good.txt").read_text(encoding="utf-8") == ""
    assert (destination / "valid/images/valid-bin.jpg").is_file()
    assert (destination / "data.yaml").is_file()
