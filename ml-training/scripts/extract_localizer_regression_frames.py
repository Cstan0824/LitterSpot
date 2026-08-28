"""Extract deterministic video frames for bin-localizer regression review."""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fraction", type=float, default=.5)
    args = parser.parse_args()
    if not args.video.is_file():
        raise SystemExit(f"Video not found: {args.video}")
    if not 0 <= args.fraction <= 1:
        raise SystemExit("fraction must be between 0 and 1")
    capture = cv2.VideoCapture(str(args.video))
    try:
        count = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        capture.set(cv2.CAP_PROP_POS_FRAMES, round((count - 1) * args.fraction))
        success, frame = capture.read()
        if not success:
            raise SystemExit(f"Could not read a frame from {args.video}")
    finally:
        capture.release()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(args.output), frame):
        raise SystemExit(f"Could not write {args.output}")
    print(args.output)


if __name__ == "__main__":
    main()
