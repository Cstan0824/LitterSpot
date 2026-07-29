"""Create a reusable floor ROI by clicking points around the visible floor."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


WINDOW_NAME = "Create floor ROI"
ROI_COLOR = (0, 220, 255)
POINT_COLOR = (0, 255, 0)


def default_output_path(image_path: Path) -> Path:
    roi_dir = Path(__file__).resolve().parent / "rois"
    return roi_dir / f"{image_path.stem}_floor_roi.json"


def fit_to_screen(
    image: np.ndarray,
    max_width: int,
    max_height: int,
) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    scale = min(max_width / width, max_height / height, 1.0)
    if scale == 1.0:
        return image.copy(), scale
    resized = cv2.resize(
        image,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale


def draw_editor(
    display_image: np.ndarray,
    display_points: list[tuple[int, int]],
    status: str,
) -> np.ndarray:
    canvas = display_image.copy()
    if len(display_points) >= 3:
        polygon = np.array(display_points, dtype=np.int32)
        overlay = canvas.copy()
        cv2.fillPoly(overlay, [polygon], ROI_COLOR)
        canvas = cv2.addWeighted(canvas, 0.75, overlay, 0.25, 0)
        cv2.polylines(canvas, [polygon], True, ROI_COLOR, 2, cv2.LINE_AA)
    elif len(display_points) >= 2:
        cv2.polylines(
            canvas,
            [np.array(display_points, dtype=np.int32)],
            False,
            ROI_COLOR,
            2,
            cv2.LINE_AA,
        )

    for index, point in enumerate(display_points, start=1):
        cv2.circle(canvas, point, 5, POINT_COLOR, -1, cv2.LINE_AA)
        cv2.putText(
            canvas,
            str(index),
            (point[0] + 8, point[1] - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            POINT_COLOR,
            2,
            cv2.LINE_AA,
        )

    instruction = "Click floor boundary | U undo | R reset | S save | Q quit"
    cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 68), (20, 20, 20), -1)
    cv2.putText(
        canvas,
        instruction,
        (12, 27),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        canvas,
        status,
        (12, 55),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        ROI_COLOR,
        2,
        cv2.LINE_AA,
    )
    return canvas


def normalized_points(
    display_points: list[tuple[int, int]],
    scale: float,
    image_width: int,
    image_height: int,
) -> list[list[float]]:
    points: list[list[float]] = []
    for display_x, display_y in display_points:
        original_x = min(max(display_x / scale, 0.0), image_width - 1)
        original_y = min(max(display_y / scale, 0.0), image_height - 1)
        points.append(
            [
                round(original_x / image_width, 6),
                round(original_y / image_height, 6),
            ]
        )
    return points


def save_roi(
    image_path: Path,
    image: np.ndarray,
    display_points: list[tuple[int, int]],
    scale: float,
    output_path: Path,
    preview_path: Path,
) -> None:
    image_height, image_width = image.shape[:2]
    points = normalized_points(
        display_points,
        scale,
        image_width,
        image_height,
    )
    pixel_points = np.array(
        [
            [
                min(round(x * image_width), image_width - 1),
                min(round(y * image_height), image_height - 1),
            ]
            for x, y in points
        ],
        dtype=np.int32,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    roi_data = {
        "normalized": True,
        "source_image": str(image_path.resolve()),
        "image_width": image_width,
        "image_height": image_height,
        "points": points,
    }
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(roi_data, handle, indent=2)
        handle.write("\n")

    preview = image.copy()
    overlay = preview.copy()
    cv2.fillPoly(overlay, [pixel_points], ROI_COLOR)
    preview = cv2.addWeighted(preview, 0.72, overlay, 0.28, 0)
    cv2.polylines(preview, [pixel_points], True, ROI_COLOR, 4, cv2.LINE_AA)
    for point in pixel_points:
        cv2.circle(preview, tuple(point), 7, POINT_COLOR, -1, cv2.LINE_AA)

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(preview_path), preview):
        raise RuntimeError(f"Could not write ROI preview: {preview_path}")

    print(f"Floor ROI saved: {output_path}")
    print(f"ROI preview saved: {preview_path}")
    print(f"Points saved: {len(points)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Image used to select the floor area.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Output JSON path. Defaults to ml-training/floor_rubbish/rois/<image>_floor_roi.json.",
    )
    parser.add_argument(
        "--preview-output",
        type=Path,
        help="Output preview path. Defaults beside the ROI JSON.",
    )
    parser.add_argument("--max-display-width", type=int, default=1400)
    parser.add_argument("--max-display-height", type=int, default=850)
    args = parser.parse_args()

    if not args.image.is_file():
        raise SystemExit(f"Image not found: {args.image}")
    if args.max_display_width <= 0 or args.max_display_height <= 0:
        raise SystemExit("Display width and height must be positive.")

    image = cv2.imread(str(args.image))
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")

    output_path = args.output or default_output_path(args.image)
    preview_path = args.preview_output or output_path.with_name(
        f"{output_path.stem}_preview.jpg"
    )
    display_image, scale = fit_to_screen(
        image,
        args.max_display_width,
        args.max_display_height,
    )
    display_points: list[tuple[int, int]] = []
    status = "Add at least 3 points around the walkable floor."
    saved = False

    def handle_mouse(event: int, x: int, y: int, _flags: int, _data: object) -> None:
        nonlocal status
        if event == cv2.EVENT_LBUTTONDOWN:
            display_points.append((x, y))
            status = f"{len(display_points)} point(s) selected."

    try:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback(WINDOW_NAME, handle_mouse)

        while True:
            cv2.imshow(
                WINDOW_NAME,
                draw_editor(display_image, display_points, status),
            )
            key = cv2.waitKey(20) & 0xFF

            if key == ord("u"):
                if display_points:
                    display_points.pop()
                status = f"{len(display_points)} point(s) selected."
            elif key == ord("r"):
                display_points.clear()
                status = "Selection reset. Add at least 3 points."
            elif key == ord("s"):
                if len(display_points) < 3:
                    status = "Cannot save: select at least 3 points."
                    continue
                save_roi(
                    args.image,
                    image,
                    display_points,
                    scale,
                    output_path,
                    preview_path,
                )
                saved = True
                break
            elif key == ord("q"):
                break

            if cv2.getWindowProperty(WINDOW_NAME, cv2.WND_PROP_VISIBLE) < 1:
                break
    except cv2.error as error:
        raise SystemExit(
            "OpenCV could not open the click window. Install opencv-python "
            "(not opencv-python-headless) and run this script in a desktop terminal.\n"
            f"OpenCV error: {error}"
        ) from error
    finally:
        cv2.destroyAllWindows()

    if not saved:
        print("Closed without saving a floor ROI.")


if __name__ == "__main__":
    main()
