"""Run one real LLM assignment against a disposable copy of the JSON simulation."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path

from app.agent import select_assignment_pair
from app.providers import GeminiProvider, OllamaProvider, ProviderChain
from tools import assign_task, get_alert, list_cleaner_candidates


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DATABASE = PROJECT_ROOT / "database" / "assignment_simulation.json"


def provider_chain() -> ProviderChain:
    timeout = float(os.getenv("ASSIGNMENT_REQUEST_TIMEOUT_SECONDS", "60"))
    providers = [OllamaProvider(
        os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        os.getenv("OLLAMA_MODEL", "qwen3.5:4b"),
        timeout,
    )]
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        providers.append(GeminiProvider(
            gemini_key,
            os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
            timeout,
        ))
    return ProviderChain(providers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Test one isolated JSON task assignment.")
    parser.add_argument("--alert-id", default="ALT-001")
    arguments = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="litterspot-assignment-demo-") as directory:
        disposable_database = Path(directory) / "assignment_simulation.json"
        shutil.copy2(SOURCE_DATABASE, disposable_database)
        os.environ["ASSIGNMENT_SIM_DATABASE_PATH"] = str(disposable_database)

        alert_result = get_alert(arguments.alert_id)
        candidate_result = list_cleaner_candidates(arguments.alert_id)
        if not alert_result.get("ok"):
            raise RuntimeError(f"Alert tool failed: {alert_result.get('error')}")
        if not candidate_result.get("ok"):
            raise RuntimeError(f"Candidate tool failed: {candidate_result.get('error')}")

        candidate_result["policyVersion"] = "assignment-v1"
        candidate_result["calculatedAt"] = candidate_result.get("simulationTime")
        context = {
            "policyVersion": "bounded-pair-selection",
            "calculatedAt": candidate_result.get("simulationTime"),
            "alerts": [{
                "alertId": arguments.alert_id,
                "zoneId": alert_result["alert"]["zoneId"],
                "issueType": alert_result["alert"]["issueType"],
                "severity": alert_result["alert"].get("severity"),
            }],
            "cleaners": [{
                "cleanerId": candidate["cleanerId"],
                "availability": candidate["availability"].lower(),
            } for candidate in candidate_result["candidates"]],
            "eligiblePairs": [{
                "alertId": arguments.alert_id,
                "cleanerId": candidate["cleanerId"],
                "stationDistanceMeters": candidate["zoneDistanceRank"],
            } for candidate in candidate_result["candidates"]],
        }
        selection = select_assignment_pair(provider_chain(), context)
        assignment = assign_task(arguments.alert_id, selection.cleaner_id)
        if not assignment.get("ok"):
            raise RuntimeError(f"Assignment tool failed: {assignment.get('error')}")

        print("\nIsolated task-assignment demo passed.")
        print(f"Alert: {arguments.alert_id} ({alert_result['alert']['zoneName']})")
        print("Candidates:")
        for candidate in candidate_result["candidates"]:
            print(
                f"  - {candidate['cleanerId']}: {candidate['availability']}, "
                f"distance={candidate['zoneDistanceRank']}, "
                f"not-started={candidate['notStartedWorkload']}"
            )
        print(f"Provider: {selection.provider}/{selection.model}")
        print(f"Selected: {selection.cleaner_id}")
        print(f"Reason: {selection.rationale_summary}")
        print(f"Temporary result: {assignment['assignment']}")
        print("Original JSON unchanged: yes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
