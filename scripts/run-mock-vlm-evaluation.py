"""Run reproducible InternVL mock-data evaluation through the FastAPI curl API.

The report folder contains request/outcome JSONL logs, raw HTTP responses,
extracted video frames, a reviewable CSV, and a Markdown summary table.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

import cv2


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MOCK_DATA_ROOT = PROJECT_ROOT / "mock-data" / "internvl-evaluation"
DEFAULT_EXPECTATIONS = MOCK_DATA_ROOT / "provisional-expected-stills.json"
PUBLIC_MANIFEST = PROJECT_ROOT / "mock-data" / "public-domain" / "manifest.json"
EDGE_MANIFEST = PROJECT_ROOT / "mock-data" / "edge-cases" / "manifest.json"
DEFAULT_SOURCES = [
    MOCK_DATA_ROOT / "videos" / "WhatsApp Video 2026-08-04 at 12.12.35 AM.mp4",
    MOCK_DATA_ROOT / "videos" / "WhatsApp Video 2026-08-12 at 10.35.34 AM (1).mp4",
    MOCK_DATA_ROOT / "videos" / "WhatsApp Video 2026-08-12 at 10.35.34 AM.mp4",
    MOCK_DATA_ROOT / "videos" / "WhatsApp Video 2026-08-12 at 10.35.33 AM.mp4",
    MOCK_DATA_ROOT / "videos" / "WhatsApp Video 2026-08-04 at 12.14.58 AM.mp4",
    MOCK_DATA_ROOT / "images" / "WhatsApp Image 2026-07-27 at 5.59.58 PM (3).jpeg",
    MOCK_DATA_ROOT / "images" / "WhatsApp Image 2026-07-27 at 6.00.00 PM.jpeg",
    MOCK_DATA_ROOT / "images" / "WhatsApp Image 2026-07-27 at 5.59.59 PM (2).jpeg",
    MOCK_DATA_ROOT / "images" / "WhatsApp Image 2026-07-27 at 5.59.59 PM (1).jpeg",
    MOCK_DATA_ROOT / "images" / "WhatsApp Image 2026-07-27 at 5.59.59 PM.jpeg",
]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv"}


@dataclass(frozen=True)
class Sample:
    source: Path
    input_path: Path
    input_kind: str
    sample_index: int
    timestamp_seconds: float | None


def slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, ensure_ascii=False) + "\n")


def extract_video_samples(source: Path, frames_dir: Path, count: int) -> Iterable[Sample]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("OpenCV could not open video")
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0 or frame_count <= 0:
            raise RuntimeError(f"Invalid video metadata (fps={fps}, frames={frame_count})")
        duration = frame_count / fps
        positions = [(index + 1) / (count + 1) * duration for index in range(count)]
        for index, timestamp in enumerate(positions, start=1):
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(f"Could not extract frame at {timestamp:.2f}s")
            target = frames_dir / f"{slug(source.stem)}-frame-{index:02d}-{timestamp:.2f}s.jpg"
            if not cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92]):
                raise RuntimeError(f"Could not write extracted frame {target}")
            yield Sample(source, target, "video_frame", index, round(timestamp, 3))
    finally:
        capture.release()


def read_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (OSError, json.JSONDecodeError) as error:
        return None, str(error)


def sources_from_manifest(path: Path, key: str) -> list[Path]:
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources: list[Path] = []
    for item in payload.get(key, []):
        value = item.get("path")
        if value:
            sources.append((PROJECT_ROOT / value).resolve())
    return sources


def resolve_suite(name: str) -> list[Path]:
    if name == "original":
        return list(DEFAULT_SOURCES)
    public_sources = sources_from_manifest(PUBLIC_MANIFEST, "items")
    edge_sources = sources_from_manifest(EDGE_MANIFEST, "assets")
    if name == "public-domain":
        return public_sources
    if name == "edge":
        return edge_sources
    return [*DEFAULT_SOURCES, *public_sources, *edge_sources]


def expected_summary(expected: dict[str, Any]) -> str:
    people_min = expected.get("peopleMin")
    people_max = expected.get("peopleMax")
    people = str(people_min) if people_min == people_max else f"{people_min}-{people_max}"
    bins = ",".join(str(state) for state in expected.get("binStates", [])) or "none"
    hazards = ",".join(str(hazard) for hazard in expected.get("floorHazards", [])) or "none"
    return f"people={people}; bins={bins}; hazards={hazards}"


def manifest_expectations() -> dict[Path, str]:
    result: dict[Path, str] = {}
    for manifest_path, key in ((PUBLIC_MANIFEST, "items"), (EDGE_MANIFEST, "assets")):
        if not manifest_path.is_file():
            continue
        for item in json.loads(manifest_path.read_text(encoding="utf-8")).get(key, []):
            value, expected = item.get("path"), item.get("expected")
            if value and isinstance(expected, dict) and not expected.get("reviewRequired"):
                result[(PROJECT_ROOT / value).resolve()] = expected_summary(expected)
    return result


def summarize(payload: dict[str, Any] | None) -> dict[str, Any]:
    if payload is None:
        return {"people": "", "bins": "", "litter": "", "spill": "", "flags": "", "tiles": "", "raw_counts": "", "placeholder": ""}
    bins = payload.get("bins", [])
    hazards = payload.get("floorHazards", [])
    flags = payload.get("flags", [])
    bin_states = [item.get("state", "unknown") for item in bins if isinstance(item, dict)]
    diagnostics = payload.get("inferenceDiagnostics") or {}
    raw_counts = diagnostics.get("sceneObjectCounts") or {}
    return {
        "people": payload.get("peopleCount", 0),
        "bins": ", ".join(bin_states) or "none",
        "litter": sum(1 for item in hazards if item.get("className") == "floor_litter"),
        "spill": sum(1 for item in hazards if item.get("className") == "floor_spill"),
        "flags": ", ".join(item.get("kind", "unknown") for item in flags if isinstance(item, dict)) or "none",
        "tiles": diagnostics.get("tileCount", ""),
        "raw_counts": "/".join(str(raw_counts.get(name, 0)) for name in ("people", "bins", "floorHazards")),
        "placeholder": diagnostics.get("placeholderTemplateDetected", ""),
    }


def run_curl(
    curl: str,
    endpoint: str,
    token: str,
    sample: Sample,
    response_path: Path,
    timeout_seconds: int,
    camera_prefix: str,
    include_diagnostics: bool,
) -> tuple[int | None, float, str, str]:
    camera_id = f"{camera_prefix}-{slug(sample.source.stem)[:48]}"
    command = [
        curl,
        "--silent",
        "--show-error",
        "--max-time", str(timeout_seconds),
        "--output", str(response_path),
        "--write-out", "%{http_code}",
        "--request", "POST", endpoint,
        "--header", f"x-internal-token: {token}",
        "--form", f"file=@{sample.input_path}",
        "--form", f"camera_id={camera_id}",
        "--form", "confirmation_frames=1",
    ]
    if include_diagnostics:
        command.extend(["--form", "include_diagnostics=true"])
    started = time.perf_counter()
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    elapsed = round(time.perf_counter() - started, 3)
    try:
        http_status = int(completed.stdout.strip())
    except ValueError:
        http_status = None
    return http_status, elapsed, completed.stderr.strip(), " ".join(command[:12] + ["<token-redacted>"])


def markdown_table(rows: list[dict[str, Any]]) -> str:
    headers = ["#", "Source / sample", "Expected (provisional)", "HTTP", "Result", "People", "Bins", "Litter", "Spill", "Raw P/B/H", "Tiles", "Placeholder", "Seconds"]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        source = row["source_name"] if row["input_kind"] == "image" else f"{row['source_name']} @ {row['frame_timestamp_seconds']}s"
        lines.append("| " + " | ".join([
            str(row["run_index"]), source.replace("|", "\\|"), row["expected_summary"].replace("|", "\\|"), str(row["http_status"] or "-"),
            row["result"], str(row["people_count"]), row["bin_states"], str(row["floor_litter_count"]),
            str(row["floor_spill_count"]), row["raw_counts"], str(row["tile_count"]), str(row["placeholder_template"]), str(row["elapsed_seconds"]),
        ]) + " |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", type=Path, help="Image/video source. Repeat to override the default mock set.")
    parser.add_argument(
        "--suite",
        choices=("original", "public-domain", "edge", "expanded"),
        default="original",
        help="Versioned source set used when --source is not supplied.",
    )
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/analyze/frame")
    parser.add_argument("--token", default=os.getenv("INTERNAL_API_TOKEN", "local-playground-token"))
    parser.add_argument("--curl", default="curl.exe")
    parser.add_argument("--video-samples", type=int, default=3, metavar="1-10")
    parser.add_argument("--timeout-seconds", type=int, default=180, metavar="1-600")
    parser.add_argument("--camera-prefix", default="mock")
    parser.add_argument("--expectations", type=Path, default=DEFAULT_EXPECTATIONS)
    parser.add_argument("--include-diagnostics", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if not 1 <= args.video_samples <= 10:
        parser.error("--video-samples must be between 1 and 10")
    if not 1 <= args.timeout_seconds <= 600:
        parser.error("--timeout-seconds must be between 1 and 600")

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or PROJECT_ROOT / "artifacts" / "mock-evaluations" / timestamp
    frames_dir, responses_dir = output_dir / "frames", output_dir / "responses"
    frames_dir.mkdir(parents=True, exist_ok=False)
    responses_dir.mkdir(parents=True, exist_ok=False)
    log_path, jsonl_path = output_dir / "run.log", output_dir / "run.jsonl"
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler(sys.stdout)])

    sources = args.source or resolve_suite(args.suite)
    expectations = json.loads(args.expectations.read_text(encoding="utf-8")).get("items", {}) if args.expectations.is_file() else {}
    structured_expectations = manifest_expectations()
    logging.info("Starting mock evaluation: sources=%d, video_samples=%d, output=%s", len(sources), args.video_samples, output_dir)
    write_jsonl(jsonl_path, {"event": "run_started", "timestamp": datetime.now(UTC).isoformat(), "api_url": args.api_url, "source_count": len(sources), "video_samples": args.video_samples})

    samples: list[Sample] = []
    for source in sources:
        if not source.is_file():
            logging.error("Missing source: %s", source)
            write_jsonl(jsonl_path, {"event": "source_error", "source": str(source), "error": "file_not_found"})
            continue
        if source.suffix.lower() in IMAGE_SUFFIXES:
            samples.append(Sample(source, source, "image", 1, None))
        elif source.suffix.lower() in VIDEO_SUFFIXES:
            try:
                samples.extend(extract_video_samples(source, frames_dir, args.video_samples))
            except RuntimeError as error:
                logging.exception("Could not sample %s", source.name)
                write_jsonl(jsonl_path, {"event": "source_error", "source": str(source), "error": str(error)})
        else:
            logging.error("Unsupported source type: %s", source)

    rows: list[dict[str, Any]] = []
    for index, sample in enumerate(samples, start=1):
        response_path = responses_dir / f"{index:02d}-{slug(sample.source.stem)}-{sample.sample_index:02d}.json"
        input_metadata = {"path": str(sample.input_path), "bytes": sample.input_path.stat().st_size, "sha256": sha256(sample.input_path)}
        write_jsonl(jsonl_path, {"event": "request", "run_index": index, "source": str(sample.source), "input_kind": sample.input_kind, "frame_timestamp_seconds": sample.timestamp_seconds, "input": input_metadata})
        logging.info("[%d/%d] Analyzing %s", index, len(samples), sample.input_path.name)
        http_status, elapsed, curl_error, command = run_curl(args.curl, args.api_url, args.token, sample, response_path, args.timeout_seconds, args.camera_prefix, args.include_diagnostics)
        payload, parse_error = read_json(response_path)
        outcome = summarize(payload)
        success = http_status == 200 and parse_error is None
        error = curl_error or parse_error or ("HTTP response was not 200" if not success else "")
        row = {
            "run_index": index, "source_name": sample.source.name, "source_path": str(sample.source), "input_path": str(sample.input_path),
            "input_kind": sample.input_kind, "frame_timestamp_seconds": sample.timestamp_seconds, "input_bytes": input_metadata["bytes"], "input_sha256": input_metadata["sha256"],
            "http_status": http_status, "result": "ok" if success else "error", "elapsed_seconds": elapsed,
            "people_count": outcome["people"], "bin_states": outcome["bins"], "floor_litter_count": outcome["litter"], "floor_spill_count": outcome["spill"],
            "raw_counts": outcome["raw_counts"], "tile_count": outcome["tiles"], "placeholder_template": outcome["placeholder"],
            "expected_summary": structured_expectations.get(
                sample.source.resolve(), expectations.get(sample.source.name, {}).get("summary", "not reviewed")
            ),
            "flags": outcome["flags"], "response_file": str(response_path.relative_to(output_dir)), "error": error,
        }
        rows.append(row)
        write_jsonl(jsonl_path, {"event": "outcome", **row, "curl_command": command})
        logging.info("[%d/%d] status=%s result=%s people=%s bins=%s flags=%s seconds=%.3f", index, len(samples), http_status, row["result"], row["people_count"], row["bin_states"], row["flags"], elapsed)

    fieldnames = list(rows[0]) if rows else ["run_index", "source_name", "result"]
    with (output_dir / "summary.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    (output_dir / "summary.md").write_text("# InternVL mock evaluation\n\n" + markdown_table(rows), encoding="utf-8")
    write_jsonl(jsonl_path, {"event": "run_finished", "timestamp": datetime.now(UTC).isoformat(), "sample_count": len(rows), "success_count": sum(row["result"] == "ok" for row in rows), "output": str(output_dir)})
    logging.info("Finished %d samples. Review %s", len(rows), output_dir / "summary.md")
    return 0 if rows and all(row["result"] == "ok" for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
