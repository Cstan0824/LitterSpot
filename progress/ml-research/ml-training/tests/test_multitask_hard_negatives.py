import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from train_multitask_bin_state import load_ood_negatives


class HardNegativeLoadingTests(unittest.TestCase):
    def test_non_bin_images_only_train_presence_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "train" / "people-video").mkdir(parents=True)
            Image.new("RGB", (20, 20)).save(root / "train" / "people-video" / "frame.jpg")

            samples = load_ood_negatives(root, "train")

            self.assertEqual(len(samples), 1)
            self.assertEqual(samples[0]["presence"], 0.0)
            self.assertEqual(samples[0]["fullness_mask"], 0.0)
            self.assertEqual(samples[0]["overflow_mask"], 0.0)


if __name__ == "__main__":
    unittest.main()
