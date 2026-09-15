"""Build a reproducible, explicitly synthetic multi-angle bin-state prototype.

The Malaysia bin-node images provide bin localization crops but do not contain
verified ``normal/full/overflow`` state annotations or multiple camera angles.
This utility therefore does two things:

* keeps the original crops as weak, top-down examples using a deterministic
  content heuristic; and
* creates project-owned perspective/state surrogates (normal, full, overflow,
  and unknown) from those crops.

The generated manifest is for methodology testing only.  Every row is marked
``weak_label`` and synthetic rows carry ``synthetic-prototype`` tags.  It must
not be promoted as a production benchmark without operator-reviewed captures.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps, ImageStat


ROOT = Path(__file__).resolve().parents[1]
ANGLES = ("top_down", "oblique", "side")
STATES = ("normal", "full", "overflow", "unknown")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve(value: str | Path, root: Path = ROOT) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def content_score(image: Image.Image) -> float:
    """Return a stable, weak proxy for visible material in the bin interior."""
    width, height = image.size
    crop = image.crop((int(width * .16), int(height * .08), int(width * .84), int(height * .72)))
    gray = ImageOps.grayscale(crop).resize((64, 64), Image.Resampling.BILINEAR)
    edge = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0] / 255.0
    hsv = crop.convert("HSV").resize((64, 64), Image.Resampling.BILINEAR)
    saturation = ImageStat.Stat(hsv.getchannel("S")).mean[0] / 255.0
    contrast = min(1.0, ImageStat.Stat(gray).stddev[0] / 80.0)
    return float(.52 * edge + .30 * saturation + .18 * contrast)


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * fraction)))
    return float(ordered[index])


def weak_state(score: float, low: float, high: float) -> str:
    if score <= low:
        return "normal"
    if score >= high:
        return "full"
    return "unknown"


def angle_transform(image: Image.Image, angle: str, seed: int) -> Image.Image:
    """Apply a mild deterministic view change; it is not a camera model."""
    image = image.convert("RGB")
    if angle == "top_down":
        return ImageEnhance.Brightness(image).enhance(1.015 + (seed % 3) * .004)
    if angle == "oblique":
        degrees = 7.0 + (seed % 5) * .7
        return image.rotate(degrees, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(36, 36, 36))
    # A shallow shear and counter-rotation stand in for a side view while
    # retaining the fixed crop dimensions expected by the classifier.
    sheared = image.transform(
        image.size,
        Image.Transform.AFFINE,
        (1.0, .12, -image.width * .06, 0.0, 1.0, 0.0),
        resample=Image.Resampling.BICUBIC,
        fillcolor=(34, 34, 34),
    )
    return sheared.rotate(-8.0 - (seed % 4), resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(34, 34, 34))


def draw_bag(draw: ImageDraw.ImageDraw, w: int, h: int, seed: int, alpha: int = 215) -> None:
    randomizer = random.Random(seed)
    cx = w * (.42 + randomizer.uniform(-.04, .04))
    top = h * (.18 + randomizer.uniform(-.02, .04))
    bottom = h * (.43 + randomizer.uniform(-.03, .03))
    half = w * (.25 + randomizer.uniform(-.02, .03))
    points = [
        (cx - half * .78, top + h * .03),
        (cx - half * .45, top - h * .01),
        (cx + half * .48, top + h * .01),
        (cx + half * .82, top + h * .08),
        (cx + half * .58, bottom),
        (cx - half * .58, bottom + h * .01),
        (cx - half * .84, top + h * .10),
    ]
    draw.polygon(points, fill=(28, 30, 31, alpha))
    draw.line(points + [points[0]], fill=(10, 10, 10, min(255, alpha + 20)), width=max(2, round(w / 80)))
    draw.ellipse((cx - half * .45, top - h * .015, cx + half * .45, top + h * .06), fill=(16, 17, 18, alpha))


def state_overlay(image: Image.Image, state: str, seed: int) -> Image.Image:
    """Create a visually obvious but deterministic state surrogate."""
    w, h = image.size
    rgba = image.convert("RGBA")
    draw = ImageDraw.Draw(rgba, "RGBA")
    if state == "normal":
        # Slight photometric change makes the generated row unique without
        # inventing a positive event.
        result = ImageEnhance.Contrast(rgba.convert("RGB")).enhance(1.015 + (seed % 4) * .006)
        draw = ImageDraw.Draw(result.convert("RGBA"), "RGBA")
        draw.line((w * .20, h * .235, w * .80, h * .235), fill=(205, 205, 205, 30), width=max(1, round(w / 150)))
        return result.convert("RGB")
    if state in {"full", "overflow"}:
        draw_bag(draw, w, h, seed)
        # A few colored objects at the rim mimic visible contents while still
        # making this a declared synthetic training example.
        randomizer = random.Random(seed + 11)
        for index in range(4):
            x = w * (.26 + .13 * index) + randomizer.uniform(-w * .025, w * .025)
            y = h * (.24 + randomizer.uniform(-.025, .025))
            color = (120 + index * 19, 74 + index * 11, 35 + index * 8, 205)
            draw.rounded_rectangle((x - w * .035, y - h * .025, x + w * .035, y + h * .025), radius=max(2, round(w / 100)), fill=color)
        if state == "overflow":
            # Deliberately crosses the rim and places surrounding pieces on
            # the lower exterior, which is the defining overflow cue.
            draw_bag(draw, w, h, seed + 97, alpha=235)
            randomizer = random.Random(seed + 103)
            for index in range(7):
                x = w * randomizer.uniform(.12, .88)
                y = h * randomizer.uniform(.48, .86)
                size = w * randomizer.uniform(.018, .045)
                draw.ellipse((x - size, y - size * .55, x + size, y + size * .55), fill=(25 + index * 13, 27, 28, 230))
                if index % 2:
                    draw.rectangle((x - size * .7, y - size * .2, x + size * .7, y + size * .2), fill=(176, 117, 54, 220))
        return rgba.convert("RGB")
    # Unknown: preserve a recognisable crop but occlude and blur the evidence.
    blurred = rgba.filter(ImageFilter.GaussianBlur(radius=max(1.2, w / 260)))
    draw = ImageDraw.Draw(blurred, "RGBA")
    draw.rectangle((w * .12, h * .16, w * .88, h * .58), fill=(40, 40, 40, 155))
    draw.line((w * .1, h * .2, w * .9, h * .55), fill=(220, 220, 220, 125), width=max(3, round(w / 45)))
    return blurred.convert("RGB")


def write_image(image: Image.Image, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=94, optimize=True)
    return sha256(path)


def read_crops(crops_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(crops_path.read_text(encoding="utf-8"))
    if not isinstance(payload.get("crops"), list) or not payload["crops"]:
        raise ValueError(f"No crops in {crops_path}")
    return list(payload["crops"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-crops", type=Path, default=ROOT / "ml-training/data/malaysia-bin-node-crops-revision-2/crops.json")
    parser.add_argument("--test-crops", type=Path, default=ROOT / "ml-training/data/malaysia-bin-node-test-crops-revision-2/crops.json")
    parser.add_argument("--output", type=Path, default=ROOT / "ml-training/data/specialists/multi-angle-prototype")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    random.seed(args.seed)
    train_crops = read_crops(resolve(args.train_crops))
    test_crops = read_crops(resolve(args.test_crops))
    all_crops = train_crops + test_crops
    scores: dict[str, float] = {}
    for row in all_crops:
        path = resolve(row["path"])
        with Image.open(path) as image:
            scores[row["cropId"]] = content_score(image)
    train_scores = [scores[row["cropId"]] for row in train_crops]
    low = quantile(train_scores, .42)
    high = quantile(train_scores, .72)

    output = resolve(args.output)
    image_root = output / "images"
    image_root.mkdir(parents=True, exist_ok=True)
    samples: list[dict[str, Any]] = []
    checksums: set[str] = set()
    state_counts = Counter()
    angle_counts = Counter()
    base_counts = Counter()

    def add_sample(
        *, sample_id: str, image: Image.Image, split: str, group: str, state: str,
        angle: str, source_id: str, tags: list[str], weak_method: str,
        base_crop_id: str, bin_present: bool = True,
    ) -> None:
        relative = Path("ml-training/data/specialists/multi-angle-prototype/images") / split / f"{sample_id}.jpg"
        destination = ROOT / relative
        digest = write_image(image, destination)
        if digest in checksums:
            raise ValueError(f"Generated duplicate pixel checksum for {sample_id}")
        checksums.add(digest)
        known = state != "unknown"
        samples.append({
            "sampleId": sample_id,
            "pipeline": "bin_state",
            "path": relative.as_posix(),
            "captureGroup": group,
            "split": split,
            "source": {
                "id": source_id,
                "url": "https://data.mendeley.com/datasets/6269042",
                "license": "CC BY 4.0; synthetic project derivative for prototype",
                "attribution": "University of Malaya, solid waste bin images with 3 bins per node",
                "baseCropId": base_crop_id,
                "viewAngle": angle,
            },
            "sha256": digest,
            "review": {
                "status": "weak_label",
                "reviewer": "prototype-generator",
                "method": weak_method,
                "reviewedAt": datetime.now(timezone.utc).date().isoformat(),
            },
            "edgeTags": sorted(set(tags + [angle, "public_source", "prototype_only"])),
            "label": {
                "binId": "bin-prototype-1",
                "state": state,
                "binPresent": bin_present,
                "presenceKnown": True,
                "fullnessKnown": known,
                "overflowKnown": known,
            },
        })
        state_counts[state] += 1
        angle_counts[angle] += 1

    for row in all_crops:
        split = str(row["split"])
        if split not in {"train", "valid", "test"}:
            # The extractor uses train/valid/test; reject accidental drift.
            raise ValueError(f"Unsupported crop split {split!r} in {row['cropId']}")
        base_id = str(row["cropId"])
        base_path = resolve(row["path"])
        score = scores[base_id]
        original_state = weak_state(score, low, high)
        source_stem = Path(str(row.get("sourcePath", base_id))).stem.replace(" ", "_")
        group = f"malaysia-node-{split}-{source_stem}"
        with Image.open(base_path) as opened:
            base_image = opened.convert("RGB")
        # Keep the unmodified crop as the weak, top-down observation.
        add_sample(
            sample_id=f"{base_id}-base",
            image=base_image,
            split=split,
            group=group,
            state=original_state,
            angle="top_down",
            source_id="malaysia-bin-node-weak",
            tags=["weak_public_crop", f"weak_score_{score:.4f}"],
            weak_method=f"content_heuristic_v1(score={score:.6f},low={low:.6f},high={high:.6f})",
            base_crop_id=base_id,
        )
        base_counts[split] += 1
        # Four controlled states at each angle. These are the surrogate rows
        # used to prove the classifier and angle metadata flow end-to-end.
        for angle_index, angle in enumerate(ANGLES):
            for state_index, state in enumerate(STATES):
                variant_seed = args.seed + angle_index * 101 + state_index * 1009 + len(base_id)
                transformed = angle_transform(base_image, angle, variant_seed)
                variant = state_overlay(transformed, state, variant_seed)
                add_sample(
                    sample_id=f"{base_id}-{angle}-{state}",
                    image=variant,
                    split=split,
                    group=group,
                    state=state,
                    angle=angle,
                    source_id="malaysia-bin-node-synthetic-prototype",
                    tags=["synthetic", "angle_surrogate", "state_surrogate"] + (["overflow_surrogate", "surrounding_waste"] if state == "overflow" else []),
                    weak_method=f"controlled_overlay_v1(state={state},angle={angle},seed={variant_seed})",
                    base_crop_id=base_id,
                    # The opaque/blurred unknown surrogate is also the
                    # negative presence example needed to calibrate the
                    # runtime's unknown guard.  It is deliberately tagged as
                    # synthetic and is not a claim about the source crop.
                    bin_present=False if state == "unknown" else True,
                )

    manifest = {
        "schemaVersion": 1,
        "datasetId": "multi-angle-bin-state-prototype-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "Methodology proof only; synthetic angle/state surrogates, not production accuracy",
        "baseData": {
            "trainCrops": len(train_crops),
            "testCrops": len(test_crops),
            "weakHeuristic": {"name": "content_heuristic_v1", "lowThreshold": low, "highThreshold": high},
        },
        "samples": samples,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    report = {
        "generatedAt": manifest["generatedAt"],
        "manifest": str(manifest_path),
        "sampleCounts": {split: sum(1 for row in samples if row["split"] == split) for split in ("train", "valid", "test")},
        "baseCounts": dict(base_counts),
        "stateCounts": dict(state_counts),
        "angleCounts": dict(angle_counts),
        "weakScoreThresholds": {"low": low, "high": high},
        "productionReady": False,
        "reason": "No human-reviewed oblique/side/overflow labels; synthetic rows are a pipeline proof only.",
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
