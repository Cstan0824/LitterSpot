"""Validate provenance, leakage, and coverage before specialist training.

The repository's ``mock-data`` tree is a locked evaluation benchmark. This
audit intentionally refuses to treat it as training data, even when a sample
is copied to another path with the same bytes. The manifest is the only input
to the training-preparation step, so the checks here fail early and produce a
machine-readable report for CI or a local labeling workflow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
PIPELINES = {"bin_state", "floor_hazard", "occupancy"}
SPLITS = {"train", "valid", "test"}
BIN_STATES = {"normal", "full", "overflow", "unknown"}
FLOOR_CLASSES = {"floor_litter", "floor_spill"}
UNKNOWN_LICENSES = {"", "unknown", "unclear", "restricted", "tbd"}
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")

# These are deliberately smaller pilot gates. Promotion targets remain higher
# and are enforced by held-out metrics, not by pretending raw sample count is
# sufficient evidence.
PILOT_MINIMUMS: dict[str, dict[str, int]] = {
    "bin_state": {
        "state:normal": 100,
        "state:full": 75,
        "state:overflow": 75,
        "state:unknown": 50,
        "tag:surrounding_waste": 50,
        "tag:hard_negative": 50,
    },
    "floor_hazard": {
        "class:floor_litter": 100,
        "class:floor_spill": 100,
        "class:food_or_sauce": 50,
        "class:clean_negative": 100,
        "class:mixed_litter_spill": 30,
    },
    "occupancy": {
        "people:0": 40,
        "people:1_3": 40,
        "people:4_8": 80,
        "people:9_plus": 40,
    },
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inside(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _resolve(root: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = Path(value)
    return candidate if candidate.is_absolute() else root / candidate


def _readable_image(path: Path) -> tuple[bool, str | None]:
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        return False, "unsupported image suffix"
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.width < 2 or image.height < 2:
                return False, "image is smaller than 2x2 pixels"
    except Exception as exc:  # Pillow exposes several format-specific errors.
        return False, f"image cannot be decoded: {exc}"
    return True, None


def _source_errors(sample: dict[str, Any], prefix: str) -> list[str]:
    source = sample.get("source")
    errors: list[str] = []
    if not isinstance(source, dict):
        return [f"{prefix}.source must be an object"]
    for field in ("id", "url", "license"):
        value = source.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{prefix}.source.{field} is required")
    license_name = str(source.get("license", "")).strip().lower()
    if license_name in UNKNOWN_LICENSES:
        errors.append(f"{prefix}.source.license must be explicit, not {license_name or 'empty'}")
    return errors


def _label_errors(sample: dict[str, Any], prefix: str) -> list[str]:
    pipeline = sample.get("pipeline")
    label = sample.get("label")
    errors: list[str] = []
    if not isinstance(label, dict):
        return [f"{prefix}.label must be an object"]

    if pipeline == "bin_state":
        state = label.get("state")
        if state not in BIN_STATES:
            errors.append(f"{prefix}.label.state must be one of {sorted(BIN_STATES)}")
        if not isinstance(label.get("binId"), str) or not label["binId"].strip():
            errors.append(f"{prefix}.label.binId is required for a fixed-camera crop")
        bin_present = label.get("binPresent")
        if not isinstance(bin_present, bool):
            errors.append(f"{prefix}.label.binPresent must be true or false")
        elif state in {"normal", "full", "overflow"} and not bin_present:
            errors.append(f"{prefix}.label.binPresent must be true for a known bin state")
        for target_name in ("presenceKnown", "fullnessKnown", "overflowKnown"):
            if target_name in label and not isinstance(label[target_name], bool):
                errors.append(f"{prefix}.label.{target_name} must be boolean when supplied")
    elif pipeline == "floor_hazard":
        classes = label.get("classes")
        if not isinstance(classes, list) or any(item not in FLOOR_CLASSES for item in classes):
            errors.append(f"{prefix}.label.classes must contain only {sorted(FLOOR_CLASSES)}")
            classes = []
        if len(classes) != len(set(classes)):
            errors.append(f"{prefix}.label.classes contains duplicates")
        mask_path = label.get("maskPath")
        if classes and (not isinstance(mask_path, str) or not mask_path.strip()):
            errors.append(f"{prefix}.label.maskPath is required for a floor hazard")
        if not classes and mask_path:
            errors.append(f"{prefix}.label.maskPath must be empty for a clean negative")
    elif pipeline == "occupancy":
        count = label.get("peopleCount")
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 100:
            errors.append(f"{prefix}.label.peopleCount must be an integer from 0 to 100")
        elif count > 0 and (not isinstance(label.get("boxesPath"), str) or not label["boxesPath"].strip()):
            errors.append(f"{prefix}.label.boxesPath is required when peopleCount is greater than zero")
    return errors


def _coverage(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter[str]] = {pipeline: Counter() for pipeline in PIPELINES}
    for row in rows:
        pipeline = row.get("pipeline")
        if pipeline == "bin_state":
            label = row.get("label", {})
            counts[pipeline][f"state:{label.get('state')}"] += 1
            tags = set(row.get("edgeTags", [])) if isinstance(row.get("edgeTags"), list) else set()
            if "surrounding_waste" in tags:
                counts[pipeline]["tag:surrounding_waste"] += 1
            if any(tag.startswith("hard_negative") for tag in tags):
                counts[pipeline]["tag:hard_negative"] += 1
        elif pipeline == "floor_hazard":
            classes = set(row.get("label", {}).get("classes", []))
            if not classes:
                counts[pipeline]["class:clean_negative"] += 1
            if "floor_litter" in classes:
                counts[pipeline]["class:floor_litter"] += 1
            if "floor_spill" in classes:
                counts[pipeline]["class:floor_spill"] += 1
            tags = set(row.get("edgeTags", [])) if isinstance(row.get("edgeTags"), list) else set()
            if "food_or_sauce" in tags:
                counts[pipeline]["class:food_or_sauce"] += 1
            if {"floor_litter", "floor_spill"}.issubset(classes):
                counts[pipeline]["class:mixed_litter_spill"] += 1
        elif pipeline == "occupancy":
            count = row.get("label", {}).get("peopleCount")
            if isinstance(count, int):
                bucket = "0" if count == 0 else "1_3" if count <= 3 else "4_8" if count <= 8 else "9_plus"
                counts[pipeline][f"people:{bucket}"] += 1
    return {pipeline: dict(values) for pipeline, values in counts.items()}


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Specialist training-data audit",
        "",
        f"- Profile: `{report['profile']}`",
        f"- Samples: `{report['rows']}`",
        f"- Result: **{'PASS' if report['passed'] else 'BLOCKED'}**",
        "",
        "## Coverage",
        "",
        "| Pipeline | Metric | Observed | Required |",
        "|---|---:|---:|---:|",
    ]
    for pipeline, metrics in report["requirements"].items():
        for metric, required in metrics.items():
            observed = report["coverage"].get(pipeline, {}).get(metric, 0)
            lines.append(f"| `{pipeline}` | `{metric}` | {observed} | {required} |")
    lines.extend(["", "## Errors", ""])
    lines.extend(f"- {error}" for error in report["errors"] or ["None"])
    if report["warnings"]:
        lines.extend(["", "## Warnings", ""])
        lines.extend(f"- {warning}" for warning in report["warnings"])
    return "\n".join(lines) + "\n"


def audit(
    manifest_path: Path,
    root: Path = ROOT,
    profile: str = "pilot",
    locked_root: Path | None = None,
    pipeline: str | None = None,
    allow_weak_labels: bool = False,
) -> dict[str, Any]:
    """Return a complete readiness report without writing files."""
    pipeline_filter = pipeline
    manifest_path = manifest_path if manifest_path.is_absolute() else root / manifest_path
    locked_root = locked_root or root / "mock-data"
    errors: list[str] = []
    warnings: list[str] = []
    rows: list[dict[str, Any]] = []
    if profile not in {"pilot", "smoke"}:
        errors.append(f"unknown profile {profile!r}; use pilot or smoke")
    if pipeline is not None and pipeline not in PIPELINES:
        errors.append(f"unknown pipeline {pipeline!r}; use one of {sorted(PIPELINES)}")
    if not manifest_path.is_file():
        errors.append(f"manifest not found: {manifest_path}")
    else:
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            payload = {}
            errors.append(f"manifest cannot be read as JSON: {exc}")
        if payload.get("schemaVersion") != 1:
            errors.append("manifest.schemaVersion must be 1")
        if not isinstance(payload.get("samples"), list):
            errors.append("manifest.samples must be an array")
        else:
            rows = payload["samples"]
            if pipeline_filter in PIPELINES:
                rows = [row for row in rows if isinstance(row, dict) and row.get("pipeline") == pipeline_filter]

    locked_hashes: dict[str, str] = {}
    if locked_root.is_dir():
        for candidate in locked_root.rglob("*"):
            if candidate.is_file() and candidate.suffix.lower() in IMAGE_SUFFIXES:
                try:
                    locked_hashes[_sha256(candidate)] = str(candidate.relative_to(root))
                except OSError:
                    warnings.append(f"could not hash locked benchmark file: {candidate}")

    seen_ids: set[str] = set()
    seen_hashes: dict[str, str] = {}
    groups: defaultdict[str, set[str]] = defaultdict(set)
    valid_rows: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        prefix = f"samples[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{prefix} must be an object")
            continue
        sample_id = row.get("sampleId")
        if not isinstance(sample_id, str) or not sample_id.strip():
            errors.append(f"{prefix}.sampleId is required")
        elif sample_id in seen_ids:
            errors.append(f"duplicate sampleId: {sample_id}")
        else:
            seen_ids.add(sample_id)
        pipeline = row.get("pipeline")
        if pipeline not in PIPELINES:
            errors.append(f"{prefix}.pipeline must be one of {sorted(PIPELINES)}")
        split = row.get("split")
        if split not in SPLITS:
            errors.append(f"{prefix}.split must be one of {sorted(SPLITS)}")
        capture_group = row.get("captureGroup")
        if not isinstance(capture_group, str) or not capture_group.strip():
            errors.append(f"{prefix}.captureGroup is required")
        elif split in SPLITS:
            groups[capture_group].add(split)
        path = _resolve(root, row.get("path"))
        if path is None or not path.is_file():
            errors.append(f"{prefix}.path does not point to a file: {row.get('path')!r}")
        else:
            readable, reason = _readable_image(path)
            if not readable:
                errors.append(f"{prefix}.path {path}: {reason}")
            if _inside(path, locked_root):
                errors.append(f"{prefix}.path is inside locked mock-data: {path}")
        declared_hash = row.get("sha256")
        if not isinstance(declared_hash, str) or not SHA256_RE.fullmatch(declared_hash):
            errors.append(f"{prefix}.sha256 must be a 64-character hexadecimal checksum")
        elif path is not None and path.is_file():
            actual_hash = _sha256(path)
            if actual_hash.lower() != declared_hash.lower():
                errors.append(f"{prefix}.sha256 does not match {path}")
            if actual_hash in locked_hashes:
                errors.append(f"{prefix} duplicates locked benchmark pixels: {locked_hashes[actual_hash]}")
            previous = seen_hashes.get(actual_hash)
            if previous:
                errors.append(f"duplicate image checksum in {prefix} and {previous}")
            else:
                seen_hashes[actual_hash] = str(sample_id)
        review = row.get("review")
        review_status = review.get("status") if isinstance(review, dict) else None
        reviewer = str(review.get("reviewer", "")).strip() if isinstance(review, dict) else ""
        if review_status == "reviewed" and reviewer:
            pass
        elif review_status == "weak_label" and allow_weak_labels and reviewer and str(review.get("method", "")).strip():
            warnings.append(f"{prefix} uses a weak label and must not be promoted without human confirmation")
        else:
            suffix = "; pass allow_weak_labels only for bootstrap data" if review_status == "weak_label" else ""
            errors.append(f"{prefix}.review.status must be reviewed (or an explicitly allowed weak_label) and reviewer is required{suffix}")
        edge_tags = row.get("edgeTags")
        if not isinstance(edge_tags, list) or not edge_tags or any(not isinstance(tag, str) or not tag.strip() for tag in edge_tags):
            errors.append(f"{prefix}.edgeTags must be a non-empty string array")
        errors.extend(_source_errors(row, prefix))
        errors.extend(_label_errors(row, prefix))
        label = row.get("label") if isinstance(row.get("label"), dict) else {}
        for label_path_key in ("maskPath", "boxesPath"):
            label_path = _resolve(root, label.get(label_path_key))
            if label.get(label_path_key) and (label_path is None or not label_path.is_file()):
                errors.append(f"{prefix}.label.{label_path_key} does not point to a file")
        if pipeline == "floor_hazard" and path is not None and path.is_file() and label.get("maskPath"):
            mask_path = _resolve(root, label.get("maskPath"))
            if mask_path is not None and mask_path.is_file():
                try:
                    with Image.open(path) as source_image, Image.open(mask_path) as mask_image:
                        if source_image.size != mask_image.size:
                            errors.append(
                                f"{prefix}.label.maskPath dimensions {mask_image.size} do not match image {source_image.size}"
                            )
                        class_mask = mask_image.convert("L")
                        pixels = (
                            class_mask.get_flattened_data()
                            if hasattr(class_mask, "get_flattened_data")
                            else class_mask.getdata()
                        )
                        values = set(pixels)
                    unexpected = values - {0, 1, 2}
                    if unexpected:
                        errors.append(f"{prefix}.label.maskPath contains values outside 0/1/2: {sorted(unexpected)[:10]}")
                    classes = set(label.get("classes", []))
                    if "floor_litter" in classes and 1 not in values:
                        errors.append(f"{prefix}.label.maskPath has no floor_litter pixels (value 1)")
                    if "floor_spill" in classes and 2 not in values:
                        errors.append(f"{prefix}.label.maskPath has no floor_spill pixels (value 2)")
                except Exception as exc:
                    errors.append(f"{prefix}.label.maskPath cannot be decoded as a class-index PNG: {exc}")
        if pipeline in PIPELINES and not any(error.startswith(prefix) for error in errors):
            valid_rows.append(row)

    for capture_group, splits in groups.items():
        if len(splits) > 1:
            errors.append(f"captureGroup {capture_group!r} appears across splits: {sorted(splits)}")

    coverage = _coverage(rows)
    selected_pipelines = {pipeline_filter} if pipeline_filter in PIPELINES else PIPELINES
    requirements = {
        pipeline_name: (PILOT_MINIMUMS[pipeline_name] if profile == "pilot" else {})
        for pipeline_name in selected_pipelines
    }
    if profile == "pilot":
        for pipeline, metrics in requirements.items():
            for metric, required in metrics.items():
                observed = coverage[pipeline].get(metric, 0)
                if observed < required:
                    errors.append(f"coverage below pilot minimum for {pipeline}/{metric}: {observed} < {required}")
    if rows and not valid_rows:
        warnings.append("no fully valid rows are available for preparation")
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "manifest": str(manifest_path),
        "profile": profile,
        "pipeline": pipeline_filter,
        "rows": len(rows),
        "validRows": len(valid_rows),
        "coverage": coverage,
        "requirements": requirements,
        "lockedMockFilesHashed": len(locked_hashes),
        "errors": errors,
        "warnings": warnings,
        "allowWeakLabels": allow_weak_labels,
        "passed": not errors,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "ml-training/data/specialists/manifest.json")
    parser.add_argument("--profile", choices=("pilot", "smoke"), default="pilot")
    parser.add_argument("--pipeline", choices=sorted(PIPELINES))
    parser.add_argument(
        "--allow-weak-labels",
        action="store_true",
        help="Allow event-derived weak_label rows for bootstrap smoke runs; never use for promotion.",
    )
    parser.add_argument("--json-report", "--report", dest="json_report", type=Path, default=ROOT / "artifacts/specialist-data-audit/report.json")
    parser.add_argument("--markdown-report", type=Path, default=ROOT / "artifacts/specialist-data-audit/report.md")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = audit(args.manifest, ROOT, args.profile, pipeline=args.pipeline, allow_weak_labels=args.allow_weak_labels)
    for destination, content in ((args.json_report, json.dumps(report, indent=2) + "\n"), (args.markdown_report, _markdown(report))):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
