"""Evaluate reviewed bin-state edge-case fixtures without changing a checkpoint."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import cv2
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def load_image(path: Path, media_type: str, frame_fraction: float) -> Image.Image:
    if media_type == "image":
        return Image.open(path).convert("RGB")
    capture = cv2.VideoCapture(str(path))
    try:
        count = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        capture.set(cv2.CAP_PROP_POS_FRAMES, min(count - 1, round((count - 1) * frame_fraction)))
        success, frame = capture.read()
        if not success:
            raise ValueError(f"Could not read a frame from {path}")
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        capture.release()


def frame_fractions(fixture: dict[str, object]) -> list[float]:
    if fixture["mediaType"] == "image":
        return [0.0]
    configured = fixture.get("frameFractions", [fixture.get("frameFraction", 0.5)])
    values = [float(value) for value in configured]
    if not values or any(not 0 <= value <= 1 for value in values):
        raise ValueError(f"Invalid frame fractions for fixture {fixture['id']}")
    return values


def normalized_box(value: dict[str, float], image: Image.Image):
    from app.schemas import BoundingBox

    return BoundingBox(
        x1=value["x1"] * image.width,
        y1=value["y1"] * image.height,
        x2=value["x2"] * image.width,
        y2=value["y2"] * image.height,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "samples/bin-state-edge-cases/manifest.json")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "runs/state_classifier/multitask_gco_gbs_v2/production.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/edge-case-evaluation/report.json")
    parser.add_argument("--strict", action="store_true", help="Fail when a reviewed expected state differs from the prediction")
    parser.add_argument("--validate-localizer", action="store_true", help="Also validate fixed-camera behavior for no-ROI fixtures")
    args = parser.parse_args()

    os.environ["STATE_CLASSIFIER_PATH"] = str(args.checkpoint.resolve())
    from app.multi_state_classifier import BinProfile, MultiStateClassifier

    manifest_path = args.manifest.resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    classifier = MultiStateClassifier()
    classifier.load()
    if not classifier.ready:
        raise RuntimeError(classifier.load_error or "State classifier did not load")

    rows = []
    for fixture in payload["fixtures"]:
        roi = fixture.get("roiNormalized")
        if not roi:
            if not args.validate_localizer or not fixture.get("knownBinRoiNormalized"):
                rows.append({"id": fixture["id"], "status": "skipped", "reason": "no_classifier_roi"})
                continue
            from app.bin_localizer import BinLocalizer

            localizer = BinLocalizer()
            localizer.load()
            if not localizer.ready:
                raise RuntimeError(localizer.load_error or "Bin localizer did not load")
            known_roi = fixture["knownBinRoiNormalized"]
            classifier.profile_store.profiles[f"{fixture['cameraId']}:registered-bin"] = BinProfile(region=known_roi, thresholds={})
            frame_rows = []
            for fraction in frame_fractions(fixture):
                image = load_image(manifest_path.parent / fixture["media"], fixture["mediaType"], fraction)
                candidates, _ = localizer.locate_all(image)
                classifications = []
                for index, candidate in enumerate(candidates, start=1):
                    bin_id, profile = classifier.resolve_profile(image, str(fixture["cameraId"]), candidate.bbox)
                    response = classifier.classify(image, candidate.bbox, str(fixture["cameraId"]), bin_id or f"candidate-{index}", 1, profile is not None, True)
                    classifications.append({"state": response.state, "reasons": response.unknownReasons, "localizerConfidence": candidate.confidence})
                frame_rows.append({"frameFraction": fraction, "localizedBins": len(candidates), "classifications": classifications})
            is_safe = all(item["state"] != "overflow" for frame in frame_rows for item in frame["classifications"])
            rows.append({"id": fixture["id"], "status": "evaluated_localizer_guard", "matchesExpectedOverflowCandidate": is_safe, "frames": frame_rows})
            continue
        frame_rows = []
        for fraction in frame_fractions(fixture):
            image = load_image(manifest_path.parent / fixture["media"], fixture["mediaType"], fraction)
            camera_id = str(fixture["cameraId"]) if fixture.get("useProfile") else None
            bin_id = str(fixture["binId"]) if fixture.get("useProfile") else None
            profile_used = classifier.profile_store.get(camera_id, bin_id) is not None
            response = classifier.classify(
                image,
                normalized_box(roi, image),
                camera_id,
                bin_id,
                1,
                profile_used,
            )
            frame_rows.append({
                "frameFraction": fraction,
                "prediction": response.state,
                "signals": response.signals.model_dump(),
                "reasons": response.unknownReasons,
                "profileUsed": response.profileUsed,
            })
        expected = fixture.get("expectedState")
        allowed_states = fixture.get("allowedStates")
        expected_overflow = fixture.get("expectedOverflowCandidate")
        states = [row["prediction"] for row in frame_rows]
        matches_state = all(state in allowed_states for state in states) if allowed_states else all(state == expected for state in states) if expected else None
        matches_overflow = None if expected_overflow is None else all((state == "overflow") == expected_overflow for state in states)
        rows.append({
            "id": fixture["id"],
            "status": "evaluated",
            "expectedState": expected,
            "predictions": states,
            "matchesExpectedState": matches_state,
            "matchesExpectedOverflowCandidate": matches_overflow,
            "frames": frame_rows,
            "reviewStatus": fixture["reviewStatus"],
        })

    report = {
        "checkpoint": str(args.checkpoint.resolve()),
        "modelVersion": classifier.__class__.__name__,
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if args.strict and any(
        row.get("matchesExpectedState") is False or row.get("matchesExpectedOverflowCandidate") is False
        for row in rows
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
