import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from prepare_public_wet_surface_dataset import _capture_group, _split, prepare


class PublicWetSurfacePreparationTests(unittest.TestCase):
    @staticmethod
    def _sample(root: Path, relative: str, class_id: int) -> None:
        image = root / relative
        image.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (32, 32), (10, 20, 30)).save(image)
        image.with_suffix(".txt").write_text(f"{class_id} 0.5 0.5 0.2 0.2\n", encoding="utf-8")

    def test_adjacent_numbers_share_capture_group_and_split(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "Indoor/Top View/image100.jpeg"
            second = root / "Indoor/Top View/image119.jpeg"
            first_group = _capture_group(root, first)
            second_group = _capture_group(root, second)
            self.assertEqual(first_group, second_group)
            self.assertEqual(_split(first_group), _split(second_group))

    def test_prepare_preserves_classes_and_never_marks_qualification_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            output = root / "prepared"
            self._sample(source, "Indoor/Top View/image1.jpeg", 0)
            self._sample(source, "Outdoor/Side View/image50.jpeg", 1)

            report = prepare(source, output)

            self.assertEqual(report["sampleCount"], 2)
            self.assertEqual(report["classInstanceCounts"], {"0": 1, "1": 1})
            self.assertFalse(report["qualificationEligible"])
            self.assertTrue((output / "data.yaml").is_file())
            self.assertTrue((output / "manifest.json").is_file())

    def test_prepare_refuses_nonempty_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            output = root / "prepared"
            self._sample(source, "Indoor/image1.jpeg", 0)
            output.mkdir(parents=True)
            (output / "existing.txt").write_text("keep", encoding="utf-8")

            with self.assertRaisesRegex(FileExistsError, "choose a new immutable version"):
                prepare(source, output)


if __name__ == "__main__":
    unittest.main()
