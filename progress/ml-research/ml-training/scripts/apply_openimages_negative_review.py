"""Apply complete contact-sheet review decisions to a negative acquisition manifest."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "ml-training/data/public/openimages-v7-loop2-negative/manifest.json"
DEFAULT_REVIEW = ROOT / "artifacts/dataset-readiness/openimages-v7-loop2-negative-visual-review.json"
DEFAULT_OUTPUT = ROOT / "ml-training/data/public/openimages-v7-loop2-negative/manifest.reviewed.json"
ACQUIRED_STATUSES = {"downloaded", "reused"}


class VisualReviewError(RuntimeError):
    """Raised when a review does not cover the acquired pixel set exactly."""


def apply_visual_review(
    manifest: dict[str, Any], review: dict[str, Any],
    sidecars: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if manifest.get("complete") is not True:
        raise VisualReviewError("acquisition manifest must be complete")
    if review.get("allTilesReviewed") is not True:
        raise VisualReviewError("review must explicitly state allTilesReviewed=true")
    review_pages = review.get("pages", {})
    if not isinstance(review_pages, dict) or set(review_pages) != set(sidecars):
        raise VisualReviewError("review pages must exactly match contact-sheet sidecars")

    tile_by_filename: dict[str, tuple[str, dict[str, Any]]] = {}
    rejected_tiles: set[tuple[str, str]] = set()
    for page_name, sidecar in sidecars.items():
        tiles = sidecar.get("tiles", [])
        if not isinstance(tiles, list):
            raise VisualReviewError(f"{page_name} sidecar tiles must be a list")
        known_tile_ids = set()
        for tile in tiles:
            if not isinstance(tile, dict):
                raise VisualReviewError(f"{page_name} tile must be an object")
            tile_id = str(tile.get("tileId", ""))
            filename = Path(str(tile.get("sourcePath", ""))).name
            if not tile_id or not filename or filename in tile_by_filename:
                raise VisualReviewError("blank or duplicate contact-sheet tile identity")
            known_tile_ids.add(tile_id)
            tile_by_filename[filename] = (page_name, tile)
        reject_values = review_pages[page_name].get("rejectTileIds", [])
        if not isinstance(reject_values, list):
            raise VisualReviewError(f"{page_name} rejectTileIds must be a list")
        unknown = {str(value) for value in reject_values} - known_tile_ids
        if unknown:
            raise VisualReviewError(f"{page_name} rejects unknown tiles: {sorted(unknown)}")
        rejected_tiles.update((page_name, str(value)) for value in reject_values)

    updated_records: list[dict[str, Any]] = []
    reviewed_count = 0
    rejected_count = 0
    acquired_filenames: set[str] = set()
    for original in manifest.get("records", []):
        if not isinstance(original, dict):
            raise VisualReviewError("manifest record must be an object")
        row = dict(original)
        if row.get("status") not in ACQUIRED_STATUSES:
            updated_records.append(row)
            continue
        filename = str(row.get("localFilename", ""))
        tile_value = tile_by_filename.get(filename)
        if tile_value is None:
            raise VisualReviewError(f"acquired asset is absent from contact sheets: {filename}")
        page_name, tile = tile_value
        if str(tile.get("sourceSha256", "")) != str(row.get("sha256", "")):
            raise VisualReviewError(f"contact-sheet hash differs for {filename}")
        acquired_filenames.add(filename)
        reviewed_count += 1
        tile_id = str(tile["tileId"])
        visual_evidence = {
            "status": "visible_bin" if (page_name, tile_id) in rejected_tiles else "reviewed_no_bin",
            "reviewer": review.get("reviewer"),
            "reviewedAt": review.get("reviewedAt"),
            "method": review.get("reviewMethod"),
            "page": page_name,
            "tileId": tile_id,
        }
        if (page_name, tile_id) in rejected_tiles:
            row.update({
                "status": "rejected",
                "reason": "visual_review_visible_bin",
                "visualReviewStatus": "visible_bin",
                "visualReviewEvidence": visual_evidence,
            })
            rejected_count += 1
        else:
            row.update({
                "binAbsenceVerified": True,
                "visualReviewStatus": "reviewed_no_bin",
                "visualReviewEvidence": visual_evidence,
            })
        updated_records.append(row)
    unlinked_tiles = set(tile_by_filename) - acquired_filenames
    if unlinked_tiles:
        raise VisualReviewError(
            f"contact sheets contain assets absent from acquisition manifest: {len(unlinked_tiles)}"
        )

    counts = Counter(str(row.get("status", "")) for row in updated_records)
    return {
        **manifest,
        "records": updated_records,
        "counts": {
            name: counts[name] for name in ("downloaded", "reused", "failed", "rejected")
        },
        "visualReview": {
            "reviewedTiles": reviewed_count,
            "rejectedVisibleBins": rejected_count,
            "admittedNoBin": reviewed_count - rejected_count,
            "reviewer": review.get("reviewer"),
            "reviewedAt": review.get("reviewedAt"),
            "method": review.get("reviewMethod"),
            "allTilesReviewed": True,
        },
    }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    review = json.loads(args.review.read_text(encoding="utf-8"))
    contact_root = ROOT / str(review.get("contactSheetRoot", ""))
    sidecars = {
        page_name: json.loads((contact_root / page_name / "sidecar.json").read_text(encoding="utf-8"))
        for page_name in review.get("pages", {})
    }
    result = apply_visual_review(manifest, review, sidecars)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"output": str(args.output), **result["visualReview"], "counts": result["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
