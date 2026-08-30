from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from app.agent import build_assignment_prompt, select_assignment_pair
from app.providers import GeminiProvider, ModelProviderError, OllamaProvider, ProviderChain


class FakeProvider:
    def __init__(self, name: str, model: str, result=None, error: Exception | None = None) -> None:
        self.name = name
        self.model = model
        self._result = result
        self._error = error
        self.called = False

    def generate(self, system_prompt: str, user_prompt: str):
        self.called = True
        if self._error:
            raise self._error
        return self._result


class LiveAssignmentAgentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.context = {
            "policyVersion": "assignment-v1",
            "calculatedAt": "2026-08-20T10:00:00+08:00",
            "alerts": [{"alertId": "ALT-1", "zoneId": "ZONE-A", "issueType": "floor_litter"}],
            "cleaners": [
                {
                    "cleanerId": "CLN-1",
                    "availability": "available",
                },
                {
                    "cleanerId": "CLN-2",
                    "availability": "available",
                },
            ],
            "eligiblePairs": [
                {"alertId": "ALT-1", "cleanerId": "CLN-1", "stationDistanceMeters": 10},
                {"alertId": "ALT-1", "cleanerId": "CLN-2", "stationDistanceMeters": 20},
            ],
        }

    def test_prompt_contains_only_trusted_assignment_context(self) -> None:
        prompt = build_assignment_prompt(self.context)
        payload = json.loads(prompt.split("Current trusted facts:\n", 1)[1])
        self.assertEqual(payload["alerts"][0]["alertId"], "ALT-1")
        self.assertEqual([item["cleanerId"] for item in payload["cleaners"]], ["CLN-1", "CLN-2"])

    def test_uses_local_provider_when_it_returns_an_eligible_pair(self) -> None:
        local = FakeProvider("ollama", "qwen", {"alertId": "ALT-1", "cleanerId": "CLN-1", "rationaleSummary": "High priority and nearby."})
        fallback = FakeProvider("gemini", "flash", {"alertId": "ALT-1", "cleanerId": "CLN-2", "rationaleSummary": "Fallback."})
        selected = select_assignment_pair(ProviderChain([local, fallback]), self.context)
        self.assertEqual(selected.alert_id, "ALT-1")
        self.assertEqual(selected.cleaner_id, "CLN-1")
        self.assertEqual(selected.provider, "ollama")
        self.assertFalse(fallback.called)

    def test_falls_back_when_local_provider_fails(self) -> None:
        local = FakeProvider("ollama", "qwen", error=ModelProviderError("offline"))
        fallback = FakeProvider("gemini", "flash", {"alertId": "ALT-1", "cleanerId": "CLN-2", "rationaleSummary": "Valid fallback."})
        selected = select_assignment_pair(ProviderChain([local, fallback]), self.context)
        self.assertEqual(selected.cleaner_id, "CLN-2")
        self.assertEqual(selected.provider, "gemini")

    def test_rejects_pairs_not_returned_by_node(self) -> None:
        invalid = FakeProvider("ollama", "qwen", {"alertId": "ALT-1", "cleanerId": "CLN-999", "rationaleSummary": "Invented."})
        with self.assertRaises(ModelProviderError):
            select_assignment_pair(ProviderChain([invalid]), self.context)

    @patch("app.providers._json_request")
    def test_ollama_adapter_requests_structured_output_without_thinking(self, request) -> None:
        request.return_value = {
            "message": {"content": '{"alertId":"ALT-1","cleanerId":"CLN-1","rationaleSummary":"Available."}'},
        }
        result = OllamaProvider("http://127.0.0.1:11434", "qwen3.5:4b", 30).generate("system", "user")
        self.assertEqual(result["cleanerId"], "CLN-1")
        body = request.call_args.args[1]
        self.assertFalse(body["think"])
        self.assertEqual(body["format"]["required"], ["alertId", "cleanerId", "rationaleSummary"])

    @patch("app.providers._json_request")
    def test_gemini_adapter_parses_structured_generate_content_response(self, request) -> None:
        request.return_value = {
            "candidates": [{
                "content": {"parts": [{"text": '{"alertId":"ALT-1","cleanerId":"CLN-2","rationaleSummary":"Fallback."}'}]},
            }],
        }
        result = GeminiProvider("test-key", "gemini-3.5-flash-lite", 30).generate("system", "user")
        self.assertEqual(result["cleanerId"], "CLN-2")
        body = request.call_args.args[1]
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(request.call_args.args[3]["x-goog-api-key"], "test-key")


if __name__ == "__main__":
    unittest.main()
