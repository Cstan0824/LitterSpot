#!/usr/bin/env python3
"""Download a deterministic, attribution-preserving TACO image subset.

The official TACO annotations remain the source of truth. Pixels are written
under the ignored ``dataset/floor_rubbish/raw_dataset`` cache; the acquisition
manifest is the reproducibility record. This intentionally uses the reviewed
``annotations.json`` file, never ``annotations_unofficial.json``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANNOTATIONS = ROOT / "dataset/floor_rubbish/raw_dataset/TACO-repo/data/annotations.json"
DEFAULT_OUTPUT = ROOT / "dataset/floor_rubbish/raw_dataset/TACO-images"
USER_AGENT = "LitterSpot/1.0 (dataset acquisition; provenance retained)"


def _download(url: str, destination: Path, timeout: int = 90) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=timeout) as response, destination.open("wb") as stream:
        while chunk := response.read(1024 * 1024):
            stream.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def acquire(annotations_path: Path, output: Path, limit: int, seed: int) -> dict[str, Any]:
    payload = json.loads(annotations_path.read_text(encoding="utf-8"))
    images = {item["id"]: item for item in payload.get("images", [])}
    annotated_ids = sorted({item["image_id"] for item in payload.get("annotations", []) if item.get("image_id") in images})
    if limit < 1:
        raise ValueError("limit must be positive")
    selected_ids = random.Random(seed).sample(annotated_ids, min(limit, len(annotated_ids)))
    selected_ids.sort()
    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    output.mkdir(parents=True, exist_ok=True)
    for position, image_id in enumerate(selected_ids, 1):
        item = images[image_id]
        relative = Path(str(item["file_name"]))
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        url = str(item.get("flickr_640_url") or item.get("flickr_url") or "")
        item_status = "failed"
        try:
            if destination.is_file():
                digest = hashlib.sha256(destination.read_bytes()).hexdigest()
                status = "reused"
            elif not url:
                raise ValueError("missing Flickr URL")
            else:
                digest = _download(url, destination)
                status = "downloaded"
            # Flickr can return truncated JPEG bytes with a successful HTTP
            # status. Reject them before they enter a training split.
            with Image.open(destination) as image:
                image.verify()
            item_status = status
            records.append({
                "imageId": image_id,
                "fileName": str(relative).replace("\\", "/"),
                "path": str(destination.relative_to(ROOT)).replace("\\", "/"),
                "url": url,
                "sourceUrl": "https://github.com/pedropro/TACO",
                "license": "CC BY 4.0 (verify original Flickr asset terms before redistribution)",
                "sha256": digest,
                "status": status,
            })
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            failures.append({"imageId": str(image_id), "url": url, "error": str(exc)})
            if destination.exists() and destination.stat().st_size == 0:
                destination.unlink()
        print(f"[{position}/{len(selected_ids)}] {item_status} image={image_id}")
        time.sleep(0.05)
    result = {
        "schemaVersion": 1,
        "retrievedAt": datetime.now(UTC).isoformat(),
        "annotations": str(annotations_path.relative_to(ROOT)).replace("\\", "/"),
        "requested": limit,
        "selected": len(selected_ids),
        "downloaded": sum(record["status"] == "downloaded" for record in records),
        "reused": sum(record["status"] == "reused" for record in records),
        "failed": len(failures),
        "seed": seed,
        "records": records,
        "failures": failures,
    }
    (output / "acquisition-manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, default=DEFAULT_ANNOTATIONS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=150)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    result = acquire(args.annotations.resolve(), args.output.resolve(), args.limit, args.seed)
    print(json.dumps({key: result[key] for key in ("selected", "downloaded", "reused", "failed")}, indent=2))
    return 0 if result["downloaded"] + result["reused"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
