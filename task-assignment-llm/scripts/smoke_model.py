"""Call the configured assignment model with a small, deterministic scenario."""

from __future__ import annotations

import os

from app.agent import select_assignment_pair
from app.providers import GeminiProvider, OllamaProvider, ProviderChain


def main() -> int:
    timeout = float(os.getenv("ASSIGNMENT_REQUEST_TIMEOUT_SECONDS", "60"))
    providers = [
        OllamaProvider(
            os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
            os.getenv("OLLAMA_MODEL", "qwen3.5:4b"),
            timeout,
        )
    ]
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        providers.append(
            GeminiProvider(
                gemini_key,
                os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
                timeout,
            )
        )

    context = {
        "alerts": [{
            "alertId": "SMOKE-ALERT-001",
            "siteId": "SITE-001",
            "zoneId": "ZONE-A",
            "issueType": "floor_litter",
            "severity": "warning",
            "priorityScore": 50,
        }],
        "policyVersion": "bounded-pair-selection",
        "cleaners": [
            {
                "cleanerId": "CLN-SAME-ZONE",
                "availability": "available",
            },
            {
                "cleanerId": "CLN-FARTHER",
                "availability": "available",
            },
        ],
        "eligiblePairs": [
            {"alertId": "SMOKE-ALERT-001", "cleanerId": "CLN-SAME-ZONE", "stationDistanceMeters": 10},
            {"alertId": "SMOKE-ALERT-001", "cleanerId": "CLN-FARTHER", "stationDistanceMeters": 100},
        ],
    }

    selection = select_assignment_pair(ProviderChain(providers), context)
    if selection.cleaner_id != "CLN-SAME-ZONE":
        raise RuntimeError(
            "Model smoke test failed: expected CLN-SAME-ZONE, "
            f"received {selection.cleaner_id}."
        )

    print("Assignment model smoke test passed.")
    print(f"Provider: {selection.provider}")
    print(f"Model: {selection.model}")
    print(f"Selected alert: {selection.alert_id}")
    print(f"Selected cleaner: {selection.cleaner_id}")
    print(f"Reason: {selection.rationale_summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
