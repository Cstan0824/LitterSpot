# Phase 12.7 System backend readiness

Status: the backend gaps needed before System-page integration are closed. This work does not replace the current System frontend.

## What changed

- `GET /api/operations/v2/system` now returns V2 waiting-Alert and awaiting-review Work counts.
- Root and Regular Supervisors receive the latest 20 pause/resume actions through a bounded safe history. The full immutable audit API remains Root-only.
- Run list, Run detail, and System summaries now include readable Alert, Cleaner, Work, Zone, and Camera references when the Run captured them.
- Assignment Runs already freeze their offered Alerts and Cleaners. New review Runs now freeze a small Work display snapshot too.
- System Run summaries report provider request count, retry count, Cleaner reservation count, and tool-call count.
- Generic assignment failure reporting now has separate safe codes for no available Cleaner, provider failure after retries, invalid model selection, other assignment failure, inconclusive review, and unexpected review failure.
- If Site configuration says `running` while this Node process has its worker disabled, the System response derives a warning. Reading the page never writes that warning to Firestore.

## Firestore and quota behavior

The System endpoint stays bounded:

- 20 Runs maximum;
- 20 control-history entries maximum;
- two aggregation-count queries for the backlog;
- one safe System-event query;
- no live Alert, Cleaner, or Work lookup for each Run.

No new Firestore index is required for this change.

## API checks

As either Root or Regular Supervisor:

1. `GET /api/operations/v2/system`.
2. Check `runtime.backlog`.
3. Pause and resume through `POST /api/orchestrator/v2/status`, then read System again and check `controlHistory`.
4. Run an assignment through the Phase 9 Postman folder, then check `recentRuns[0].references`, `retryCount`, `candidateAttemptCount`, and `toolCallCount`.
5. Read the same Run through `GET /api/orchestrator/v2/runs/{runId}` and inspect its attempts and actions.

Expected limitations:

- `providerConnectivity` remains `not_probed` by design.
- Runs created before readable snapshots existed can have null labels, especially failed review Runs. New Runs retain the labels needed by the System page.
- Raw provider output remains in the local developer-only debug directory and never enters this API.

## Verification completed

- Backend TypeScript build passed.
- 255 non-emulator backend tests passed.
- The focused Firestore/Auth emulator run passed all 28 System and Orchestrator scenarios.
- The emulator used alternate local ports because Docker was already using port 8080. Docker and other running projects were not stopped.

## Next work

Build the System page with the delivered UI style. Poll the bounded System summary once per minute while the page is visible and keep an explicit refresh control. This protects the Spark Firestore read quota as Run history grows. Fetch Run detail only when the Supervisor expands a Run.
