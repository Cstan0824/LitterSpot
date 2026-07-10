# LitterSpot

Minimal Python project scaffold for local ML training and local inference usage.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Train a model from CSV

The training CSV should contain numeric feature columns and one target column.

```bash
python -m litterspot_ml.cli train \
  --data /path/to/train.csv \
  --target label \
  --model ./models/litterspot_model.json
```

## Run local predictions

```bash
python -m litterspot_ml.cli predict \
  --data /path/to/predict.csv \
  --model ./models/litterspot_model.json \
  --output ./predictions.csv
```