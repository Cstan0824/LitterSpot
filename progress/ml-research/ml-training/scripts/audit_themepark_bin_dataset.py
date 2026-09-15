"""Audit the admitted theme-park bin dataset before either training loop.

The input is a JSON Lines manifest with one row per dataset sample. Candidate
or quarantined rows belong in a separate manifest: every row presented here is
asserted to be admitted to the source-separated train/valid/test dataset and
must therefore have complete provenance, an approved product-use status, a
valid local image checksum, and no relationship to the locked WhatsApp suite.

Only reviewed appearance labels count toward bin-style quotas. Only negative
frames whose source metadata verifies bin absence count toward hard-negative
quotas. Overflow/non-overflow rows count only when their state evidence was
reviewed; generic ``overflow`` or litter boxes do not become state truth merely
because an upstream category has that name.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "artifacts/dataset-readiness/themepark-bin-dataset-audit.json"
ALLOWED_SPLITS = {"train", "valid", "test"}
ALLOWED_TASKS = {"localizer_positive", "localizer_negative", "state"}
ALLOWED_REVIEW = {"reviewed", "upstream_verified"}
STYLE_MINIMUMS = {
    "wheeled_closed_lid": 300,
    "open_top_cylindrical": 300,
    "open_receptacle": 200,
}
NEGATIVE_FAMILY_MINIMUMS = {
    "chair": 150,
    "person_table": 150,
    "cart_stroller": 150,
    "sign_box": 150,
    "bag_bottle": 150,
}
EDGE_TAGS = {"object_on_lid", "adjacent_bag", "exposed_liner", "partial_occlusion"}
REQUIRED_FIELDS = {
    "sampleId", "image", "sourceId", "sourceRecord", "attribution",
    "license", "commercialUseStatus", "sha256", "perceptualHash64",
    "groupId", "split", "task", "reviewStatus", "isLockedAcceptance",
}


def _bool(value: Any) -> bool:
    return value is True


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _valid_phash(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 16:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


def _read_manifest(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"line {line_number}: invalid JSON: {error}") from error
            if not isinstance(row, dict):
                raise ValueError(f"line {line_number}: row must be an object")
            row["_line"] = line_number
            rows.append(row)
    return rows


def _gate(value: int | float | bool, *, minimum: int | float | None = None, maximum: int | float | None = None) -> dict[str, Any]:
    passed = bool(value) if minimum is None and maximum is None else True
    result: dict[str, Any] = {"value": value}
    if minimum is not None:
        result["minimum"] = minimum
        passed = passed and value >= minimum
    if maximum is not None:
        result["maximum"] = maximum
        passed = passed and value <= maximum
    result["passed"] = passed
    return result


def _unique_hashes(rows: Iterable[dict[str, Any]]) -> set[str]:
    return {str(row["sha256"]).lower() for row in rows}


def _near_duplicate_cross_split(rows: list[dict[str, Any]], maximum_distance: int = 4) -> list[dict[str, Any]]:
    """Find cross-split 64-bit perceptual hashes within the configured distance."""
    by_split: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if not _valid_phash(row.get("perceptualHash64")):
            continue
        by_split[str(row["split"])][int(row["perceptualHash64"], 16)].append(str(row["sampleId"]))
    collisions: list[dict[str, Any]] = []
    splits = sorted(by_split)
    for index, left_split in enumerate(splits):
        for right_split in splits[index + 1:]:
            for left_hash, left_ids in by_split[left_split].items():
                for right_hash, right_ids in by_split[right_split].items():
                    distance = (left_hash ^ right_hash).bit_count()
                    if distance <= maximum_distance:
                        collisions.append({
                            "leftSplit": left_split,
                            "rightSplit": right_split,
                            "distance": distance,
                            "leftSampleIds": left_ids,
                            "rightSampleIds": right_ids,
                        })
                        if len(collisions) >= 100:
                            return collisions
    return collisions


def audit(manifest: Path, root: Path | None = None) -> dict[str, Any]:
    manifest = manifest.resolve()
    root = (root or manifest.parent).resolve()
    rows = _read_manifest(manifest)
    errors: list[str] = []
    warnings: list[str] = []
    sample_ids: set[str] = set()
    split_by_group: dict[str, set[str]] = defaultdict(set)
    split_by_sha: dict[str, set[str]] = defaultdict(set)
    source_splits: dict[str, set[str]] = defaultdict(set)
    structured_rows: list[dict[str, Any]] = []
    admitted_rows: list[dict[str, Any]] = []

    for row in rows:
        line = int(row["_line"])
        missing = sorted(field for field in REQUIRED_FIELDS if field not in row)
        if missing:
            errors.append(f"line {line}: missing required fields: {', '.join(missing)}")
            continue
        row_error_start = len(errors)
        sample_id = str(row["sampleId"]).strip()
        if not sample_id or sample_id in sample_ids:
            errors.append(f"line {line}: sampleId must be non-empty and unique")
        sample_ids.add(sample_id)
        split = str(row["split"]).strip()
        task = str(row["task"]).strip()
        if split not in ALLOWED_SPLITS:
            errors.append(f"line {line}: invalid split {split!r}")
        if task not in ALLOWED_TASKS:
            errors.append(f"line {line}: invalid task {task!r}")
        if str(row["commercialUseStatus"]).strip() != "approved":
            errors.append(f"line {line}: commercialUseStatus must be 'approved'")
        license_info = row["license"]
        if not isinstance(license_info, dict) or not str(license_info.get("id", "")).strip() or not str(license_info.get("url", "")).strip():
            errors.append(f"line {line}: license must contain non-empty id and url")
        for field in ("sourceId", "sourceRecord", "attribution", "groupId"):
            if not str(row[field]).strip():
                errors.append(f"line {line}: {field} must be non-empty")
        if str(row["reviewStatus"]).strip() not in ALLOWED_REVIEW:
            errors.append(f"line {line}: reviewStatus must be reviewed or upstream_verified")
        if _bool(row["isLockedAcceptance"]):
            errors.append(f"line {line}: locked acceptance media cannot enter the dataset")
        if "whatsapp" in str(row["image"]).casefold() or "whatsapp" in str(row["sourceId"]).casefold():
            errors.append(f"line {line}: WhatsApp-labelled paths/sources are forbidden")

        digest = str(row["sha256"]).strip().lower()
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            errors.append(f"line {line}: sha256 must be 64 lowercase hexadecimal characters")
        if not _valid_phash(row["perceptualHash64"]):
            errors.append(f"line {line}: perceptualHash64 must be 16 hexadecimal characters")
        image = (root / str(row["image"])).resolve()
        try:
            image.relative_to(root)
        except ValueError:
            errors.append(f"line {line}: image resolves outside manifest root")
        else:
            if not image.is_file():
                errors.append(f"line {line}: missing image: {image}")
            else:
                if _sha256(image) != digest:
                    errors.append(f"line {line}: image checksum mismatch")
                try:
                    with Image.open(image) as opened:
                        opened.verify()
                except Exception as error:
                    errors.append(f"line {line}: image decode failed: {error}")

        if task == "localizer_positive":
            style = str(row.get("binStyle", "")).strip()
            if not style:
                errors.append(f"line {line}: localizer_positive requires binStyle")
        elif task == "localizer_negative":
            family = str(row.get("negativeFamily", "")).strip()
            if not family:
                errors.append(f"line {line}: localizer_negative requires negativeFamily")
            if not _bool(row.get("binAbsenceVerified")):
                errors.append(f"line {line}: localizer_negative requires binAbsenceVerified=true")
        elif task == "state":
            state = str(row.get("state", "")).strip()
            evidence = str(row.get("stateEvidenceType", "")).strip()
            if state not in {"overflow", "non_overflow", "unknown"}:
                errors.append(f"line {line}: invalid state {state!r}")
            if evidence not in {"mask", "reviewed_crop", "none"}:
                errors.append(f"line {line}: invalid stateEvidenceType {evidence!r}")

        split_by_group[str(row["groupId"])].add(split)
        split_by_sha[digest].add(split)
        source_splits[str(row["sourceId"])].add(split)
        structured_rows.append(row)
        if len(errors) == row_error_start:
            admitted_rows.append(row)

    group_leaks = {group: sorted(splits) for group, splits in split_by_group.items() if len(splits) > 1}
    content_leaks = {digest: sorted(splits) for digest, splits in split_by_sha.items() if len(splits) > 1}
    if group_leaks:
        errors.append(f"capture/source group leakage across splits: {len(group_leaks)} groups")
    if content_leaks:
        errors.append(f"content checksum leakage across splits: {len(content_leaks)} hashes")
    phash_leaks = _near_duplicate_cross_split(structured_rows)
    if phash_leaks:
        errors.append(f"perceptual near-duplicate leakage across splits: {len(phash_leaks)} collisions (capped at 100)")

    positives = [row for row in admitted_rows if row["task"] == "localizer_positive"]
    negatives = [row for row in admitted_rows if row["task"] == "localizer_negative"]
    states = [row for row in admitted_rows if row["task"] == "state"]
    reviewed_styles = [row for row in positives if str(row.get("appearanceReviewStatus", "")) == "reviewed"]
    style_counts = {
        style: len(_unique_hashes(row for row in reviewed_styles if row.get("binStyle") == style))
        for style in STYLE_MINIMUMS
    }
    negative_counts = {
        family: len(_unique_hashes(row for row in negatives if row.get("negativeFamily") == family and _bool(row.get("binAbsenceVerified"))))
        for family in NEGATIVE_FAMILY_MINIMUMS
    }
    reviewed_states = [row for row in states if row["reviewStatus"] == "reviewed" and row.get("stateEvidenceType") in {"mask", "reviewed_crop"}]
    overflow_rows = [row for row in reviewed_states if row.get("state") == "overflow"]
    non_overflow_rows = [row for row in reviewed_states if row.get("state") == "non_overflow"]
    edge_counts = {
        tag: len(_unique_hashes(row for row in non_overflow_rows if tag in set(row.get("edgeTags", []))))
        for tag in EDGE_TAGS
    }
    edge_total = len(_unique_hashes(
        row for row in non_overflow_rows if EDGE_TAGS.intersection(set(row.get("edgeTags", [])))
    ))
    state_groups = {
        state: len({str(row["groupId"]) for row in reviewed_states if row.get("state") == state})
        for state in ("overflow", "non_overflow")
    }
    held_out_sources = sorted(
        source for source, splits in source_splits.items()
        if splits == {"test"} and any(_bool(row.get("completeSourceHoldout")) for row in admitted_rows if row["sourceId"] == source)
    )

    gates: dict[str, Any] = {
        "manifestValidation": {"value": len(errors), "maximum": 0, "passed": not errors},
        "explicitBinPositiveImages": _gate(len(_unique_hashes(positives)), minimum=1200),
        "hardNegativeImages": _gate(len(_unique_hashes(negatives)), minimum=1500),
        "independentPositiveSources": _gate(len({str(row["sourceId"]) for row in positives}), minimum=2),
        "independentNegativeSources": _gate(len({str(row["sourceId"]) for row in negatives}), minimum=2),
        "completeHeldOutSources": _gate(len(held_out_sources), minimum=1),
        "crossSplitContentLeaks": _gate(len(content_leaks), maximum=0),
        "crossSplitGroupLeaks": _gate(len(group_leaks), maximum=0),
        "crossSplitPerceptualLeaks": _gate(len(phash_leaks), maximum=0),
        "overflowEvidenceImages": _gate(len(_unique_hashes(overflow_rows)), minimum=300),
        "nonOverflowEvidenceImages": _gate(len(_unique_hashes(non_overflow_rows)), minimum=600),
        "stateEdgeNegativeImages": _gate(edge_total, minimum=150),
        "overflowCaptureGroups": _gate(state_groups["overflow"], minimum=20),
        "nonOverflowCaptureGroups": _gate(state_groups["non_overflow"], minimum=20),
    }
    gates.update({f"style:{style}": _gate(style_counts[style], minimum=minimum) for style, minimum in STYLE_MINIMUMS.items()})
    gates.update({f"negative:{family}": _gate(negative_counts[family], minimum=minimum) for family, minimum in NEGATIVE_FAMILY_MINIMUMS.items()})
    gates.update({f"edge:{tag}": _gate(edge_counts[tag], minimum=1) for tag in sorted(EDGE_TAGS)})
    ready = bool(rows and not errors and all(gate["passed"] for gate in gates.values()))
    return {
        "schemaVersion": 1,
        "manifest": str(manifest),
        "root": str(root),
        "rows": len(rows),
        "admittedRows": len(admitted_rows),
        "counts": {
            "positiveImages": len(_unique_hashes(positives)),
            "reviewedStyleImages": len(_unique_hashes(reviewed_styles)),
            "hardNegativeImages": len(_unique_hashes(negatives)),
            "style": style_counts,
            "negativeFamily": negative_counts,
            "state": {"overflow": len(_unique_hashes(overflow_rows)), "nonOverflow": len(_unique_hashes(non_overflow_rows))},
            "stateCaptureGroups": state_groups,
            "edge": edge_counts,
            "edgeTotal": edge_total,
            "heldOutSources": held_out_sources,
        },
        "leakage": {
            "content": content_leaks,
            "groups": group_leaks,
            "perceptual": phash_leaks,
        },
        "errors": errors,
        "warnings": warnings,
        "gates": gates,
        "readyForTraining": ready,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()
    try:
        report = audit(args.manifest, args.root)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "counts": report["counts"], "readyForTraining": report["readyForTraining"]}, indent=2))
    return 1 if args.require_ready and not report["readyForTraining"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
