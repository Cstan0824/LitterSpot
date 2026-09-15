"""Build a deterministic one-class YOLO dataset from acquired Open Images bins."""
from __future__ import annotations

import argparse
from collections import Counter
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ACQUISITION = ROOT / "ml-training/data/public/openimages-v7-v0/manifest.json"
DEFAULT_BOXES = ROOT / "artifacts/dataset-readiness/openimages-v7-verified-bin-boxes.json"
DEFAULT_DESTINATION = ROOT / "ml-training/data/bin-localizer-openimages-v0"
ACQUIRED_STATUSES = {"downloaded", "reused"}
SPLITS = ("train", "valid", "test")


def _load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def _clean_boxes(rows: Iterable[dict[str, Any]], filtered: Counter[str]) -> list[tuple[float, float, float, float]]:
    clean: list[tuple[float, float, float, float]] = []
    for row in rows:
        if bool(row.get("isDepiction")):
            filtered["depiction"] += 1
            continue
        if bool(row.get("isGroupOf")):
            filtered["groupOf"] += 1
            continue
        values = row.get("xyxyNormalized")
        if not isinstance(values, list) or len(values) != 4:
            filtered["invalid"] += 1
            continue
        try:
            x1, y1, x2, y2 = (min(1.0, max(0.0, float(value))) for value in values)
        except (TypeError, ValueError):
            filtered["invalid"] += 1
            continue
        if x2 <= x1 or y2 <= y1:
            filtered["invalid"] += 1
            continue
        clean.append(((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1))
    return clean


def _split_assignments(rows: list[dict[str, str]]) -> dict[str, str]:
    groups: dict[str, list[str]] = {}
    for row in rows:
        groups.setdefault(row["groupKey"], []).append(row["ImageID"])
    ordered_groups = sorted(
        groups,
        key=lambda value: (sha256(value.encode("utf-8")).hexdigest(), value),
    )
    total_groups = len(ordered_groups)
    if total_groups < 3:
        return {image_id: "train" for image_ids in groups.values() for image_id in image_ids}
    valid_groups = max(1, round(total_groups * 0.1))
    test_groups = max(1, round(total_groups * 0.1))
    if valid_groups + test_groups >= total_groups:
        valid_groups = test_groups = 1
    train_end = total_groups - valid_groups - test_groups
    valid_end = total_groups - test_groups
    split_for_group = {
        group: "train" if index < train_end else ("valid" if index < valid_end else "test")
        for index, group in enumerate(ordered_groups)
    }
    return {
        image_id: split_for_group[group]
        for group, image_ids in groups.items()
        for image_id in image_ids
    }


def _materialize(source: Path, destination: Path, mode: str) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if mode in {"auto", "hardlink"}:
        try:
            os.link(source, destination)
            return "hardlink"
        except OSError:
            if mode == "hardlink":
                raise
    shutil.copy2(source, destination)
    return "copy"


def _write_label(path: Path, boxes: list[tuple[float, float, float, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = ["0 " + " ".join(f"{value:.8f}" for value in box) for box in boxes]
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")


def prepare(
    acquisition_path: Path,
    boxes_path: Path,
    destination: Path,
    *,
    image_mode: str = "copy",
    allow_partial: bool = False,
) -> dict[str, Any]:
    if image_mode not in {"auto", "hardlink", "copy"}:
        raise ValueError(f"Unsupported image mode: {image_mode}")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"Destination must be empty: {destination}")
    acquisition = _load_json(acquisition_path)
    acquisition_complete = acquisition.get("complete") is True
    if not acquisition_complete and not allow_partial:
        raise ValueError("Acquisition manifest must be complete")
    boxes_artifact = _load_json(boxes_path)
    source_value = acquisition.get("outputDirectory")
    source_dir = Path(str(source_value)).resolve() if source_value else acquisition_path.resolve().parent / "images"
    box_records = {
        str(row.get("ImageID")): row
        for row in boxes_artifact.get("records", [])
        if isinstance(row, dict) and row.get("ImageID")
    }
    filtered: Counter[str] = Counter()
    exclusions: Counter[str] = Counter()
    candidates: list[dict[str, Any]] = []
    for asset in acquisition.get("records", []):
        if not isinstance(asset, dict) or asset.get("status") not in ACQUIRED_STATUSES:
            continue
        image_id = str(asset.get("ImageID", ""))
        filename = str(asset.get("localFilename", ""))
        source = source_dir / filename
        if not source.is_file():
            exclusions["missingImageFile"] += 1
            continue
        box_record = box_records.get(image_id)
        if box_record is None:
            exclusions["missingBoxRecord"] += 1
            continue
        rows = box_record.get("boxes", [])
        clean = _clean_boxes(rows if isinstance(rows, list) else [], filtered)
        if not clean:
            exclusions["allBoxesFiltered"] += 1
            continue
        group_key = str(asset.get("declaredAuthorProfileUrl") or asset.get("declaredAuthor") or image_id).strip()
        candidates.append({
            "ImageID": image_id,
            "groupKey": group_key,
            "source": source,
            "boxes": clean,
            "asset": asset,
        })

    assignments = _split_assignments([
        {"ImageID": row["ImageID"], "groupKey": row["groupKey"]}
        for row in candidates
    ])
    split_rows: dict[str, list[dict[str, Any]]] = {split: [] for split in SPLITS}
    materialization: Counter[str] = Counter()
    for row in candidates:
        image_id = row["ImageID"]
        split = assignments[image_id]
        source: Path = row["source"]
        output_image = destination / split / "images" / f"{image_id}{source.suffix.lower()}"
        output_label = destination / split / "labels" / f"{image_id}.txt"
        materialization[_materialize(source, output_image, image_mode)] += 1
        _write_label(output_label, row["boxes"])
        split_rows[split].append(row)

    destination.mkdir(parents=True, exist_ok=True)
    data_yaml = (
        f"path: {destination.resolve().as_posix()}\n"
        "train: train/images\n"
        "val: valid/images\n"
        "test: test/images\n"
        "names:\n"
        "  0: trash bin\n"
    )
    (destination / "data.yaml").write_text(data_yaml, encoding="utf-8")
    report = {
        "schemaVersion": 1,
        "task": "one-class physical bin localization",
        "acquisitionComplete": acquisition_complete,
        "previewOnly": not acquisition_complete,
        "sources": {
            "acquisitionManifest": str(acquisition_path.resolve()),
            "boxArtifact": str(boxes_path.resolve()),
            "imageDirectory": str(source_dir),
        },
        "splitPolicy": (
            "SHA-256(author profile URL, then author, then ImageID fallback), approximately 80/10/10 by group; "
            "an author group never crosses splits"
        ),
        "boxPolicy": "exclude Open Images depiction and group-of boxes; clamp normalized physical boxes",
        "counts": {
            "images": len(candidates),
            "boxes": sum(len(row["boxes"]) for row in candidates),
        },
        "splits": {
            split: {
                "images": len(rows),
                "boxes": sum(len(row["boxes"]) for row in rows),
                "imageIds": [row["ImageID"] for row in rows],
            }
            for split, rows in split_rows.items()
        },
        "filteredBoxes": {key: filtered[key] for key in ("depiction", "groupOf", "invalid")},
        "exclusions": {key: exclusions[key] for key in ("allBoxesFiltered", "missingBoxRecord", "missingImageFile")},
        "imageMaterialization": dict(materialization),
        "dataYaml": str((destination / "data.yaml").resolve()),
        "readyForTraining": len(candidates) >= 3 and all(split_rows[split] for split in SPLITS),
        "limitations": [
            "V0 web-photo dataset; it is not theme-park-domain validation.",
            "Open Images flags do not identify every product rendering or atypical bin.",
            "No overflow-state labels are created by this builder.",
        ],
    }
    (destination / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition", type=Path, default=DEFAULT_ACQUISITION)
    parser.add_argument("--boxes", type=Path, default=DEFAULT_BOXES)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument(
        "--image-mode",
        choices=("auto", "hardlink", "copy"),
        default="copy",
        help="Copy by default so image-library repairs cannot mutate the attributed source cache.",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Build a preview-only dataset from acquired rows in an incomplete checkpoint.",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = prepare(
            args.acquisition,
            args.boxes,
            args.destination,
            image_mode=args.image_mode,
            allow_partial=args.allow_partial,
        )
    except (FileNotFoundError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(report, indent=2))
    return 0 if report["readyForTraining"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
