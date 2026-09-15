#!/usr/bin/env python3
"""Replay locked WhatsApp videos through fixed-ROI bin-state inference.

The fixture regions and expected states are diagnostic annotations only.  The
locked videos are never training data and must not be used for threshold
selection.  Each physical-bin event is sampled at fixed fractions and scored
both per frame and by majority state, which avoids treating adjacent frames as
independent deployment evidence.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sys
from typing import Any

import cv2
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
AI_SERVICE_ROOT = ROOT / "ai-service"
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))
DEFAULT_FIXTURES = ROOT / "mock-data/internvl-evaluation/provisional-expected-bin-video.json"
DEFAULT_CHECKPOINT = ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/best.pt"
DEFAULT_OUTPUT = ROOT / "artifacts/detection-stability/current/diagnostics/bin-whatsapp-video.json"


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def read_video_frame(video: Path, fraction: float) -> tuple[Image.Image, int, int, float]:
    """Return an RGB frame plus frame index/count and timestamp seconds."""
    if not 0 <= fraction <= 1:
        raise ValueError("sample fraction must be between 0 and 1")
    capture = cv2.VideoCapture(str(video))
    try:
        if not capture.isOpened():
            raise ValueError(f"Could not open video: {video}")
        frame_count = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        frame_index = round((frame_count - 1) * fraction)
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        success, frame = capture.read()
        if not success:
            raise ValueError(f"Could not read frame {frame_index} from {video}")
        timestamp_seconds = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
    finally:
        capture.release()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb), frame_index, frame_count, timestamp_seconds


def majority_state(states: list[str]) -> tuple[str | None, int]:
    """Choose a unique majority; ties are deliberately unknown."""
    if not states:
        return None, 0
    counts = Counter(states)
    best_count = max(counts.values())
    winners = sorted(state for state, count in counts.items() if count == best_count)
    return (winners[0], best_count) if len(winners) == 1 else ("unknown", best_count)


def normalized_box(region: dict[str, Any], image: Image.Image):
    required = {"x1", "y1", "x2", "y2"}
    if set(region) != required:
        raise ValueError("regionNormalized must contain x1/y1/x2/y2")
    values = {key: float(region[key]) for key in required}
    if not (0 <= values["x1"] < values["x2"] <= 1 and 0 <= values["y1"] < values["y2"] <= 1):
        raise ValueError("regionNormalized values must form a valid normalized box")
    from app.schemas import BoundingBox  # pylint: disable=import-outside-toplevel
    return BoundingBox(
        x1=values["x1"] * image.width,
        y1=values["y1"] * image.height,
        x2=values["x2"] * image.width,
        y2=values["y2"] * image.height,
    )


def evaluate(fixtures: Path, checkpoint: Path, device: str) -> dict[str, Any]:
    payload = json.loads(fixtures.read_text(encoding="utf-8"))
    fractions = [float(value) for value in payload.get("sampleFractions", [])]
    videos = payload.get("videos")
    if not fractions or not isinstance(videos, list):
        raise ValueError("Fixture must contain sampleFractions and videos")
    if payload.get("trainingUse") is not False or payload.get("thresholdSelectionUse") is not False:
        raise ValueError("Locked fixture must explicitly disable training and threshold selection")

    os.environ["STATE_CLASSIFIER_PATH"] = str(checkpoint)
    os.environ["DEVICE"] = device
    os.environ["STATE_CLASSIFIER_VERSION"] = "multi-angle-mobilenet-v3-small-loop1"
    from app.multi_state_classifier import MultiStateClassifier  # pylint: disable=import-outside-toplevel

    classifier = MultiStateClassifier()
    classifier.load()
    if not classifier.ready:
        raise RuntimeError(classifier.load_error or "runtime classifier failed to load")

    case_rows: list[dict[str, Any]] = []
    event_rows: list[dict[str, Any]] = []
    frame_matches = 0
    frame_total = 0
    for case in videos:
        video_path = resolve(str(case["path"]))
        if not video_path.is_file():
            raise FileNotFoundError(video_path)
        bins = case.get("bins", [])
        samples = []
        for sample_index, fraction in enumerate(fractions, start=1):
            image, frame_index, frame_count, timestamp_seconds = read_video_frame(video_path, fraction)
            predictions = []
            for bin_fixture in bins:
                response = classifier.classify(
                    image=image,
                    region=normalized_box(bin_fixture["regionNormalized"], image),
                    camera_id=str(case["caseId"]),
                    bin_id=str(bin_fixture["binId"]),
                    confirmation_frames=1,
                    profile_used=True,
                    localizer_used=False,
                )
                expected = str(bin_fixture["expectedState"])
                matched = response.state == expected
                frame_matches += int(matched)
                frame_total += 1
                predictions.append({
                    "binId": bin_fixture["binId"],
                    "expectedState": expected,
                    "actualState": response.state,
                    "matched": matched,
                    "confidence": response.confidence,
                    "signals": response.signals.model_dump(),
                    "unknownReasons": response.unknownReasons,
                    "processingTimeMs": response.processingTimeMs,
                    "regionNormalized": bin_fixture["regionNormalized"],
                })
            samples.append({
                "sample": sample_index,
                "fraction": fraction,
                "frameIndex": frame_index,
                "frameCount": frame_count,
                "timestampSeconds": timestamp_seconds,
                "predictions": predictions,
            })

        for bin_fixture in bins:
            states = [
                prediction["actualState"]
                for sample in samples
                for prediction in sample["predictions"]
                if prediction["binId"] == bin_fixture["binId"]
            ]
            actual, support = majority_state(states)
            expected = str(bin_fixture["expectedState"])
            event_rows.append({
                "caseId": case["caseId"],
                "binId": bin_fixture["binId"],
                "expectedState": expected,
                "actualMajorityState": actual,
                "majoritySupport": support,
                "sampleCount": len(states),
                "matched": actual == expected,
                "states": states,
            })
        case_rows.append({
            "caseId": case["caseId"],
            "input": str(video_path),
            "expectedBinCount": len(bins),
            "manualFixedRoi": True,
            "noBinNegative": not bins,
            "notes": case.get("notes"),
            "samples": samples,
        })

    event_matches = sum(int(row["matched"]) for row in event_rows)
    overflow_rows = [row for row in event_rows if row["expectedState"] == "overflow"]
    overflow_matches = sum(int(row["matched"]) for row in overflow_rows)
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "suite": "locked_whatsapp_video_fixed_roi_diagnostic",
        "fixtures": str(fixtures),
        "checkpoint": str(checkpoint),
        "trainingUse": False,
        "thresholdSelectionUse": False,
        "statePolicy": payload.get("statePolicy"),
        "metrics": {
            "frameStateAccuracy": frame_matches / frame_total if frame_total else None,
            "frameMatches": frame_matches,
            "frameTotal": frame_total,
            "eventStateAccuracy": event_matches / len(event_rows) if event_rows else None,
            "eventMatches": event_matches,
            "eventTotal": len(event_rows),
            "overflowEventRecall": overflow_matches / len(overflow_rows) if overflow_rows else None,
            "overflowEventMatches": overflow_matches,
            "overflowEventTotal": len(overflow_rows),
            "noBinCases": sum(int(not case.get("bins")) for case in videos),
        },
        "events": event_rows,
        "cases": case_rows,
        "productionReady": False,
        "conclusion": "Diagnostic only until expected labels are operator-approved and installed-camera event groups satisfy qualification gates.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    fixtures, checkpoint, output = resolve(args.fixtures), resolve(args.checkpoint), resolve(args.output)
    report = evaluate(fixtures, checkpoint, args.device)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **report["metrics"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
