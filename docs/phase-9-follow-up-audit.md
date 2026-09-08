# Phase 9 follow-up audit

Status: resolved and verified on 2026-08-31.

The Phase 10 inspection found gaps beyond the initial successful assignment demonstration. This follow-up closed them before Phase 11.

## Resolved items

| Earlier gap | Resolution |
| --- | --- |
| Camera verification bypassed the worker | Fresh ordered Camera samples now produce a ready Verification and durable `review_work` trigger. The review worker applies passed/failed outcomes. Inconclusive results wait for a Supervisor. |
| Lease/config/map/manual changes during model calls | Node checks the Site, config revision, active Site Run, worker, lease, map, Alert revision and management mode again before the commit. Tests mutate each while the provider is running. |
| Tools rebuilt context | The first assignment context is stored and hashed on the Run. Commands must select a pair from that exact snapshot. |
| Completed commands were not replayable | The Work mutation, Run result, action record, outbox completion and replay response commit in one Firestore transaction. Same-command replay returns the saved result. Different-command replay returns `409`. |
| Concurrent Runs per Site | `orchestratorConfigs.activeRunId` permits one active assignment or review Run per Site. Expired Run recovery clears ownership before another Run starts. |
| Retry/conflict ambiguity | Provider errors and invalid output have at most one initial call plus three retries. Cleaner reservation conflicts exclude that Cleaner. Pause, map, Site, Alert, lease and context conflicts cancel the Run without blaming a Cleaner. |
| Crash between Work and Run completion | There is no longer a cross-transaction gap. A crash after commit but before external trigger acknowledgement is recovered without a second model call or Work Order. |
| Provider bridge isolation | Python receives an allowlisted environment without Firebase credentials or the internal token. Context and output are bounded. Parsed output uses a strict schema. Debug files are development-only, capped, private-permission files. |
| Live Node bridge missing | `npm --workspace=backend run v2:smoke-orchestrator-provider` passed through Node, Python, Ollama and `qwen3.5:4b`. |

## Verified behavior

- 22 V2 Orchestrator emulator scenarios pass.
- Assignment and review command replay create one event and one notification.
- A stale worker cannot commit after lease recovery.
- A Site cannot start two active Runs concurrently.
- Direct and worker-owned triggers recover safely.
- Old Camera samples and duplicate/out-of-order samples do not satisfy a new Verification.
- Paused review stays pending and resolves after automation resumes.
- Manual takeover prevents automatic review mutation.
- The legacy V1 recovery loop ignores V2 Runs.

## Remaining product limitations

These are prototype boundaries, not unfinished Phase 9 behavior:

- only one Site Run executes at a time;
- the LLM selects assignments, while review applies deterministic Camera Verification rather than asking a VLM;
- local Ollama is not deployed;
- real CCTV ingestion is still represented by browser sampling;
- frontend integration remains Phase 12.
