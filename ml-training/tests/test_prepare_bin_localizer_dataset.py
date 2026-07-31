import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prepare_bin_localizer_dataset import prepare


class PrepareBinLocalizerDatasetTests(unittest.TestCase):
    def test_combines_gco_and_gbs_and_keeps_loose_garbage_as_negative(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gco, gbs, output = root / "gco", root / "gbs", root / "output"

            for split in ("train", "valid", "test"):
                image_dir, label_dir = gco / split / "images", gco / split / "labels"
                image_dir.mkdir(parents=True)
                label_dir.mkdir(parents=True)
                Image.new("RGB", (20, 20)).save(image_dir / f"{split}.jpg")
                (label_dir / f"{split}.txt").write_text("2 0.5 0.5 0.4 0.4\n", encoding="utf-8")

            (gbs / "Images").mkdir(parents=True)
            (gbs / "Annotations").mkdir()
            images = []
            annotations = []
            for image_id in range(10):
                name = f"{image_id}.jpg"
                Image.new("RGB", (100, 100)).save(gbs / "Images" / name)
                images.append({"id": image_id, "file_name": name, "width": 100, "height": 100})
                annotations.append({
                    "id": image_id,
                    "image_id": image_id,
                    "category_id": 2 if image_id == 9 else 1,
                    "bbox": [10, 20, 30, 40],
                })
            coco = {
                "images": images,
                "annotations": annotations,
                "categories": [
                    {"id": 0, "name": "overflow"},
                    {"id": 1, "name": "garbage_bin"},
                    {"id": 2, "name": "garbage"},
                ],
            }
            (gbs / "Annotations/GBS_coco.json").write_text(json.dumps(coco), encoding="utf-8")

            report = prepare(gco, gbs, output, image_mode="copy")

            self.assertEqual(report["gco"]["splits"]["train"]["objects"], 1)
            self.assertEqual(report["gbs"]["duplicateImageRowsRemoved"], 0)
            self.assertEqual(report["gbs"]["ignoredLooseGarbageAnnotations"], 1)
            self.assertEqual((output / "test/labels/gbs_9.txt").read_text(encoding="utf-8"), "")
            self.assertEqual(
                (output / "train/labels/gbs_0.txt").read_text(encoding="utf-8"),
                "0 0.25000000 0.40000000 0.30000000 0.40000000\n",
            )

    def test_rejects_non_empty_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            output.mkdir()
            (output / "keep.txt").write_text("user data", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be empty"):
                prepare(root / "gco", root / "gbs", output)


if __name__ == "__main__":
    unittest.main()
