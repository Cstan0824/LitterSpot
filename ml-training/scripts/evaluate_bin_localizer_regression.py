"""Evaluate a bin-localizer checkpoint on locked positive and negative videos.

The locked suite is an acceptance test only. It must explicitly opt out of
training and threshold selection so chair/no-bin failures cannot leak back into
model fitting. Videos are sampled at a fixed rate and scored as physical-bin
localization, independently of fullness or overflow classification.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

import cv2


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = ROOT / "mock-data/bin-localizer-regression-v1/manifest.json"
DEFAULT_OUTPUT = ROOT / "artifacts/bin-localizer-regression/report.json"
BLOCKER_CLASSES = {"person", "bottle", "chair", "couch", "dining table", "tv", "cell phone"}


def intersection_over_union(first: dict[str, float], second: dict[str, float]) -> float:
    x1 = max(float(first["x1"]), float(second["x1"]))
    y1 = max(float(first["y1"]), float(second["y1"]))
    x2 = min(float(first["x2"]), float(second["x2"]))
    y2 = min(float(first["y2"]), float(second["y2"]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, float(first["x2"]) - float(first["x1"])) * max(
        0.0, float(first["y2"]) - float(first["y1"])
    )
    second_area = max(0.0, float(second["x2"]) - float(second["x1"])) * max(
        0.0, float(second["y2"]) - float(second["y1"])
    )
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def candidate_coverage(candidate: dict[str, float], blocker: dict[str, float]) -> float:
    x1 = max(float(candidate["x1"]), float(blocker["x1"]))
    y1 = max(float(candidate["y1"]), float(blocker["y1"]))
    x2 = min(float(candidate["x2"]), float(blocker["x2"]))
    y2 = min(float(candidate["y2"]), float(blocker["y2"]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area = max(0.0, float(candidate["x2"]) - float(candidate["x1"])) * max(
        0.0, float(candidate["y2"]) - float(candidate["y1"])
    )
    return intersection / area if area > 0 else 0.0


def filter_blocked_detections(
    detections: list[dict[str, Any]],
    blockers: list[dict[str, Any]],
    *,
    minimum_coverage: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for detection in detections:
        blocking = next((
            blocker for blocker in blockers
            if blocker.get("className") in BLOCKER_CLASSES
            and candidate_coverage(detection["bboxNormalized"], blocker["bboxNormalized"]) >= minimum_coverage
        ), None)
        if blocking is None:
            accepted.append(detection)
        else:
            rejected.append({
                **detection,
                "rejectionReason": f"blocked_by_{str(blocking['className']).replace(' ', '_')}",
                "blockerConfidence": blocking.get("confidence"),
            })
    return accepted, rejected


def score_predictions(
    cases: list[dict[str, Any]],
    predictions: dict[tuple[str, int], list[dict[str, Any]]],
    minimum_iou: float,
    *,
    maximum_false_bin_frame_rate: float = .01,
    minimum_positive_track_recall: float = .90,
    minimum_positive_cases: int = 1,
    minimum_negative_cases: int = 1,
) -> dict[str, Any]:
    negative_frames = false_positive_frames = chair_false_detections = 0
    expected_track_samples = matched_track_samples = 0
    positive_cases = negative_cases = 0
    categories: dict[str, dict[str, int]] = defaultdict(
        lambda: {"frames": 0, "falsePositiveFrames": 0, "detections": 0}
    )

    for case in cases:
        case_id = str(case["caseId"])
        expected_bins = list(case.get("expectedBins", []))
        samples = list(case.get("samples", []))
        if expected_bins:
            positive_cases += 1
        else:
            negative_cases += 1
        for sample in samples:
            sample_index = int(sample["sampleIndex"])
            detections = predictions.get((case_id, sample_index), [])
            if not expected_bins:
                category = str(case.get("negativeCategory") or "uncategorized")
                categories[category]["frames"] += 1
                categories[category]["detections"] += len(detections)
                negative_frames += 1
                if detections:
                    false_positive_frames += 1
                    categories[category]["falsePositiveFrames"] += 1
                    if category == "chair":
                        chair_false_detections += len(detections)
                continue

            for expected in expected_bins:
                expected_track_samples += 1
                expected_box = expected["regionNormalized"]
                if any(
                    intersection_over_union(expected_box, detection["bboxNormalized"]) >= minimum_iou
                    for detection in detections
                ):
                    matched_track_samples += 1

    false_bin_frame_rate = false_positive_frames / negative_frames if negative_frames else None
    positive_track_recall = matched_track_samples / expected_track_samples if expected_track_samples else None
    gates = {
        "suiteCoverage": {
            "positiveCases": positive_cases,
            "minimumPositiveCases": minimum_positive_cases,
            "negativeCases": negative_cases,
            "minimumNegativeCases": minimum_negative_cases,
            "passed": positive_cases >= minimum_positive_cases and negative_cases >= minimum_negative_cases,
        },
        "falseBinFrameRate": {
            "value": false_bin_frame_rate,
            "maximum": maximum_false_bin_frame_rate,
            "passed": false_bin_frame_rate is not None and false_bin_frame_rate <= maximum_false_bin_frame_rate,
        },
        "positiveTrackRecall": {
            "value": positive_track_recall,
            "minimum": minimum_positive_track_recall,
            "passed": positive_track_recall is not None and positive_track_recall >= minimum_positive_track_recall,
        },
        "chairFalseDetections": {
            "value": chair_false_detections,
            "maximum": 0,
            "passed": chair_false_detections == 0,
        },
    }
    return {
        "metrics": {
            "positiveCases": positive_cases,
            "negativeCases": negative_cases,
            "negativeFrames": negative_frames,
            "falsePositiveFrames": false_positive_frames,
            "falseBinFrameRate": false_bin_frame_rate,
            "expectedTrackSamples": expected_track_samples,
            "matchedTrackSamples": matched_track_samples,
            "positiveTrackRecall": positive_track_recall,
            "chairFalseDetections": chair_false_detections,
        },
        "categories": dict(categories),
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates.values()),
    }


def resolve(path: Path) -> Path:
    return path if path.is_absolute() else ROOT / path


def sample_video(video: Path, sample_rate_fps: float) -> list[dict[str, Any]]:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {video}")
    try:
        frame_count = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        native_fps = float(capture.get(cv2.CAP_PROP_FPS)) or 1.0
        frame_step = max(1, round(native_fps / sample_rate_fps))
        samples: list[dict[str, Any]] = []
        for sample_index, frame_index in enumerate(range(0, frame_count, frame_step)):
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            success, frame = capture.read()
            if not success:
                continue
            samples.append({
                "sampleIndex": sample_index,
                "frameIndex": frame_index,
                "timestampSeconds": frame_index / native_fps,
                "frame": frame,
            })
        return samples
    finally:
        capture.release()


def sample_media(path: Path, sample_rate_fps: float) -> list[dict[str, Any]]:
    """Sample a locked video or admit one explicitly reviewed still frame."""
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
        frame = cv2.imread(str(path))
        if frame is None:
            raise ValueError(f"Could not open image: {path}")
        return [{"sampleIndex": 0, "frameIndex": 0, "timestampSeconds": 0.0, "frame": frame}]
    return sample_video(path, sample_rate_fps)


def evaluate(
    fixtures: Path,
    checkpoint: Path,
    *,
    confidence: float,
    image_size: int,
    device: str,
    minimum_iou: float,
    blocker_checkpoint: Path | None = None,
    blocker_confidence: float = .25,
    blocker_coverage: float = .40,
) -> dict[str, Any]:
    from ultralytics import YOLO  # pylint: disable=import-outside-toplevel

    payload = json.loads(fixtures.read_text(encoding="utf-8"))
    if payload.get("trainingUse") is not False or payload.get("thresholdSelectionUse") is not False:
        raise ValueError("Locked fixture must disable training and threshold selection")
    sample_rate_fps = float(payload.get("sampleRateFps", 1.0))
    if not 0 < sample_rate_fps <= 1:
        raise ValueError("sampleRateFps must be greater than 0 and at most 1")

    model = YOLO(str(checkpoint))
    blocker_model = YOLO(str(blocker_checkpoint)) if blocker_checkpoint is not None else None
    scored_cases: list[dict[str, Any]] = []
    predictions: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for fixture_case in payload.get("cases", []):
        case = dict(fixture_case)
        media = resolve(Path(str(case["path"])))
        if not media.is_file():
            raise FileNotFoundError(media)
        raw_samples = sample_media(media, sample_rate_fps)
        case_samples: list[dict[str, Any]] = []
        for sample in raw_samples:
            frame = sample.pop("frame")
            height, width = frame.shape[:2]
            result = model.predict(
                source=frame,
                conf=confidence,
                imgsz=image_size,
                device=device,
                verbose=False,
            )[0]
            raw_detections: list[dict[str, Any]] = []
            if result.boxes is not None:
                for xyxy, score in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist()):
                    x1, y1, x2, y2 = (float(value) for value in xyxy)
                    raw_detections.append({
                        "confidence": float(score),
                        "bboxNormalized": {
                            "x1": x1 / width,
                            "y1": y1 / height,
                            "x2": x2 / width,
                            "y2": y2 / height,
                        },
                    })
            blockers: list[dict[str, Any]] = []
            if blocker_model is not None:
                blocker_result = blocker_model.predict(
                    source=frame,
                    conf=blocker_confidence,
                    imgsz=image_size,
                    device=device,
                    verbose=False,
                )[0]
                if blocker_result.boxes is not None:
                    for xyxy, score, class_id in zip(
                        blocker_result.boxes.xyxy.cpu().tolist(),
                        blocker_result.boxes.conf.cpu().tolist(),
                        blocker_result.boxes.cls.cpu().tolist(),
                    ):
                        class_name = str(blocker_result.names[int(class_id)])
                        if class_name not in BLOCKER_CLASSES:
                            continue
                        x1, y1, x2, y2 = (float(value) for value in xyxy)
                        blockers.append({
                            "className": class_name,
                            "confidence": float(score),
                            "bboxNormalized": {"x1": x1 / width, "y1": y1 / height, "x2": x2 / width, "y2": y2 / height},
                        })
            detections, rejected = filter_blocked_detections(
                raw_detections, blockers, minimum_coverage=blocker_coverage
            )
            key = (str(case["caseId"]), int(sample["sampleIndex"]))
            predictions[key] = detections
            case_samples.append({
                **sample,
                "detections": detections,
                "rawDetections": raw_detections,
                "blockers": blockers,
                "rejectedDetections": rejected,
            })
        case["samples"] = case_samples
        scored_cases.append(case)

    score = score_predictions(
        scored_cases,
        predictions,
        minimum_iou,
        minimum_positive_cases=int(payload.get("minimumPositiveCases", 3)),
        minimum_negative_cases=int(payload.get("minimumNegativeCases", 3)),
    )
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "suite": payload.get("suite", "bin_localizer_locked_video_regression"),
        "fixtures": str(fixtures),
        "checkpoint": str(checkpoint),
        "confidence": confidence,
        "imageSize": image_size,
        "minimumIou": minimum_iou,
        "sampleRateFps": sample_rate_fps,
        "blockerCheckpoint": str(blocker_checkpoint) if blocker_checkpoint else None,
        "blockerConfidence": blocker_confidence if blocker_checkpoint else None,
        "blockerCoverage": blocker_coverage if blocker_checkpoint else None,
        "trainingUse": False,
        "thresholdSelectionUse": False,
        **score,
        "cases": scored_cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--confidence", type=float, default=.85)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="0")
    parser.add_argument("--minimum-iou", type=float, default=.25)
    parser.add_argument("--blocker-checkpoint", type=Path)
    parser.add_argument("--blocker-confidence", type=float, default=.25)
    parser.add_argument("--blocker-coverage", type=float, default=.40)
    args = parser.parse_args()
    checkpoint, fixtures, output = resolve(args.checkpoint), resolve(args.fixtures), resolve(args.output)
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")
    if not fixtures.is_file():
        raise SystemExit(f"Fixture manifest not found: {fixtures}")
    blocker_checkpoint = resolve(args.blocker_checkpoint) if args.blocker_checkpoint else None
    if blocker_checkpoint is not None and not blocker_checkpoint.is_file():
        raise SystemExit(f"Blocker checkpoint not found: {blocker_checkpoint}")
    report = evaluate(
        fixtures,
        checkpoint,
        confidence=args.confidence,
        image_size=args.imgsz,
        device=args.device,
        minimum_iou=args.minimum_iou,
        blocker_checkpoint=blocker_checkpoint,
        blocker_confidence=args.blocker_confidence,
        blocker_coverage=args.blocker_coverage,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **report["metrics"], "passed": report["passed"]}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
