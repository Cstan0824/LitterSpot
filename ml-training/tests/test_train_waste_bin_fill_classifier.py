from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "train_waste_bin_fill_classifier.py"
SPEC = importlib.util.spec_from_file_location("train_waste_bin_fill_classifier", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_load_samples_requires_real_test_and_simulated_training(tmp_path: Path) -> None:
    for name in ("sim.png", "real.png"):
        (tmp_path / name).write_bytes(b"pixel-placeholder")
    manifest = {
        "samples": [
            {"sampleId": "sim", "path": "sim.png", "domain": "simulated", "split": "train", "fillLevel": "empty"},
            {"sampleId": "real", "path": "real.png", "domain": "real", "split": "test", "fillLevel": "full"},
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")

    samples = MODULE.load_samples(path)

    assert samples["train"][0]["target"] == 0
    assert samples["test"][0]["target"] == 2


def test_load_samples_rejects_real_training_leakage(tmp_path: Path) -> None:
    (tmp_path / "real.png").write_bytes(b"pixel-placeholder")
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"samples": [{
        "sampleId": "bad", "path": "real.png", "domain": "real",
        "split": "train", "fillLevel": "empty",
    }]}), encoding="utf-8")

    with pytest.raises(ValueError, match="Real-domain images must remain test-only"):
        MODULE.load_samples(path)


def test_classification_metrics_report_macro_f1() -> None:
    metrics = MODULE.classification_metrics([0, 1, 2, 2], [0, 1, 1, 2])

    assert metrics["accuracy"] == 0.75
    assert metrics["recallByClass"] == {"empty": 1.0, "halffull": 1.0, "full": 0.5}
    assert metrics["macroF1"] == pytest.approx((1.0 + 2 / 3 + 2 / 3) / 3)
