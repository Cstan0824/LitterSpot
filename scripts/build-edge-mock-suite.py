"""Build deterministic robustness variants from the reviewed local stills."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIOS = PROJECT_ROOT / "mock-data" / "coverage" / "base-scenarios.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "mock-data" / "edge-cases" / "images"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def low_light(image: np.ndarray) -> np.ndarray:
    return cv2.convertScaleAbs(image, alpha=0.38, beta=-8)


def overexposed(image: np.ndarray) -> np.ndarray:
    return cv2.convertScaleAbs(image, alpha=1.55, beta=48)


def motion_blur(image: np.ndarray) -> np.ndarray:
    kernel = np.zeros((15, 15), dtype=np.float32)
    kernel[7, :] = 1 / 15
    return cv2.filter2D(image, -1, kernel)


def camera_shift(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    matrix = np.float32([[1, 0, round(width * 0.025)], [0, 1, round(height * -0.02)]])
    return cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REFLECT_101)


def identity(image: np.ndarray) -> np.ndarray:
    return image.copy()


def partial_occlusion(image: np.ndarray) -> np.ndarray:
    result = image.copy()
    height, width = result.shape[:2]
    x1, y1 = round(width * 0.42), round(height * 0.38)
    x2, y2 = round(width * 0.62), round(height * 0.72)
    overlay = result.copy()
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (35, 35, 35), thickness=-1)
    return cv2.addWeighted(overlay, 0.88, result, 0.12, 0)


def synthetic_beverage_spill(image: np.ndarray) -> np.ndarray:
    result = image.copy()
    height, width = result.shape[:2]
    center = (round(width * 0.52), round(height * 0.83))
    axes = (max(12, round(width * 0.085)), max(8, round(height * 0.027)))
    mask = np.zeros((height, width), dtype=np.uint8)
    points = cv2.ellipse2Poly(center, axes, -7, 0, 360, 18)
    jitter = np.array([[0, -2], [3, 1], [-1, 4], [-4, 0], [2, -3], [4, 2], [-2, 3], [-3, -1]], dtype=np.int32)
    points = points + np.resize(jitter, points.shape)
    cv2.fillPoly(mask, [points], 255)
    mask = cv2.GaussianBlur(mask, (13, 13), 0)
    stain = np.full_like(result, (28, 55, 82))
    alpha = (mask.astype(np.float32) / 255.0 * 0.62)[:, :, None]
    blended = result.astype(np.float32) * (1 - alpha) + stain.astype(np.float32) * alpha
    return np.clip(blended, 0, 255).astype(np.uint8)


TRANSFORMS: dict[str, tuple[Callable[[np.ndarray], np.ndarray], str, str]] = {
    "low-light": (low_light, "robustness.low_light", "inherit"),
    "overexposed": (overexposed, "robustness.overexposed", "inherit"),
    "motion-blur": (motion_blur, "robustness.motion_blur", "inherit"),
    "camera-shift": (camera_shift, "robustness.camera_shift", "inherit"),
    "jpeg-compression": (identity, "robustness.jpeg_compression", "inherit"),
    "partial-occlusion": (partial_occlusion, "robustness.partial_occlusion", "review_required"),
    "synthetic-beverage-spill": (synthetic_beverage_spill, "floor.spill_beverage", "synthetic_positive"),
}


def write_jpeg(path: Path, image: np.ndarray, quality: int) -> None:
    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, quality]):
        raise RuntimeError(f"Could not write {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenarios", type=Path, default=DEFAULT_SCENARIOS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = json.loads(args.scenarios.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for asset in payload["assets"]:
        source = (args.scenarios.parent / asset["path"]).resolve()
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode {source}")
        for transform_id, (operation, scenario, expectation_policy) in TRANSFORMS.items():
            target = args.output / f"{asset['sceneId']}--{transform_id}.jpg"
            output = operation(image)
            quality = 10 if transform_id == "jpeg-compression" else 88
            write_jpeg(target, output, quality)
            scenarios = [scenario]
            if expectation_policy in {"inherit", "synthetic_positive"}:
                scenarios.extend(asset["scenarios"])
            expected = dict(asset["expected"]) if expectation_policy != "review_required" else {"reviewRequired": True}
            if expectation_policy == "synthetic_positive":
                expected["floorHazards"] = sorted(set(expected.get("floorHazards", [])) | {"floor_spill"})
            records.append(
                {
                    "sceneId": asset["sceneId"],
                    "variantId": transform_id,
                    "path": str(target.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "derivedFrom": str(source.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "scenarios": sorted(set(scenarios)),
                    "expectationPolicy": expectation_policy,
                    "expected": expected,
                    "bytes": target.stat().st_size,
                    "sha256": sha256(target),
                }
            )
            print(f"built {target.name}")

    manifest_path = args.output.parent / "manifest.json"
    manifest_path.write_text(
        json.dumps({"schemaVersion": 1, "assets": records}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {manifest_path} ({len(records)} variants)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
