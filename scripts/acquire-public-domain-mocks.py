"""Download a curated Public Domain/CC0 mock set with full provenance.

Only 1280-pixel Wikimedia Commons thumbnails are stored. The downloader rejects
any item whose current Commons metadata is not Public Domain or CC0.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = PROJECT_ROOT / "mock-data" / "public-domain" / "curated-sources.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "mock-data" / "public-domain" / "images"
USER_AGENT = "LitterSpotMockData/1.0 (prototype evaluation; Wikimedia Commons provenance retained)"


def open_with_retry(request: urllib.request.Request, timeout: int):
    for attempt in range(5):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt
            print(f"rate limited; retrying in {delay:.0f}s")
            time.sleep(delay)
    raise RuntimeError("unreachable retry state")


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with open_with_retry(request, timeout=60) as response:
        return json.load(response)


def download(url: str, target: Path) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    digest = hashlib.sha256()
    with open_with_retry(request, timeout=120) as response, target.open("wb") as stream:
        while chunk := response.read(1024 * 1024):
            stream.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def plain(value: Any) -> str:
    raw = value.get("value", "") if isinstance(value, dict) else str(value or "")
    return html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def accepted_license(value: str) -> bool:
    normalized = value.casefold().replace("creative commons", "").strip()
    return "public domain" in normalized or normalized.startswith("cc0") or "cc-zero" in normalized


def commons_metadata(title: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": 1280,
            "format": "json",
            "formatversion": 2,
        }
    )
    payload = fetch_json(f"https://commons.wikimedia.org/w/api.php?{query}")
    pages = payload.get("query", {}).get("pages", [])
    if not pages or "missing" in pages[0] or not pages[0].get("imageinfo"):
        raise RuntimeError(f"Commons file was not found: {title}")
    image_info = pages[0]["imageinfo"][0]
    metadata = image_info.get("extmetadata", {})
    license_name = plain(metadata.get("LicenseShortName")) or plain(metadata.get("UsageTerms"))
    if not accepted_license(license_name):
        raise RuntimeError(f"Rejected non-Public-Domain/CC0 item {title!r}: {license_name!r}")
    image_url = image_info.get("thumburl") or image_info.get("url")
    if not image_url:
        raise RuntimeError(f"Commons did not return an image URL: {title}")
    return {
        "downloadUrl": image_url,
        "originalUrl": image_info.get("url", ""),
        "descriptionPage": image_info.get("descriptionurl", ""),
        "license": license_name,
        "artist": plain(metadata.get("Artist")),
        "credit": plain(metadata.get("Credit")),
        "description": plain(metadata.get("ImageDescription")),
        "dateTimeOriginal": plain(metadata.get("DateTimeOriginal")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true", help="Redownload pixels even when the target already exists.")
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for item in catalog["items"]:
        metadata = commons_metadata(item["title"])
        target = args.output / item["fileName"]
        if target.is_file() and not args.refresh:
            checksum = hashlib.sha256(target.read_bytes()).hexdigest()
            print(f"reused {target.name}: {metadata['license']} ({target.stat().st_size} bytes)")
        else:
            checksum = download(metadata["downloadUrl"], target)
            print(f"downloaded {target.name}: {metadata['license']} ({target.stat().st_size} bytes)")
        records.append(
            {
                **item,
                "path": str(target.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                "bytes": target.stat().st_size,
                "sha256": checksum,
                **metadata,
            }
        )
        time.sleep(1.0)

    manifest = {
        "schemaVersion": 1,
        "retrievedAt": datetime.now(UTC).isoformat(),
        "labelStatus": "provisional-human-review-needed",
        "items": records,
    }
    (args.output.parent / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {args.output.parent / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
