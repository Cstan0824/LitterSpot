from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "evaluate_whatsapp_bin_video_replay",
    ROOT / "scripts/evaluate_whatsapp_bin_video_replay.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def test_majority_state_requires_unique_winner() -> None:
    assert MODULE.majority_state(["overflow", "overflow", "normal"]) == ("overflow", 2)
    assert MODULE.majority_state(["normal", "overflow"]) == ("unknown", 1)
    assert MODULE.majority_state([]) == (None, 0)


def test_normalized_box_scales_and_validates() -> None:
    image = Image.new("RGB", (200, 100))
    box = MODULE.normalized_box({"x1": .1, "y1": .2, "x2": .8, "y2": .9}, image)
    assert box.model_dump() == {"x1": 20.0, "y1": 20.0, "x2": 160.0, "y2": 90.0}
    with pytest.raises(ValueError, match="valid normalized box"):
        MODULE.normalized_box({"x1": .8, "y1": .2, "x2": .1, "y2": .9}, image)
