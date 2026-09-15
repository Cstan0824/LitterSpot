import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from prepare_combined_wet_dry_classifier import prepare


class CombinedWetDryPreparationTests(unittest.TestCase):
    @staticmethod
    def _image(path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (20, 20), "gray").save(path)

    def test_combines_explicit_figshare_classes_and_only_mendeley_wet(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            figshare = root / "figshare"
            for relative in ("withlight/withlight/train", "nolight/nolight/train", "withlight/withlight/val", "nolight/nolight/val"):
                self._image(figshare / relative / "adj_dry_scene" / "1.jpg")
                self._image(figshare / relative / "adj_wet_scene" / "2.jpg")
            mendeley = root / "mendeley"
            samples = []
            for split in ("train", "val", "test"):
                wet = mendeley / "source" / f"{split}-wet.jpg"
                dry = mendeley / "source" / f"{split}-dry.jpg"
                self._image(wet)
                self._image(dry)
                samples.extend([
                    {"sampleId": f"{split}-wet", "split": split, "className": "wet", "image": str(wet), "captureGroup": split},
                    {"sampleId": f"{split}-dry", "split": split, "className": "dry", "image": str(dry), "captureGroup": split},
                ])
            (mendeley / "manifest.json").write_text(json.dumps({"samples": samples}), encoding="utf-8")
            report = prepare(figshare, mendeley, root / "output", 10, 10)

            self.assertFalse(report["pseudoDryRowsIncluded"])
            self.assertFalse(report["qualificationEligible"])
            self.assertEqual(report["sampleCounts"]["train:dry"], 1)
            self.assertEqual(report["sampleCounts"]["train:wet"], 2)
            self.assertTrue(all(row["className"] == "wet" for row in report["samples"] if row["sourceDataset"].startswith("mendeley")))


if __name__ == "__main__":
    unittest.main()
