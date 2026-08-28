from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import apply_openimages_negative_review as apply_review  # noqa: E402


def test_review_rejects_visible_bins_and_marks_every_kept_asset(tmp_path: Path) -> None:
    images = tmp_path / "images"
    images.mkdir()
    records = []
    tiles = []
    for index, image_id in enumerate(("keep", "reject")):
        path = images / f"{image_id}.jpg"
        path.write_bytes(image_id.encode())
        digest = hashlib.sha256(image_id.encode()).hexdigest()
        records.append({
            "ImageID": image_id, "status": "downloaded", "localFilename": path.name,
            "sha256": digest, "binAbsenceVerified": True,
        })
        tiles.append({
            "tileId": f"tile-{index:04d}", "sourcePath": str(path),
            "sourceSha256": digest,
        })
    manifest = {
        "complete": True, "outputDirectory": str(images), "records": records,
        "counts": {"downloaded": 2, "reused": 0, "failed": 0, "rejected": 0},
    }
    sidecars = {"page-000": {"tiles": tiles}}
    review = {
        "allTilesReviewed": True, "reviewer": "fixture reviewer",
        "reviewedAt": "2026-08-24T00:00:00Z", "reviewMethod": "fixture",
        "pages": {"page-000": {"rejectTileIds": ["tile-0001"]}},
    }

    result = apply_review.apply_visual_review(manifest, review, sidecars)

    assert result["counts"] == {"downloaded": 1, "reused": 0, "failed": 0, "rejected": 1}
    kept = next(row for row in result["records"] if row["ImageID"] == "keep")
    rejected = next(row for row in result["records"] if row["ImageID"] == "reject")
    assert kept["visualReviewStatus"] == "reviewed_no_bin"
    assert kept["binAbsenceVerified"] is True
    assert rejected["status"] == "rejected"
    assert rejected["reason"] == "visual_review_visible_bin"
    assert result["visualReview"]["reviewedTiles"] == 2
    assert result["visualReview"]["rejectedVisibleBins"] == 1
