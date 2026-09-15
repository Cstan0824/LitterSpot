"""Produce one fail-closed readiness report for all three detection facts."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from detection_stability import load_json, qualify


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "ml-training/data/specialists/manifest.json"
DEFAULT_BIN_CHECKPOINT = ROOT / "runs/state_classifier/multitask_bin_state/production.pt"
DEFAULT_FLOOR_CHECKPOINT = ROOT / "ml-training/floor_rubbish/runs/theme_park_hazards/yolo11n_seg_floor_v1/weights/best.pt"
DEFAULT_OCCUPANCY_CHECKPOINT = ROOT / "models/production/occupancy_yolo11n.pt"
DEFAULT_FLOOR_DATA = ROOT / "dataset/floor_rubbish/prepared_dataset/data.yaml"
DEFAULT_PROFILES = ROOT / "config/bin-profiles.json"
DEFAULT_QUALIFICATION_MANIFEST = ROOT / "data/qualification/detection-stability-v1.json"
DEFAULT_QUALIFICATION_PREDICTIONS = ROOT / "artifacts/detection-stability/current/predictions.json"
DEFAULT_STABILITY_GATES = ROOT / "config/detection-stability-gates.json"


def _load_audit():
    source = ROOT / "scripts/audit-specialist-training-data.py"
    spec = importlib.util.spec_from_file_location("audit_specialist_training_data", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.audit


def _configured_path(env_name: str, fallback: Path) -> Path:
    value = os.getenv(env_name)
    return Path(value).resolve() if value else fallback.resolve()


def _profile_count(path: Path) -> int:
    if not path.is_file():
        return 0
    try:
        profiles = json.loads(path.read_text(encoding="utf-8")).get("profiles", {})
        return len(profiles) if isinstance(profiles, dict) else 0
    except (OSError, json.JSONDecodeError):
        return 0


def _module(
    name: str,
    expected: str,
    checkpoint: Path,
    *,
    training_ready: bool,
    extra_checks: dict[str, bool] | None = None,
) -> dict[str, Any]:
    checks = {
        "runtimeAdapterImplemented": True,
        "trainingDataGatePassed": training_ready,
        "checkpointAvailable": checkpoint.is_file(),
        **(extra_checks or {}),
    }
    ready = all(checks.values())
    blockers = [key for key, passed in checks.items() if not passed]
    return {
        "name": name,
        "expectedOutput": expected,
        "actualStatus": "ready" if ready else "not_ready",
        "checkpoint": str(checkpoint),
        "checks": checks,
        "blockers": blockers,
    }


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Specialist detection readiness review",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "| Detection fact | Expected result | Actual result | Checkpoint | Blockers |",
        "|---|---|---|:---:|---|",
    ]
    for module in report["modules"]:
        lines.append(
            f"| {module['name']} | {module['expectedOutput']} | `{module['actualStatus']}` | "
            f"{'yes' if module['checks']['checkpointAvailable'] else 'no'} | "
            f"{', '.join(module['blockers']) or 'none'} |"
        )
    lines.extend([
        "",
        "## Per-module training-data gates",
        "",
        "| Pipeline | Rows | Valid | Pilot gate | Errors |",
        "|---|---:|---:|:---:|---:|",
    ])
    for name, audit in report["trainingDataAudits"].items():
        lines.append(
            f"| {name} | {audit['rows']} | {audit['validRows']} | "
            f"{'PASS' if audit['passed'] else 'BLOCKED'} | {len(audit['errors'])} |"
        )
    lines.extend([
        "",
        "## Event-level stability qualification",
        "",
        f"Status: **{report['qualification']['status'].upper()}**",
        f"Dispatch-eligible output: **{'ENABLED' if report['qualification']['dispatchEligibleOutputEnabled'] else 'DISABLED'}**",
        f"Failed gates: `{len(report['qualification']['failedGates'])}`; not proven: `{len(report['qualification']['notProvenGates'])}`",
        "",
        "## Overall",
        "",
        f"Complete three-fact specialist backend: **{'READY' if report['completeBackendReady'] else 'NOT READY'}**",
    ])
    return "\n".join(lines) + "\n"


def review(manifest: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    audit_fn = _load_audit()
    audits = {
        pipeline: audit_fn(manifest.resolve(), ROOT, "pilot", pipeline=pipeline)
        for pipeline in ("bin_state", "floor_hazard")
    }
    profiles = _configured_path("BIN_PROFILE_PATH", DEFAULT_PROFILES)
    floor_data = DEFAULT_FLOOR_DATA.resolve()
    modules = [
        _module(
            "bin_state",
            "one result per registered bin: normal/full/overflow/unknown",
            _configured_path("STATE_CLASSIFIER_PATH", DEFAULT_BIN_CHECKPOINT),
            training_ready=audits["bin_state"]["passed"],
            extra_checks={"calibratedBinProfileAvailable": _profile_count(profiles) > 0},
        ),
        _module(
            "floor_hazard",
            "clean or polygon detections for floor_litter/floor_spill",
            _configured_path("FLOOR_HAZARD_PATH", DEFAULT_FLOOR_CHECKPOINT),
            training_ready=audits["floor_hazard"]["passed"],
            extra_checks={"preparedFloorDatasetAvailable": floor_data.is_file()},
        ),
        _module(
            "occupancy",
            "visible-person count plus person boxes inside occupancyRegion",
            _configured_path("OCCUPANCY_MODEL_PATH", DEFAULT_OCCUPANCY_CHECKPOINT),
            training_ready=True,
        ),
    ]
    training_groups: set[str] = set()
    if manifest.is_file():
        try:
            training_payload = json.loads(manifest.read_text(encoding="utf-8"))
            training_groups = {
                row["captureGroup"]
                for row in training_payload.get("samples", [])
                if isinstance(row, dict) and isinstance(row.get("captureGroup"), str)
            }
        except (OSError, json.JSONDecodeError):
            training_groups = set()
    qualification = qualify(
        load_json(DEFAULT_QUALIFICATION_MANIFEST),
        load_json(DEFAULT_QUALIFICATION_PREDICTIONS),
        load_json(DEFAULT_STABILITY_GATES),
        root=ROOT,
        training_capture_groups=training_groups,
    )
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainingManifest": str(manifest.resolve()),
        "trainingDataAudits": audits,
        "binProfilePath": str(profiles),
        "binProfileCount": _profile_count(profiles),
        "floorDataYaml": str(floor_data),
        "modules": modules,
        "qualification": qualification,
        "completeBackendReady": (
            all(module["actualStatus"] == "ready" for module in modules)
            and qualification["status"] == "detection_ready"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/specialist-readiness")
    parser.add_argument("--strict", action="store_true", help="Return exit code 1 while the complete backend is not ready")
    args = parser.parse_args()
    report = review(args.manifest)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (output / "report.md").write_text(_markdown(report), encoding="utf-8")
    print(json.dumps({
        "completeBackendReady": report["completeBackendReady"],
        "modules": {module["name"]: module["actualStatus"] for module in report["modules"]},
        "trainingRows": {name: audit["rows"] for name, audit in report["trainingDataAudits"].items()},
        "trainingErrors": {name: len(audit["errors"]) for name, audit in report["trainingDataAudits"].items()},
        "output": str(output),
    }, indent=2))
    return 1 if args.strict and not report["completeBackendReady"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
