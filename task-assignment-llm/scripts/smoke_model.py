"""Call the configured assignment model with a small, deterministic scenario."""

from __future__ import annotations

import os

from app.agent import select_cleaner
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

    alert = {
        "alert": {
            "id": "SMOKE-ALERT-001",
            "siteId": "SITE-001",
            "zoneId": "ZONE-A",
            "issueType": "floor_litter",
            "severity": "warning",
        }
    }
    candidates = {
        "policyVersion": "assignment-v1",
        "candidates": [
            {
                "cleanerId": "CLN-SAME-ZONE",
                "availability": "AVAILABLE",
                "registeredZoneId": "ZONE-A",
                "zoneDistanceRank": 0,
                "notStartedWorkload": 0,
            },
            {
                "cleanerId": "CLN-NEARBY-BUSY",
                "availability": "BUSY",
                "registeredZoneId": "ZONE-B",
                "zoneDistanceRank": 1,
                "notStartedWorkload": 2,
            },
        ],
    }

    selection = select_cleaner(ProviderChain(providers), alert, candidates)
    if selection.cleaner_id != "CLN-SAME-ZONE":
        raise RuntimeError(
            "Model smoke test failed: expected CLN-SAME-ZONE, "
            f"received {selection.cleaner_id}."
        )

    print("Assignment model smoke test passed.")
    print(f"Provider: {selection.provider}")
    print(f"Model: {selection.model}")
    print(f"Selected cleaner: {selection.cleaner_id}")
    print(f"Reason: {selection.rationale_summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
