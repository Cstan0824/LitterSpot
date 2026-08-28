"""Evaluate the frozen bin localizer on the locked CDW-Seg test proxy.

This measures only bin presence/IoU. CDW-Seg has no rim-crossing overflow
truth, so predicted overflow is reported as a diagnostic count and is never
used to tune the replacement policy.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests


def iou(left: dict[str, float], right: list[float]) -> float:
    lx1, ly1, lx2, ly2 = left["x1"], left["y1"], left["x2"], left["y2"]
    rx1, ry1, rw, rh = right
    rx2, ry2 = rx1 + rw, ry1 + rh
    ix1, iy1, ix2, iy2 = max(lx1, rx1), max(ly1, ry1), min(lx2, rx2), min(ly2, ry2)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = max(0.0, lx2 - lx1) * max(0.0, ly2 - ly1) + rw * rh - intersection
    return intersection / union if union else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("data/heldout-evaluation/cdw-seg/test-proxy"))
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000/analyze/frame")
    parser.add_argument("--token", default="local-playground-token")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    root = args.root.resolve()
    annotations = json.loads((root / "annotations.test-proxy.json").read_text(encoding="utf-8"))
    images = annotations["images"][: args.limit or None]
    categories = {category["id"]: category["name"] for category in annotations["categories"]}
    by_image: dict[int, list[dict[str, Any]]] = {}
    for annotation in annotations["annotations"]:
        by_image.setdefault(annotation["image_id"], []).append(annotation)

    totals = {"images": 0, "groundTruthBins": 0, "predictedBins": 0, "truePositiveBins": 0, "falsePositiveBins": 0, "missedBins": 0, "predictedOverflowDiagnostics": 0}
    rows: list[dict[str, Any]] = []
    for image in images:
        file_name = Path(str(image["file_name"]).replace("\\", "/")).name
        path = root / "images" / file_name
        response = requests.post(
            args.endpoint,
            headers={"x-internal-token": args.token},
            files={"file": (file_name, path.open("rb"), "image/jpeg")},
            data={"floor_confidence": "0.25", "localizer_confidence": "0.80", "focus_region": "[]"},
            timeout=90,
        )
        response.raise_for_status()
        result = response.json()
        truth = [annotation["bbox"] for annotation in by_image.get(image["id"], []) if categories.get(annotation["category_id"]) == "BIN"]
        predictions = [item["bbox"] for item in result.get("bins", [])]
        matched_truth: set[int] = set()
        matches = 0
        for prediction in predictions:
            candidates = sorted(((iou(prediction, target), index) for index, target in enumerate(truth) if index not in matched_truth), reverse=True)
            if candidates and candidates[0][0] >= 0.5:
                matches += 1
                matched_truth.add(candidates[0][1])
        totals["images"] += 1
        totals["groundTruthBins"] += len(truth)
        totals["predictedBins"] += len(predictions)
        totals["truePositiveBins"] += matches
        totals["falsePositiveBins"] += len(predictions) - matches
        totals["missedBins"] += len(truth) - matches
        totals["predictedOverflowDiagnostics"] += sum(1 for item in result.get("bins", []) if item.get("state") == "overflow")
        rows.append({"fileName": file_name, "groundTruthBins": len(truth), "predictedBins": len(predictions), "matchesAtIoU50": matches, "predictedOverflowDiagnostic": sum(1 for item in result.get("bins", []) if item.get("state") == "overflow")})

    totals["precisionAtIoU50"] = totals["truePositiveBins"] / totals["predictedBins"] if totals["predictedBins"] else 0
    totals["recallAtIoU50"] = totals["truePositiveBins"] / totals["groundTruthBins"] if totals["groundTruthBins"] else 0
    output = {"dataset": "CDW-Seg", "split": "test_proxy", "iouThreshold": 0.5, "metrics": totals, "rows": rows}
    output_path = root / "benchmark.json"
    output_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output["metrics"], indent=2))


if __name__ == "__main__":
    main()
