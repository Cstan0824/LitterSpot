import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
_MODULE_SPEC = importlib.util.spec_from_file_location(
    "audit_specialist_training_data", ROOT / "scripts/audit-specialist-training-data.py",
)
_MODULE = importlib.util.module_from_spec(_MODULE_SPEC)
assert _MODULE_SPEC.loader is not None
_MODULE_SPEC.loader.exec_module(_MODULE)
audit = _MODULE.audit


class SpecialistDataAuditTests(unittest.TestCase):
    @staticmethod
    def _image(path: Path, color: tuple[int, int, int]) -> str:
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (32, 32), color).save(path, format="PNG")
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def _row(path: str, checksum: str, pipeline: str, label: dict, group: str, split: str = "train") -> dict:
        return {
            "sampleId": path,
            "pipeline": pipeline,
            "path": path,
            "captureGroup": group,
            "split": split,
            "source": {"id": "project", "url": "project-owned", "license": "project-owned"},
            "sha256": checksum,
            "review": {"status": "reviewed", "reviewer": "qa"},
            "edgeTags": ["none"],
            "label": label,
        }

    def test_smoke_manifest_passes_for_all_three_label_shapes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            samples = []
            for index, (pipeline, label) in enumerate((
                ("bin_state", {"binId": "bin-1", "state": "normal", "binPresent": True}),
                ("floor_hazard", {"classes": []}),
                ("occupancy", {"peopleCount": 0}),
            )):
                relative = f"images/{pipeline}-{index}.png"
                checksum = self._image(root / relative, (index * 40, 80, 120))
                samples.append(self._row(relative, checksum, pipeline, label, f"group-{index}"))
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "samples": samples}), encoding="utf-8")

            report = audit(manifest, root, profile="smoke", locked_root=root / "mock-data")

            self.assertTrue(report["passed"], report["errors"])
            self.assertEqual(report["validRows"], 3)

    def test_pilot_profile_blocks_missing_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative = "images/one.png"
            checksum = self._image(root / relative, (1, 2, 3))
            row = self._row(relative, checksum, "bin_state", {"binId": "bin-1", "state": "normal", "binPresent": True}, "group-1")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "samples": [row]}), encoding="utf-8")

            report = audit(manifest, root, profile="pilot", locked_root=root / "mock-data")

            self.assertFalse(report["passed"])
            self.assertTrue(any("coverage below pilot minimum" in error for error in report["errors"]))

    def test_locked_benchmark_checksum_is_rejected_even_when_copied(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            locked = root / "mock-data"
            locked_hash = self._image(locked / "locked.png", (10, 20, 30))
            copied = root / "images/copied.png"
            copied.parent.mkdir(parents=True)
            copied.write_bytes((locked / "locked.png").read_bytes())
            row = self._row("images/copied.png", locked_hash, "bin_state", {"binId": "bin-1", "state": "normal", "binPresent": True}, "group-1")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "samples": [row]}), encoding="utf-8")

            report = audit(manifest, root, profile="smoke", locked_root=locked)

            self.assertFalse(report["passed"])
            self.assertTrue(any("locked benchmark pixels" in error for error in report["errors"]))

    def test_floor_mask_must_match_image_and_class_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image_path = "images/spill.png"
            checksum = self._image(root / image_path, (10, 20, 30))
            mask_path = root / "masks/spill.png"
            mask_path.parent.mkdir(parents=True)
            Image.new("L", (16, 16), 7).save(mask_path)
            row = self._row(
                image_path, checksum, "floor_hazard",
                {"classes": ["floor_spill"], "maskPath": "masks/spill.png"},
                "group-1",
            )
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "samples": [row]}), encoding="utf-8")

            report = audit(manifest, root, profile="smoke", locked_root=root / "mock-data")

            self.assertFalse(report["passed"])
            self.assertTrue(any("dimensions" in error for error in report["errors"]))
            self.assertTrue(any("outside 0/1/2" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
