from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_specialist_floor_dataset.py"
SPEC = importlib.util.spec_from_file_location("prepare_specialist_floor_dataset", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class PrepareSpecialistFloorDatasetTests(unittest.TestCase):
    def _sample(self, root: Path, split: str, name: str, value: int) -> dict:
        image_path = root / f"{name}.jpg"
        mask_path = root / f"{name}.png"
        Image.new("RGB", (12, 12), color="white").save(image_path)
        mask = np.zeros((12, 12), dtype=np.uint8)
        if value:
            mask[2:9, 3:10] = value
            Image.fromarray(mask).save(mask_path)
            classes = ["floor_litter" if value == 1 else "floor_spill"]
            mask_value = mask_path.name
        else:
            classes = []
            mask_value = None
        return {
            "id": name, "pipeline": "floor_hazard", "split": split,
            "image": image_path.name, "label": {"classes": classes, "maskPath": mask_value},
        }

    def test_builds_polygons_and_empty_negative_labels(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = [
                self._sample(root, "train", "litter", 1),
                self._sample(root, "valid", "spill", 2),
                self._sample(root, "test", "clean", 0),
            ]
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "samples": rows}), encoding="utf-8")

            summary = MODULE.build_dataset(manifest, root / "prepared", root, min_area=4)

            self.assertEqual(summary["samples"], {"train": 1, "val": 1, "test": 1})
            self.assertTrue((root / "prepared" / "data.yaml").is_file())
            self.assertTrue((root / "prepared" / "labels" / "train" / "00000_litter.txt").read_text().startswith("0 "))
            self.assertTrue((root / "prepared" / "labels" / "val" / "00001_spill.txt").read_text().startswith("1 "))
            self.assertEqual((root / "prepared" / "labels" / "test" / "00002_clean.txt").read_text(), "")

    def test_refuses_to_overwrite_existing_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "prepared"
            destination.mkdir()
            (destination / "existing.txt").write_text("keep", encoding="utf-8")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"samples": [{"pipeline": "floor_hazard"}]}), encoding="utf-8")
            with self.assertRaises(FileExistsError):
                MODULE.build_dataset(manifest, destination, root)


if __name__ == "__main__":
    unittest.main()
