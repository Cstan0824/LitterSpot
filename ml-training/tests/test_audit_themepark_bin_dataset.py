from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

from audit_themepark_bin_dataset import audit  # noqa: E402


def make_image(path: Path, color: str) -> tuple[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 24), color).save(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest, digest[:16]


def base_row(path: str, digest: str, phash: str, *, sample_id: str, source: str, split: str, group: str, task: str) -> dict:
    return {
        "sampleId": sample_id,
        "image": path,
        "sourceId": source,
        "sourceRecord": f"https://example.test/{source}",
        "attribution": "Dataset Author",
        "license": {"id": "cc-by-4.0", "url": "https://creativecommons.org/licenses/by/4.0/"},
        "commercialUseStatus": "approved",
        "sha256": digest,
        "perceptualHash64": phash,
        "groupId": group,
        "split": split,
        "task": task,
        "reviewStatus": "reviewed",
        "isLockedAcceptance": False,
    }


def write_manifest(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_audit_counts_only_reviewed_styles_verified_negatives_and_state_evidence(tmp_path: Path) -> None:
    positive_sha, positive_phash = make_image(tmp_path / "images/positive.png", "green")
    negative_sha, negative_phash = make_image(tmp_path / "images/negative.png", "black")
    overflow_sha, overflow_phash = make_image(tmp_path / "images/overflow.png", "red")
    rows = [
        {
            **base_row("images/positive.png", positive_sha, positive_phash, sample_id="p", source="source-a", split="train", group="p-group", task="localizer_positive"),
            "binStyle": "wheeled_closed_lid",
            "appearanceReviewStatus": "reviewed",
        },
        {
            **base_row("images/negative.png", negative_sha, negative_phash, sample_id="n", source="source-b", split="valid", group="n-group", task="localizer_negative"),
            "negativeFamily": "chair",
            "binAbsenceVerified": True,
        },
        {
            **base_row("images/overflow.png", overflow_sha, overflow_phash, sample_id="s", source="source-c", split="test", group="s-group", task="state"),
            "state": "overflow",
            "stateEvidenceType": "reviewed_crop",
            "edgeTags": [],
            "completeSourceHoldout": True,
        },
    ]
    manifest = tmp_path / "manifest.jsonl"
    write_manifest(manifest, rows)

    report = audit(manifest, tmp_path)

    assert report["counts"]["positiveImages"] == 1
    assert report["counts"]["style"]["wheeled_closed_lid"] == 1
    assert report["counts"]["negativeFamily"]["chair"] == 1
    assert report["counts"]["state"]["overflow"] == 1
    assert report["counts"]["heldOutSources"] == ["source-c"]
    assert report["readyForTraining"] is False
    assert report["errors"] == []


def test_audit_rejects_locked_unlicensed_negative_and_split_leakage(tmp_path: Path) -> None:
    digest, phash = make_image(tmp_path / "images/shared.png", "blue")
    row_a = {
        **base_row("images/shared.png", digest, phash, sample_id="a", source="whatsapp-locked", split="train", group="shared", task="localizer_negative"),
        "commercialUseStatus": "unknown",
        "isLockedAcceptance": True,
        "negativeFamily": "chair",
        "binAbsenceVerified": False,
    }
    row_b = {
        **base_row("images/shared.png", digest, phash, sample_id="b", source="source-b", split="test", group="shared", task="localizer_positive"),
        "binStyle": "open_top_cylindrical",
        "appearanceReviewStatus": "reviewed",
    }
    manifest = tmp_path / "manifest.jsonl"
    write_manifest(manifest, [row_a, row_b])

    report = audit(manifest, tmp_path)

    assert report["readyForTraining"] is False
    assert any("locked acceptance" in error for error in report["errors"])
    assert any("commercialUseStatus" in error for error in report["errors"])
    assert any("binAbsenceVerified" in error for error in report["errors"])
    assert report["gates"]["crossSplitContentLeaks"]["passed"] is False
    assert report["gates"]["crossSplitGroupLeaks"]["passed"] is False
    assert report["gates"]["crossSplitPerceptualLeaks"]["passed"] is False
    assert report["admittedRows"] == 1
    assert report["counts"]["hardNegativeImages"] == 0
