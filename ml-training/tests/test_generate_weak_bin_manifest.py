from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/generate_weak_bin_manifest.py"
SPEC = importlib.util.spec_from_file_location("generate_weak_bin_manifest", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class GenerateWeakBinManifestTests(unittest.TestCase):
    def test_crops_registered_roi_and_masks_fullness_when_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "frame.jpg"
            Image.new("RGB", (100, 80), "white").save(source)
            events = root / "events.json"
            events.write_text(json.dumps({"events": [{
                "eventId": "evt-1", "binId": "bin-1", "kind": "bin_overflow",
                "preFrames": [{"path": source.name, "region": {"x1": .2, "y1": .2, "x2": .8, "y2": .8}}],
            }]}), encoding="utf-8")
            manifest = root / "manifest.json"

            report = MODULE.generate(events, manifest, root / "crops", root)
            row = json.loads(manifest.read_text(encoding="utf-8"))["samples"][0]

            self.assertEqual(report["importedRows"], 1)
            self.assertEqual(row["label"]["state"], "overflow")
            self.assertFalse(row["label"]["fullnessKnown"])
            self.assertTrue(Path(root / row["path"]).is_file())
            with Image.open(root / row["path"]) as crop:
                self.assertGreater(crop.width, 60)

    def test_rejects_frame_without_crop_or_region(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "frame.jpg"
            Image.new("RGB", (20, 20), "white").save(source)
            events = root / "events.json"
            events.write_text(json.dumps({"events": [{
                "eventId": "evt-1", "binId": "bin-1", "kind": "normal",
                "preFrames": [{"path": source.name}],
            }]}), encoding="utf-8")
            report = MODULE.generate(events, root / "manifest.json", root / "crops", root)
            self.assertEqual(report["importedRows"], 0)
            self.assertEqual(report["skipped"], 1)


if __name__ == "__main__":
    unittest.main()
