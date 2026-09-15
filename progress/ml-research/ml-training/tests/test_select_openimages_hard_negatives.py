from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import select_openimages_hard_negatives as selector  # noqa: E402


def _row(image_id: str, classes: list[str], author: str) -> dict[str, object]:
    return {
        "ImageID": image_id,
        "classNames": classes,
        "familyNames": ["fixture"],
        "AuthorProfileURL": author,
    }


def test_selector_balances_requested_classes_excludes_bins_and_caps_authors() -> None:
    audit = {
        "source": {"dataset": "Open Images V7", "pixelsDownloaded": False},
        "candidateSelection": {"candidateRows": [
            _row("bin", ["waste_container", "chair"], "author-bin"),
            _row("chair-a", ["chair"], "author-a"),
            _row("chair-b", ["chair"], "author-b"),
            _row("table-a", ["table"], "author-a"),
            _row("table-c", ["table"], "author-c"),
            _row("cart-d", ["cart"], "author-d"),
            _row("person-e", ["person"], "author-e"),
        ]},
    }

    result = selector.select_hard_negatives(
        audit,
        class_quotas={"chair": 2, "table": 1, "cart": 1},
        max_images=4,
        max_per_author=1,
    )

    selected = result["candidateSelection"]["candidateRows"]
    assert [row["ImageID"] for row in selected] == ["cart-d", "chair-a", "chair-b", "table-c"]
    assert result["selectionSummary"]["selectedImageCount"] == 4
    assert result["selectionSummary"]["selectedClassCounts"] == {
        "cart": 1,
        "chair": 2,
        "table": 1,
    }
    assert result["selectionSummary"]["excludedWasteContainerRows"] == 1
    assert max(result["selectionSummary"]["selectedAuthorCounts"].values()) == 1
