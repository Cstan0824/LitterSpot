"""Select a deterministic, class-balanced Open Images hard-negative pool."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AUDIT = ROOT / "artifacts/dataset-readiness/openimages-v7-validation-loop2-candidates.json"
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/openimages-v7-validation-loop2-hard-negatives.json"
DEFAULT_CLASS_QUOTAS = {
    "barrel": 30,
    "bottle": 40,
    "box": 50,
    "cart": 60,
    "chair": 140,
    "handbag": 25,
    "person": 160,
    "picnic_basket": 10,
    "plastic_bag": 8,
    "table": 140,
    "traffic_sign": 20,
    "wheelchair": 30,
}


class HardNegativeSelectionError(RuntimeError):
    """Raised when an input cannot satisfy the selector contract."""


def _author_key(row: dict[str, Any]) -> str:
    author = str(row.get("AuthorProfileURL") or row.get("Author") or "").strip().casefold()
    return author or f"missing:{row.get('ImageID', '')}"


def select_hard_negatives(
    audit: dict[str, Any], *, class_quotas: dict[str, int], max_images: int,
    max_per_author: int,
) -> dict[str, Any]:
    if audit.get("source", {}).get("pixelsDownloaded") is not False:
        raise HardNegativeSelectionError("input must explicitly state source.pixelsDownloaded=false")
    if max_images <= 0 or max_per_author <= 0:
        raise ValueError("max_images and max_per_author must be positive")
    if not class_quotas or any(not name or quota <= 0 for name, quota in class_quotas.items()):
        raise ValueError("class quotas must contain positive values")
    rows = audit.get("candidateSelection", {}).get("candidateRows", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HardNegativeSelectionError("candidateSelection.candidateRows must be a list of objects")

    excluded_bins = 0
    eligible: list[dict[str, Any]] = []
    for row in rows:
        classes = {str(value) for value in row.get("classNames", [])}
        if "waste_container" in classes:
            excluded_bins += 1
            continue
        if classes & class_quotas.keys():
            eligible.append(row)
    eligible.sort(key=lambda row: str(row.get("ImageID", "")))

    by_class = {
        name: [row for row in eligible if name in row.get("classNames", [])]
        for name in sorted(class_quotas)
    }
    positions = Counter()
    selected: dict[str, dict[str, Any]] = {}
    selected_class_counts = Counter()
    selected_author_counts = Counter()

    while len(selected) < max_images:
        progressed = False
        for class_name in sorted(class_quotas):
            if selected_class_counts[class_name] >= class_quotas[class_name]:
                continue
            candidates = by_class[class_name]
            while positions[class_name] < len(candidates):
                row = candidates[positions[class_name]]
                positions[class_name] += 1
                image_id = str(row.get("ImageID", ""))
                author = _author_key(row)
                if not image_id or image_id in selected or selected_author_counts[author] >= max_per_author:
                    continue
                selected[image_id] = row
                selected_author_counts[author] += 1
                for name in set(map(str, row.get("classNames", []))) & class_quotas.keys():
                    selected_class_counts[name] += 1
                progressed = True
                break
            if len(selected) >= max_images:
                break
        if not progressed:
            break

    selected_rows = [selected[image_id] for image_id in sorted(selected)]
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {**audit.get("source", {}), "pixelsDownloaded": False},
        "selectionSummary": {
            "requestedClassQuotas": dict(sorted(class_quotas.items())),
            "maxImages": max_images,
            "maxPerAuthor": max_per_author,
            "eligibleImageCount": len(eligible),
            "excludedWasteContainerRows": excluded_bins,
            "selectedImageCount": len(selected_rows),
            "selectedClassCounts": {
                name: selected_class_counts[name] for name in sorted(class_quotas)
            },
            "selectedAuthorCounts": dict(sorted(selected_author_counts.items())),
            "unmetClassQuotas": {
                name: class_quotas[name] - selected_class_counts[name]
                for name in sorted(class_quotas)
                if selected_class_counts[name] < class_quotas[name]
            },
        },
        "candidateSelection": {"candidateRows": selected_rows},
    }


def _parse_quota(value: str) -> tuple[str, int]:
    name, separator, raw_quota = value.partition("=")
    if not separator:
        raise argparse.ArgumentTypeError("quota must use CLASS=COUNT")
    try:
        quota = int(raw_quota)
    except ValueError as error:
        raise argparse.ArgumentTypeError("quota count must be an integer") from error
    if not name or quota <= 0:
        raise argparse.ArgumentTypeError("quota must have a class and positive count")
    return name, quota


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--class-quota", action="append", type=_parse_quota)
    parser.add_argument("--max-images", type=int, default=550)
    parser.add_argument("--max-per-author", type=int, default=3)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    audit = json.loads(args.audit.read_text(encoding="utf-8"))
    quotas = dict(args.class_quota) if args.class_quota else DEFAULT_CLASS_QUOTAS
    report = select_hard_negatives(
        audit, class_quotas=quotas, max_images=args.max_images,
        max_per_author=args.max_per_author,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"output": str(args.output), **report["selectionSummary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
