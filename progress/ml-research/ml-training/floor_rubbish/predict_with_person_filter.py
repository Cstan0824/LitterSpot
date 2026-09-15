"""Run floor hazard prediction and suppress detections that overlap ignore objects.

This script uses two models:
- A pretrained YOLO detection model for people and common non-floor objects.
- The trained floor rubbish/spill segmentation model.

It is intended for image folders or single images. Video analytics should use a
tracking pipeline later so people are not double-counted frame by frame.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
CLASS_NAMES = {0: "floor_litter", 1: "floor_spill"}
CLASS_COLORS = {
    0: (255, 170, 0),
    1: (0, 210, 255),
}
PERSON_COLOR = (0, 255, 0)
IGNORE_COLOR = (180, 80, 255)
REMOVED_COLOR = (0, 0, 255)
DEFAULT_IGNORE_CLASSES = [
    "person",
    "chair",
    "dining table",
    "bench",
    "couch",
    "backpack",
    "handbag",
    "suitcase",
    "laptop",
]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_floor_weights() -> Path:
    root = repo_root()
    candidates = [
        root / "ml-training" / "floor_rubbish" / "runs" / "theme_park_hazards" / "yolo26s_seg_v1" / "weights" / "best.pt",
        root / "runs" / "segment" / "ml-training" / "floor_rubbish" / "runs" / "theme_park_hazards" / "yolo26s_seg_v1" / "weights" / "best.pt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    matches = sorted(root.glob("**/yolo26s_seg_v1/weights/best.pt"))
    if matches:
        return matches[0]
    return candidates[0]


def iter_images(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() in IMAGE_EXTENSIONS:
        return [source]
    if source.is_dir():
        return sorted(path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)
    return []


def box_intersection_area(box_a: np.ndarray, box_b: np.ndarray) -> float:
    x1 = max(float(box_a[0]), float(box_b[0]))
    y1 = max(float(box_a[1]), float(box_b[1]))
    x2 = min(float(box_a[2]), float(box_b[2]))
    y2 = min(float(box_a[3]), float(box_b[3]))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return (x2 - x1) * (y2 - y1)


def box_area(box: np.ndarray) -> float:
    return max(0.0, float(box[2] - box[0])) * max(0.0, float(box[3] - box[1]))


def overlaps_any(detection_box: np.ndarray, ignore_boxes: np.ndarray, threshold: float) -> bool:
    area = box_area(detection_box)
    if area <= 0 or len(ignore_boxes) == 0:
        return False
    for ignore_box in ignore_boxes:
        if box_intersection_area(detection_box, ignore_box) / area >= threshold:
            return True
    return False


def class_ids_for_names(model_names: dict[int, str], requested_names: list[str]) -> dict[int, str]:
    normalized_requests = {name.strip().lower() for name in requested_names if name.strip()}
    matched: dict[int, str] = {}
    for class_id, class_name in model_names.items():
        if class_name.lower() in normalized_requests:
            matched[int(class_id)] = class_name
    missing = sorted(normalized_requests - {name.lower() for name in matched.values()})
    if missing:
        print(f"Warning: ignore classes not found in pretrained model: {', '.join(missing)}")
    return matched


def scale_mask(mask: np.ndarray, image_shape: tuple[int, int]) -> np.ndarray:
    height, width = image_shape
    resized = cv2.resize(mask.astype("float32"), (width, height), interpolation=cv2.INTER_LINEAR)
    return resized > 0.5


def draw_label(image: np.ndarray, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.65
    thickness = 2
    (text_width, text_height), baseline = cv2.getTextSize(text, font, scale, thickness)
    y = max(y, text_height + baseline + 4)
    cv2.rectangle(image, (x, y - text_height - baseline - 6), (x + text_width + 8, y + 2), color, -1)
    cv2.putText(image, text, (x + 4, y - baseline - 2), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)


def overlay_mask(image: np.ndarray, mask: np.ndarray, color: tuple[int, int, int], alpha: float = 0.35) -> None:
    color_array = np.zeros_like(image)
    color_array[:, :] = color
    image[mask] = cv2.addWeighted(image, 1 - alpha, color_array, alpha, 0)[mask]


def load_roi_points(roi_path: Path, image_shape: tuple[int, int]) -> np.ndarray:
    height, width = image_shape
    with roi_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    points = data.get("points", data) if isinstance(data, dict) else data
    if not isinstance(points, list) or len(points) < 3:
        raise ValueError(f"Floor ROI must contain at least three points: {roi_path}")

    array = np.array(points, dtype=float)
    if array.ndim != 2 or array.shape[1] != 2:
        raise ValueError(f"Floor ROI points must be [[x, y], ...]: {roi_path}")

    normalized = bool(data.get("normalized", False)) if isinstance(data, dict) else False
    if normalized or float(array.max()) <= 1.0:
        array[:, 0] *= width
        array[:, 1] *= height
    return array.astype(np.int32)


def make_roi_mask(roi_points: np.ndarray, image_shape: tuple[int, int]) -> np.ndarray:
    height, width = image_shape
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [roi_points], 1)
    return mask.astype(bool)


def mask_fraction_inside_roi(mask: np.ndarray, roi_mask: np.ndarray) -> float:
    mask_area = int(mask.sum())
    if mask_area == 0:
        return 0.0
    return float(np.logical_and(mask, roi_mask).sum()) / mask_area


def predict_one(
    image_path: Path,
    output_path: Path,
    floor_model: YOLO,
    person_model: YOLO,
    ignore_class_ids: dict[int, str],
    args: argparse.Namespace,
) -> dict[str, object]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"Could not read image: {image_path}")
    image_height, image_width = image.shape[:2]
    roi_points = load_roi_points(args.floor_roi, (image_height, image_width)) if args.floor_roi else None
    roi_mask = make_roi_mask(roi_points, (image_height, image_width)) if roi_points is not None else None

    object_result = person_model.predict(
        source=str(image_path),
        classes=sorted(ignore_class_ids),
        conf=args.person_conf,
        imgsz=args.imgsz,
        device=args.device,
        verbose=False,
    )[0]
    object_boxes = np.empty((0, 4), dtype=float)
    object_class_ids = np.empty((0,), dtype=int)
    if object_result.boxes is not None and len(object_result.boxes) > 0:
        object_boxes = object_result.boxes.xyxy.cpu().numpy()
        object_class_ids = object_result.boxes.cls.cpu().numpy().astype(int)

    person_boxes = object_boxes[object_class_ids == 0] if len(object_boxes) else np.empty((0, 4), dtype=float)

    floor_result = floor_model.predict(
        source=str(image_path),
        conf=args.floor_conf,
        imgsz=args.imgsz,
        device=args.device,
        verbose=False,
    )[0]

    kept_litter = 0
    kept_spill = 0
    removed_litter = 0
    removed_spill = 0
    removed_outside_roi = 0

    if roi_points is not None:
        cv2.polylines(image, [roi_points], isClosed=True, color=(255, 255, 255), thickness=3)
        draw_label(image, "floor_roi", int(roi_points[0][0]), int(roi_points[0][1]), (255, 255, 255))

    for object_box, object_class_id in zip(object_boxes, object_class_ids):
        x1, y1, x2, y2 = object_box.astype(int)
        object_name = ignore_class_ids.get(int(object_class_id), str(object_class_id))
        color = PERSON_COLOR if object_name == "person" else IGNORE_COLOR
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        draw_label(image, object_name, x1, y1, color)

    if floor_result.boxes is not None and floor_result.masks is not None:
        boxes = floor_result.boxes.xyxy.cpu().numpy()
        class_ids = floor_result.boxes.cls.cpu().numpy().astype(int)
        confidences = floor_result.boxes.conf.cpu().numpy()
        masks = floor_result.masks.data.cpu().numpy()

        for box, class_id, confidence, mask in zip(boxes, class_ids, confidences, masks):
            scaled_mask = scale_mask(mask, (image_height, image_width))
            outside_roi = False
            if roi_mask is not None:
                roi_fraction = mask_fraction_inside_roi(scaled_mask, roi_mask)
                outside_roi = roi_fraction < args.min_roi_mask_fraction

            should_filter = class_id == 0 or args.filter_spills
            remove_for_object = should_filter and overlaps_any(box, object_boxes, args.ignore_overlap)
            remove = outside_roi or remove_for_object
            if remove:
                if outside_roi:
                    removed_outside_roi += 1
                if class_id == 0:
                    removed_litter += 1
                elif class_id == 1:
                    removed_spill += 1
                if args.show_removed:
                    overlay_mask(image, scaled_mask, REMOVED_COLOR, alpha=0.2)
                    x1, y1, x2, y2 = box.astype(int)
                    cv2.rectangle(image, (x1, y1), (x2, y2), REMOVED_COLOR, 2)
                    reason = "outside_roi" if outside_roi else "ignore_object"
                    draw_label(image, f"removed {CLASS_NAMES.get(class_id, class_id)} {confidence:.2f} {reason}", x1, y1, REMOVED_COLOR)
                continue

            if class_id == 0:
                kept_litter += 1
            elif class_id == 1:
                kept_spill += 1

            color = CLASS_COLORS.get(class_id, (255, 255, 255))
            overlay_mask(image, scaled_mask, color)
            x1, y1, x2, y2 = box.astype(int)
            cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
            draw_label(image, f"{CLASS_NAMES.get(class_id, class_id)} {confidence:.2f}", x1, y1, color)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), image)

    return {
        "source": str(image_path),
        "output": str(output_path),
        "person_count": len(person_boxes),
        "ignore_object_count": max(0, len(object_boxes) - len(person_boxes)),
        "kept_floor_litter": kept_litter,
        "kept_floor_spill": kept_spill,
        "removed_floor_litter": removed_litter,
        "removed_floor_spill": removed_spill,
        "removed_outside_floor_roi": removed_outside_roi,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Image file or image folder.")
    parser.add_argument("--floor-weights", type=Path, default=default_floor_weights(), help="Path to trained floor rubbish/spill best.pt.")
    parser.add_argument("--person-model", default="yolo26s.pt", help="Pretrained YOLO detection model for person detection.")
    parser.add_argument("--output-dir", type=Path, default=repo_root() / "runs" / "floor_rubbish_person_filter", help="Directory for filtered prediction images.")
    parser.add_argument("--imgsz", type=int, default=960)
    parser.add_argument("--floor-conf", type=float, default=0.25)
    parser.add_argument("--person-conf", type=float, default=0.25)
    parser.add_argument(
        "--ignore-classes",
        nargs="*",
        default=DEFAULT_IGNORE_CLASSES,
        help="Pretrained model classes that should suppress overlapping floor detections.",
    )
    parser.add_argument(
        "--ignore-overlap",
        type=float,
        default=0.10,
        help="Remove floor detections when this fraction of their box overlaps an ignore object.",
    )
    parser.add_argument("--floor-roi", type=Path, help="Optional JSON polygon for the floor area to inspect.")
    parser.add_argument(
        "--min-roi-mask-fraction",
        type=float,
        default=0.50,
        help="With --floor-roi, keep detections only when this fraction of their mask is inside the floor ROI.",
    )
    parser.add_argument("--device", default="cpu", help='Use "cpu" on Mac, or "0" for CUDA GPU.')
    parser.add_argument("--filter-spills", action="store_true", help="Also remove floor_spill detections that overlap ignore objects.")
    parser.add_argument("--show-removed", action="store_true", help="Draw removed detections in red for debugging.")
    args = parser.parse_args()

    images = iter_images(args.source)
    if not images:
        raise SystemExit(f"No supported images found at {args.source}")
    if not args.floor_weights.exists():
        raise SystemExit(f"Floor weights not found: {args.floor_weights}")

    floor_model = YOLO(str(args.floor_weights))
    person_model = YOLO(args.person_model)
    ignore_class_ids = class_ids_for_names(person_model.names, args.ignore_classes)
    if not ignore_class_ids:
        raise SystemExit("No valid ignore classes were found in the pretrained model.")

    rows: list[dict[str, object]] = []
    for image_path in images:
        relative = image_path.name if image_path.is_file() else str(image_path.relative_to(args.source))
        output_path = args.output_dir / relative
        rows.append(predict_one(image_path, output_path, floor_model, person_model, ignore_class_ids, args))

    summary_path = args.output_dir / "summary.csv"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with summary_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "source",
                "output",
                "person_count",
                "ignore_object_count",
                "kept_floor_litter",
                "kept_floor_spill",
                "removed_floor_litter",
                "removed_floor_spill",
                "removed_outside_floor_roi",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Processed images: {len(rows)}")
    print(f"Output directory: {args.output_dir}")
    print(f"Summary CSV: {summary_path}")


if __name__ == "__main__":
    main()
