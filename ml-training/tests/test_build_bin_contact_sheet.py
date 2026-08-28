from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/build_bin_contact_sheet.py"
SPEC = importlib.util.spec_from_file_location("build_bin_contact_sheet", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class BinContactSheetTests(unittest.TestCase):
    def test_sidecar_and_label_file_materialise_original_resolution_crops(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "sources"
            source_dir.mkdir()
            for index, size in enumerate(((640, 480), (320, 640))):
                Image.new("RGB", size, (index * 30, 100, 200)).save(source_dir / f"bin-{index}.jpg")
            output = root / "sheet"
            sidecar = MODULE.build_contact_sheet(sorted(source_dir.glob("*.jpg")), output, columns=2)
            self.assertEqual(len(sidecar["tiles"]), 2)
            labels = root / "labels.json"
            labels.write_text(json.dumps({"tiles": [
                {"tileId": "tile-0000", "state": "normal", "confidence": .95},
                {"tileId": "tile-0001", "state": "unknown", "confidence": 0},
            ]}), encoding="utf-8")
            report = MODULE.materialize_labels(output / "sidecar.json", labels, output / "labeled", min_confidence=.8)
            self.assertEqual(report["accepted"], 1)
            self.assertEqual(report["unknownOrRejected"], 1)
            manifest = json.loads((output / "labeled" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["samples"]), 1)
            crop = output / "labeled" / "images" / "tile-0000.jpg"
            self.assertTrue(crop.is_file())
            with Image.open(crop) as image:
                self.assertEqual(image.size, (640, 480))

    def test_changed_source_checksum_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "bin.jpg"
            Image.new("RGB", (100, 80), "white").save(source)
            output = root / "sheet"
            MODULE.build_contact_sheet([source], output)
            Image.new("RGB", (100, 80), "black").save(source)
            labels = root / "labels.json"
            labels.write_text(json.dumps({"tiles": [{"tileId": "tile-0000", "state": "normal", "confidence": .99}]}), encoding="utf-8")
            report = MODULE.materialize_labels(output / "sidecar.json", labels, output / "labeled")
            self.assertEqual(report["accepted"], 0)
            self.assertIn("source_checksum_changed", (output / "labeled" / "labels.csv").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
