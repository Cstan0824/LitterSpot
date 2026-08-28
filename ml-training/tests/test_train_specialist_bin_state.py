from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "train_specialist_bin_state.py"
SPEC = importlib.util.spec_from_file_location("train_specialist_bin_state", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class TrainSpecialistBinStateTests(unittest.TestCase):
    def test_maps_unknown_bin_to_masked_state_targets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "frame.jpg"
            Image.new("RGB", (20, 20), color="white").save(image)
            rows = [
                {"sampleId": "known", "pipeline": "bin_state", "path": image.name, "captureGroup": "a",
                 "split": "train", "label": {"state": "overflow", "binPresent": True}},
                {"sampleId": "missing", "pipeline": "bin_state", "path": image.name, "captureGroup": "b",
                 "split": "valid", "label": {"state": "unknown", "binPresent": False}},
            ]
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"samples": rows}), encoding="utf-8")

            samples = MODULE.load_manifest_samples(manifest, root)

            self.assertEqual(samples["train"][0]["fullness"], 1.0)
            self.assertEqual(samples["train"][0]["overflow"], 1.0)
            self.assertEqual(samples["train"][0]["fullness_mask"], 1.0)
            self.assertEqual(samples["valid"][0]["presence"], 0.0)
            self.assertEqual(samples["valid"][0]["presence_mask"], 1.0)
            self.assertEqual(samples["valid"][0]["fullness_mask"], 0.0)
            self.assertEqual(samples["valid"][0]["overflow_mask"], 0.0)

    def test_rejects_unknown_state_without_boolean_presence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "frame.jpg"
            Image.new("RGB", (20, 20), color="white").save(image)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"samples": [{
                "sampleId": "bad", "pipeline": "bin_state", "path": image.name, "captureGroup": "a",
                "split": "train", "label": {"state": "normal"},
            }]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                MODULE.load_manifest_samples(manifest, root)


if __name__ == "__main__":
    unittest.main()
