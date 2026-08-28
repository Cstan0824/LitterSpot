"""Audit mock coverage without counting image transformations as new scenes."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = PROJECT_ROOT / "mock-data" / "coverage" / "coverage-targets.json"
DEFAULT_BASE = PROJECT_ROOT / "mock-data" / "coverage" / "base-scenarios.json"
DEFAULT_PUBLIC = PROJECT_ROOT / "mock-data" / "public-domain" / "manifest.json"
DEFAULT_DERIVED = PROJECT_ROOT / "mock-data" / "edge-cases" / "manifest.json"
DEFAULT_REPORT = PROJECT_ROOT / "artifacts" / "mock-coverage" / "coverage-report.md"


def read_items(path: Path, key: str) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get(key, [])


def resolve_asset_path(item: dict[str, Any], manifest_path: Path) -> Path | None:
    value = item.get("path")
    if not value:
        return None
    candidates = [(manifest_path.parent / value).resolve(), (PROJECT_ROOT / value).resolve()]
    return next((candidate for candidate in candidates if candidate.is_file()), candidates[-1])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def integrity_issues(groups: list[tuple[Path, list[dict[str, Any]]]]) -> list[str]:
    issues: list[str] = []
    for manifest_path, items in groups:
        for item in items:
            path = resolve_asset_path(item, manifest_path)
            if path is None:
                issues.append(f"{item.get('sceneId', 'unknown')}: missing path field")
                continue
            if not path.is_file():
                issues.append(f"{item.get('sceneId', 'unknown')}: file not found: {path}")
                continue
            expected_hash = item.get("sha256")
            if expected_hash and sha256(path) != expected_hash:
                issues.append(f"{item.get('sceneId', 'unknown')}: SHA-256 mismatch: {path}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, default=DEFAULT_TARGETS)
    parser.add_argument("--base", type=Path, default=DEFAULT_BASE)
    parser.add_argument("--public", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--derived", type=Path, default=DEFAULT_DERIVED)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    targets = json.loads(args.targets.read_text(encoding="utf-8"))
    base = read_items(args.base, "assets")
    public = read_items(args.public, "items")
    derived = read_items(args.derived, "assets")
    issues = integrity_issues([(args.base, base), (args.public, public), (args.derived, derived)])
    independent: dict[str, set[str]] = defaultdict(set)
    variants: dict[str, int] = defaultdict(int)
    for item in [*base, *public]:
        for scenario in item.get("scenarios", []):
            independent[scenario].add(item["sceneId"])
    for item in derived:
        for scenario in item.get("scenarios", []):
            variants[scenario] += 1

    smoke_target = targets["policy"]["smokeTargetPerScenario"]
    prototype_target = targets["policy"]["prototypeTargetPerScenario"]
    rows: list[str] = []
    missing_must: list[str] = []
    for target in targets["scenarios"]:
        scenario = target["id"]
        unique_count = len(independent[scenario])
        coverage_basis = "derived variants" if target["pipeline"] == "cross_cutting" else "independent scenes"
        effective_count = variants[scenario] if target["pipeline"] == "cross_cutting" else unique_count
        status = "prototype" if effective_count >= prototype_target else "smoke" if effective_count >= smoke_target else "gap"
        if status == "gap" and target["priority"] == "must":
            missing_must.append(scenario)
        rows.append(
            f"| {target['pipeline']} | {scenario} | {target['priority']} | {unique_count} | {variants[scenario]} | {coverage_basis} | {status} |"
        )

    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = "\n".join(
        [
            "# Mock-data coverage audit",
            "",
            f"Independent scenes: **{len({item['sceneId'] for item in [*base, *public]})}**  ",
            f"Derived robustness variants: **{len(derived)}**  ",
            f"Required scenarios still below smoke coverage: **{len(missing_must)}**",
            f"Asset integrity issues: **{len(issues)}**",
            "",
            "Derived variants are shown separately. They satisfy cross-cutting robustness targets only; they never satisfy semantic independent-scene targets.",
            "",
            "| Pipeline | Scenario | Priority | Independent scenes | Derived variants | Coverage basis | Status |",
            "|---|---|---|---:|---:|---|---|",
            *rows,
            "",
            "## Remaining required gaps",
            "",
            *(f"- `{scenario}`" for scenario in missing_must),
            "",
            "## Asset integrity issues",
            "",
            *(f"- {issue}" for issue in issues),
            *([] if issues else ["- None"]),
            "",
        ]
    )
    args.report.write_text(report, encoding="utf-8")
    print(report)
    print(f"wrote {args.report}")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
