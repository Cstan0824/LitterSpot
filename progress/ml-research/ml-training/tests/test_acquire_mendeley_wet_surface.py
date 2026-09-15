import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "acquire_mendeley_wet_surface",
    ROOT / "scripts/acquire_mendeley_wet_surface.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class MendeleyWetSurfaceAcquisitionTests(unittest.TestCase):
    def test_safe_members_rejects_zip_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "unsafe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../escape.txt", "bad")
            with zipfile.ZipFile(archive_path) as archive:
                with self.assertRaisesRegex(ValueError, "unsafe archive member"):
                    MODULE.safe_members(archive, root / "output")

    def test_safe_members_accepts_nested_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "safe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("images/train/one.jpg", "pixels")
            with zipfile.ZipFile(archive_path) as archive:
                members = MODULE.safe_members(archive, root / "output")
            self.assertEqual([member.filename for member in members], ["images/train/one.jpg"])


if __name__ == "__main__":
    unittest.main()
