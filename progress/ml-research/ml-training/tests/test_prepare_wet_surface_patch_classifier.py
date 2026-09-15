import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from prepare_wet_surface_patch_classifier import prepare


class WetSurfacePatchPreparationTests(unittest.TestCase):
    @staticmethod
    def _source(root: Path) -> Path:
        source = root / "source"
        image = source / "images" / "train" / "sample.jpg"
        label = source / "labels" / "train" / "sample.txt"
        image.parent.mkdir(parents=True)
        label.parent.mkdir(parents=True)
        Image.new("RGB", (128, 128), (100, 110, 120)).save(image)
        label.write_text("0 0.25 0.25 0.20 0.20\n1 0.75 0.25 0.20 0.20\n", encoding="utf-8")
        manifest = {
            "samples": [{
                "sampleId": "public-1", "captureGroup": "group-1", "split": "train",
                "preparedImage": str(image), "preparedLabel": str(label),
            }],
        }
        (source / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return source

    def test_prepare_emits_wet_and_dry_patches_as_public_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = prepare(self._source(root), root / "output", positives_per_image=2)

            self.assertEqual(report["sampleCounts"]["train:wet"], 2)
            self.assertEqual(report["sampleCounts"]["train:dry"], 1)
            self.assertFalse(report["qualificationEligible"])
            self.assertTrue(all(row["evidenceTier"] == "public" for row in report["samples"]))
            self.assertTrue(all(Path(row["image"]).is_file() for row in report["samples"]))

    def test_prepare_refuses_nonempty_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._source(root)
            output = root / "output"
            output.mkdir()
            (output / "keep.txt").touch()
            with self.assertRaisesRegex(FileExistsError, "immutable version"):
                prepare(source, output)


if __name__ == "__main__":
    unittest.main()
