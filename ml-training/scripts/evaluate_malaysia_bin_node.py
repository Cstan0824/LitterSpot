"""Measure three-bin detection coverage on the University of Malaya image set."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_BINS_PER_IMAGE = 3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument(
        "--images",
        type=Path,
        default=ROOT / "ml-training/data/malaysia-bin-node/images",
    )
    parser.add_argument("--confidence", type=float, default=.40)
    parser.add_argument("--skip", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default=0)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint = args.checkpoint.resolve()
    images = args.images.resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")
    paths = sorted(images.glob("*.jpg"))
    paths = paths[args.skip:]
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        raise SystemExit(f"No JPEG images found: {images}")

    model = YOLO(str(checkpoint))
    results = model.predict(
        [str(path) for path in paths],
        conf=args.confidence,
        imgsz=args.imgsz,
        device=args.device,
        max_det=10,
        verbose=False,
        stream=True,
    )
    per_image = []
    for path, result in zip(paths, results, strict=True):
        confidences = [] if result.boxes is None else [float(value) for value in result.boxes.conf.tolist()]
        per_image.append(
            {"image": path.name, "detections": len(confidences), "confidences": confidences}
        )

    counts = [item["detections"] for item in per_image]
    expected_total = len(paths) * EXPECTED_BINS_PER_IMAGE
    report = {
        "checkpoint": str(checkpoint),
        "dataset": "University of Malaya solid-waste bin images (Figshare 6269042)",
        "images": len(paths),
        "sourceRange": {"skip": args.skip, "limit": args.limit},
        "expectedBinsPerImage": EXPECTED_BINS_PER_IMAGE,
        "confidence": args.confidence,
        "exactlyThreeRate": sum(count == 3 for count in counts) / len(counts),
        "atLeastThreeRate": sum(count >= 3 for count in counts) / len(counts),
        "countCoverageProxy": sum(min(count, EXPECTED_BINS_PER_IMAGE) for count in counts) / expected_total,
        "meanDetections": mean(counts),
        "note": (
            "Count coverage is a domain diagnostic, not localization mAP: the source has "
            "three bins per image but no machine-readable ground-truth boxes."
        ),
        "perImage": per_image,
    }
    output = args.output or checkpoint.parents[1] / "malaysia-bin-node-report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "perImage"}, indent=2))
    print(f"Report written to {output}")


if __name__ == "__main__":
    main()
