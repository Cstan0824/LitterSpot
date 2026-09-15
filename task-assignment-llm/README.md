# Assignment provider adapter

This package contains the Python boundary used by the Node Orchestrator to request one Alert and Cleaner pair from the configured provider.

## Runtime contract

Node sends one JSON object on standard input:

```json
{
  "context": {
    "alerts": [],
    "cleaners": [],
    "eligiblePairs": []
  },
  "config": {
    "provider": "ollama",
    "model": "qwen3.5:4b",
    "requestTimeoutSeconds": 60
  }
}
```

The adapter returns exactly one structured decision:

```json
{
  "alertId": "alert-id",
  "cleanerId": "cleaner-id",
  "rationaleSummary": "Concise factors used for the selection.",
  "provider": "ollama",
  "model": "qwen3.5:4b"
}
```

Node validates the selected pair against `eligiblePairs` and rechecks Firestore before committing. This package never reads or writes Firestore.

## Providers

- Ollama is the default configured provider. `OLLAMA_URL` may override its address.
- Gemini is supported when `GEMINI_API_KEY` and optional `GEMINI_MODEL` are configured.
- Provider failure does not assign a deterministic fallback Cleaner.

## Files

- `scripts/decide_assignment.py`: production stdin/stdout provider bridge
- `live_agent.py`: provider request, structured response, fallback adapter, and pair validation
- `tools.py`: isolated JSON assignment tools used by tests and demos
- `database/store.py`: isolated JSON store used only by package tests and demos
- `tests/`: provider and isolated-tool tests

The JSON database and tools are not the application database. The production system uses Node and Firestore.

## Tests

From the repository root:

```bash
npm run test:assignment
```

Run a real configured provider smoke test:

```bash
npm run test:assignment:model
```

Run the isolated JSON demo:

```bash
npm run demo:assignment
```

The full application behavior, triggers, leases, retries, and commit rules are documented in [the Orchestrator reference](../docs/orchestrator.md).
