"""Extract a small, source-locked CDW-Seg evaluation proxy from the CC0 archive.

The COCO release does not include the publisher's split file. This script keeps
the selection deterministic and labels it ``test_proxy`` rather than claiming
an unrecoverable publisher test split. The full archive and extracted pixels
belong under the ignored ``data/heldout-evaluation`` directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def hashes(path: Path) -> tuple[str, str]:
    md5 = hashlib.md5()  # noqa: S324 - publisher checksum
    sha256 = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=Path("data/heldout-evaluation/cdw-seg/Ground_Truths_COCO_Format.zip"))
    parser.add_argument("--count", type=int, default=43)
    args = parser.parse_args()
    archive = args.archive.resolve()
    if not archive.is_file(): raise SystemExit(f"Archive not found: {archive}")
    if args.count < 1: raise SystemExit("count must be positive")

    output_root = archive.parent / "test-proxy"
    image_root = output_root / "images"
    image_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        annotation_name = "Ground_Truths_COCO_Format/annotations.json"
        annotations = json.loads(source.read(annotation_name))
        image_rows = sorted(annotations["images"], key=lambda row: row["file_name"])
        selected = image_rows[-args.count:]
        selected_ids = {row["id"] for row in selected}
        selected_names = {row["file_name"] for row in selected}
        for image in selected:
            source_name = "Ground_Truths_COCO_Format/" + image["file_name"].replace("\\", "/")
            target = image_root / Path(image["file_name"].replace("\\", "/")).name
            target.write_bytes(source.read(source_name))

        subset = {
            **annotations,
            "images": selected,
            "annotations": [row for row in annotations["annotations"] if row["image_id"] in selected_ids],
        }
        (output_root / "annotations.test-proxy.json").write_text(json.dumps(subset, indent=2), encoding="utf-8")

    archive_md5, archive_sha256 = hashes(archive)
    manifest = {
        "sourceName": "CDW-Seg",
        "canonicalUrl": "https://api.figshare.com/v2/articles/28573229",
        "doi": "10.6084/m9.figshare.28573229.v1",
        "license": "CC0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "archiveFileId": 52959722,
        "archiveName": archive.name,
        "archiveBytes": archive.stat().st_size,
        "archiveMd5": archive_md5,
        "archiveSha256": archive_sha256,
        "selection": "last 43 lexicographically sorted image IDs; COCO archive has no split file",
        "splitLabel": "test_proxy",
        "imageCount": len(selected),
        "annotationCount": len(subset["annotations"]),
        "trainingUse": False,
        "thresholdSelectionUse": False,
        "promptSelectionUse": False,
        "selectedFileNames": sorted(selected_names),
    }
    (output_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output_root), "images": len(selected), "annotations": len(subset["annotations"]), "archiveSha256": manifest["archiveSha256"]}, indent=2))


if __name__ == "__main__":
    main()
