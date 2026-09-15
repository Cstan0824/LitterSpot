"""Evaluate a candidate against the frozen detection qualification contract."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from detection_stability import load_json, qualify


ROOT = Path(__file__).resolve().parents[1]


def _training_groups(path: Path | None) -> set[str]:
    if path is None or not path.is_file():
        return set()
    payload = load_json(path)
    return {
        row["captureGroup"]
        for row in payload.get("samples", [])
        if isinstance(row, dict) and isinstance(row.get("captureGroup"), str)
    }


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Detection stability qualification",
        "",
        f"Generated: `{datetime.now(timezone.utc).isoformat()}`",
        f"Candidate: `{report.get('candidate', {}).get('version', 'unknown')}`",
        f"Status: **{report['status'].upper()}**",
        f"Dispatch-eligible output: **{'ENABLED' if report['dispatchEligibleOutputEnabled'] else 'DISABLED'}**",
        "",
        "| Gate | Module | Observed | Required | Evidence | Status |",
        "|---|---|---:|---:|---:|---|",
    ]
    for gate in report.get("gates", []):
        observed = "missing" if gate["observed"] is None else f"{gate['observed']:.6g}"
        lines.append(
            f"| `{gate['id']}` | `{gate['module']}` | {observed} | "
            f"{gate['operator']} {gate['threshold']} | {gate['evidenceCount']} / {gate['minEvidence']} | "
            f"**{gate['status'].upper()}** |"
        )
    lines.extend(["", "## Audit", ""])
    for name in ("manifestAudit", "predictionAudit"):
        audit = report.get(name, {})
        lines.append(f"- `{name}`: **{'PASS' if audit.get('passed') else 'FAIL'}**")
        lines.extend(f"  - {error}" for error in audit.get("errors", []))
    if report.get("notProvenGates"):
        lines.extend(["", "## Missing evidence", ""])
        lines.extend(f"- `{gate}`" for gate in report["notProvenGates"])
    if report.get("failedGates"):
        lines.extend(["", "## Failed gates", ""])
        lines.extend(f"- `{gate}`" for gate in report["failedGates"])
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/qualification/detection-stability-v1.json")
    parser.add_argument("--predictions", type=Path, default=ROOT / "artifacts/detection-stability/current/predictions.json")
    parser.add_argument("--gates", type=Path, default=ROOT / "config/detection-stability-gates.json")
    parser.add_argument("--training-manifest", type=Path, default=ROOT / "ml-training/data/specialists/manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/detection-stability/current")
    parser.add_argument("--skip-file-checks", action="store_true", help="Test templates only; never use for promotion")
    parser.add_argument("--strict", action="store_true", help="Exit 1 unless status is detection_ready")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = load_json(args.manifest)
    predictions = load_json(args.predictions)
    gates = load_json(args.gates)
    report = qualify(
        manifest,
        predictions,
        gates,
        root=ROOT,
        verify_files=not args.skip_file_checks,
        training_capture_groups=_training_groups(args.training_manifest),
    )
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "readiness.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (args.output / "readiness.md").write_text(_markdown(report), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "dispatchEligibleOutputEnabled": report["dispatchEligibleOutputEnabled"],
        "failedGates": len(report["failedGates"]),
        "notProvenGates": len(report["notProvenGates"]),
        "output": str(args.output.resolve()),
    }, indent=2))
    return 1 if args.strict and report["status"] != "detection_ready" else 0


if __name__ == "__main__":
    raise SystemExit(main())
