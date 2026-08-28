"""Assemble Loop 2 bin-localizer data with source-verified hard negatives."""
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
DEFAULT_BASE = ROOT / "ml-training/data/bin-localizer-openimages-v0"
DEFAULT_BASE_ACQUISITION = ROOT / "ml-training/data/public/openimages-v7-v0/checkpoint.json"
DEFAULT_NEGATIVE_ACQUISITION = ROOT / "ml-training/data/public/openimages-v7-loop2-negative/manifest.json"
DEFAULT_DESTINATION = ROOT / "ml-training/data/bin-localizer-openimages-loop2"
SPLITS = ("train", "valid", "test")
ACQUIRED_STATUSES = {"downloaded", "reused"}


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _group_key(row: dict[str, Any]) -> str:
    return str(
        row.get("declaredAuthorProfileUrl") or row.get("declaredAuthor")
        or row.get("ImageID") or ""
    ).strip().casefold()


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


def prepare(
    base_dataset: Path, base_acquisition_path: Path,
    negative_acquisition_path: Path, destination: Path, *, image_mode: str = "copy",
) -> dict[str, Any]:
    if image_mode not in {"auto", "hardlink", "copy"}:
        raise ValueError(f"unsupported image mode: {image_mode}")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"destination must be empty: {destination}")
    base_report = _load(base_dataset / "build-report.json")
    base_acquisition = _load(base_acquisition_path)
    negative_acquisition = _load(negative_acquisition_path)
    if negative_acquisition.get("complete") is not True:
        raise ValueError("negative acquisition manifest must be complete")

    base_assets = {
        str(row.get("ImageID", "")): row
        for row in base_acquisition.get("records", []) if isinstance(row, dict)
    }
    heldout_ids = {
        str(image_id)
        for split in ("valid", "test")
        for image_id in base_report.get("splits", {}).get(split, {}).get("imageIds", [])
    }
    heldout_authors = {
        _group_key(base_assets[image_id]) for image_id in heldout_ids if image_id in base_assets
    }

    base_hashes: set[str] = set()
    materialization = Counter()
    base_image_count = 0
    for split in SPLITS:
        for kind in ("images", "labels"):
            source_dir = base_dataset / split / kind
            if not source_dir.is_dir():
                raise FileNotFoundError(source_dir)
            for source in sorted(path for path in source_dir.iterdir() if path.is_file()):
                destination_path = destination / split / kind / source.name
                materialization[_materialize(source, destination_path, image_mode)] += 1
                if kind == "images":
                    base_hashes.add(sha256(source.read_bytes()).hexdigest())
                    base_image_count += 1

    negative_source = Path(str(negative_acquisition.get("outputDirectory", ""))).resolve()
    exclusions = Counter()
    admitted: list[dict[str, Any]] = []
    seen_hashes = set(base_hashes)
    for asset in negative_acquisition.get("records", []):
        if not isinstance(asset, dict) or asset.get("status") not in ACQUIRED_STATUSES:
            continue
        if asset.get("binAbsenceVerified") is not True:
            exclusions["absenceNotVerified"] += 1
            continue
        if asset.get("visualReviewStatus") != "reviewed_no_bin":
            exclusions["visualReviewMissing"] += 1
            continue
        if _group_key(asset) in heldout_authors:
            exclusions["heldoutAuthorOverlap"] += 1
            continue
        filename = str(asset.get("localFilename", ""))
        source = negative_source / filename
        if not filename or Path(filename).name != filename or not source.is_file():
            exclusions["missingImageFile"] += 1
            continue
        digest = sha256(source.read_bytes()).hexdigest()
        if digest != str(asset.get("sha256", "")):
            exclusions["hashMismatch"] += 1
            continue
        if digest in seen_hashes:
            exclusions["duplicateContent"] += 1
            continue
        image_id = str(asset.get("ImageID", ""))
        destination_image = destination / "train/images" / f"{image_id}{source.suffix.lower()}"
        destination_label = destination / "train/labels" / f"{image_id}.txt"
        if destination_image.exists() or destination_label.exists():
            exclusions["destinationCollision"] += 1
            continue
        materialization[_materialize(source, destination_image, image_mode)] += 1
        destination_label.parent.mkdir(parents=True, exist_ok=True)
        destination_label.write_text("", encoding="utf-8")
        seen_hashes.add(digest)
        admitted.append({
            "ImageID": image_id,
            "image": str(destination_image.relative_to(destination).as_posix()),
            "label": str(destination_label.relative_to(destination).as_posix()),
            "sha256": digest,
            "groupKey": _group_key(asset),
            "classNames": asset.get("classNames", []),
            "familyNames": asset.get("familyNames", []),
            "binAbsenceVerified": True,
            "visualReviewStatus": "reviewed_no_bin",
            "visualReviewEvidence": asset.get("visualReviewEvidence"),
            "negativeEvidence": asset.get("negativeEvidence"),
            "acquisitionManifestRecord": asset,
        })

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
    (destination / "negative-manifest.json").write_text(
        json.dumps({"schemaVersion": 1, "records": admitted}, indent=2) + "\n",
        encoding="utf-8",
    )
    report = {
        "schemaVersion": 1,
        "task": "one-class physical bin localization with verified hard negatives",
        "sources": {
            "baseDataset": str(base_dataset.resolve()),
            "baseAcquisition": str(base_acquisition_path.resolve()),
            "negativeAcquisition": str(negative_acquisition_path.resolve()),
        },
        "splitPolicy": (
            "Frozen base train/valid/test splits; source-verified Open Images train negatives enter "
            "train only; negative authors overlapping frozen valid/test authors are excluded."
        ),
        "counts": {
            "baseImages": base_image_count,
            "addedVerifiedNegatives": len(admitted),
            "combinedImages": base_image_count + len(admitted),
        },
        "exclusions": dict(sorted(exclusions.items())),
        "imageMaterialization": dict(materialization),
        "dataYaml": str((destination / "data.yaml").resolve()),
        "readyForTraining": len(admitted) >= 300,
        "limitations": [
            "Human-verified image-level absence is stronger than missing boxes but is not local theme-park review.",
            "No overflow-state labels are produced by this builder.",
        ],
    }
    (destination / "build-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8",
    )
    return report


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-dataset", type=Path, default=DEFAULT_BASE)
    parser.add_argument("--base-acquisition", type=Path, default=DEFAULT_BASE_ACQUISITION)
    parser.add_argument("--negative-acquisition", type=Path, default=DEFAULT_NEGATIVE_ACQUISITION)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--image-mode", choices=("auto", "hardlink", "copy"), default="copy")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    report = prepare(
        args.base_dataset.resolve(), args.base_acquisition.resolve(),
        args.negative_acquisition.resolve(), args.destination.resolve(),
        image_mode=args.image_mode,
    )
    print(json.dumps(report, indent=2))
    return 0 if report["readyForTraining"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
