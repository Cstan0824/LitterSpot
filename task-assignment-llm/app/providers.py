"""Structured-output local and fallback LLM providers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SELECTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cleanerId": {"type": "string"},
        "rationaleSummary": {"type": "string", "maxLength": 300},
    },
    "required": ["cleanerId", "rationaleSummary"],
    "additionalProperties": False,
}


class ModelProviderError(RuntimeError):
    """Raised when a model cannot produce a valid assignment decision."""


@dataclass(frozen=True)
class ModelSelection:
    cleaner_id: str
    rationale_summary: str
    provider: str
    model: str


class SelectionProvider(Protocol):
    name: str
    model: str

    def generate(self, system_prompt: str, user_prompt: str) -> dict[str, Any]: ...


def _json_request(url: str, body: dict[str, Any], timeout_seconds: float, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json", **(headers or {})},
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ModelProviderError(f"Model API returned HTTP {error.code}: {detail[:1000]}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ModelProviderError(f"Model API request failed: {error}") from error


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self.model = model
        self._timeout_seconds = timeout_seconds

    def generate(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        response = _json_request(
            f"{self._base_url}/api/chat",
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
                "think": False,
                "format": SELECTION_SCHEMA,
                "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 400},
            },
            self._timeout_seconds,
        )
        content = response.get("message", {}).get("content")
        if not isinstance(content, str):
            raise ModelProviderError("Ollama response did not contain message.content.")
        try:
            return json.loads(content)
        except json.JSONDecodeError as error:
            raise ModelProviderError(
                "Ollama returned invalid structured JSON "
                f"({error.msg} at character {error.pos}; content length {len(content)})."
            ) from error


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self._api_key = api_key
        self.model = model
        self._timeout_seconds = timeout_seconds

    def generate(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        response = _json_request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{quote(self.model, safe='')}:generateContent",
            {
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseJsonSchema": SELECTION_SCHEMA,
                },
            },
            self._timeout_seconds,
            {"x-goog-api-key": self._api_key},
        )
        candidates = response.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise ModelProviderError("Gemini response did not contain a candidate.")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = next((part.get("text") for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str)), None)
        if text is None:
            raise ModelProviderError("Gemini response did not contain structured text.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise ModelProviderError("Gemini returned invalid structured JSON.") from error


class ProviderChain:
    def __init__(self, providers: list[SelectionProvider]) -> None:
        if not providers:
            raise ValueError("At least one model provider is required.")
        self._providers = providers

    def select(self, system_prompt: str, user_prompt: str, eligible_cleaner_ids: set[str]) -> ModelSelection:
        errors: list[str] = []
        for provider in self._providers:
            try:
                result = provider.generate(system_prompt, user_prompt)
                if not isinstance(result, dict):
                    raise ModelProviderError("Model response was not a JSON object.")
                cleaner_id = result.get("cleanerId")
                rationale = result.get("rationaleSummary")
                if not isinstance(cleaner_id, str) or cleaner_id not in eligible_cleaner_ids:
                    raise ModelProviderError("Model selected a Cleaner outside the eligible candidate set.")
                if not isinstance(rationale, str) or not rationale.strip():
                    raise ModelProviderError("Model did not provide a rationale summary.")
                return ModelSelection(cleaner_id, rationale.strip()[:1000], provider.name, provider.model)
            except ModelProviderError as error:
                errors.append(f"{provider.name}/{provider.model}: {error}")
        raise ModelProviderError("All assignment providers failed: " + " | ".join(errors))
