import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from acquire_figshare_road_surface import _safe_members


class FigshareRoadSurfaceAcquisitionTests(unittest.TestCase):
    def test_rejects_zip_path_traversal(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("../outside.jpg", b"bad")
        stream.seek(0)
        with tempfile.TemporaryDirectory() as directory, zipfile.ZipFile(stream) as archive:
            with self.assertRaisesRegex(ValueError, "unsafe zip member"):
                list(_safe_members(archive, Path(directory)))

    def test_accepts_nested_member(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("dry/sample.jpg", b"ok")
        stream.seek(0)
        with tempfile.TemporaryDirectory() as directory, zipfile.ZipFile(stream) as archive:
            self.assertEqual(len(list(_safe_members(archive, Path(directory)))), 1)


if __name__ == "__main__":
    unittest.main()
