# LitterSpot Orchestrator

## 1. Responsibility

The Orchestrator automates two operations:

- select one valid waiting Alert and available Cleaner pair, then create assigned Work;
- apply a stored deterministic Verification outcome to orchestrated Work.

Node owns triggers, context, validation, leases, persistence, and mutations. The Python provider adapter returns a structured selection and never accesses Firestore.

## 2. Configuration

Each Site has one `orchestratorConfigs/{siteId}` document containing running or paused status, assignment and review switches, provider, model, retry limit, retry delays, request timeout, active Run reference, and health timestamps.

The default Site configuration uses provider `ollama`, model `qwen3.5:4b`, three technical retries, delays near 1, 2, and 4 seconds, and a 60-second request timeout.

## 3. Triggers

### Alert and evidence management

Creating a qualifying Alert enqueues `assign_alert`.

### Cleaner and Work operations

Cleaner creation, schedule or availability change, Cleaner release, and resolved or dismissed Work enqueue `retry_waiting_alerts`. A ready Camera Verification enqueues `review_work`.

### Orchestration and operational intelligence

Resuming the Orchestrator enqueues an immediate Site retry. Every five minutes, the worker finds Sites with orchestrated `waiting_for_cleaner` Alerts and creates one coalesced scheduled retry per Site and time bucket.

Triggers are deterministic `orchestratorOutbox` records. Duplicate creation under the same uniqueness key is ignored.

## 4. Worker

The Node worker ticks every five seconds when `ORCHESTRATOR_WORKER_ENABLED=true`.

1. It recovers expired Runs.
2. It performs the five-minute waiting-Site scan when due.
3. It reads up to 100 pending or expired-claim outbox records and processes at most ten per tick.
4. It claims one event for five minutes with its process worker ID and a random claim token.
5. It resumes, retries, cancels, fails, or completes the trigger based on the Run result.

Only one worker loop runs inside a process. Firestore claims protect the event across processes, while Site and Work leases protect the business operation.

## 5. Assignment context

Node builds the trusted context from current Firestore records:

- up to ten waiting orchestrated Alerts ordered by priority and age;
- active Site and map revision;
- active Cleaner account and profile state;
- weekly schedule and Site-local time;
- valid Station Point;
- absence of active Work and availability override;
- Alert target point;
- Station Point distance;
- fresh recent resolved Work target and its distance when applicable;
- the final eligible Alert and Cleaner pairs.

The provider does not receive raw Firestore access and does not calculate availability, tenant ownership, or allowed pairs.

## 6. Provider adapter

Node spawns `task-assignment-llm/scripts/decide_assignment.py` with a restricted environment and sends bounded JSON on standard input.

Allowed child environment values are limited to operating-system basics plus `OLLAMA_URL`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. Input is limited to 800,000 bytes, stdout to 131,072 bytes, stderr retention to 32,768 bytes, and process time to the configured timeout plus two seconds.

The response must contain exactly:

- `alertId`;
- `cleanerId`;
- `rationaleSummary`, at most 300 characters;
- `provider`;
- `model`.

Ollama is the configured default. The Python adapter supports Gemini fallback when configured and available.

## 7. Assignment commit

Node rejects a selection when:

- the pair was not in the supplied eligible-pair list;
- Site, map, Alert, Cleaner, account, schedule, Station Point, Work, or management state changed;
- the Run lease expired or belongs to another worker;
- the Alert already has Work;
- another Site Run is active.

A successful transaction reserves the Cleaner, creates one Work Order, links and advances the Alert, records Run action and history, and creates notifications. Replaying the same command fingerprint returns the committed result.

There is no deterministic assignment fallback. Provider or validation exhaustion leaves the Alert waiting.

## 8. Technical and candidate retries

Provider transport, timeout, output, parsing, or invalid-selection failures are recorded as provider attempts. Technical retry count is bounded to three. Cleaner reservation conflicts exclude that candidate and permit another supplied pair when available.

Terminal failures create safe Run and System records. Raw exceptions or provider output are not exposed in the product.

## 9. Automated review

### Camera monitoring and AI

Fresh ordered Camera observations build a deterministic Verification for Work awaiting review.

### Cleaner and Work operations

The review Run reads the ready Verification and may:

- resolve passed orchestrated Work;
- return failed orchestrated Work to the same Cleaner for rework;
- leave inconclusive Work awaiting Supervisor review.

Manual origin or manual management mode blocks automatic review mutation.

## 10. Pause and resume

Pausing changes Site configuration and records control history. It prevents automatic assignment and review mutation. It does not stop Camera monitoring, Alert creation, analytics, or Supervisor actions.

Resuming enqueues a waiting-Alert retry. Existing active manual Work remains excluded from automated mutation.

## 11. Runs and presentation

Firestore retains:

- Run input snapshot and safe decision summary;
- provider and model;
- status, result, error code, timing, and retries;
- provider attempts and Cleaner-reservation attempts;
- validated Node tool actions and safe result summaries.

The System page and Camera trace show structured records. Optional local debug output is disabled in production, capped at 64 KiB, stored for up to 14 days by the writer's cleanup pass, and never served through the API.

## 12. Internal HTTP boundary

Private routes under `/internal/orchestrator` require both `X-Orchestrator-Token` and `X-Orchestrator-Worker-ID`. They create Runs, return bounded contexts, and execute guarded assignment or review commands. Their full contract is in the [API reference](api-reference.md).
