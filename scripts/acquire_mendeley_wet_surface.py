"""Acquire and inventory the CC BY 4.0 Mendeley wet-surface dataset.

Pixels are extracted only into the ignored specialist source cache. The
tracked source record documents attribution and prevents this public dataset
from being counted as real-camera qualification evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE_RECORD = ROOT / "ml-training/data/specialists/sources/mendeley-wet-surface-v4.json"
CACHE = ROOT / "ml-training/data/specialists/source-cache/mendeley-wet-surface-v4"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_members(archive: zipfile.ZipFile, destination: Path) -> list[zipfile.ZipInfo]:
    destination = destination.resolve()
    members: list[zipfile.ZipInfo] = []
    for member in archive.infolist():
        relative = Path(member.filename)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"unsafe archive member: {member.filename}")
        target = (destination / relative).resolve()
        try:
            target.relative_to(destination)
        except ValueError as error:
            raise ValueError(f"archive member escapes destination: {member.filename}") from error
        members.append(member)
    return members


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 LitterSpot dataset acquisition",
            "Referer": "https://data.mendeley.com/datasets/y6zyrnxbfm/4",
        },
    )
    with urllib.request.urlopen(request) as response, partial.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    partial.replace(destination)


def acquire(
    source_record: Path = SOURCE_RECORD,
    cache: Path = CACHE,
    *,
    download_if_missing: bool = True,
) -> dict[str, Any]:
    source = json.loads(source_record.read_text(encoding="utf-8"))
    archive_path = cache / "y6zyrnxbfm-4.zip"
    extracted = cache / "extracted"
    if not archive_path.is_file():
        if not download_if_missing:
            raise FileNotFoundError(archive_path)
        download(source["downloadUrl"], archive_path)
    actual_bytes = archive_path.stat().st_size
    if actual_bytes != source["declaredArchiveBytes"]:
        raise ValueError(
            f"archive size mismatch: expected {source['declaredArchiveBytes']}, got {actual_bytes}"
        )
    extracted.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        members = safe_members(archive, extracted)
        archive.extractall(extracted, members=members)
    nested_record = source["preferredNestedArchive"]
    nested_matches = list(extracted.rglob(nested_record["name"]))
    if len(nested_matches) != 1:
        raise ValueError(f"expected one preferred nested archive, found {len(nested_matches)}")
    nested_archive = nested_matches[0]
    if nested_archive.stat().st_size != nested_record["bytes"] or sha256(nested_archive) != nested_record["sha256"]:
        raise ValueError("preferred nested archive does not match the tracked size/hash")
    dataset_root = cache / "dataset"
    dataset_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(nested_archive) as nested:
        nested_members = safe_members(nested, dataset_root)
        nested.extractall(dataset_root, members=nested_members)
    suffixes = Counter(path.suffix.lower() or "<none>" for path in dataset_root.rglob("*") if path.is_file())
    image_paths = [
        path for path in dataset_root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
        and "raw data" not in {part.lower() for part in path.parts}
    ]
    paired_images = [path for path in image_paths if path.with_suffix(".txt").is_file()]
    class_counts: Counter[int] = Counter()
    malformed_labels: list[str] = []
    for image_path in paired_images:
        label_path = image_path.with_suffix(".txt")
        for line_number, line in enumerate(label_path.read_text(encoding="utf-8-sig").splitlines(), start=1):
            values = line.split()
            try:
                if len(values) != 5:
                    raise ValueError
                class_id = int(values[0])
                coordinates = [float(value) for value in values[1:]]
                if class_id not in {0, 1} or any(not 0 <= value <= 1 for value in coordinates):
                    raise ValueError
                class_counts[class_id] += 1
            except ValueError:
                malformed_labels.append(f"{label_path}:{line_number}")
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceId": source["sourceId"],
        "sourceRecord": str(source_record.resolve()),
        "archive": str(archive_path.resolve()),
        "archiveBytes": actual_bytes,
        "archiveSha256": sha256(archive_path),
        "extractedRoot": str(extracted.resolve()),
        "archiveMembers": len(members),
        "preferredNestedArchive": str(nested_archive.resolve()),
        "preferredNestedArchiveMembers": len(nested_members),
        "datasetRoot": str(dataset_root.resolve()),
        "fileSuffixCounts": dict(sorted(suffixes.items())),
        "candidateImages": len(image_paths),
        "pairedImages": len(paired_images),
        "unpairedImages": len(image_paths) - len(paired_images),
        "annotationClassCounts": {str(key): value for key, value in sorted(class_counts.items())},
        "malformedLabelRows": malformed_labels,
        "qualificationEvidenceTier": source["litterSpotUse"]["qualificationEvidenceTier"],
        "mapsDirectlyToDispatchableFloorSpill": False,
    }
    (cache / "acquisition-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-record", type=Path, default=SOURCE_RECORD)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()
    report = acquire(args.source_record, args.cache, download_if_missing=not args.no_download)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
