"""One-shot assignment prompt and decision orchestration."""

from __future__ import annotations

import json
from typing import Any

from .providers import ModelSelection, ProviderChain


SYSTEM_PROMPT = """You are the LitterSpot Cleaner assignment decision-maker.
Choose exactly one Cleaner from the supplied eligible candidates.

Policy, in priority order:
1. Prefer an AVAILABLE Cleaner registered in the alert zone.
2. When several fit, prefer lower notStartedWorkload.
3. If alert-zone Cleaners are busy, consider AVAILABLE Cleaners from the nearest registered zones.
4. If nobody is AVAILABLE, choose a BUSY Cleaner using workload and zone distance so another task can be queued.
5. Never invent a Cleaner ID and never select anyone outside the candidate list.
6. Keep rationaleSummary to one short sentence of at most 300 characters.

Node.js has already calculated permissions, schedule, workload, availability, and distance. Do not recalculate or challenge those facts. Return only the requested structured JSON selection."""


def build_assignment_prompt(alert_context: dict[str, Any], candidate_result: dict[str, Any]) -> str:
    payload = {
        "alert": alert_context["alert"],
        "policyVersion": candidate_result.get("policyVersion"),
        "calculatedAt": candidate_result.get("calculatedAt"),
        "candidates": candidate_result.get("candidates", []),
    }
    return "Select the Cleaner responsible for this alert. Current trusted facts:\n" + json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
    )


def select_cleaner(
    providers: ProviderChain,
    alert_context: dict[str, Any],
    candidate_result: dict[str, Any],
) -> ModelSelection:
    candidates = candidate_result.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("No eligible Cleaner candidates are available.")
    eligible_ids = {
        candidate["cleanerId"]
        for candidate in candidates
        if isinstance(candidate, dict) and isinstance(candidate.get("cleanerId"), str)
    }
    return providers.select(SYSTEM_PROMPT, build_assignment_prompt(alert_context, candidate_result), eligible_ids)
