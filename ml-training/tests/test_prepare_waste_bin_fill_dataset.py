from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_waste_bin_fill_dataset.py"
SPEC = importlib.util.spec_from_file_location("prepare_waste_bin_fill_dataset", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_balanced_selection_is_deterministic_and_capped() -> None:
    names = [f"simulated/empty/{index:05d}.png" for index in range(20)]

    first = MODULE.balanced_selection(names, per_class=7)
    second = MODULE.balanced_selection(list(reversed(names)), per_class=7)

    assert first == second
    assert len(first) == 7
    assert first[0].endswith("00000.png")
    assert first[-1].endswith("00019.png")


def test_manifest_keeps_real_images_test_only_and_does_not_invent_overflow() -> None:
    files = [
        "simulated/empty/00001.png",
        "simulated/empty/00102.png",
        "simulated/halffull/00003.png",
        "simulated/halffull/00104.png",
        "simulated/full/00005.png",
        "simulated/full/00106.png",
        "real/empty/a.png",
        "real/halffull/b.png",
        "real/full/c.png",
    ]

    rows = MODULE.build_manifest_rows(files, validation_fraction=0.5, seed=42)

    real_rows = [row for row in rows if row["domain"] == "real"]
    assert {row["split"] for row in real_rows} == {"test"}
    assert {row["fillLevel"] for row in rows} == {"empty", "halffull", "full"}
    assert all(row["overflowKnown"] is False for row in rows)
    assert all("overflow" not in row["fillLevel"] for row in rows)
    assert {row["split"] for row in rows if row["domain"] == "simulated"} == {"train", "valid"}


def test_nearby_simulator_ids_stay_in_one_split() -> None:
    files = [
        "simulated/empty/00001.png", "simulated/full/00049.png",
        "simulated/empty/00101.png", "simulated/full/00149.png",
    ]

    rows = MODULE.build_manifest_rows(files, validation_fraction=0.5, seed=42)
    split_by_group = {}
    for row in rows:
        previous = split_by_group.setdefault(row["captureGroup"], row["split"])
        assert previous == row["split"]
