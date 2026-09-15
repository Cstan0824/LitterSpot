"""Shared helpers for LitterSpot dataset preparation."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
MASK_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
SEED = 42
CLASS_NAMES = {0: "floor_litter", 1: "floor_spill"}


def project_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists() or (parent / "package.json").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def floor_rubbish_dataset_root() -> Path:
    return project_root() / "dataset" / "floor_rubbish"


def raw_dataset_root() -> Path:
    return floor_rubbish_dataset_root() / "raw_dataset"


def prepared_dataset_root() -> Path:
    return floor_rubbish_dataset_root() / "prepared_dataset"


def default_search_roots() -> list[Path]:
    roots = [raw_dataset_root(), Path.home() / "Downloads"]
    return [root for root in roots if root.exists()]


def parse_roots(values: list[str] | None) -> list[Path]:
    return [Path(value).expanduser().resolve() for value in values] if values else default_search_roots()


def ensure_dirs(prepared: Path) -> None:
    for split in ("train", "val", "test"):
        (prepared / "images" / split).mkdir(parents=True, exist_ok=True)
        (prepared / "labels" / split).mkdir(parents=True, exist_ok=True)
    for extra in ("external_test/hd10k", "reports", "previews", "intermediate/taco/images",
                  "intermediate/taco/labels", "intermediate/hd10k/images", "intermediate/hd10k/labels",
                  "intermediate/uavvaste/images", "intermediate/uavvaste/labels"):
        (prepared / extra).mkdir(parents=True, exist_ok=True)


def reset_generated_dataset(prepared: Path) -> None:
    """Clear generated outputs inside prepared_dataset only."""
    for child in ("images", "labels", "external_test", "reports", "previews", "intermediate"):
        target = prepared / child
        if target.exists():
            shutil.rmtree(target)
    for child in ("data.yaml", "dataset_manifest.csv"):
        target = prepared / child
        if target.exists():
            target.unlink()
    ensure_dirs(prepared)


def is_image(path: Path) -> bool:
    return not path.name.startswith(".") and path.suffix.lower() in IMAGE_EXTENSIONS


def safe_name(prefix: str, relative: Path) -> str:
    parts = [part for part in relative.with_suffix("").parts if part not in (".", "")]
    return f"{prefix}_{'_'.join(parts)}{relative.suffix.lower()}"


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def is_coco_json(path: Path) -> bool:
    data = read_json(path)
    return bool(data and isinstance(data.get("images"), list) and isinstance(data.get("annotations"), list)
                and isinstance(data.get("categories"), list))


def find_coco_jsons(roots: Iterable[Path]) -> list[Path]:
    found: list[Path] = []
    for root in roots:
        if root.is_file() and root.suffix.lower() == ".json" and is_coco_json(root):
            found.append(root)
            continue
        if not root.exists() or not root.is_dir():
            continue
        for path in root.rglob("*.json"):
            if any(part in {".git", "node_modules", ".venv", "__pycache__"} for part in path.parts):
                continue
            if is_coco_json(path):
                found.append(path)
    return sorted(set(found))


def find_taco_jsons(roots: Iterable[Path]) -> list[Path]:
    candidates = find_coco_jsons(roots)
    taco = [path for path in candidates if "taco" in str(path).lower()]
    return taco or candidates


def find_uavvaste_roots(roots: Iterable[Path]) -> list[Path]:
    hits: set[Path] = set()
    for root in roots:
        if root.is_file() and root.name == "annotations.json":
            candidate = root.parent.parent
            if (candidate / "images").exists() and (candidate / "annotations" / "train_val_test_distribution_file.json").exists():
                hits.add(candidate)
            continue
        if not root.exists() or not root.is_dir():
            continue
        for annotation in root.rglob("annotations.json"):
            if any(part in {".git", "node_modules", ".venv", "__pycache__"} for part in annotation.parts):
                continue
            candidate = annotation.parent.parent
            split_file = candidate / "annotations" / "train_val_test_distribution_file.json"
            image_dir = candidate / "images"
            if split_file.exists() and image_dir.exists() and "uav" in str(candidate).lower():
                hits.add(candidate)
    return sorted(hits)


def find_hd10k_roots(roots: Iterable[Path]) -> list[Path]:
    hits: set[Path] = set()
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_dir():
                continue
            name = path.name.lower()
            if name in {"liquid_dirts_masks", "solid_dirts_bboxes"}:
                current = path
                while current.parent != current:
                    if (current / "train").exists() or current.name.lower() in {"iros2022_dataset", "hd10k"}:
                        hits.add(current)
                        break
                    current = current.parent
    return sorted(hits)


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return None


def resolve_coco_image_path(json_path: Path, file_name: str) -> Path | None:
    direct = json_path.parent / file_name
    if direct.exists():
        return direct
    root = json_path.parent
    name = Path(file_name).name
    matches = list(root.rglob(name))
    image_matches = [match for match in matches if is_image(match)]
    return image_matches[0] if image_matches else None


def normalize_polygon(poly: list[float], width: int, height: int) -> list[float] | None:
    if len(poly) < 6 or len(poly) % 2 != 0:
        return None
    normalized: list[float] = []
    for index in range(0, len(poly), 2):
        x = min(max(float(poly[index]) / width, 0.0), 1.0)
        y = min(max(float(poly[index + 1]) / height, 0.0), 1.0)
        normalized.extend([x, y])
    return normalized


def polygon_area(points: list[float]) -> float:
    if len(points) < 6:
        return 0.0
    area = 0.0
    pairs = list(zip(points[0::2], points[1::2]))
    for idx, (x1, y1) in enumerate(pairs):
        x2, y2 = pairs[(idx + 1) % len(pairs)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def yolo_line(class_id: int, coords: list[float]) -> str:
    values = " ".join(f"{value:.6f}" for value in coords)
    return f"{class_id} {values}"


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def deterministic_split(items: list[Any], train_ratio: float = 0.70, val_ratio: float = 0.15) -> dict[Any, str]:
    rng = random.Random(SEED)
    shuffled = list(items)
    rng.shuffle(shuffled)
    train_end = math.floor(len(shuffled) * train_ratio)
    val_end = train_end + math.floor(len(shuffled) * val_ratio)
    mapping: dict[Any, str] = {}
    for idx, item in enumerate(shuffled):
        if idx < train_end:
            mapping[item] = "train"
        elif idx < val_end:
            mapping[item] = "val"
        else:
            mapping[item] = "test"
    return mapping


def hd10k_group_key(path_text: str) -> str:
    path = Path(path_text)
    stem = path.stem.replace("_keyframe", "")
    if "-" in stem:
        prefix = stem.rsplit("-", 1)[0]
        scene = next((part for part in path.parts if part.lower().startswith("scene_")), "")
        return f"{scene}_{prefix}" if scene else prefix
    parts = path.parts
    for part in parts:
        if part.lower().startswith("scene_"):
            return part
    return stem


def summarize_manifest(rows: list[dict[str, str]]) -> dict[str, Any]:
    by_split = Counter(row.get("split", "unassigned") for row in rows)
    by_source = Counter(row.get("source", "unknown") for row in rows)
    objects = Counter()
    for row in rows:
        for class_id, count in ((0, row.get("floor_litter_objects", "0")), (1, row.get("floor_spill_objects", "0"))):
            try:
                objects[class_id] += int(count)
            except ValueError:
                pass
    return {"by_split": dict(by_split), "by_source": dict(by_source), "objects": dict(objects)}


def inspect_mask_values(mask_path: Path, max_values: int = 20) -> list[Any]:
    try:
        import cv2
        import numpy as np

        mask = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
        if mask is None:
            return []
        if mask.ndim == 2:
            values = np.unique(mask)
            return [int(value) for value in values[:max_values]]
        flat = mask.reshape(-1, mask.shape[-1])
        values = np.unique(flat, axis=0)
        return [tuple(int(channel) for channel in value) for value in values[:max_values]]
    except Exception:
        return []


def find_matching_mask(image: Path, mask_dir: Path) -> Path | None:
    for suffix in MASK_EXTENSIONS:
        candidate = mask_dir / f"{image.stem}{suffix}"
        if candidate.exists() and not candidate.name.startswith("."):
            return candidate
    candidates = sorted(candidate for candidate in mask_dir.glob(f"{image.stem}.*") if not candidate.name.startswith("."))
    return candidates[0] if candidates else None


def collect_hd10k_pairs(root: Path, subset: str = "train") -> tuple[list[dict[str, Path]], list[dict[str, str]]]:
    base = root / subset
    pairs: list[dict[str, Path]] = []
    issues: list[dict[str, str]] = []
    if subset == "train":
        image_roots = sorted(base.glob("**/liquid_dirts/images"))
        mask_roots = sorted(base.glob("**/liquid_dirts_masks"))
    else:
        image_roots = sorted((base / "images").glob("*")) if (base / "images").exists() else []
        mask_roots = sorted((base / "liquid_dirts_masks").glob("*")) if (base / "liquid_dirts_masks").exists() else []

    mask_by_scene: dict[str, Path] = {}
    for mask_root in mask_roots:
        if mask_root.is_dir() and mask_root.name.lower().startswith("scene_"):
            mask_by_scene[mask_root.name] = mask_root
        elif mask_root.is_dir():
            for scene_dir in mask_root.glob("scene_*"):
                if scene_dir.is_dir():
                    mask_by_scene[scene_dir.name] = scene_dir

    image_dirs: list[Path] = []
    for image_root in image_roots:
        if image_root.is_dir() and image_root.name.lower().startswith("scene_"):
            image_dirs.append(image_root)
        elif image_root.is_dir():
            image_dirs.extend([scene_dir for scene_dir in image_root.glob("scene_*") if scene_dir.is_dir()])

    for image_dir in sorted(set(image_dirs)):
        mask_dir = mask_by_scene.get(image_dir.name)
        if not mask_dir:
            issues.append({"type": "missing_mask_dir", "path": str(image_dir), "detail": f"scene={image_dir.name}"})
            continue
        for image in sorted(path for path in image_dir.iterdir() if path.is_file() and is_image(path)):
            mask = find_matching_mask(image, mask_dir)
            if mask is None:
                issues.append({"type": "missing_mask", "path": str(image), "detail": str(mask_dir)})
                continue
            pairs.append({"image": image, "mask": mask, "scene": image_dir.name, "subset": subset})
    return pairs, issues
