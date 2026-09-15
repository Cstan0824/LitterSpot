"""Event-level qualification and fail-closed readiness scoring.

The qualification manifest owns reviewed ground truth. Candidate predictions
live in a separate file so evaluating a model never mutates the frozen test
set. Only project-owned, reviewed ``real`` evidence can promote a bundle;
public, synthetic, and mock evidence is retained as diagnostic coverage.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


PIPELINES = {"bin_state", "floor_hazard", "occupancy"}
EVIDENCE_TIERS = {"real", "public", "synthetic", "mock"}
BIN_STATES = {"normal", "full", "overflow", "unknown"}
FLOOR_CLASSES = {"floor_litter", "floor_spill"}
SHA256_LENGTH = 64


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve(root: Path, value: str) -> Path:
    candidate = Path(value)
    return candidate if candidate.is_absolute() else root / candidate


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _percentile(values: Iterable[float], percentile: float) -> float | None:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _wilson(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float | None, float | None]:
    if total <= 0:
        return None, None
    rate = successes / total
    denominator = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / denominator
    radius = z * math.sqrt((rate * (1 - rate) + z * z / (4 * total)) / total) / denominator
    return max(0.0, center - radius), min(1.0, center + radius)


def _rate(successes: int, total: int) -> dict[str, Any]:
    lower, upper = _wilson(successes, total)
    return {
        "value": successes / total if total else None,
        "successes": successes,
        "denominator": total,
        "lower95": lower,
        "upper95": upper,
    }


def _scalar(value: float | int | None, sample_count: int = 0) -> dict[str, Any]:
    return {"value": value, "sampleCount": sample_count}


def _source_errors(event: dict[str, Any], prefix: str, root: Path, verify_files: bool) -> list[str]:
    source = event.get("source")
    if not isinstance(source, dict):
        return [f"{prefix}.source must be an object"]
    errors: list[str] = []
    path_value = source.get("path")
    checksum = source.get("sha256")
    if not isinstance(path_value, str) or not path_value.strip():
        errors.append(f"{prefix}.source.path is required")
    if not isinstance(checksum, str) or len(checksum) != SHA256_LENGTH:
        errors.append(f"{prefix}.source.sha256 must be a 64-character checksum")
    elif any(character not in "0123456789abcdefABCDEF" for character in checksum):
        errors.append(f"{prefix}.source.sha256 must be hexadecimal")
    if verify_files and isinstance(path_value, str) and path_value.strip():
        path = _resolve(root, path_value)
        if not path.is_file():
            errors.append(f"{prefix}.source.path does not exist: {path}")
        elif isinstance(checksum, str) and len(checksum) == SHA256_LENGTH and _sha256(path).lower() != checksum.lower():
            errors.append(f"{prefix}.source.sha256 does not match: {path}")
    return errors


def _expected_errors(event: dict[str, Any], prefix: str) -> list[str]:
    expected = event.get("expected")
    if not isinstance(expected, dict):
        return [f"{prefix}.expected must be an object"]
    pipeline = event.get("pipeline")
    if pipeline == "bin_state" and expected.get("state") not in BIN_STATES:
        return [f"{prefix}.expected.state must be one of {sorted(BIN_STATES)}"]
    if pipeline == "floor_hazard":
        classes = expected.get("classes")
        if not isinstance(classes, list) or len(classes) != len(set(classes)) or any(item not in FLOOR_CLASSES for item in classes):
            return [f"{prefix}.expected.classes must be a unique list from {sorted(FLOOR_CLASSES)}"]
    if pipeline == "occupancy":
        count = expected.get("peopleCount")
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 100:
            return [f"{prefix}.expected.peopleCount must be an integer from 0 to 100"]
    return []


def audit_manifest(
    payload: dict[str, Any],
    *,
    root: Path,
    verify_files: bool = True,
    training_capture_groups: set[str] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    events = payload.get("events")
    if payload.get("schemaVersion") != 1:
        errors.append("manifest.schemaVersion must be 1")
    if not isinstance(payload.get("qualificationVersion"), str) or not payload["qualificationVersion"].strip():
        errors.append("manifest.qualificationVersion is required")
    if payload.get("frozen") is not True:
        errors.append("manifest.frozen must be true for qualification")
    if not isinstance(events, list):
        errors.append("manifest.events must be an array")
        events = []

    seen_ids: set[str] = set()
    capture_groups: set[str] = set()
    coverage: dict[str, Counter[str]] = {pipeline: Counter() for pipeline in PIPELINES}
    for index, event in enumerate(events):
        prefix = f"events[{index}]"
        if not isinstance(event, dict):
            errors.append(f"{prefix} must be an object")
            continue
        event_id = event.get("eventId")
        if not isinstance(event_id, str) or not event_id.strip():
            errors.append(f"{prefix}.eventId is required")
        elif event_id in seen_ids:
            errors.append(f"duplicate eventId: {event_id}")
        else:
            seen_ids.add(event_id)
        pipeline = event.get("pipeline")
        if pipeline not in PIPELINES:
            errors.append(f"{prefix}.pipeline must be one of {sorted(PIPELINES)}")
        for field in ("cameraId", "sessionId", "captureGroup"):
            if not isinstance(event.get(field), str) or not event[field].strip():
                errors.append(f"{prefix}.{field} is required")
        capture_group = event.get("captureGroup")
        if isinstance(capture_group, str) and capture_group.strip():
            capture_groups.add(capture_group)
        tier = event.get("evidenceTier")
        if tier not in EVIDENCE_TIERS:
            errors.append(f"{prefix}.evidenceTier must be one of {sorted(EVIDENCE_TIERS)}")
        duration = event.get("durationSeconds")
        if not _is_number(duration) or float(duration) <= 0:
            errors.append(f"{prefix}.durationSeconds must be positive")
        edge_tags = event.get("edgeTags")
        if not isinstance(edge_tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in edge_tags):
            errors.append(f"{prefix}.edgeTags must be a string array")
        review = event.get("review")
        if not isinstance(review, dict) or review.get("status") != "reviewed" or not str(review.get("reviewer", "")).strip():
            errors.append(f"{prefix}.review must have status=reviewed and a reviewer")
        errors.extend(_source_errors(event, prefix, root, verify_files))
        errors.extend(_expected_errors(event, prefix))

        if pipeline in PIPELINES and tier in EVIDENCE_TIERS:
            coverage[pipeline][tier] += 1
            if pipeline == "bin_state":
                coverage[pipeline][f"state:{event.get('expected', {}).get('state')}"] += 1
            elif pipeline == "floor_hazard":
                classes = event.get("expected", {}).get("classes", [])
                coverage[pipeline]["clean" if not classes else "positive"] += 1
                for class_name in classes:
                    coverage[pipeline][f"class:{class_name}"] += 1
            elif pipeline == "occupancy":
                count = event.get("expected", {}).get("peopleCount")
                if isinstance(count, int):
                    coverage[pipeline][f"count:{min(count, 9)}"] += 1

    overlap = capture_groups & (training_capture_groups or set())
    if overlap:
        errors.append(f"qualification capture groups overlap training data: {sorted(overlap)}")
    if not events:
        warnings.append("qualification manifest contains no events; readiness will be not_proven")
    return {
        "passed": not errors,
        "eventCount": len(events),
        "errors": errors,
        "warnings": warnings,
        "coverage": {pipeline: dict(counter) for pipeline, counter in coverage.items()},
    }


def audit_predictions(payload: dict[str, Any], qualification_version: str) -> dict[str, Any]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("predictions.schemaVersion must be 1")
    if payload.get("qualificationVersion") != qualification_version:
        errors.append("predictions.qualificationVersion must match the manifest")
    candidate = payload.get("candidate")
    if not isinstance(candidate, dict) or not str(candidate.get("version", "")).strip():
        errors.append("predictions.candidate.version is required")
    events = payload.get("events")
    if not isinstance(events, list):
        errors.append("predictions.events must be an array")
        events = []
    seen: set[str] = set()
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            errors.append(f"predictions.events[{index}] must be an object")
            continue
        event_id = event.get("eventId")
        if not isinstance(event_id, str) or not event_id.strip():
            errors.append(f"predictions.events[{index}].eventId is required")
        elif event_id in seen:
            errors.append(f"duplicate prediction eventId: {event_id}")
        else:
            seen.add(event_id)
    return {"passed": not errors, "predictionCount": len(events), "errors": errors}


def _prediction_index(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        row["eventId"]: row
        for row in payload.get("events", [])
        if isinstance(row, dict) and isinstance(row.get("eventId"), str)
    }


def _binary_metrics(events: list[dict[str, Any]], predictions: dict[str, dict[str, Any]], fact: str) -> dict[str, Any]:
    tp = fp = fn = 0
    for event in events:
        expected = fact in set(event["expected"].get("classes", []))
        actual = fact in set(predictions.get(event["eventId"], {}).get("actual", {}).get("classes", []))
        tp += int(expected and actual)
        fp += int(not expected and actual)
        fn += int(expected and not actual)
    return {
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "precision": _rate(tp, tp + fp),
        "recall": _rate(tp, tp + fn),
    }


def _per_camera_rate(
    rows: list[tuple[str, bool]],
) -> dict[str, dict[str, Any]]:
    grouped: defaultdict[str, list[bool]] = defaultdict(list)
    for camera_id, success in rows:
        grouped[camera_id].append(success)
    return {camera: _rate(sum(values), len(values)) for camera, values in sorted(grouped.items())}


def compute_metrics(manifest: dict[str, Any], prediction_payload: dict[str, Any]) -> dict[str, Any]:
    predictions = _prediction_index(prediction_payload)
    real_events = [event for event in manifest.get("events", []) if event.get("evidenceTier") == "real"]
    by_pipeline = {
        pipeline: [event for event in real_events if event.get("pipeline") == pipeline]
        for pipeline in PIPELINES
    }
    all_event_ids = {event["eventId"] for event in real_events}
    prediction_coverage = _rate(sum(event_id in predictions for event_id in all_event_ids), len(all_event_ids))

    # Bin-state event metrics.
    bin_events = by_pipeline["bin_state"]
    bin_tp = bin_fp = bin_fn = 0
    full_rows: list[bool] = []
    normal_false: list[bool] = []
    hard_negative_false: list[bool] = []
    unknown_rows: list[bool] = []
    per_camera_overflow: list[tuple[str, bool]] = []
    bin_delays: list[float] = []
    bin_latencies: list[float] = []
    bin_duplicate_count = bin_positive_predictions = 0
    for event in bin_events:
        expected_state = event["expected"]["state"]
        prediction = predictions.get(event["eventId"], {})
        actual = prediction.get("actual", {})
        actual_state = actual.get("state", "unknown")
        expected_positive = expected_state == "overflow"
        actual_positive = actual_state == "overflow"
        bin_tp += int(expected_positive and actual_positive)
        bin_fp += int(not expected_positive and actual_positive)
        bin_fn += int(expected_positive and not actual_positive)
        if expected_state == "full":
            full_rows.append(actual_state == "full")
        if expected_state == "normal":
            normal_false.append(actual_positive)
        tags = set(event.get("edgeTags", []))
        if {"staged_bags", "object_on_lid"} & tags:
            hard_negative_false.append(actual_positive)
        if expected_state == "unknown" or {"missing_bin", "heavy_occlusion"} & tags:
            unknown_rows.append(actual_state == "unknown")
        if expected_positive:
            per_camera_overflow.append((event["cameraId"], actual_positive))
        if expected_positive and actual_positive and _is_number(actual.get("confirmationDelaySeconds")):
            bin_delays.append(float(actual["confirmationDelaySeconds"]))
        if _is_number(prediction.get("latencyMs")):
            bin_latencies.append(float(prediction["latencyMs"]))
        incident_ids = actual.get("incidentIds", [])
        if actual_positive:
            bin_positive_predictions += 1
            if isinstance(incident_ids, list):
                bin_duplicate_count += max(0, len(set(incident_ids)) - 1)

    bin_metrics = {
        "eventCount": len(bin_events),
        "overflow": {
            "precision": _rate(bin_tp, bin_tp + bin_fp),
            "recall": _rate(bin_tp, bin_tp + bin_fn),
            "perCameraRecall": _per_camera_rate(per_camera_overflow),
        },
        "containedFullRecall": _rate(sum(full_rows), len(full_rows)),
        "normalFalseOverflow": _rate(sum(normal_false), len(normal_false)),
        "hardNegativeFalseOverflow": _rate(sum(hard_negative_false), len(hard_negative_false)),
        "unknownSafety": _rate(sum(unknown_rows), len(unknown_rows)),
        "confirmationDelayMedianSeconds": _scalar(statistics.median(bin_delays) if bin_delays else None, len(bin_delays)),
        "duplicateIncidentRate": _rate(bin_duplicate_count, bin_positive_predictions + bin_duplicate_count),
        "latencyP95Ms": _scalar(_percentile(bin_latencies, 0.95), len(bin_latencies)),
    }

    # Floor hazard event metrics.
    floor_events = by_pipeline["floor_hazard"]
    floor_metrics: dict[str, Any] = {"eventCount": len(floor_events)}
    floor_metrics["spill"] = _binary_metrics(floor_events, predictions, "floor_spill")
    floor_metrics["litter"] = _binary_metrics(floor_events, predictions, "floor_litter")
    clean_rows: list[bool] = []
    hard_negative_rows: defaultdict[str, list[bool]] = defaultdict(list)
    small_rows: list[bool] = []
    floor_camera_rows: dict[str, list[tuple[str, bool]]] = {class_name: [] for class_name in FLOOR_CLASSES}
    floor_latencies: list[float] = []
    floor_delays: list[float] = []
    floor_duplicate_count = floor_positive_predictions = 0
    negative_seconds = 0.0
    for event in floor_events:
        expected_classes = set(event["expected"].get("classes", []))
        prediction = predictions.get(event["eventId"], {})
        actual = prediction.get("actual", {})
        actual_classes = set(actual.get("classes", []))
        tags = set(event.get("edgeTags", []))
        if not expected_classes:
            false_positive = bool(actual_classes)
            clean_rows.append(false_positive)
            negative_seconds += float(event["durationSeconds"])
            for tag in tags:
                if tag.startswith("hard_negative_"):
                    hard_negative_rows[tag].append(false_positive)
        if "small_object" in tags and expected_classes:
            small_rows.append(bool(expected_classes & actual_classes))
        for class_name in FLOOR_CLASSES:
            if class_name in expected_classes:
                floor_camera_rows[class_name].append((event["cameraId"], class_name in actual_classes))
        if expected_classes & actual_classes and _is_number(actual.get("confirmationDelaySeconds")):
            floor_delays.append(float(actual["confirmationDelaySeconds"]))
        if _is_number(prediction.get("latencyMs")):
            floor_latencies.append(float(prediction["latencyMs"]))
        incident_ids = actual.get("incidentIds", [])
        if actual_classes:
            floor_positive_predictions += 1
            if isinstance(incident_ids, list):
                floor_duplicate_count += max(0, len(set(incident_ids)) - 1)
    false_clean_count = sum(clean_rows)
    negative_hours = negative_seconds / 3600
    floor_metrics.update({
        "cleanFalseEvent": _rate(false_clean_count, len(clean_rows)),
        "cleanFalseEventsPerCameraHour": {
            "value": false_clean_count / negative_hours if negative_hours else None,
            "errorCount": false_clean_count,
            "cameraHours": negative_hours,
            "upper95Conservative": (false_clean_count + 3) / negative_hours if negative_hours else None,
        },
        "hardNegativeFalseEvent": {
            tag: _rate(sum(values), len(values)) for tag, values in sorted(hard_negative_rows.items())
        },
        "smallObjectRecall": _rate(sum(small_rows), len(small_rows)),
        "perCameraRecall": {
            class_name: _per_camera_rate(rows) for class_name, rows in floor_camera_rows.items()
        },
        "confirmationDelayMedianSeconds": _scalar(statistics.median(floor_delays) if floor_delays else None, len(floor_delays)),
        "duplicateIncidentRate": _rate(floor_duplicate_count, floor_positive_predictions + floor_duplicate_count),
        "latencyP95Ms": _scalar(_percentile(floor_latencies, 0.95), len(floor_latencies)),
    })

    # Occupancy metrics.
    occupancy_events = by_pipeline["occupancy"]
    occupancy_within: list[bool] = []
    occupancy_errors: list[float] = []
    empty_false: list[bool] = []
    per_camera_occupancy: list[tuple[str, bool]] = []
    occupancy_latencies: list[float] = []
    stable_groups: defaultdict[tuple[str, str], list[tuple[float, int]]] = defaultdict(list)
    for event in occupancy_events:
        expected_count = event["expected"]["peopleCount"]
        prediction = predictions.get(event["eventId"], {})
        actual = prediction.get("actual", {})
        actual_count = actual.get("peopleCount")
        valid_count = isinstance(actual_count, int) and not isinstance(actual_count, bool)
        difference = abs(actual_count - expected_count) if valid_count else max(2, expected_count)
        within = valid_count and difference <= 1
        occupancy_within.append(within)
        occupancy_errors.append(float(difference))
        per_camera_occupancy.append((event["cameraId"], within))
        if expected_count == 0:
            empty_false.append(not valid_count or actual_count > 0)
        if _is_number(prediction.get("latencyMs")):
            occupancy_latencies.append(float(prediction["latencyMs"]))
        if "stable_scene" in set(event.get("edgeTags", [])) and valid_count and _is_number(event.get("timestampSeconds")):
            stable_groups[(event["cameraId"], event["sessionId"])].append((float(event["timestampSeconds"]), actual_count))
    jitter_values: list[float] = []
    for samples in stable_groups.values():
        samples.sort()
        if len(samples) >= 2 and samples[-1][0] - samples[0][0] >= 60:
            jitter_values.append(statistics.pstdev(count for _, count in samples))
    occupancy_metrics = {
        "eventCount": len(occupancy_events),
        "withinOne": _rate(sum(occupancy_within), len(occupancy_within)),
        "meanAbsoluteError": _scalar(statistics.fmean(occupancy_errors) if occupancy_errors else None, len(occupancy_errors)),
        "emptyFalseCount": _rate(sum(empty_false), len(empty_false)),
        "perCameraWithinOne": _per_camera_rate(per_camera_occupancy),
        "stableSceneJitterMax": _scalar(max(jitter_values) if jitter_values else None, len(jitter_values)),
        "latencyP95Ms": _scalar(_percentile(occupancy_latencies, 0.95), len(occupancy_latencies)),
    }

    runtime = prediction_payload.get("runtime", {}) if isinstance(prediction_payload.get("runtime"), dict) else {}
    shadow = prediction_payload.get("shadow", {}) if isinstance(prediction_payload.get("shadow"), dict) else {}
    false_eligible = shadow.get("falseEligibleEvents") if isinstance(shadow.get("falseEligibleEvents"), int) else None
    camera_hours = float(shadow["cameraHours"]) if _is_number(shadow.get("cameraHours")) else None
    shadow_rate = {
        "value": false_eligible / camera_hours if false_eligible is not None and camera_hours else None,
        "errorCount": false_eligible,
        "cameraHours": camera_hours,
        "upper95Conservative": (false_eligible + 3) / camera_hours if false_eligible is not None and camera_hours else None,
    }
    integrated = {
        "predictionCoverage": prediction_coverage,
        "completeCycleP95Ms": _scalar(runtime.get("completeCycleP95Ms"), int(runtime.get("cycleCount", 0) or 0)),
        "peakGpuMemoryGiB": _scalar(runtime.get("peakGpuMemoryGiB"), int(runtime.get("cycleCount", 0) or 0)),
        "cudaCrashes": _scalar(runtime.get("cudaCrashes"), int(runtime.get("cycleCount", 0) or 0)),
        "schemaInvalidObservations": _scalar(runtime.get("schemaInvalidObservations"), int(runtime.get("cycleCount", 0) or 0)),
        "unsafeEligibleEvents": _scalar(runtime.get("unsafeEligibleEvents"), int(runtime.get("cycleCount", 0) or 0)),
        "crossTargetMixes": _scalar(runtime.get("crossTargetMixes"), int(runtime.get("cycleCount", 0) or 0)),
        "shadow": {
            "falseEligibleEventsPerCameraHour": shadow_rate,
            "consecutiveDays": _scalar(shadow.get("consecutiveDays"), int(shadow.get("reviewedEventCount", 0) or 0)),
            "minimumPerCameraHours": _scalar(
                min(shadow.get("perCameraHours", {}).values()) if isinstance(shadow.get("perCameraHours"), dict) and shadow["perCameraHours"] else None,
                len(shadow.get("perCameraHours", {})) if isinstance(shadow.get("perCameraHours"), dict) else 0,
            ),
        },
        "consecutivePassingReleases": _scalar(prediction_payload.get("consecutivePassingReleases"), 1),
    }
    return {
        "realEventCount": len(real_events),
        "diagnosticEventCount": len(manifest.get("events", [])) - len(real_events),
        "bin_state": bin_metrics,
        "floor_hazard": floor_metrics,
        "occupancy": occupancy_metrics,
        "integrated": integrated,
    }


def _get_path(payload: dict[str, Any], path: str) -> Any:
    value: Any = payload
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def evaluate_gates(metrics: dict[str, Any], gates: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for gate in gates.get("gates", []):
        metric = _get_path(metrics, gate["metric"])
        operator = gate["operator"]
        observed = None
        evidence_count = 0
        status = "not_proven"
        if isinstance(metric, dict):
            if operator == "min_lower_bound":
                observed = metric.get("lower95")
                evidence_count = int(metric.get("denominator", 0) or 0)
                if evidence_count >= gate.get("minEvidence", 0) and observed is not None:
                    status = "passed" if observed >= gate["threshold"] else "failed"
            elif operator == "max_upper_bound":
                observed = metric.get("upper95")
                evidence_count = int(metric.get("denominator", 0) or 0)
                if evidence_count >= gate.get("minEvidence", 0) and observed is not None:
                    status = "passed" if observed <= gate["threshold"] else "failed"
            elif operator in {"min", "max", "equals"}:
                observed = metric.get("value")
                evidence_count = int(metric.get("sampleCount", metric.get("denominator", 0)) or 0)
                if evidence_count >= gate.get("minEvidence", 0) and observed is not None:
                    if operator == "min":
                        status = "passed" if observed >= gate["threshold"] else "failed"
                    elif operator == "max":
                        status = "passed" if observed <= gate["threshold"] else "failed"
                    else:
                        status = "passed" if observed == gate["threshold"] else "failed"
            elif operator == "max_conservative_rate":
                observed = metric.get("upper95Conservative")
                evidence_count = int(metric.get("cameraHours", 0) or 0)
                if evidence_count >= gate.get("minEvidence", 0) and observed is not None:
                    status = "passed" if observed <= gate["threshold"] else "failed"
            elif operator in {"min_each_lower_bound", "max_each_upper_bound"}:
                child_values = [value for value in metric.values() if isinstance(value, dict)]
                evidence_counts = [int(value.get("denominator", 0) or 0) for value in child_values]
                bound_name = "lower95" if operator == "min_each_lower_bound" else "upper95"
                bounds = [value.get(bound_name) for value in child_values]
                evidence_count = min(evidence_counts) if evidence_counts else 0
                if child_values and evidence_count >= gate.get("minEvidence", 0) and all(value is not None for value in bounds):
                    observed = min(bounds) if operator == "min_each_lower_bound" else max(bounds)
                    if operator == "min_each_lower_bound":
                        status = "passed" if observed >= gate["threshold"] else "failed"
                    else:
                        status = "passed" if observed <= gate["threshold"] else "failed"
        results.append({
            "id": gate["id"],
            "module": gate["module"],
            "metric": gate["metric"],
            "operator": operator,
            "threshold": gate["threshold"],
            "minEvidence": gate.get("minEvidence", 0),
            "observed": observed,
            "evidenceCount": evidence_count,
            "status": status,
        })
    return results


def qualify(
    manifest: dict[str, Any],
    predictions: dict[str, Any],
    gates: dict[str, Any],
    *,
    root: Path,
    verify_files: bool = True,
    training_capture_groups: set[str] | None = None,
) -> dict[str, Any]:
    manifest_audit = audit_manifest(
        manifest,
        root=root,
        verify_files=verify_files,
        training_capture_groups=training_capture_groups,
    )
    prediction_audit = audit_predictions(predictions, str(manifest.get("qualificationVersion", "")))
    metrics = compute_metrics(manifest, predictions) if manifest_audit["passed"] and prediction_audit["passed"] else {}
    gate_results = evaluate_gates(metrics, gates) if metrics else []
    failed = [gate["id"] for gate in gate_results if gate["status"] == "failed"]
    not_proven = [gate["id"] for gate in gate_results if gate["status"] == "not_proven"]
    all_passed = bool(gate_results) and not failed and not not_proven
    if all_passed and manifest_audit["passed"] and prediction_audit["passed"]:
        status = "detection_ready"
    elif gate_results and all(gate["status"] == "passed" for gate in gate_results if not gate["id"].startswith("integrated.shadow")):
        status = "shadow_only"
    else:
        status = "not_ready"
    return {
        "schemaVersion": 1,
        "qualificationVersion": manifest.get("qualificationVersion"),
        "candidate": predictions.get("candidate", {}),
        "status": status,
        "dispatchEligibleOutputEnabled": status == "detection_ready",
        "taskDispatchImplemented": False,
        "manifestAudit": manifest_audit,
        "predictionAudit": prediction_audit,
        "metrics": metrics,
        "gates": gate_results,
        "failedGates": failed,
        "notProvenGates": not_proven,
    }


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return payload
