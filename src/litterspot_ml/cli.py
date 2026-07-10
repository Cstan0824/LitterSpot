from __future__ import annotations

import argparse

from .pipeline import load_model, predict_csv, save_model, train_from_csv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LitterSpot local ML utility")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="Train a model from CSV")
    train_parser.add_argument("--data", required=True, help="Training CSV path")
    train_parser.add_argument("--target", required=True, help="Target column name")
    train_parser.add_argument("--model", required=True, help="Output model path")

    predict_parser = subparsers.add_parser("predict", help="Predict labels from CSV")
    predict_parser.add_argument("--data", required=True, help="Input feature CSV path")
    predict_parser.add_argument("--model", required=True, help="Saved model path")
    predict_parser.add_argument("--output", required=True, help="Output CSV path")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "train":
        model = train_from_csv(args.data, args.target)
        save_model(model, args.model)
        print(f"Model saved to {args.model}")
        return

    model = load_model(args.model)
    predictions = predict_csv(model, args.data, args.output)
    print(f"Wrote {len(predictions)} predictions to {args.output}")


if __name__ == "__main__":
    main()
