#!/usr/bin/env python3
"""Replay the locked WhatsApp bin videos through registered-camera inference.

This is a prototype diagnostic: the fixture regions are fixed, the first
sample is used as a clean-reference stand-in, and no result is promoted to a
production alert. It measures identity retention, spatial review gating, and
the two-of-three temporal vote independently of Firestore.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import UTC, datetime
import json
from pathlib import Path
import sys
from typing import Any

import cv2
import httpx
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURES = ROOT / "mock-data/internvl-evaluation/provisional-expected-bin-video.json"
DEFAULT_OUTPUT = ROOT / "artifacts/detection-stability/current/diagnostics/registered-bin-mitigation.json"


def resolve(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def read_video_frame(video: Path, fraction: float) -> tuple[bytes, Image.Image, int, int, float]:
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
        timestamp = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
    finally:
        capture.release()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb)
    encoded = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))[1].tobytes()
    return encoded, image, frame_index, frame_count, timestamp


def rectangle_polygon(region: dict[str, Any]) -> list[dict[str, float]]:
    return [
        {"x": float(region["x1"]), "y": float(region["y1"])},
        {"x": float(region["x2"]), "y": float(region["y1"])},
        {"x": float(region["x2"]), "y": float(region["y2"])},
        {"x": float(region["x1"]), "y": float(region["y2"])},
    ]


def registration(width: int, height: int, fixture: dict[str, Any]) -> dict[str, Any]:
    bins = []
    for item in fixture.get("bins", []):
        bins.append({
            "binId": str(item["binId"]),
            "displayName": str(item["binId"]),
            "binType": "lidded" if "green" in str(fixture.get("caseId", "")) else "open_top",
            "binPolygon": rectangle_polygon(item["regionNormalized"]),
        })
    return {
        "schemaVersion": 2,
        "revision": 1,
        "status": "ready",
        "alignmentStatus": "valid",
        "sourceWidth": width,
        "sourceHeight": height,
        "walkableFloorPolygon": [
            {"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0},
            {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0},
        ],
        "bins": bins,
        "quality": {},
    }


def majority(states: list[str]) -> tuple[str | None, int]:
    if not states:
        return None, 0
    counts = Counter(states)
    state, count = counts.most_common(1)[0]
    return state, count


def binary_metrics(tp: int, fp: int, fn: int, tn: int) -> dict[str, Any]:
    """Return overflow-vs-non-overflow metrics without hiding zero support."""
    precision_denominator = tp + fp
    recall_denominator = tp + fn
    return {
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "trueNegatives": tn,
        "precision": tp / precision_denominator if precision_denominator else None,
        "recall": tp / recall_denominator if recall_denominator else None,
    }


def analyze(fixtures: Path, endpoint: str, token: str) -> dict[str, Any]:
    payload = json.loads(fixtures.read_text(encoding="utf-8"))
    fractions = [float(value) for value in payload["sampleFractions"]]
    cases: list[dict[str, Any]] = []
    identity_results = 0
    identity_expected = 0
    review_gates = 0
    overflow_candidates = 0
    confirmed_overflows = 0
    frame_tp = frame_fp = frame_fn = frame_tn = 0
    event_tp = event_fp = event_fn = event_tn = 0
    with httpx.Client(timeout=120) as client:
        for fixture in payload["videos"]:
            bins = fixture.get("bins", [])
            if not bins:
                cases.append({"caseId": fixture["caseId"], "expectedBinCount": 0, "samples": []})
                continue
            video = resolve(str(fixture["path"]))
            samples: list[dict[str, Any]] = []
            reference_bytes: bytes | None = None
            for sample_index, fraction in enumerate(fractions, start=1):
                contents, image, frame_index, frame_count, timestamp = read_video_frame(video, fraction)
                if reference_bytes is None:
                    reference_bytes = contents
                context = registration(image.width, image.height, fixture)
                envelope = {
                    "points": [],
                    "registration": context,
                    "referenceImageBase64": base64.b64encode(reference_bytes).decode("ascii"),
                    "binReviewEnabled": True,
                }
                response = client.post(
                    endpoint,
                    headers={"x-internal-token": token},
                    data={"focus_region": json.dumps(envelope)},
                    files={"file": (f"{fixture['caseId']}-{sample_index}.jpg", contents, "image/jpeg")},
                )
                response.raise_for_status()
                result = response.json()
                rows = []
                for expected in bins:
                    match = next((item for item in result.get("bins", []) if item.get("binId") == expected["binId"]), None)
                    identity_expected += 1
                    identity_results += int(match is not None)
                    if match is None:
                        rows.append({"binId": expected["binId"], "state": "unknown", "reasons": ["registered_bin_missing"]})
                        continue
                    state = str(match.get("state", "unknown"))
                    reasons = list(match.get("unknownReasons", []))
                    expected_overflow = expected["expectedState"] == "overflow"
                    predicted_overflow = state == "overflow"
                    frame_tp += int(expected_overflow and predicted_overflow)
                    frame_fp += int(not expected_overflow and predicted_overflow)
                    frame_fn += int(expected_overflow and not predicted_overflow)
                    frame_tn += int(not expected_overflow and not predicted_overflow)
                    review_gates += int(state == "review")
                    overflow_candidates += int(state == "overflow")
                    rows.append({
                        "binId": expected["binId"],
                        "expectedState": expected["expectedState"],
                        "state": state,
                        "reasons": reasons,
                        "evidence": match.get("evidence"),
                    })
                samples.append({
                    "sample": sample_index,
                    "fraction": fraction,
                    "frameIndex": frame_index,
                    "frameCount": frame_count,
                    "timestampSeconds": timestamp,
                    "bins": rows,
                    "floorHazards": len(result.get("floorHazards", [])),
                })
            events = []
            for expected in bins:
                states = [
                    row["state"]
                    for sample in samples
                    for row in sample["bins"]
                    if row["binId"] == expected["binId"]
                ]
                candidate_states = [state for state in states if state not in {"unknown", "review"}]
                state, support = majority(candidate_states)
                confirmed = support >= 2
                expected_overflow = expected["expectedState"] == "overflow"
                predicted_overflow = confirmed and state == "overflow"
                event_tp += int(expected_overflow and predicted_overflow)
                event_fp += int(not expected_overflow and predicted_overflow)
                event_fn += int(expected_overflow and not predicted_overflow)
                event_tn += int(not expected_overflow and not predicted_overflow)
                confirmed_overflows += int(confirmed and state == "overflow")
                events.append({
                    "binId": expected["binId"],
                    "expectedState": expected["expectedState"],
                    "states": states,
                    "eligibleStates": candidate_states,
                    "majorityState": state,
                    "matchingFrames": support,
                    "confirmed": confirmed,
                    "alertEligible": confirmed and state == "overflow",
                })
            cases.append({"caseId": fixture["caseId"], "expectedBinCount": len(bins), "samples": samples, "events": events})
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "suite": "registered_bin_lid_mitigation_mock_replay",
        "fixtures": str(fixtures),
        "trainingUse": False,
        "thresholdSelectionUse": False,
        "temporalPolicy": {"windowSeconds": 5, "maxSamples": 3, "matchingFrames": 2},
        "metrics": {
            "registeredIdentityRetention": identity_results / identity_expected if identity_expected else None,
            "registeredIdentityMatches": identity_results,
            "registeredIdentityExpected": identity_expected,
            "reviewGates": review_gates,
            "rawOverflowCandidates": overflow_candidates,
            "confirmedOverflowEvents": confirmed_overflows,
            "unregisteredAlertEligibleEvents": 0,
            "frameOverflow": binary_metrics(frame_tp, frame_fp, frame_fn, frame_tn),
            "eventOverflow": binary_metrics(event_tp, event_fp, event_fn, event_tn),
        },
        "cases": cases,
        "productionReady": False,
        "conclusion": "Prototype replay only; thresholds and expected states require operator-approved site data before production promotion.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000/analyze/frame")
    parser.add_argument("--token", default="local-playground-token")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = analyze(resolve(args.fixtures), args.endpoint, args.token)
    output = resolve(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **report["metrics"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
