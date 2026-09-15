"""Merge deterministic Open Images licence-verification chunks."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable


class VerificationMergeError(RuntimeError):
    """Raised when verification chunks are incompatible or overlap."""


def merge_verifications(chunks: Iterable[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(
        chunks,
        key=lambda chunk: int(chunk.get("candidateWindow", {}).get("startIndex", -1)),
    )
    if not ordered:
        raise VerificationMergeError("at least one chunk is required")
    source_dataset = ordered[0].get("sourceDataset")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    windows: list[dict[str, Any]] = []
    for chunk in ordered:
        if chunk.get("pixelsDownloaded") is not False:
            raise VerificationMergeError("all chunks must state pixelsDownloaded=false")
        if chunk.get("sourceDataset") != source_dataset:
            raise VerificationMergeError("source datasets differ")
        window = chunk.get("candidateWindow", {})
        if not isinstance(window, dict) or int(window.get("startIndex", -1)) < 0:
            raise VerificationMergeError("chunk is missing a valid candidate window")
        windows.append(dict(window))
        chunk_records = chunk.get("records", [])
        if not isinstance(chunk_records, list):
            raise VerificationMergeError("chunk records must be a list")
        for record in chunk_records:
            if not isinstance(record, dict):
                raise VerificationMergeError("verification record must be an object")
            image_id = str(record.get("ImageID", ""))
            if not image_id:
                raise VerificationMergeError("record is missing ImageID")
            if image_id in seen:
                raise VerificationMergeError(f"duplicate ImageID across chunks: {image_id}")
            seen.add(image_id)
            records.append(record)
    counts = Counter(str(record.get("status", "")) for record in records)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDataset": source_dataset,
        "candidateCount": len(records),
        "candidateWindows": windows,
        "pixelsDownloaded": False,
        "landingPageBodiesOnly": True,
        "counts": {
            name: counts[name] for name in ("verified", "rejected", "manual_review")
        },
        "verifiedImageIds": sorted(
            str(record["ImageID"]) for record in records if record.get("status") == "verified"
        ),
        "records": records,
    }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    chunks = [json.loads(path.read_text(encoding="utf-8")) for path in args.input]
    result = merge_verifications(chunks)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({
        "output": str(args.output), "candidateCount": result["candidateCount"],
        "counts": result["counts"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
