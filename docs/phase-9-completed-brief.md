# Phase 9 completed brief

> Status: completed after the Phase 10 follow-up audit. Assignment, automatic deterministic review, concurrency, leases, replay, recovery and the Node-to-Python provider boundary pass automated tests. See [the resolved follow-up audit](phase-9-follow-up-audit.md). Product frontend integration remains deferred to Phase 12.

## What was built

### V2 Alert and Cleaner pair assignment

- Node loads at most 10 waiting V2 Alerts for one Site.
- Node validates every available Cleaner from account status, schedule, Availability Override, active Work, Station Point and Active Map Revision.
- Node calculates every Alert and Cleaner distance in Site Map metres.
- The LLM now selects both `alertId` and `cleanerId` from the supplied eligible pairs.
- Node rejects invented or stale IDs and performs the final Firestore transaction.
- A farther Cleaner remains eligible. Distance is a decision fact, not an eligibility cutoff.

### Recent Work location context

- Resolving Work saves the Work target, resolution time, Work ID and map revision on the Cleaner projection.
- Station Point remains the default Cleaner origin.
- A resolved Work target is supplied as uncertain `returning_to_station` context for up to 15 minutes.
- The current provisional strengths are `strong` through 5 minutes and `weak` through 15 minutes.
- Recent Work from another map revision is ignored.
- Dismissed Work does not change recent location.
- No GPS or invented point between the Work target and Station Point is used.

### Teammate model integration

- Reused the teammate's Ollama and optional Gemini provider adapters.
- Replaced Cleaner-only structured output with `{ alertId, cleanerId, rationaleSummary }`.
- Added `task-assignment-llm/scripts/decide_assignment.py` as a JSON stdin/stdout bridge.
- Python receives only Node-calculated context and never receives Firebase credentials or direct database access.
- Optional raw structured provider output is stored under ignored `data/orchestrator-debug/` files when `ORCHESTRATOR_DEBUG_OUTPUT=true`.

### Runs, retries and tools

- Added V2 `orchestratorRuns`, attempts, actions and outbox execution records.
- Added provider technical retries after 1, 2 and 4 seconds.
- No deterministic Cleaner fallback is created after provider failure.
- A Cleaner reservation conflict excludes that Cleaner for the current Run and asks the model again.
- Each reservation attempt passes through the existing atomic V2 Work Order transaction.
- Provider failure or no available Cleaner leaves Alerts waiting and creates a Supervisor notification.
- Expired V2 Run leases fail safely during startup recovery.

The five private Node-controlled tools are:

```text
get_assignment_context
assign_cleaner
get_review_context
resolve_verified_work
request_rework
```

### Automatic triggering

- New V2 Alerts create durable assignment outbox triggers.
- Cleaner release, Cleaner availability changes and Orchestrator resume create retry triggers.
- A local worker polls triggers every 5 seconds.
- A five-minute scheduled scan catches missed availability events while waiting Alerts exist.
- Paused, disabled or inactive Site state blocks mutation.

### Follow-up hardening

- One active Run per Site is enforced through `orchestratorConfigs.activeRunId`.
- The saved assignment context is hashed and becomes the command allowlist.
- Work and Run results commit atomically and support exact replay.
- Camera verification queues `review_work`; the worker resolves or requests rework after rechecking pause, manual mode and Site state.
- Stale workers, changed maps, changed Alerts and expired leases cannot commit.
- The Python child process receives no Firebase Admin credential or internal Node token.

## Supervisor API

All routes use the normal Firebase Supervisor bearer token.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/orchestrator/v2/config` | Read Site Orchestrator configuration and health timestamps |
| `POST` | `/api/orchestrator/v2/status` | Pause or resume the Orchestrator |
| `GET` | `/api/orchestrator/v2/runs?limit=50` | List V2 assignment and review Runs |
| `GET` | `/api/orchestrator/v2/runs/{runId}` | Read a Run with attempts and tool actions |
| `POST` | `/api/orchestrator/v2/assignment-cycle` | Start one real provider-backed assignment cycle for testing |

## Private Orchestrator API

These routes require `X-Orchestrator-Token` and `X-Orchestrator-Worker-ID`.

| Method | Route | Tool or operation |
| --- | --- | --- |
| `POST` | `/internal/orchestrator/v2/assignment-runs` | Create and lease one assignment Run |
| `GET` | `/internal/orchestrator/v2/runs/{runId}/assignment-context?siteId=...` | `get_assignment_context` |
| `POST` | `/internal/orchestrator/v2/runs/{runId}/assign-cleaner` | `assign_cleaner` |
| `POST` | `/internal/orchestrator/v2/review-runs` | Create and lease one review Run |
| `GET` | `/internal/orchestrator/v2/runs/{runId}/review-context?siteId=...&workOrderId=...` | `get_review_context` |
| `POST` | `/internal/orchestrator/v2/runs/{runId}/resolve-verified-work` | `resolve_verified_work` |
| `POST` | `/internal/orchestrator/v2/runs/{runId}/request-rework` | `request_rework` |

## Automated verification completed

- Backend TypeScript build passed.
- 245 ordinary backend tests passed.
- 12 isolated teammate assignment tests passed.
- Real Ollama `qwen3.5:4b` structured pair-selection smoke passed.
- 22 V2 Orchestrator emulator scenarios passed.
- The full Firebase Auth and Firestore emulator suite passed, including Phases 0 through 8 and Phase 9.

The V2 Orchestrator tests cover:

- pair context and top-10 boundary;
- Station and recent Work distances;
- cross-map recent-location rejection;
- model-selected Alert and Cleaner;
- invalid or stale reservation retry;
- 1, 2 and 4-second technical backoff;
- provider exhaustion without fallback Work;
- no available Cleaner;
- leased internal assignment tools;
- durable outbox-trigger consumption;
- passed Verification resolution;
- failed Verification rework;
- recent Work projection after resolution;
- paused Orchestrator guard.

## How to test

For repeatable assignment testing without vision models, use the [simulated Alert testing guide](phase-9-simulated-alert-testing.md). Phase 9 Postman requests 05a and 05b select an existing Camera and create a development-only Alert on demand.

### Safe automated tests

```bash
npm run test:assignment
npm --workspace=backend run build
npm run test:emulator -- "npm --workspace=backend run test -- --run src/v2Orchestrator.integration.test.ts"
```

The emulator test does not touch the cloud Firebase project and does not call a real LLM.

### Real local model smoke test

Install and start the model configured in `orchestratorConfigs/{siteId}`. The current development bootstrap uses `qwen3.5:4b` through Ollama.

```bash
ollama pull qwen3.5:4b
npm run test:assignment:model
```

Then start the normal backend and use Postman request **V2 Root - Phase 9 Trigger Real Assignment Cycle**. This request can create a real Work Order. Use only a development Site with a waiting Alert and available Cleaner.

## Environment values

```text
ORCHESTRATOR_INTERNAL_TOKEN=<shared local worker secret>
ORCHESTRATOR_LEASE_SECONDS=300
ORCHESTRATOR_PYTHON_PATH=<repo>/.venv/bin/python
ORCHESTRATOR_DEBUG_OUTPUT=false
ORCHESTRATOR_DEBUG_ROOT=<repo>/data/orchestrator-debug
ORCHESTRATOR_WORKER_ENABLED=true
```

Gemini remains optional through `GEMINI_API_KEY`. Ollama stays local and primary by default.

Set `ORCHESTRATOR_WORKER_ENABLED=false` and restart Node when you want to step through private requests 10 through 12 manually without the background worker taking the Alert first. Restore it to `true` for automatic end-to-end testing.

## What is intentionally not part of Phase 9

- System-page frontend integration;
- Cleaner mobile frontend integration;
- general Dashboard and analytics completion;
- raw hidden chain-of-thought display;
- VLM-based cleaning review;
- deployment of Ollama, Gemini or LangGraph to cloud infrastructure.

Phase 10 continues with the final notification, audit, deactivation and System read models.
