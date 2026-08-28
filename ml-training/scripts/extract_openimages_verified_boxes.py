"""Extract official Waste container boxes for verified Open Images rows.

This is a metadata-only join.  It streams the official bounding-box CSV,
retains only ``/m/0bjyj5`` rows belonging to attributed verified images, and
emits normalized coordinates for crop review and detector labels.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import time
from typing import Any, Iterable, Iterator, TextIO
from urllib.parse import urlparse

from audit_openimages_v7_metadata import BBOX_COLUMNS, open_text_url


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VERIFICATION = ROOT / "artifacts/dataset-readiness/openimages-v7-license-verification-full-attributed.json"
DEFAULT_CANDIDATE_AUDIT = ROOT / "artifacts/dataset-readiness/openimages-v7-train-full-candidates.json"
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/openimages-v7-verified-bin-boxes.json"
WASTE_CONTAINER_MID = "/m/0bjyj5"


class BoxExtractionError(RuntimeError):
    """Raised when verified Open Images boxes cannot be joined safely."""


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@contextmanager
def _open_csv(source: str) -> Iterator[TextIO]:
    if urlparse(source).scheme in {"http", "https"}:
        with open_text_url(source) as handle:
            yield handle
        return
    with Path(source).resolve().open(newline="", encoding="utf-8-sig") as handle:
        yield handle


def _local_sha256(source: str) -> str | None:
    if urlparse(source).scheme in {"http", "https"}:
        return None
    return sha256(Path(source).resolve().read_bytes()).hexdigest()


def _flag(value: Any) -> bool:
    return str(value).strip().casefold() in {"1", "true", "yes"}


def _box(row: dict[str, Any]) -> dict[str, Any]:
    coordinates = [float(row[name]) for name in ("XMin", "YMin", "XMax", "YMax")]
    xmin, ymin, xmax, ymax = coordinates
    if not (0 <= xmin < xmax <= 1 and 0 <= ymin < ymax <= 1):
        raise ValueError(f"invalid normalized coordinates: {coordinates}")
    return {
        "labelName": WASTE_CONTAINER_MID,
        "displayName": "Waste container",
        "xyxyNormalized": coordinates,
        "source": str(row.get("Source", "")),
        "confidence": float(row.get("Confidence", 0)),
        "isOccluded": _flag(row.get("IsOccluded")),
        "isTruncated": _flag(row.get("IsTruncated")),
        "isGroupOf": _flag(row.get("IsGroupOf")),
        "isDepiction": _flag(row.get("IsDepiction")),
        "isInside": _flag(row.get("IsInside")),
    }


def extract_boxes(
    verification: dict[str, Any], *, bbox_source: str,
    open_csv: Any = _open_csv, max_stream_attempts: int = 3,
    retry_delay_seconds: float = 2.0,
) -> dict[str, Any]:
    if verification.get("pixelsDownloaded") is not False:
        raise BoxExtractionError("verification input must state pixelsDownloaded=false")
    if verification.get("readyForAcquisition") is not True:
        raise BoxExtractionError("verification input must be attribution-complete and readyForAcquisition")
    rows = verification.get("records", [])
    if not isinstance(rows, list):
        raise BoxExtractionError("verification records must be a list")
    if max_stream_attempts < 1 or retry_delay_seconds < 0:
        raise ValueError("stream attempts must be positive and retry delay non-negative")
    verified_ids = {
        str(row.get("ImageID", "")) for row in rows
        if isinstance(row, dict) and row.get("status") == "verified"
    }
    if "" in verified_ids:
        raise BoxExtractionError("verified record has blank ImageID")
    stream_attempt = 0
    last_stream_error: Exception | None = None
    for stream_attempt in range(1, max_stream_attempts + 1):
        attempt_boxes: dict[str, list[dict[str, Any]]] = {image_id: [] for image_id in verified_ids}
        attempt_scanned_rows = 0
        attempt_target_rows = 0
        attempt_invalid_rows: list[dict[str, str]] = []
        try:
            with open_csv(bbox_source) as handle:
                reader = csv.DictReader(handle)
                fields = tuple(reader.fieldnames or ())
                missing = [field for field in BBOX_COLUMNS if field not in fields]
                if missing:
                    raise BoxExtractionError(f"bbox schema mismatch: missing {', '.join(missing)}")
                for row in reader:
                    attempt_scanned_rows += 1
                    image_id = str(row.get("ImageID", "")).strip()
                    if image_id not in verified_ids or str(row.get("LabelName", "")).strip() != WASTE_CONTAINER_MID:
                        continue
                    attempt_target_rows += 1
                    try:
                        attempt_boxes[image_id].append(_box(row))
                    except (TypeError, ValueError, KeyError) as error:
                        attempt_invalid_rows.append({"ImageID": image_id, "reason": str(error)})
            boxes_by_id = attempt_boxes
            scanned_rows = attempt_scanned_rows
            target_rows = attempt_target_rows
            invalid_rows = attempt_invalid_rows
            break
        except BoxExtractionError:
            raise
        except (OSError, TimeoutError, csv.Error) as error:
            last_stream_error = error
            if stream_attempt >= max_stream_attempts:
                raise BoxExtractionError(
                    f"bbox stream failed after {stream_attempt} attempt(s): {error}"
                ) from error
            time.sleep(retry_delay_seconds * (2 ** (stream_attempt - 1)))
    else:  # pragma: no cover - defensive retry loop guard
        raise BoxExtractionError(f"bbox stream failed: {last_stream_error}") from last_stream_error

    records = [
        {"ImageID": image_id, "boxes": boxes_by_id[image_id]}
        for image_id in sorted(verified_ids)
    ]
    matched = sum(bool(record["boxes"]) for record in records)
    counts = {
        "verifiedImages": len(verified_ids),
        "matchedImages": matched,
        "missingImages": len(verified_ids) - matched,
        "boxCount": sum(len(record["boxes"]) for record in records),
    }
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "dataset": "Open Images V7",
            "bboxSource": bbox_source,
            "bboxSourceSha256": _local_sha256(bbox_source),
            "labelName": WASTE_CONTAINER_MID,
            "displayName": "Waste container",
        },
        "scan": {
            "rowsScanned": scanned_rows,
            "verifiedTargetRows": target_rows,
            "invalidTargetRows": len(invalid_rows),
            "streamAttempts": stream_attempt,
        },
        "counts": counts,
        "invalidRows": invalid_rows,
        "pixelsDownloaded": False,
        "readyForCropping": counts["missingImages"] == 0 and not invalid_rows and counts["boxCount"] > 0,
        "records": records,
    }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verification", type=Path, default=DEFAULT_VERIFICATION)
    parser.add_argument("--candidate-audit", type=Path, default=DEFAULT_CANDIDATE_AUDIT)
    parser.add_argument("--bbox-csv", type=str)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-stream-attempts", type=int, default=3)
    parser.add_argument("--retry-delay-seconds", type=float, default=2.0)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    verification_path = args.verification.resolve()
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if args.bbox_csv:
        bbox_source = args.bbox_csv
    else:
        candidate_audit = json.loads(args.candidate_audit.read_text(encoding="utf-8"))
        bbox_source = str(candidate_audit.get("source", {}).get("bboxUrl", "")).strip()
        if not bbox_source:
            raise BoxExtractionError("candidate audit has no source.bboxUrl")
    report = extract_boxes(
        verification,
        bbox_source=bbox_source,
        max_stream_attempts=args.max_stream_attempts,
        retry_delay_seconds=args.retry_delay_seconds,
    )
    report["inputVerification"] = str(verification_path)
    report["inputVerificationSha256"] = sha256(verification_path.read_bytes()).hexdigest()
    output = args.output.resolve()
    _atomic_write_json(output, report)
    print(json.dumps({
        "output": str(output),
        "counts": report["counts"],
        "invalidTargetRows": report["scan"]["invalidTargetRows"],
        "readyForCropping": report["readyForCropping"],
        "pixelsDownloaded": report["pixelsDownloaded"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
