#!/usr/bin/env python3
"""Acquire and verify the CC BY Figshare dry/wet road-surface corpus."""
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
SOURCE = ROOT / "ml-training/data/specialists/sources/figshare-road-surface-v1.json"
DEFAULT_OUTPUT = ROOT / "ml-training/data/specialists/source-cache/figshare-road-surface-v1"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_members(archive: zipfile.ZipFile, destination: Path):
    destination = destination.resolve()
    for info in archive.infolist():
        candidate = (destination / info.filename).resolve()
        try:
            candidate.relative_to(destination)
        except ValueError as error:
            raise ValueError(f"unsafe zip member: {info.filename}") from error
        yield info


def acquire(output: Path = DEFAULT_OUTPUT) -> dict[str, Any]:
    output = output.resolve()
    specification = json.loads(SOURCE.read_text(encoding="utf-8"))
    archives = output / "archives"
    dataset = output / "dataset"
    archives.mkdir(parents=True, exist_ok=True)
    dataset.mkdir(parents=True, exist_ok=True)
    files = []
    for item in specification["files"]:
        archive_path = archives / item["name"]
        if not archive_path.is_file():
            temporary = archive_path.with_suffix(archive_path.suffix + ".part")
            with urllib.request.urlopen(item["downloadUrl"]) as response, temporary.open("wb") as handle:
                shutil.copyfileobj(response, handle, length=1024 * 1024)
            temporary.replace(archive_path)
        if archive_path.stat().st_size != item["size"]:
            raise ValueError(f"size mismatch for {archive_path}")
        digest = _md5(archive_path)
        if digest != item["md5"]:
            raise ValueError(f"MD5 mismatch for {archive_path}")
        destination = dataset / Path(item["name"]).stem
        marker = destination / ".extracted.json"
        if not marker.is_file():
            if destination.exists() and any(destination.rglob("*")):
                raise FileExistsError(f"partial extraction exists: {destination}")
            destination.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(destination, members=list(_safe_members(archive, destination)))
            marker.write_text(json.dumps({"archiveMd5": digest}) + "\n", encoding="utf-8")
        files.append({"path": str(archive_path), "size": archive_path.stat().st_size, "md5": digest})
    inventory: Counter[str] = Counter()
    for path in dataset.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            lowered = [part.lower() for part in path.parts]
            label = next((name for name in ("dry", "wet", "snow") if any(f"_{name}_" in part for part in lowered)), "unclassified")
            lighting = "withlight" if "withlight" in lowered else "nolight" if "nolight" in lowered else "unknown"
            inventory[f"{lighting}:{label}"] += 1
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSpecification": str(SOURCE),
        "output": str(output),
        "files": files,
        "imageCounts": dict(sorted(inventory.items())),
        "evidenceTier": "public",
        "qualificationEligible": False,
    }
    (output / "acquisition-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(acquire(args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
