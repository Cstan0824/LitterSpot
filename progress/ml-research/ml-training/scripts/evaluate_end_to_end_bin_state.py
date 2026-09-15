"""Benchmark learned bin localization followed by the bin-state classifier.

Unlike the fixed-ROI diagnostics, a localizer miss counts as an end-to-end
state failure. Locked WhatsApp fixtures remain evaluation-only.
"""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sys
from typing import Any

import cv2
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
AI_SERVICE_ROOT = ROOT / "ai-service"
DEFAULT_FIXTURES = ROOT / "mock-data/internvl-evaluation/provisional-expected-bin-video.json"
DEFAULT_LOCALIZER = ROOT / "runs/bin-localizer/bin_localizer_openimages_v0_76/weights/best.pt"
DEFAULT_STATE = ROOT / "runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/best.pt"
DEFAULT_OUTPUT = ROOT / "artifacts/state-benchmark-v0-20260822/end-to-end.json"


def score(rows: list[dict[str, Any]], negative_frames: list[dict[str, Any]]) -> dict[str, Any]:
    expected = len(rows)
    localized_rows = [row for row in rows if row["localized"]]
    localized = len(localized_rows)
    correct = sum(row.get("actualState") == row["expectedState"] for row in localized_rows)
    overflow_rows = [row for row in rows if row["expectedState"] == "overflow"]
    detected_overflow = sum(
        row["localized"] and row.get("actualState") == "overflow"
        for row in overflow_rows
    )
    false_bin_frames = sum(int(frame["detectionCount"] > 0) for frame in negative_frames)
    false_overflow_frames = sum(int("overflow" in frame["states"]) for frame in negative_frames)
    negative_count = len(negative_frames)
    return {
        "expectedFrameBins": expected,
        "localizedFrameBins": localized,
        "localizerRecall": localized / expected if expected else None,
        "stateCorrectGivenLocalized": correct,
        "stateAccuracyGivenLocalized": correct / localized if localized else None,
        "endToEndStateCorrect": correct,
        "endToEndStateAccuracy": correct / expected if expected else None,
        "expectedOverflowFrameBins": len(overflow_rows),
        "detectedOverflowFrameBins": detected_overflow,
        "endToEndOverflowRecall": detected_overflow / len(overflow_rows) if overflow_rows else None,
        "negativeFrames": negative_count,
        "falseBinFrames": false_bin_frames,
        "falseBinFrameRate": false_bin_frames / negative_count if negative_count else None,
        "falseOverflowFrames": false_overflow_frames,
        "falseOverflowFrameRate": false_overflow_frames / negative_count if negative_count else None,
    }


def _resolve(path: Path) -> Path:
    return path if path.is_absolute() else ROOT / path


def _read_frame(video: Path, fraction: float) -> tuple[Image.Image, int, int, float]:
    capture = cv2.VideoCapture(str(video))
    try:
        if not capture.isOpened():
            raise ValueError(f"Could not open video: {video}")
        count = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        index = round((count - 1) * fraction)
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if not ok:
            raise ValueError(f"Could not read frame {index} from {video}")
        timestamp = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
    finally:
        capture.release()
    return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), index, count, timestamp


def _iou(first: list[float], second: list[float]) -> float:
    x1, y1 = max(first[0], second[0]), max(first[1], second[1])
    x2, y2 = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def evaluate(
    fixtures_path: Path,
    localizer_checkpoint: Path,
    state_checkpoint: Path,
    *,
    confidence: float,
    minimum_iou: float,
    device: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    if str(AI_SERVICE_ROOT) not in sys.path:
        sys.path.insert(0, str(AI_SERVICE_ROOT))
    state_device = f"cuda:{device}" if device.isdigit() else device
    os.environ["STATE_CLASSIFIER_PATH"] = str(state_checkpoint)
    os.environ["STATE_CLASSIFIER_VERSION"] = "multi-angle-mobilenet-v3-small-loop1"
    os.environ["DEVICE"] = state_device
    from app.multi_state_classifier import MultiStateClassifier
    from app.schemas import BoundingBox

    payload = json.loads(fixtures_path.read_text(encoding="utf-8"))
    if payload.get("trainingUse") is not False or payload.get("thresholdSelectionUse") is not False:
        raise ValueError("Locked fixtures must disable training and threshold selection")
    fractions = [float(value) for value in payload["sampleFractions"]]
    localizer = YOLO(str(localizer_checkpoint))
    classifier = MultiStateClassifier()
    classifier.load()
    if not classifier.ready:
        raise RuntimeError(classifier.load_error or "State classifier failed to load")

    state_rows: list[dict[str, Any]] = []
    negative_rows: list[dict[str, Any]] = []
    cases: list[dict[str, Any]] = []
    for case in payload["videos"]:
        video = _resolve(Path(case["path"]))
        samples = []
        for sample_index, fraction in enumerate(fractions, start=1):
            image, frame_index, frame_count, timestamp = _read_frame(video, fraction)
            result = localizer.predict(
                source=image,
                conf=confidence,
                imgsz=640,
                device=device,
                verbose=False,
            )[0]
            detections = []
            if result.boxes is not None:
                for xyxy, probability in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist()):
                    detections.append({"xyxy": [float(value) for value in xyxy], "confidence": float(probability)})

            expected_bins = list(case.get("bins", []))
            if not expected_bins:
                states = []
                classified = []
                for index, detection in enumerate(detections, start=1):
                    box = BoundingBox(
                        x1=detection["xyxy"][0], y1=detection["xyxy"][1],
                        x2=detection["xyxy"][2], y2=detection["xyxy"][3],
                    )
                    response = classifier.classify(
                        image, box, str(case["caseId"]), f"candidate-{index}", 1,
                        False, True, profile_enabled=False,
                    )
                    states.append(response.state)
                    classified.append({
                        "localizerConfidence": detection["confidence"],
                        "state": response.state,
                        "signals": response.signals.model_dump(),
                    })
                negative = {"detectionCount": len(detections), "states": states}
                negative_rows.append(negative)
                samples.append({
                    "sample": sample_index, "fraction": fraction, "frameIndex": frame_index,
                    "frameCount": frame_count, "timestampSeconds": timestamp,
                    **negative, "detections": classified,
                })
                continue

            used: set[int] = set()
            expected_results = []
            for expected in expected_bins:
                region = expected["regionNormalized"]
                expected_xyxy = [
                    float(region["x1"]) * image.width,
                    float(region["y1"]) * image.height,
                    float(region["x2"]) * image.width,
                    float(region["y2"]) * image.height,
                ]
                ranked = sorted(
                    ((index, _iou(expected_xyxy, detection["xyxy"])) for index, detection in enumerate(detections) if index not in used),
                    key=lambda item: item[1], reverse=True,
                )
                match = ranked[0] if ranked and ranked[0][1] >= minimum_iou else None
                row = {
                    "caseId": case["caseId"], "sample": sample_index,
                    "binId": expected["binId"], "expectedState": expected["expectedState"],
                    "localized": match is not None, "actualState": None,
                }
                if match is not None:
                    detection_index, overlap = match
                    used.add(detection_index)
                    detection = detections[detection_index]
                    box = BoundingBox(
                        x1=detection["xyxy"][0], y1=detection["xyxy"][1],
                        x2=detection["xyxy"][2], y2=detection["xyxy"][3],
                    )
                    response = classifier.classify(
                        image, box, str(case["caseId"]), str(expected["binId"]), 1,
                        False, True, profile_enabled=False,
                    )
                    row.update({
                        "actualState": response.state,
                        "iou": overlap,
                        "localizerConfidence": detection["confidence"],
                        "stateConfidence": response.confidence,
                        "signals": response.signals.model_dump(),
                        "unknownReasons": response.unknownReasons,
                    })
                state_rows.append(row)
                expected_results.append(row)
            samples.append({
                "sample": sample_index, "fraction": fraction, "frameIndex": frame_index,
                "frameCount": frame_count, "timestampSeconds": timestamp,
                "detectionCount": len(detections), "expectedBins": expected_results,
            })
        cases.append({"caseId": case["caseId"], "input": str(video), "samples": samples})

    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "suite": "locked_whatsapp_learned_localizer_to_state_v0",
        "benchmarkType": "end_to_end_diagnostic",
        "fixtures": str(fixtures_path),
        "localizerCheckpoint": str(localizer_checkpoint),
        "stateCheckpoint": str(state_checkpoint),
        "confidence": confidence,
        "minimumMatchIou": minimum_iou,
        "trainingUse": False,
        "thresholdSelectionUse": False,
        "metrics": score(state_rows, negative_rows),
        "stateRows": state_rows,
        "negativeFrames": negative_rows,
        "cases": cases,
        "productionReady": False,
        "limitations": [
            "Expected WhatsApp labels and regions are provisional diagnostic annotations.",
            "Only three positive events and two negative videos are represented.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--localizer-checkpoint", type=Path, default=DEFAULT_LOCALIZER)
    parser.add_argument("--state-checkpoint", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--minimum-iou", type=float, default=0.2)
    parser.add_argument("--device", default="0")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fixtures = _resolve(args.fixtures)
    localizer = _resolve(args.localizer_checkpoint)
    state = _resolve(args.state_checkpoint)
    output = _resolve(args.output)
    for path in (fixtures, localizer, state):
        if not path.is_file():
            raise SystemExit(f"Required benchmark input not found: {path}")
    report = evaluate(
        fixtures, localizer, state,
        confidence=args.confidence,
        minimum_iou=args.minimum_iou,
        device=args.device,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **report["metrics"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
