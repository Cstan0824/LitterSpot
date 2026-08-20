# Task Assignment LLM

This is an isolated cleaner-assignment prototype. It does not import, start,
or call the LitterSpot backend. It does not use SQLite, Firebase, Firestore,
Supabase, or any cloud database.

The only external connection is the selected model provider:

- Ollama on `127.0.0.1:11434` by default.
- Gemini only when `GEMINI_API_KEY` is explicitly configured.

## Current data flow

```text
database/assignment_simulation.json
    -> get_alert
    -> list_cleaner_candidates
    -> Ollama or Gemini selects one eligible Cleaner
    -> assign_task validates the Cleaner
    -> temporary simulation result
```

The demo copies the source JSON into a temporary directory before assigning,
so `database/assignment_simulation.json` is not modified.

## Module layout

```text
task-assignment-llm/
├── app/
│   ├── agent.py
│   └── providers.py
├── database/
│   └── assignment_simulation.json
├── scripts/
│   ├── demo_isolated_assignment.py
│   └── smoke_model.py
├── tests/
│   ├── test_live_agent.py
│   └── test_tools.py
└── tools/
    ├── get_alert.py
    ├── list_cleaner_candidates.py
    └── assign_task.py
```

## Assignment facts

The tools calculate facts before calling the model:

- registered zone and zone-distance rank;
- whether the Cleaner is scheduled at the simulation time;
- availability (`AVAILABLE` or `BUSY`);
- `notStartedWorkload`, which counts assigned tasks that have not started;
- current in-progress task count.

The model may select only a Cleaner ID returned by the candidate tool. The
assignment tool validates that ID again before saving the temporary result.

No LangChain, LangGraph, RAG, or conversation memory is used.

## Future database migration proposal (not implemented)

The current prototype remains JSON-only. The structures below describe the
minimum database changes proposed for a later integration stage. They are not
present in the backend and no migration has been run.

### Existing Cleaner records: add work schedule

Keep the existing Cleaner identity, registered site/zone, permitted zones,
capabilities, and account status. Add only a recurring schedule:

```json
{
  "workSchedule": {
    "timezone": "Asia/Kuala_Lumpur",
    "shifts": [
      {
        "days": ["MONDAY", "TUESDAY", "WEDNESDAY"],
        "startTime": "08:00",
        "endTime": "17:00"
      }
    ]
  }
}
```

### New `zoneDistances` collection

Store the relative distance between registered zones:

```json
{
  "siteId": "SITE-001",
  "fromZoneId": "ZONE-FOOD-COURT",
  "toZoneId": "ZONE-WEST-PLAZA",
  "distanceRank": 1
}
```

`distanceRank` is not metres or GPS distance:

- `0` means the alert and Cleaner are in the same zone;
- `1` means the nearest neighbouring registered zone;
- `2` means the next-nearest registered zone.

Same-zone rank `0` may be calculated without storing a record. Only cross-zone
relationships need to be stored.

### Existing work orders: calculate workload

Do not store a separate workload counter because it could become stale.
Calculate it from current work orders:

```text
notStartedWorkload = ASSIGNED task count + ACCEPTED task count
```

An `IN_PROGRESS` task does not increase `notStartedWorkload`, but it still makes
the Cleaner busy. Availability should be derived as follows:

```text
AVAILABLE = scheduled now and has no assigned, accepted, in-progress, or rework task
BUSY      = has at least one active or queued task
```

The LLM first considers available Cleaners. If everyone is busy, it may assign
another queued task to the least-loaded eligible Cleaner.

### Existing work orders: optional LLM decision fields

Store a small amount of decision information directly on the resulting work
order so the application can show that the LLM made the assignment:

```json
{
  "assignmentSource": "llm",
  "assignmentProvider": "ollama",
  "assignmentModel": "qwen3.5:4b",
  "assignmentReason": "Available Cleaner registered in the alert zone."
}
```

The simple version does not require a separate candidate-history or LLM-memory
collection.

### New `assignmentRuns` collection

Later automatic processing needs one durable queue record per alert:

```json
{
  "alertId": "ALT-001",
  "status": "queued",
  "selectedCleanerId": null,
  "workOrderId": null,
  "createdAt": "server timestamp"
}
```

Proposed lifecycle:

```text
queued -> processing -> completed
                  \-> failed
```

This prevents duplicate assignment when a worker restarts. The existing alert
keeps its current structure; `alertId` and its registered zone connect it to
the assignment run and resulting work order.

### Fields and systems not required

The initial database migration should not add:

- generated instructions or equipment;
- task due times;
- GPS distance or connection-heartbeat requirements;
- stored workload counters;
- LLM conversation memory or RAG storage;
- assignment candidate history.

Before this future migration, the team should review and approve the proposed
field names and create a dry-run migration. Until then, the JSON simulation is
the only data source used by this module.

## Test procedure 1: isolated automated tests

From the repository root:

```bash
npm run test:assignment
```

This runs 12 Python unit tests. It tests JSON reading, candidate calculations,
schedule and workload handling, assignment validation, idempotency, provider
fallback, and rejection of invented Cleaner IDs.

It does not start or call an LLM, backend, or database server. A temporary copy
of the JSON file is used for tests that save assignments.

Expected ending:

```text
Ran 12 tests
OK
All isolated task-assignment tests passed.
```

## Test procedure 2: real model smoke test

Ensure Ollama is already running and the model exists:

```bash
ollama pull qwen3.5:4b
npm run test:assignment:model
```

This sends a small hard-coded scenario to the real model and verifies that it
selects `CLN-SAME-ZONE`. It does not read or write the simulation JSON.

Expected ending:

```text
Assignment model smoke test passed.
Provider: ollama
Model: qwen3.5:4b
Selected cleaner: CLN-SAME-ZONE
```

## Test procedure 3: isolated end-to-end demo

With Ollama running:

```bash
npm run demo:assignment
```

This performs the complete prototype flow with `ALT-001`: copy the JSON,
retrieve the alert, calculate candidates, call the real model, validate the
selection, and assign the task in the temporary copy.

Expected ending includes:

```text
Isolated task-assignment demo passed.
Selected: CLN-002
Original JSON unchanged: yes
```

Use a specific simulated alert with:

```bash
npm run demo:assignment -- --alert-id ALT-001
```

## Optional Gemini fallback

Leave `GEMINI_API_KEY` unset for local-only testing. To configure fallback,
export it in the terminal before running a model test or demo:

```bash
export GEMINI_API_KEY="your-key"
npm run demo:assignment
```

Ollama remains the primary provider. Gemini is called only if Ollama fails.
