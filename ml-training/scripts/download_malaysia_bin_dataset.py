"""Download and verify the University of Malaya three-bin image dataset."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


ARTICLE_ID = 6269042
ARTICLE_API = f"https://api.figshare.com/v2/articles/{ARTICLE_ID}"
ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--destination",
        type=Path,
        default=ROOT / "ml-training/data/malaysia-bin-node",
    )
    return parser.parse_args()


def fetch_json(url: str) -> dict:
    with urlopen(url, timeout=30) as response:
        return json.load(response)


def download(url: str, destination: Path) -> str:
    digest = hashlib.md5()  # Figshare publishes MD5 checksums for these files.
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urlopen(url, timeout=60) as response, temporary.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    temporary.replace(destination)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    destination = args.destination.resolve()
    images = destination / "images"
    images.mkdir(parents=True, exist_ok=True)

    article = fetch_json(ARTICLE_API)
    if article.get("id") != ARTICLE_ID:
        raise SystemExit("Figshare returned an unexpected article.")
    if article.get("license", {}).get("name") != "CC BY 4.0":
        raise SystemExit(f"Unexpected dataset license: {article.get('license')}")

    def fetch_file(item: dict) -> bool:
        target = images / item["name"]
        expected = item["supplied_md5"].lower()
        if target.is_file() and hashlib.md5(target.read_bytes()).hexdigest() == expected:
            return False
        actual = download(item["download_url"], target)
        if actual != expected:
            target.unlink(missing_ok=True)
            raise SystemExit(f"Checksum mismatch for {item['name']}: {actual} != {expected}")
        return True

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(fetch_file, article["files"]))
    downloaded = sum(results)
    skipped = len(results) - downloaded

    metadata = {
        "articleId": ARTICLE_ID,
        "title": article["title"],
        "url": article["url_public_html"],
        "doi": article.get("doi"),
        "license": article["license"],
        "description": article["description"],
        "files": len(article["files"]),
        "use": (
            "Malaysian domain check for bin localization. The source provides images but "
            "no machine-readable bounding-box or state annotations."
        ),
    }
    (destination / "source-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Verified {len(article['files'])} images ({downloaded} downloaded, {skipped} existing)")
    print(f"Dataset written to {destination}")


if __name__ == "__main__":
    main()
