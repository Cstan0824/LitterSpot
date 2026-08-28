import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-training/scripts"))

from audit_cctv_bin_localizer_data import REQUIRED_FIELDS, audit


class CctvBinLocalizerAuditTests(unittest.TestCase):
    def write_manifest(self, root: Path, rows: list[dict[str, str]]) -> Path:
        manifest = root / "manifest.csv"
        with manifest.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=REQUIRED_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        return manifest

    def test_reviewed_positive_and_chair_negative_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "images").mkdir(); (root / "labels").mkdir()
            (root / "images/bin.jpg").write_bytes(b"positive-image")
            (root / "images/chair.jpg").write_bytes(b"negative-image")
            (root / "labels/bin.txt").write_text("0 .5 .5 .4 .6\n", encoding="utf-8")
            manifest = self.write_manifest(root, [
                {"image": "images/bin.jpg", "source_id": "camera-a-day-1", "camera_id": "camera-a", "split": "train", "has_bin": "true", "label": "labels/bin.txt", "bin_style": "wheeled", "state": "normal", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "", "review_status": "reviewed", "notes": ""},
                {"image": "images/chair.jpg", "source_id": "camera-b-day-1", "camera_id": "camera-b", "split": "test", "has_bin": "false", "label": "", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": ""},
            ])
            report = audit(manifest, root)
            self.assertTrue(report["passed"])
            self.assertEqual(report["negativeCategories"], {"chair": 1})

    def test_source_split_leakage_and_negative_label_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "images").mkdir(); (root / "labels").mkdir()
            (root / "images/a.jpg").write_bytes(b"image")
            (root / "images/b.jpg").write_bytes(b"image")
            (root / "labels/not-empty.txt").write_text("0 .5 .5 .4 .6\n", encoding="utf-8")
            manifest = self.write_manifest(root, [
                {"image": "images/a.jpg", "source_id": "camera-a-day-1", "camera_id": "camera-a", "split": "train", "has_bin": "false", "label": "labels/not-empty.txt", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": ""},
                {"image": "images/b.jpg", "source_id": "camera-a-day-1", "camera_id": "camera-a", "split": "test", "has_bin": "false", "label": "", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": ""},
            ])
            report = audit(manifest, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("across splits" in error for error in report["errors"]))
            self.assertTrue(any("must be empty" in error for error in report["errors"]))

    def test_malformed_and_out_of_bounds_yolo_boxes_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "images").mkdir(); (root / "labels").mkdir()
            (root / "images/a.jpg").write_bytes(b"a")
            (root / "images/b.jpg").write_bytes(b"b")
            (root / "labels/a.txt").write_text("1 .5 .5 .4 .6\n", encoding="utf-8")
            (root / "labels/b.txt").write_text("0 .9 .5 .4 .6\n", encoding="utf-8")
            manifest = self.write_manifest(root, [
                {"image": "images/a.jpg", "source_id": "source-a", "camera_id": "camera-a", "split": "train", "has_bin": "true", "label": "labels/a.txt", "bin_style": "wheeled", "state": "normal", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "", "review_status": "reviewed", "notes": ""},
                {"image": "images/b.jpg", "source_id": "source-b", "camera_id": "camera-b", "split": "valid", "has_bin": "true", "label": "labels/b.txt", "bin_style": "wheeled", "state": "full", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "", "review_status": "reviewed", "notes": ""},
            ])
            report = audit(manifest, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("class id must be 0" in error for error in report["errors"]))
            self.assertTrue(any("outside normalized image bounds" in error for error in report["errors"]))

    def test_duplicate_content_and_camera_split_leakage_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "images").mkdir()
            (root / "images/a.jpg").write_bytes(b"same-frame")
            (root / "images/b.jpg").write_bytes(b"same-frame")
            manifest = self.write_manifest(root, [
                {"image": "images/a.jpg", "source_id": "source-a", "camera_id": "camera-a", "split": "train", "has_bin": "false", "label": "", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": ""},
                {"image": "images/b.jpg", "source_id": "source-b", "camera_id": "camera-a", "split": "test", "has_bin": "false", "label": "", "bin_style": "none", "state": "none", "view_angle": "oblique", "lighting": "day", "occlusion": "none", "negative_category": "chair", "review_status": "reviewed", "notes": ""},
            ])
            report = audit(manifest, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("duplicate image content" in error for error in report["errors"]))
            self.assertTrue(any("camera 'camera-a' appears across splits" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
