# Phase 12.7 System prototype completed brief

Superseded by [the System integration brief](phase-12-7-system-integration-completed-brief.md). This file records the approved hardcoded checkpoint before backend wiring.

## Outcome

`#/status` now shows a hardcoded System-page prototype instead of the obsolete model-health sample. It uses Melissa's current navigation, typography, colour, spacing, and operational-page patterns.

No System data is loaded from Node or Firebase yet. The page labels itself `Preview data`.

## What the prototype contains

- Orchestrator running or paused state.
- Background-worker, last-success, and configured-provider facts.
- Waiting Alert, awaiting-review Work, active Run, and recent outcome counts.
- A chronological assignment and review ledger.
- All, Assignments, and Reviews filters.
- Expandable decision details with a safe explanation, model/policy facts, retries, elapsed time, Cleaner candidates, distances, Node actions, and technical Run reference.
- Open and recovered System issues.
- Node, FastAPI, LLM-provider, and background-worker status rows.
- A recent pause/resume history.
- A pause confirmation with an optional reason.

## Prototype-only interactions

- Filtering and expanding Runs use local component state.
- Pausing changes the displayed status and adds a local history row.
- Resuming returns the displayed status to running and adds a local history row.
- Reloading the browser restores the original hardcoded data.
- No interaction sends an HTTP request or changes Firestore.

## How to review it

1. Start the normal LitterSpot frontend and sign in as a Supervisor.
2. Open `http://127.0.0.1:5173/#/status` or select **System**.
3. Compare the page with the Camera, Alert, Work, Team, and Insights pages. It should remain inside the same visual family.
4. Open and close each decision Run.
5. Switch among the three decision filters.
6. Open **Pause orchestrator**, inspect the warning and reason input, then confirm it.
7. Check that the status and control history change only in the current browser state.
8. Reload and confirm the original preview returns.
9. Review at a narrow browser width. The command panel, ledger, details, issue panels, and history should collapse without horizontal page overflow.

## Verification completed

- All 40 frontend tests passed.
- Frontend TypeScript and production build passed.
- The Impeccable mechanical detector returned no findings for the changed System files.
- Desktop and 390-pixel mobile layouts were inspected in the authenticated application shell.
- The pause confirmation and responsive navigation were checked without calling backend mutations.

## Next work

Collect page changes first. After approval, wire the prototype to:

- `GET /api/operations/v2/system`;
- `POST /api/orchestrator/v2/status`;
- `GET /api/orchestrator/v2/runs/{runId}`;
- `GET /api/health` where service health is useful.

The Model Playground remains a later System section.
