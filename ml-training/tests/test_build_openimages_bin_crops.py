from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import build_openimages_bin_crops as build  # noqa: E402


def test_cli_builds_review_crop_from_validated_source_and_normalized_box(tmp_path: Path) -> None:
    images = tmp_path / "images"
    images.mkdir()
    source = images / "image-a.jpg"
    Image.new("RGB", (100, 80), (50, 100, 150)).save(source, quality=95)
    source_bytes = source.read_bytes()
    acquisition_path = tmp_path / "acquisition.json"
    boxes_path = tmp_path / "boxes.json"
    output_dir = tmp_path / "crops"
    acquisition_path.write_text(json.dumps({
        "schemaVersion": 1,
        "outputDirectory": str(images.resolve()),
        "records": [{
            "ImageID": "image-a",
            "status": "downloaded",
            "localFilename": source.name,
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
            "byteCount": len(source_bytes),
            "width": 100,
            "height": 80,
            "title": "A supplied title",
            "declaredAuthor": "Author",
            "declaredAuthorProfileUrl": "https://photos.test/author",
            "declaredLicense": "https://creativecommons.org/licenses/by/2.0/",
            "landingUrl": "https://photos.test/image-a",
            "originalUrl": "https://pixels.test/image-a.jpg",
        }],
    }), encoding="utf-8")
    boxes_path.write_text(json.dumps({
        "schemaVersion": 1,
        "readyForCropping": True,
        "records": [{
            "ImageID": "image-a",
            "boxes": [{
                "xyxyNormalized": [0.1, 0.2, 0.5, 0.75],
                "isOccluded": False,
                "isTruncated": False,
                "isGroupOf": False,
                "isDepiction": False,
                "isInside": False,
            }],
        }],
    }), encoding="utf-8")

    assert build.main([
        "--acquisition-manifest", str(acquisition_path),
        "--boxes", str(boxes_path),
        "--output-dir", str(output_dir),
        "--padding", "0",
    ]) == 0

    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"] == {"sourceImages": 1, "crops": 1, "failures": 0}
    crop_record = manifest["records"][0]
    assert crop_record["ImageID"] == "image-a"
    assert crop_record["sourceSha256"] == hashlib.sha256(source_bytes).hexdigest()
    assert crop_record["title"] == "A supplied title"
    assert crop_record["isDerivative"] is True
    assert crop_record["changesDescription"] == "cropped to the official Waste container bounding box"
    with Image.open(output_dir / crop_record["localFilename"]) as crop:
        assert crop.size == (40, 44)
