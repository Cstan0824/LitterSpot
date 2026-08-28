"""Acquire a pinned, leakage-safe first-pass waste-bin fill-level dataset.

The official dataset provides empty, half-full, and full labels.  It does not
provide overflow evidence, so generated manifest rows explicitly leave
``overflowKnown`` false.  Simulated images are used for train/validation and
all real images remain untouched until test evaluation.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import random
import re
from typing import Iterable

from huggingface_hub import HfApi, hf_hub_download


ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "akirsch1/waste-bin-dataset"
REVISION = "b2a470de0d0c48ff56d714696db37339a6cc4e91"
CLASSES = ("empty", "halffull", "full")
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


def balanced_selection(names: Iterable[str], per_class: int) -> list[str]:
    """Select an evenly spaced deterministic subset from one class."""
    ordered = sorted(set(names))
    if len(ordered) <= per_class:
        return ordered
    if per_class == 1:
        return [ordered[len(ordered) // 2]]
    return [ordered[round(index * (len(ordered) - 1) / (per_class - 1))] for index in range(per_class)]


def build_manifest_rows(
    files: Iterable[str], *, validation_fraction: float = 0.15, seed: int = 42
) -> list[dict[str, object]]:
    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for name in sorted(set(files)):
        parts = Path(name).parts
        if len(parts) == 3 and parts[0] in {"simulated", "real"} and parts[1] in CLASSES:
            grouped[(parts[0], parts[1])].append(name)

    def capture_group(name: str) -> str:
        domain, label, filename = Path(name).parts
        match = re.search(r"\d+", Path(filename).stem)
        if domain == "simulated" and match:
            # Adjacent simulator IDs can be near-duplicate render variants.
            return f"simulated:id-block-{int(match.group()) // 50:04d}"
        return f"{domain}:{label}:{Path(filename).stem}"

    simulated_groups: dict[str, list[str]] = defaultdict(list)
    for (domain, _), names in grouped.items():
        if domain == "simulated":
            for name in names:
                simulated_groups[capture_group(name)].append(name)
    ordered_groups = sorted(simulated_groups)
    random.Random(seed).shuffle(ordered_groups)
    valid_group_count = max(1, round(len(ordered_groups) * validation_fraction)) if len(ordered_groups) > 1 else 0
    valid_groups = set(ordered_groups[:valid_group_count])

    rows: list[dict[str, object]] = []
    for (domain, label), names in sorted(grouped.items()):
        for name in names:
            rows.append({
                "sampleId": name.replace("/", "__").rsplit(".", 1)[0],
                "path": name,
                "domain": domain,
                "captureGroup": capture_group(name),
                "split": "test" if domain == "real" else ("valid" if capture_group(name) in valid_groups else "train"),
                "fillLevel": label,
                "binPresent": True,
                "overflowKnown": False,
                "sourceRepository": REPOSITORY,
                "sourceRevision": REVISION,
            })
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "ml-training/data/public/waste-bin-dataset")
    parser.add_argument("--simulated-per-class", type=int, default=200)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--manifest-only", action="store_true", help="Rebuild metadata from already downloaded files")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    if args.simulated_per_class < 2 or not 0 < args.validation_fraction < .5 or args.workers < 1:
        raise SystemExit("Invalid subset, validation fraction, or worker count")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    existing_manifest = output / "manifest.json"
    if args.manifest_only and existing_manifest.is_file():
        previous = json.loads(existing_manifest.read_text(encoding="utf-8"))
        repository_images = [str(row["path"]) for row in previous.get("samples", [])]
    else:
        info = HfApi().dataset_info(REPOSITORY, revision=REVISION, files_metadata=True)
        repository_images = [
            sibling.rfilename for sibling in info.siblings
            if sibling.rfilename.lower().endswith(IMAGE_SUFFIXES)
            and len(Path(sibling.rfilename).parts) == 3
        ]
    selected: list[str] = []
    for label in CLASSES:
        candidates = [name for name in repository_images if name.startswith(f"simulated/{label}/")]
        selected.extend(balanced_selection(candidates, args.simulated_per_class))
        selected.extend(name for name in repository_images if name.startswith(f"real/{label}/"))

    support_files = ["README.md", "LICENSE.md"]
    failures: list[dict[str, str]] = []
    completed = 0

    def download(name: str) -> str:
        hf_hub_download(
            REPOSITORY, name, repo_type="dataset", revision=REVISION,
            local_dir=output,
        )
        return name

    if not args.manifest_only:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(download, name): name for name in selected + support_files}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    future.result()
                    completed += 1
                    if completed % 50 == 0 or completed == len(futures):
                        print(f"Downloaded {completed}/{len(futures)}", flush=True)
                except Exception as error:  # preserve a machine-readable partial result
                    failures.append({"path": name, "error": str(error)})

    present = [name for name in selected if (output / name).is_file()]
    rows = build_manifest_rows(present, validation_fraction=args.validation_fraction, seed=args.seed)
    for row in rows:
        row["sha256"] = sha256_file(output / str(row["path"]))
        row["source"] = {
            "url": f"https://huggingface.co/datasets/{REPOSITORY}",
            "license": "CC-BY-SA-4.0",
            "attribution": "André Kirsch and Jan Rexilius, Waste Bin Dataset",
        }
    counts = Counter((str(row["split"]), str(row["fillLevel"])) for row in rows)
    report = {
        "dataset": REPOSITORY,
        "revision": REVISION,
        "license": "CC-BY-SA-4.0",
        "licenseFile": "LICENSE.md",
        "attribution": "André Kirsch and Jan Rexilius, Waste Bin Dataset",
        "intendedTask": "bin fill-level classification",
        "overflowLimitation": "No row establishes trash crossing the rim; full must not be mapped to overflow.",
        "requestedImages": len(selected),
        "downloadedImages": len(present),
        "failures": failures,
        "counts": {f"{split}/{label}": value for (split, label), value in sorted(counts.items())},
        "samples": rows,
    }
    (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("requestedImages", "downloadedImages", "counts", "failures")}, indent=2))
    if failures or len(present) != len(selected):
        raise SystemExit("Dataset acquisition incomplete; inspect manifest failures")


if __name__ == "__main__":
    main()
