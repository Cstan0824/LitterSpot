import csv
import tempfile
import unittest
from pathlib import Path

from litterspot_ml.pipeline import (
    load_model,
    predict_csv,
    predict_rows,
    save_model,
    train_centroid_model,
    train_from_csv,
)


class PipelineTests(unittest.TestCase):
    def test_train_and_predict_rows(self) -> None:
        model = train_centroid_model(
            feature_rows=[[0.0, 0.0], [0.1, 0.2], [9.0, 9.0], [8.8, 9.1]],
            labels=["clean", "clean", "litter", "litter"],
        )

        predictions = predict_rows(model, [[0.2, 0.1], [9.2, 8.7]])
        self.assertEqual(predictions, ["clean", "litter"])

    def test_csv_train_save_load_predict(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            train_csv = tmp / "train.csv"
            model_file = tmp / "model.json"
            inference_csv = tmp / "predict.csv"
            output_csv = tmp / "predictions.csv"

            train_csv.write_text(
                "f1,f2,label\n0,0,clean\n0.2,0.1,clean\n9.0,9.0,litter\n8.7,9.2,litter\n",
                encoding="utf-8",
            )
            inference_csv.write_text("0.1,0.2\n9.1,8.9\n", encoding="utf-8")

            model = train_from_csv(train_csv, target_column="label")
            save_model(model, model_file)
            loaded = load_model(model_file)
            predictions = predict_csv(loaded, inference_csv, output_csv)

            self.assertEqual(predictions, ["clean", "litter"])

            with output_csv.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows, [["prediction"], ["clean"], ["litter"]])


if __name__ == "__main__":
    unittest.main()
