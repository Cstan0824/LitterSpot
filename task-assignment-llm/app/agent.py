"""One-shot assignment prompt and decision orchestration."""

from __future__ import annotations

import json
from typing import Any

from .providers import ModelSelection, ProviderChain


SYSTEM_PROMPT = """You are the LitterSpot cleaning assignment decision-maker.
Choose exactly one Alert and one Cleaner as a pair from the supplied trusted context.

Consider Alert severity, priority and age together with Cleaner distance. Station Point is the default Cleaner origin. A fresh recent Work target is only an uncertain clue while the Cleaner returns to Station. Never treat it as live tracking. Far Cleaners remain valid when they are the best available choice.

Node.js has already validated tenant ownership, Alert state, Cleaner account, schedule, availability, one-active-Work limits, map revisions and every distance. Do not recalculate or challenge those facts. Never invent an ID or select a pair absent from eligiblePairs. Keep rationaleSummary to one short sentence of at most 300 characters. Return only the requested structured JSON selection."""


def build_assignment_prompt(assignment_context: dict[str, Any]) -> str:
    return "Select one Alert and Cleaner pair. Your JSON must contain non-empty alertId, cleanerId, and rationaleSummary fields. Current trusted facts:\n" + json.dumps(
        assignment_context,
        ensure_ascii=False,
        sort_keys=True,
    )


def select_assignment_pair(
    providers: ProviderChain,
    assignment_context: dict[str, Any],
) -> ModelSelection:
    pairs = assignment_context.get("eligiblePairs")
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("No eligible Alert and Cleaner pairs are available.")
    eligible_pairs = {
        (pair["alertId"], pair["cleanerId"])
        for pair in pairs
        if isinstance(pair, dict)
        and isinstance(pair.get("alertId"), str)
        and isinstance(pair.get("cleanerId"), str)
    }
    if not eligible_pairs:
        raise ValueError("No valid Alert and Cleaner pairs are available.")
    return providers.select(SYSTEM_PROMPT, build_assignment_prompt(assignment_context), eligible_pairs)
