from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

from audit_gbs_zenodo_metadata import validate_record  # noqa: E402
from sample_gbs_zenodo_visual_audit import (  # noqa: E402
    STRATA,
    _atomic_write_json,
    assign_stratum,
    completed_rows_by_id,
    prune_unreferenced_pixels,
    render_contact_sheets,
    resume_completed_ids,
    sha256_bytes,
    stratified_sample,
    validate_final_materialization,
)


def image_row(image_id: int) -> dict:
    return {"id": image_id, "file_name": f"{image_id:06d}.jpg", "width": 100, "height": 80}


def annotations(*categories: str) -> list[dict]:
    ids = {"garbage_bin": 1, "overflow": 0, "garbage": 2}
    return [
        {"id": index + 1, "image_id": 1, "category_id": ids[name], "bbox": [10 + index, 10, 20, 20]}
        for index, name in enumerate(categories)
    ]


def test_strata_are_disjoint_and_preserve_source_semantics() -> None:
    by_id = {
        1: annotations("garbage_bin"),
        2: annotations("overflow"),
        3: annotations("garbage_bin", "overflow"),
        4: annotations("garbage_bin", "garbage"),
        5: annotations("garbage"),
    }
    categories = {0: "overflow", 1: "garbage_bin", 2: "garbage"}

    assert [assign_stratum(rows, categories) for rows in by_id.values()] == [
        "garbage_bin_only",
        "overflow_present",
        "overflow_present",
        "mixed_garbage_context",
        "mixed_garbage_context",
    ]


def test_stratified_sample_is_seeded_balanced_and_unique() -> None:
    categories = {0: "overflow", 1: "garbage_bin", 2: "garbage"}
    by_id = {}
    image_rows = []
    image_id = 1
    for _ in range(7):
        image_rows.append(image_row(image_id)); by_id[image_id] = annotations("garbage_bin"); image_id += 1
    for _ in range(5):
        image_rows.append(image_row(image_id)); by_id[image_id] = annotations("overflow"); image_id += 1
    for _ in range(4):
        image_rows.append(image_row(image_id)); by_id[image_id] = annotations("garbage"); image_id += 1

    selected, report = stratified_sample(image_rows, by_id, categories, total=12, seed=17)

    assert len(selected) == 12
    assert len({row["imageId"] for row in selected}) == 12
    assert set(report["stratumCounts"]) == set(STRATA)
    assert report["stratumCounts"] == {
        "garbage_bin_only": 4,
        "overflow_present": 4,
        "mixed_garbage_context": 4,
    }
    selected_again, report_again = stratified_sample(image_rows, by_id, categories, total=12, seed=17)
    assert [row["imageId"] for row in selected_again] == [row["imageId"] for row in selected]
    assert report_again == report


def test_contact_sheets_are_paginated_and_indexed(tmp_path: Path) -> None:
    annotated = tmp_path / "annotated"
    annotated.mkdir()
    rows = []
    for index in range(3):
        path = annotated / f"sample-{index}.jpg"
        Image.new("RGB", (100, 80), (index * 50, 100, 150)).save(path)
        rows.append({"sampleId": f"gbs-{index:04d}", "annotatedPath": str(path)})

    report = render_contact_sheets(rows, tmp_path / "contact-sheets", page_size=2)

    assert [page["path"] for page in report["pages"]] == [
        "contact-sheets/contact-sheet-001.jpg",
        "contact-sheets/contact-sheet-002.jpg",
    ]
    assert [page["sampleIds"] for page in report["pages"]] == [
        ["gbs-0000", "gbs-0001"],
        ["gbs-0002"],
    ]
    assert all(page["bytes"] > 0 and len(page["sha256"]) == 64 for page in report["pages"])
    assert (tmp_path / "contact-sheets/contact-sheet-001.jpg").is_file()
    assert (tmp_path / "contact-sheets/contact-sheet-002.jpg").is_file()


def test_resume_completed_ids_requires_a_valid_existing_original(tmp_path: Path) -> None:
    original = tmp_path / "images/garbage_bin_only/source-000001.jpg"
    original.parent.mkdir(parents=True)
    original.write_bytes(b"original-one")
    checkpoint = {
        "completed": [
            {
                "source": {"imageId": 1},
                "original": {
                    "path": "images/garbage_bin_only/source-000001.jpg",
                    "sha256": sha256_bytes(b"original-one"),
                },
            },
            {
                "source": {"imageId": 2},
                "original": {
                    "path": "images/garbage_bin_only/source-000002.jpg",
                    "sha256": sha256_bytes(b"missing"),
                },
            },
        ]
    }

    selected = [
        {"imageId": 1, "stratum": "garbage_bin_only"},
        {"imageId": 2, "stratum": "garbage_bin_only"},
    ]

    assert resume_completed_ids(checkpoint, selected, tmp_path) == {1}


def test_checkpoint_is_atomic_and_incomplete_run_has_no_final_manifest(tmp_path: Path) -> None:
    checkpoint = tmp_path / "checkpoint.json"
    manifest = tmp_path / "manifest.json"

    _atomic_write_json(checkpoint, {"completedCount": 1, "completed": []})

    assert checkpoint.is_file()
    assert not manifest.exists()
    assert not list(tmp_path.glob(".checkpoint.json.tmp"))


def test_completed_rows_require_all_referenced_pixels_and_checksum(tmp_path: Path) -> None:
    original = tmp_path / "images/garbage_bin_only/source-000001.jpg"
    annotated = tmp_path / "annotated/garbage_bin_only/source-000001.jpg"
    crop = tmp_path / "crops/garbage_bin_only/source-000001-ann-000001-garbage_bin.jpg"
    for path, color in ((original, (10, 20, 30)), (annotated, (30, 20, 10)), (crop, (20, 30, 10))):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (20, 20), color).save(path)
    row = {
        "sampleId": "gbs-visual-0001",
        "stratum": "garbage_bin_only",
        "source": {"imageId": 1},
        "original": {
            "path": "images/garbage_bin_only/source-000001.jpg",
            "sha256": sha256_bytes(original.read_bytes()),
            "bytes": original.stat().st_size,
        },
        "annotatedPath": "annotated/garbage_bin_only/source-000001.jpg",
        "annotatedSha256": sha256_bytes(annotated.read_bytes()),
        "annotatedBytes": annotated.stat().st_size,
        "crops": [{
            "path": "crops/garbage_bin_only/source-000001-ann-000001-garbage_bin.jpg",
            "sha256": sha256_bytes(crop.read_bytes()),
            "bytes": crop.stat().st_size,
        }],
    }
    checkpoint = {"completed": [row]}
    selected = [{"imageId": 1, "stratum": "garbage_bin_only"}]

    assert set(completed_rows_by_id(checkpoint, selected, tmp_path)) == {1}
    annotated.write_bytes(b"corrupt")
    assert completed_rows_by_id(checkpoint, selected, tmp_path) == {}


def test_prune_and_validate_final_pixels_reject_orphans(tmp_path: Path) -> None:
    original = tmp_path / "images/garbage_bin_only/source-000001.jpg"
    annotated = tmp_path / "annotated/garbage_bin_only/source-000001.jpg"
    orphan = tmp_path / "annotated/garbage_bin_only/orphan.jpg"
    for path in (original, annotated, orphan):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (20, 20), (20, 30, 40)).save(path)
    row = {
        "sampleId": "gbs-visual-0001",
        "stratum": "garbage_bin_only",
        "source": {"imageId": 1},
        "original": {"path": "images/garbage_bin_only/source-000001.jpg", "sha256": sha256_bytes(original.read_bytes()), "bytes": original.stat().st_size},
        "annotatedPath": "annotated/garbage_bin_only/source-000001.jpg",
        "annotatedSha256": sha256_bytes(annotated.read_bytes()),
        "annotatedBytes": annotated.stat().st_size,
        "crops": [],
    }
    contact = {"pages": []}
    removed = prune_unreferenced_pixels([row], contact, tmp_path)

    assert "annotated/garbage_bin_only/orphan.jpg" in removed
    assert not orphan.exists()
    audit = validate_final_materialization(
        [row],
        [{"imageId": 1, "stratum": "garbage_bin_only"}],
        contact,
        tmp_path,
    )
    assert audit["orphanedPixelCount"] == 0
