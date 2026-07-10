from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Iterable


Model = dict[str, object]


def _to_float_row(row: Iterable[str]) -> list[float]:
    return [float(value) for value in row]


def train_centroid_model(feature_rows: list[list[float]], labels: list[str]) -> Model:
    if not feature_rows:
        raise ValueError("feature_rows must not be empty")
    if len(feature_rows) != len(labels):
        raise ValueError("feature_rows and labels must have the same length")

    feature_count = len(feature_rows[0])
    for row in feature_rows:
        if len(row) != feature_count:
            raise ValueError("all feature rows must have the same width")

    grouped: dict[str, list[list[float]]] = {}
    for row, label in zip(feature_rows, labels):
        grouped.setdefault(label, []).append(row)

    centroids: dict[str, list[float]] = {}
    for label, rows in grouped.items():
        centroids[label] = [
            sum(row[index] for row in rows) / len(rows) for index in range(feature_count)
        ]

    return {"feature_count": feature_count, "centroids": centroids}


def predict_rows(model: Model, feature_rows: list[list[float]]) -> list[str]:
    feature_count = int(model["feature_count"])
    centroids = model["centroids"]
    if not isinstance(centroids, dict) or not centroids:
        raise ValueError("model has no centroids")

    predictions: list[str] = []
    for row in feature_rows:
        if len(row) != feature_count:
            raise ValueError("input row width does not match model feature count")
        best_label = min(
            centroids,
            key=lambda label: _euclidean_distance(row, centroids[label]),  # type: ignore[index]
        )
        predictions.append(best_label)
    return predictions


def _euclidean_distance(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def save_model(model: Model, path: str | Path) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(model, indent=2), encoding="utf-8")


def load_model(path: str | Path) -> Model:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def train_from_csv(data_path: str | Path, target_column: str) -> Model:
    with Path(data_path).open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or target_column not in reader.fieldnames:
            raise ValueError(f"target column '{target_column}' not found in CSV headers")

        feature_columns = [name for name in reader.fieldnames if name != target_column]
        if not feature_columns:
            raise ValueError("CSV must contain at least one feature column")

        feature_rows: list[list[float]] = []
        labels: list[str] = []
        for row in reader:
            feature_rows.append(_to_float_row(row[column] for column in feature_columns))  # type: ignore[arg-type]
            labels.append(str(row[target_column]))

    return train_centroid_model(feature_rows, labels)


def predict_csv(
    model: Model, data_path: str | Path, output_path: str | Path | None = None
) -> list[str]:
    with Path(data_path).open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        raw_rows = [row for row in reader if row]

    if not raw_rows:
        return []

    rows: list[list[float]] = []
    for index, row in enumerate(raw_rows):
        try:
            rows.append(_to_float_row(row))
        except ValueError:
            if index == 0:
                continue
            raise

    predictions = predict_rows(model, rows)
    if output_path is not None:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with output_file.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["prediction"])
            for prediction in predictions:
                writer.writerow([prediction])
    return predictions
