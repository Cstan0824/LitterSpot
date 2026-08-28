from __future__ import annotations

import csv
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

from audit_cctv_bin_localizer_data import REQUIRED_FIELDS
from prepare_cctv_bin_localizer_dataset import build_dataset


def write_manifest(root: Path) -> Path:
    manifest = root / "manifest.csv"
    rows = [
        {"image": "local/positive.jpg", "source_id": "local-positive", "camera_id": "camera-a", "split": "train", "has_bin": "true", "label": "local/positive.txt", "bin_style": "wheeled", "state": "normal", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "", "review_status": "reviewed", "notes": ""},
        {"image": "local/chair.jpg", "source_id": "local-chair", "camera_id": "camera-b", "split": "test", "has_bin": "false", "label": "", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": "locked negative"},
    ]
    with manifest.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=REQUIRED_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return manifest


def test_build_dataset_merges_generic_and_reviewed_local_samples(tmp_path: Path) -> None:
    generic = tmp_path / "generic"
    for split in ("train", "valid", "test"):
        (generic / split / "images").mkdir(parents=True)
        (generic / split / "labels").mkdir(parents=True)
        Image.new("RGB", (80, 60), "white").save(generic / split / "images" / f"{split}.jpg")
        (generic / split / "labels" / f"{split}.txt").write_text(
            "0 .5 .5 .4 .6\n" if split != "test" else "", encoding="utf-8"
        )

    local_root = tmp_path / "reviewed"
    (local_root / "local").mkdir(parents=True)
    Image.new("RGB", (80, 60), "green").save(local_root / "local/positive.jpg")
    (local_root / "local/positive.txt").write_text("0 .5 .5 .4 .6\n", encoding="utf-8")
    Image.new("RGB", (80, 60), "black").save(local_root / "local/chair.jpg")
    manifest = write_manifest(local_root)

    destination = tmp_path / "combined"
    report = build_dataset(
        manifest=manifest,
        root=local_root,
        generic=generic,
        destination=destination,
        image_mode="copy",
        minimum_positive_images=3,
        minimum_negative_images=2,
        minimum_chair_negatives=1,
    )

    assert report["audit"]["passed"] is True
    assert report["coverage"]["passed"] is True
    assert report["readyForTraining"] is True
    assert len(list((destination / "train/images").iterdir())) == 2
    assert len(list((destination / "test/images").iterdir())) == 2
    local_chair_labels = list((destination / "test/labels").glob("cctv_*.txt"))
    assert len(local_chair_labels) == 1
    assert local_chair_labels[0].read_text(encoding="utf-8") == ""
    assert (destination / "data.yaml").is_file()
    assert (destination / "source-manifest.csv").is_file()
    assert (destination / "audit-report.json").is_file()
    assert (destination / "data-card.md").is_file()
    assert (destination / "review/train-contact-sheet.jpg").is_file()
    assert (destination / "review/valid-contact-sheet.jpg").is_file()
    assert (destination / "review/test-contact-sheet.jpg").is_file()
    assert (destination / "review/contact-sheet-index.json").is_file()
