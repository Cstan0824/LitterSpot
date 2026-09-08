# Phase 12.7 System integration completed brief

## Outcome

The approved `#/status` design now uses V2 backend data. The hardcoded Runs, counts, events, service rows, and pause history have been removed.

## What was wired

- `GET /api/operations/v2/system` supplies Orchestrator configuration, worker state, backlog counts, recent Runs, safe System events, and pause/resume history.
- `GET /api/orchestrator/v2/runs/{runId}` loads provider attempts, Cleaner reservation attempts, candidate distances, and Node actions only when a Run expands.
- `POST /api/orchestrator/v2/status` performs real pause and resume operations.
- `GET /api/health` reports FastAPI inference readiness separately from Orchestrator provider configuration.

## Data and interaction behaviour

- The page performs one initial System read and then refreshes once per minute while the browser tab is visible.
- The explicit **Refresh** button remains available.
- A failed background refresh keeps the last good response on screen and identifies it as stale.
- Expanding a Run caches its detail for the current page session.
- Run filters operate on the latest 20 backend Runs.
- On desktop, Decision Activity and the right-hand System column share one fixed-height panel. The right column aligns with the **Recent Runs** metric card, while Decision Activity uses the remaining width.
- When no Run is expanded, the Run list scrolls inside a fixed-height Decision Activity panel. The page does not keep growing with more collapsed Runs.
- Expanding one Run intentionally removes the fixed-height cap. Decision Activity grows to show its full decision summary, trace, and bottom collapse control in the ordinary page scroll.
- Opening a Run always replaces the prior expanded Run. Two details cannot remain open at once.
- Candidate detail starts with the selected Cleaner, then any attempted-conflict Cleaner, then the nearest remaining candidates. It shows five rows by default; **Show all** keeps a very large candidate table bounded with its own scroll.
- The end of every loaded Run detail has **Collapse Run details**, which returns focus and scroll position to that Run's summary row.
- Empty Run, event, and control-history states use real empty-state copy.
- Pause and resume disable repeated submission while the request is running.
- Pause keeps the optional reason, reports backend validation errors inside the dialog, and reloads the System view after success.
- The page never displays raw provider output or hidden reasoning.

## Firestore read control

The page does not poll every 10 seconds. With 20 stored Runs, that interval could consume the Spark daily read quota if a browser stayed open. The one-minute visible-tab interval keeps the page current enough for a prototype and cuts that worst-case Run-list read rate by roughly six times. Run subcollections load only after a Supervisor opens a Run.

## Text readability

Useful descriptions, service values, Run outcomes, candidate rows, trace actions, and history values now use larger text. Compact mono type remains only for timestamps, state codes, and technical references.

## How to test

1. Sign in as a Root or Regular Supervisor and open **System**.
2. Confirm the status, worker setting, provider, backlog, recent Runs, and System issues match `GET /api/operations/v2/system` in Postman.
3. Expand a Run and confirm its decision summary, Cleaner candidates, distances, attempts, and actions match `GET /api/orchestrator/v2/runs/{runId}`.
4. Switch among **All**, **Assignments**, and **Reviews**.
5. Press **Refresh** and confirm the update time changes.
6. Pause the Orchestrator with a reason. Confirm the page changes to Paused and the new control-history row appears.
7. Resume it and confirm a second history row appears.
8. Test with `ORCHESTRATOR_WORKER_ENABLED=false`. The page must keep Site status and process-worker status separate and show the derived warning.
9. Stop FastAPI, refresh, and confirm only the FastAPI service row degrades. Restart FastAPI afterward.

## Verification completed

- The V2 System client has request-contract tests.
- All 43 frontend tests pass.
- Frontend TypeScript and the production build pass.
- The authenticated development database returned real counts, one readable assignment Run, candidate distances, provider attempts, Node actions, and the worker-disabled warning.
- Desktop and 390-pixel mobile layouts were checked with real backend values.
- The live development Site was paused once with the reason `System page integration verification`, then resumed. Both status changes and their control-history rows were confirmed in the authenticated browser. The Site was left running.

## Deferred

The temporary-media Model Playground remains the last System-page section. It is not part of this integration.
