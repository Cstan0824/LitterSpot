from __future__ import annotations

import csv
from contextlib import contextmanager
import io
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

import extract_openimages_verified_boxes as extract  # noqa: E402


def _record(image_id: str, status: str) -> dict[str, object]:
    return {
        "ImageID": image_id,
        "classNames": ["waste_container"],
        "familyNames": ["bin_positive"],
        "status": status,
        "attributionComplete": status == "verified",
    }


def test_cli_extracts_all_waste_container_boxes_for_verified_rows(tmp_path: Path) -> None:
    verification_path = tmp_path / "verification.json"
    bbox_path = tmp_path / "boxes.csv"
    output_path = tmp_path / "verified-boxes.json"
    verification_path.write_text(json.dumps({
        "schemaVersion": 2,
        "pixelsDownloaded": False,
        "readyForAcquisition": True,
        "records": [
            _record("image-a", "verified"),
            _record("image-b", "verified"),
            _record("image-c", "manual_review"),
        ],
    }), encoding="utf-8")
    with bbox_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=extract.BBOX_COLUMNS)
        writer.writeheader()
        writer.writerows([
            {"ImageID": "image-a", "Source": "xclick", "LabelName": extract.WASTE_CONTAINER_MID,
             "Confidence": "1", "XMin": ".1", "XMax": ".4", "YMin": ".2", "YMax": ".8",
             "IsOccluded": "0", "IsTruncated": "0", "IsGroupOf": "0", "IsDepiction": "0", "IsInside": "0"},
            {"ImageID": "image-a", "Source": "xclick", "LabelName": extract.WASTE_CONTAINER_MID,
             "Confidence": "1", "XMin": ".5", "XMax": ".9", "YMin": ".3", "YMax": ".7",
             "IsOccluded": "1", "IsTruncated": "0", "IsGroupOf": "0", "IsDepiction": "0", "IsInside": "0"},
            {"ImageID": "image-b", "Source": "xclick", "LabelName": extract.WASTE_CONTAINER_MID,
             "Confidence": "1", "XMin": "0", "XMax": "1", "YMin": "0", "YMax": "1",
             "IsOccluded": "0", "IsTruncated": "0", "IsGroupOf": "0", "IsDepiction": "0", "IsInside": "0"},
            {"ImageID": "image-c", "Source": "xclick", "LabelName": extract.WASTE_CONTAINER_MID,
             "Confidence": "1", "XMin": "0", "XMax": "1", "YMin": "0", "YMax": "1",
             "IsOccluded": "0", "IsTruncated": "0", "IsGroupOf": "0", "IsDepiction": "0", "IsInside": "0"},
        ])

    assert extract.main([
        "--verification", str(verification_path),
        "--bbox-csv", str(bbox_path),
        "--output", str(output_path),
    ]) == 0

    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["counts"] == {
        "verifiedImages": 2,
        "matchedImages": 2,
        "missingImages": 0,
        "boxCount": 3,
    }
    assert result["readyForCropping"] is True
    assert result["pixelsDownloaded"] is False
    image_a = next(record for record in result["records"] if record["ImageID"] == "image-a")
    assert image_a["boxes"][0]["xyxyNormalized"] == [0.1, 0.2, 0.4, 0.8]
    assert image_a["boxes"][1]["isOccluded"] is True


def test_stream_restart_discards_partial_attempt_before_retry() -> None:
    columns = extract.BBOX_COLUMNS
    header = ",".join(columns)
    row = ",".join([
        "image-a", "xclick", extract.WASTE_CONTAINER_MID, "1", ".1", ".4", ".2", ".8",
        "0", "0", "0", "0", "0",
    ])
    row_two = ",".join([
        "image-a", "xclick", extract.WASTE_CONTAINER_MID, "1", ".5", ".9", ".3", ".7",
        "0", "0", "0", "0", "0",
    ])
    payload = f"{header}\n{row}\n{row_two}\n"
    attempts = 0

    class InterruptedStream(io.StringIO):
        lines_read = 0

        def __next__(self) -> str:
            self.lines_read += 1
            if self.lines_read == 3:
                raise TimeoutError("simulated interrupted transfer")
            return super().__next__()

    @contextmanager
    def open_csv(source: str):
        del source
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield InterruptedStream(payload)
        else:
            yield io.StringIO(payload)

    result = extract.extract_boxes(
        {
            "pixelsDownloaded": False,
            "readyForAcquisition": True,
            "records": [_record("image-a", "verified")],
        },
        bbox_source="https://metadata.test/boxes.csv",
        open_csv=open_csv,
        max_stream_attempts=2,
        retry_delay_seconds=0,
    )

    assert attempts == 2
    assert result["counts"]["boxCount"] == 2
    assert result["scan"]["streamAttempts"] == 2
