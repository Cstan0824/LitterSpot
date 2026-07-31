"""Generate polygon overlay previews for converted and prepared samples."""
from __future__ import annotations

import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from dataset_utils import SEED, prepared_dataset_root, read_csv

COLORS = {
    0: ((255, 193, 7, 95), (255, 193, 7), "floor_litter"),
    1: ((0, 188, 212, 95), (0, 188, 212), "floor_spill"),
}


def read_polygons(label_path: Path, size: tuple[int, int]) -> list[tuple[int, list[tuple[float, float]]]]:
    width, height = size
    polygons: list[tuple[int, list[tuple[float, float]]]] = []
    if not label_path.exists():
        return polygons
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            class_id = int(parts[0])
            values = [float(part) for part in parts[1:]]
        except ValueError:
            continue
        points = [(values[idx] * width, values[idx + 1] * height) for idx in range(0, len(values), 2)]
        if len(points) >= 3:
            polygons.append((class_id, points))
    return polygons


def render_preview(image_path: Path, label_path: Path, destination: Path, source: str) -> bool:
    try:
        image = Image.open(image_path).convert("RGBA")
    except Exception:
        return False
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    text_draw = ImageDraw.Draw(image)
    polygons = read_polygons(label_path, image.size)
    if not polygons:
        return False
    for class_id, points in polygons:
        fill, outline, name = COLORS.get(class_id, ((255, 0, 0, 80), (255, 0, 0), f"class_{class_id}"))
        draw.polygon(points, fill=fill)
        draw.line(points + [points[0]], fill=outline + (255,), width=4)
        x, y = points[0]
        label = f"{name} | {source}"
        text_draw.rectangle((x, max(y - 18, 0), x + max(140, len(label) * 7), max(y, 18)), fill=(0, 0, 0, 180))
        text_draw.text((x + 4, max(y - 16, 2)), label, fill=(255, 255, 255, 255))
    result = Image.alpha_composite(image, overlay).convert("RGB")
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.save(destination, quality=92)
    return True


def sample_rows(rows: list[dict[str, str]], count: int) -> list[dict[str, str]]:
    rng = random.Random(SEED)
    rows = [row for row in rows if row.get("output_image") and row.get("output_label")]
    if len(rows) <= count:
        return rows
    return rng.sample(rows, count)


def sample_manifest_rows(rows: list[dict[str, str]], split: str, count: int) -> list[dict[str, str]]:
    rng = random.Random(SEED + len(split))
    filtered = [row for row in rows if row.get("split") == split]
    if len(filtered) <= count:
        return filtered
    return rng.sample(filtered, count)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, default=prepared_dataset_root())
    args = parser.parse_args()
    prepared = args.prepared
    preview_dir = prepared / "previews"

    jobs: list[tuple[Path, Path, Path, str]] = []
    taco_rows = read_csv(prepared / "intermediate" / "taco" / "manifest.csv")
    hd_rows = read_csv(prepared / "intermediate" / "hd10k" / "manifest.csv")
    uav_rows = read_csv(prepared / "intermediate" / "uavvaste" / "manifest.csv")
    final_rows = read_csv(prepared / "dataset_manifest.csv")

    for idx, row in enumerate(sample_rows(taco_rows, 25), 1):
        jobs.append((Path(row["output_image"]), Path(row["output_label"]), preview_dir / "taco" / f"taco_{idx:03d}.jpg", "TACO"))
    for idx, row in enumerate(sample_rows(hd_rows, 25), 1):
        jobs.append((Path(row["output_image"]), Path(row["output_label"]), preview_dir / "hd10k" / f"hd10k_{idx:03d}.jpg", "HD10K"))
    for idx, row in enumerate(sample_rows(uav_rows, 25), 1):
        jobs.append((Path(row["output_image"]), Path(row["output_label"]), preview_dir / "uavvaste" / f"uavvaste_{idx:03d}.jpg", "UAVVaste"))
    for split in ("train", "val", "test"):
        for idx, row in enumerate(sample_manifest_rows(final_rows, split, 10), 1):
            jobs.append((Path(row["prepared_image"]), Path(row["prepared_label"]), preview_dir / split / f"{split}_{idx:03d}.jpg", row.get("source", "prepared")))

    rendered = 0
    for image, label, destination, source in jobs:
        if render_preview(image, label, destination, source):
            rendered += 1
    print(f"Rendered previews: {rendered}/{len(jobs)}")
    print(f"Preview directory: {preview_dir}")


if __name__ == "__main__":
    main()
