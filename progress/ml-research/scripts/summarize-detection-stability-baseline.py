"""Normalize current diagnostic reports without treating them as qualification."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = {
    "bin": ROOT / "artifacts/detection-stability/current/diagnostics/bin-multi-angle.json",
    "binHybridWhatsapp": ROOT / "artifacts/detection-stability/current/diagnostics/bin-hybrid-whatsapp.json",
    "binHybridOcclusion": ROOT / "artifacts/detection-stability/current/diagnostics/bin-hybrid-occluded-full-vote.json",
    "floor": ROOT / "artifacts/detection-stability/current/diagnostics/floor-taco.json",
    "occupancyStill": ROOT / "artifacts/detection-stability/current/diagnostics/occupancy/results.json",
    "occupancyVideo": ROOT / "artifacts/detection-stability/current/diagnostics/occupancy-video-postprocess-v2/results.json",
}


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"report root must be an object: {path}")
    return payload


def _source(path: Path) -> dict[str, Any]:
    return {
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def summarize(sources: dict[str, Path]) -> dict[str, Any]:
    missing = [str(path) for path in sources.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing diagnostic reports: {missing}")
    bin_report = _load(sources["bin"])
    bin_hybrid = _load(sources["binHybridWhatsapp"])
    bin_occlusion = _load(sources["binHybridOcclusion"])
    floor_report = _load(sources["floor"])
    occupancy_still = _load(sources["occupancyStill"])
    occupancy_video = _load(sources["occupancyVideo"])
    bin_latency = bin_report.get("latency", {}).get("8", {})
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "diagnostic_baseline_only",
        "qualificationEligible": False,
        "dispatchEligibleOutputEnabled": False,
        "sources": {name: _source(path) for name, path in sources.items()},
        "bin_state": {
            "evidenceTier": "synthetic_and_weak_public",
            "sampleCount": bin_report.get("sampleCount"),
            "syntheticMacroF1": bin_report.get("perKind", {}).get("synthetic_variant", {}).get("metrics", {}).get("macroF1"),
            "weakPublicMacroF1": bin_report.get("perKind", {}).get("weak_base", {}).get("metrics", {}).get("macroF1"),
            "overflowPrecision": bin_report.get("taskMetrics", {}).get("overflow", {}).get("precision"),
            "overflowRecall": bin_report.get("taskMetrics", {}).get("overflow", {}).get("recall"),
            "batch8P95Ms": bin_latency.get("p95Ms"),
            "lockedOverflowEventRecall": bin_hybrid.get("metrics", {}).get("overflowEventRecallConfirmed"),
            "lockedStillAccuracy": bin_hybrid.get("metrics", {}).get("stillStrictAccuracy"),
            "lockedNormalFalseOverflow": bin_hybrid.get("metrics", {}).get("normalStillFalseOverflow"),
            "semanticP95MsPerRoi": bin_hybrid.get("metrics", {}).get("semanticP95LatencyMs"),
            "occludedFullFalseOverflowConfirmed": bin_occlusion.get("falseOverflowConfirmed"),
            "blocker": "No reviewed installed-camera event holdout; synthetic performance cannot prove dispatch stability.",
        },
        "floor_hazard": {
            "evidenceTier": "public_litter_only",
            "maskPrecision": floor_report.get("mask", {}).get("precision"),
            "maskRecall": floor_report.get("mask", {}).get("recall"),
            "maskMap50": floor_report.get("mask", {}).get("map50"),
            "spillMetric": None,
            "blocker": "Litter recall is below gate and the checkpoint has no verified spill training/evaluation examples.",
        },
        "occupancy": {
            "evidenceTier": "locked_mock_with_provisional_review",
            "stillCaseCount": occupancy_still.get("summary", {}).get("caseCount"),
            "stillWithinOneRate": occupancy_still.get("summary", {}).get("withinToleranceRate"),
            "stillExactRangeRate": occupancy_still.get("summary", {}).get("withinExpectedRangeRate"),
            "stillMeanRangeError": occupancy_still.get("summary", {}).get("meanRangeError"),
            "stillEmptyFalseCases": occupancy_still.get("summary", {}).get("zeroPersonFalsePositiveCases"),
            "stillEmptyCaseCount": occupancy_still.get("summary", {}).get("zeroPersonCaseCount"),
            "stillP95Ms": occupancy_still.get("summary", {}).get("latencyMs", {}).get("p95"),
            "videoCaseCount": occupancy_video.get("summary", {}).get("caseCount"),
            "videoWithinOneRate": occupancy_video.get("summary", {}).get("withinToleranceRate"),
            "videoEmptyFalseCases": occupancy_video.get("summary", {}).get("zeroPersonFalsePositiveCases"),
            "videoEmptyCaseCount": occupancy_video.get("summary", {}).get("zeroPersonCaseCount"),
            "videoP95Ms": occupancy_video.get("summary", {}).get("latencyMs", {}).get("p95"),
            "blocker": "The point estimate passes, but labels remain provisional and count-band/camera/empty-frame evidence is below the qualification minimum.",
        },
        "failurePriority": [
            "floor_spill_missing_evidence",
            "floor_litter_low_recall",
            "bin_state_missing_real_event_evidence",
            "occupancy_real_camera_count_band_and_empty_frame_coverage",
        ],
    }


def _markdown(report: dict[str, Any]) -> str:
    bin_state = report["bin_state"]
    floor = report["floor_hazard"]
    occupancy = report["occupancy"]
    return "\n".join([
        "# Current detection stability diagnostic baseline",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "This report is diagnostic only. It cannot enable downstream dispatch eligibility.",
        "",
        "| Pipeline | Current evidence | Actual result | Qualification blocker |",
        "|---|---|---|---|",
        f"| Bin state | {bin_state['evidenceTier']} | synthetic macro-F1 {bin_state['syntheticMacroF1']:.3f}; locked hybrid overflow-event recall {bin_state['lockedOverflowEventRecall']:.3f}; still accuracy {bin_state['lockedStillAccuracy']:.3f}; semantic p95 {bin_state['semanticP95MsPerRoi']:.1f} ms/ROI | {bin_state['blocker']} |",
        f"| Floor hazard | {floor['evidenceTier']} | litter mask P/R {floor['maskPrecision']:.3f}/{floor['maskRecall']:.3f}; spill metric missing | {floor['blocker']} |",
        f"| Occupancy | {occupancy['evidenceTier']} | still within +/-1 {occupancy['stillWithinOneRate']:.3f}; video within +/-1 {occupancy['videoWithinOneRate']:.3f} | {occupancy['blocker']} |",
        "",
        "## Failure priority",
        "",
        *[f"{index}. `{failure}`" for index, failure in enumerate(report["failurePriority"], start=1)],
        "",
        "Status: **NOT READY**; `dispatchEligibleOutputEnabled=false`.",
        "",
    ])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/detection-stability/current")
    args = parser.parse_args()
    report = summarize(DEFAULT_SOURCES)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "diagnostic-baseline.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (args.output / "diagnostic-baseline.md").write_text(_markdown(report), encoding="utf-8")
    print(json.dumps({
        "qualificationEligible": report["qualificationEligible"],
        "dispatchEligibleOutputEnabled": report["dispatchEligibleOutputEnabled"],
        "failurePriority": report["failurePriority"],
        "output": str(args.output.resolve()),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
