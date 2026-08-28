from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import prepare_openimages_bin_localizer_dataset as prepare_oi  # noqa: E402


def _write_image(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (20, 10), color).save(path)


def test_prepare_builds_deterministic_three_way_yolo_dataset(tmp_path: Path) -> None:
    source = tmp_path / "source"
    records = []
    box_records = []
    for index, image_id in enumerate(("bin-a", "bin-b", "bin-c")):
        filename = f"{image_id}.jpg"
        _write_image(source / filename, (index * 20, 30, 40))
        records.append({
            "ImageID": image_id,
            "status": "downloaded",
            "localFilename": filename,
            "sha256": f"hash-{image_id}",
            "landingUrl": f"https://example.test/{image_id}",
            "declaredLicense": "https://creativecommons.org/licenses/by/2.0/",
            "declaredAuthor": "Test Author",
            "declaredAuthorProfileUrl": f"https://example.test/authors/{image_id}",
            "title": image_id,
        })
        box_records.append({
            "ImageID": image_id,
            "boxes": [{
                "xyxyNormalized": [0.1, 0.2, 0.6, 0.8],
                "isDepiction": False,
                "isGroupOf": False,
            }],
        })

    acquisition = tmp_path / "acquisition.json"
    boxes = tmp_path / "boxes.json"
    destination = tmp_path / "dataset"
    acquisition.write_text(json.dumps({
        "sourceDataset": "Open Images V7",
        "outputDirectory": str(source),
        "complete": True,
        "records": records,
    }), encoding="utf-8")
    boxes.write_text(json.dumps({"records": box_records}), encoding="utf-8")

    report = prepare_oi.prepare(acquisition, boxes, destination)

    assert report["readyForTraining"] is True
    assert report["counts"]["images"] == 3
    assert report["counts"]["boxes"] == 3
    assert {name: values["images"] for name, values in report["splits"].items()} == {
        "train": 1,
        "valid": 1,
        "test": 1,
    }
    split_ids = [
        image_id
        for split in report["splits"].values()
        for image_id in split["imageIds"]
    ]
    assert sorted(split_ids) == ["bin-a", "bin-b", "bin-c"]
    assert len(split_ids) == len(set(split_ids))
    labels = list(destination.glob("*/labels/*.txt"))
    assert len(labels) == 3
    assert all(path.read_text(encoding="utf-8").strip() == "0 0.35000000 0.50000000 0.50000000 0.60000000" for path in labels)
    assert (destination / "data.yaml").is_file()
    assert (destination / "build-report.json").is_file()
    assert report["imageMaterialization"] == {"copy": 3}


def test_prepare_excludes_depictions_group_boxes_and_unmatched_assets(tmp_path: Path) -> None:
    source = tmp_path / "source"
    for image_id in ("physical", "depiction", "unmatched"):
        _write_image(source / f"{image_id}.jpg", (1, 2, 3))
    acquisition = tmp_path / "acquisition.json"
    boxes = tmp_path / "boxes.json"
    acquisition.write_text(json.dumps({
        "outputDirectory": str(source),
        "complete": True,
        "records": [
            {"ImageID": image_id, "status": "downloaded", "localFilename": f"{image_id}.jpg"}
            for image_id in ("physical", "depiction", "unmatched")
        ],
    }), encoding="utf-8")
    boxes.write_text(json.dumps({"records": [
        {"ImageID": "physical", "boxes": [
            {"xyxyNormalized": [0.2, 0.2, 0.7, 0.9], "isDepiction": False, "isGroupOf": False},
            {"xyxyNormalized": [0.1, 0.1, 0.2, 0.2], "isDepiction": False, "isGroupOf": True},
        ]},
        {"ImageID": "depiction", "boxes": [
            {"xyxyNormalized": [0.1, 0.1, 0.9, 0.9], "isDepiction": True, "isGroupOf": False},
        ]},
    ]}), encoding="utf-8")

    report = prepare_oi.prepare(acquisition, boxes, tmp_path / "dataset", image_mode="copy")

    assert report["counts"]["images"] == 1
    assert report["counts"]["boxes"] == 1
    assert report["exclusions"] == {
        "allBoxesFiltered": 1,
        "missingBoxRecord": 1,
        "missingImageFile": 0,
    }
    assert report["filteredBoxes"] == {"depiction": 1, "groupOf": 1, "invalid": 0}


def test_split_assignment_keeps_same_author_group_together() -> None:
    rows = [
        {"ImageID": "series-a", "groupKey": "author/shared"},
        {"ImageID": "series-b", "groupKey": "author/shared"},
        {"ImageID": "single-c", "groupKey": "author/c"},
        {"ImageID": "single-d", "groupKey": "author/d"},
        {"ImageID": "single-e", "groupKey": "author/e"},
        {"ImageID": "single-f", "groupKey": "author/f"},
    ]

    assignments = prepare_oi._split_assignments(rows)

    assert assignments["series-a"] == assignments["series-b"]
    assert set(assignments.values()) == {"train", "valid", "test"}


def test_partial_checkpoint_requires_explicit_preview_opt_in(tmp_path: Path) -> None:
    source = tmp_path / "source"
    records = []
    box_rows = []
    for image_id in ("partial-a", "partial-b", "partial-c"):
        _write_image(source / f"{image_id}.jpg", (4, 5, 6))
        records.append({
            "ImageID": image_id,
            "status": "downloaded",
            "localFilename": f"{image_id}.jpg",
            "declaredAuthorProfileUrl": f"author/{image_id}",
        })
        box_rows.append({"ImageID": image_id, "boxes": [{
            "xyxyNormalized": [0.1, 0.1, 0.9, 0.9],
            "isDepiction": False,
            "isGroupOf": False,
        }]})
    acquisition = tmp_path / "checkpoint.json"
    boxes = tmp_path / "boxes.json"
    acquisition.write_text(json.dumps({
        "outputDirectory": str(source),
        "complete": False,
        "records": records,
    }), encoding="utf-8")
    boxes.write_text(json.dumps({"records": box_rows}), encoding="utf-8")

    try:
        prepare_oi.prepare(acquisition, boxes, tmp_path / "blocked", image_mode="copy")
    except ValueError as error:
        assert "complete" in str(error)
    else:
        raise AssertionError("partial acquisition unexpectedly accepted without opt-in")

    report = prepare_oi.prepare(
        acquisition,
        boxes,
        tmp_path / "preview",
        image_mode="copy",
        allow_partial=True,
    )

    assert report["acquisitionComplete"] is False
    assert report["previewOnly"] is True
    assert report["readyForTraining"] is True
