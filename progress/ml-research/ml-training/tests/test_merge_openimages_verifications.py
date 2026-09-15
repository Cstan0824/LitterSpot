from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import merge_openimages_verifications as merge  # noqa: E402


def _chunk(start: int, records: list[dict[str, str]]) -> dict[str, object]:
    return {
        "sourceDataset": "Open Images V7",
        "pixelsDownloaded": False,
        "candidateWindow": {"startIndex": start, "maxCandidates": len(records)},
        "records": records,
    }


def test_merge_orders_chunks_and_recomputes_admission_counts() -> None:
    result = merge.merge_verifications([
        _chunk(2, [{"ImageID": "c", "status": "verified"}]),
        _chunk(0, [
            {"ImageID": "a", "status": "manual_review"},
            {"ImageID": "b", "status": "verified"},
        ]),
    ])

    assert [row["ImageID"] for row in result["records"]] == ["a", "b", "c"]
    assert result["counts"] == {"verified": 2, "rejected": 0, "manual_review": 1}
    assert result["verifiedImageIds"] == ["b", "c"]
    assert result["candidateCount"] == 3


def test_merge_rejects_duplicate_image_ids() -> None:
    with pytest.raises(merge.VerificationMergeError, match="duplicate"):
        merge.merge_verifications([
            _chunk(0, [{"ImageID": "same", "status": "verified"}]),
            _chunk(1, [{"ImageID": "same", "status": "verified"}]),
        ])
