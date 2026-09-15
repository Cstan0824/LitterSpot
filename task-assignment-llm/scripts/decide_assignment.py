"""Read trusted assignment context from stdin and return one model decision."""

from __future__ import annotations

import json
import os
import sys

from app.agent import select_assignment_pair
from app.providers import GeminiProvider, OllamaProvider, ProviderChain


def provider_chain(config: dict) -> ProviderChain:
    timeout = float(config.get("requestTimeoutSeconds") or os.getenv("ASSIGNMENT_REQUEST_TIMEOUT_SECONDS", "60"))
    provider_name = str(config.get("provider") or "ollama")
    model = str(config.get("model") or os.getenv("OLLAMA_MODEL", "qwen3.5:4b"))
    providers = []
    if provider_name == "ollama":
        providers.append(OllamaProvider(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"), model, timeout))
    elif provider_name == "gemini":
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is required for the Gemini provider.")
        providers.append(GeminiProvider(key, model, timeout))
    else:
        raise RuntimeError(f"Unsupported assignment provider: {provider_name}")
    fallback_key = os.getenv("GEMINI_API_KEY")
    if provider_name != "gemini" and fallback_key:
        providers.append(GeminiProvider(fallback_key, os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"), timeout))
    return ProviderChain(providers)


def main() -> int:
    payload = json.load(sys.stdin)
    context = payload.get("context")
    if not isinstance(context, dict):
        raise ValueError("context must be a JSON object.")
    selection = select_assignment_pair(provider_chain(payload.get("config") or {}), context)
    json.dump({
        "alertId": selection.alert_id,
        "cleanerId": selection.cleaner_id,
        "rationaleSummary": selection.rationale_summary,
        "provider": selection.provider,
        "model": selection.model,
    }, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
