# Phase 12.3 completed brief

Status: implemented locally against the canonical V2 database.

## What is wired

The delivered Alert and Work screens remain in place. Their action areas now call the V2 backend instead of altering local React state.

- A waiting Alert can select one currently available Cleaner and create a linked Work Order.
- A non-terminal Alert without Work can be dismissed with a required reason.
- The Work modal creates a real Camera-linked Manual Work Order with a selected available Cleaner, severity, and instructions.
- The Work drawer supports reassignment, Supervisor takeover of orchestrated Work, Work dismissal, review outcome, and review override.
- Camera detail now consumes the V2 read model for active Camera-targeted Work, recent Alert/Work history, protected snapshot references, structured Orchestrator trace, and related audit entries. Active Camera Work appears in the current-assignment area, and a Supervisor can cancel it with a reason.
- Every destructive or competing action requires an explicit reason.
- Every action uses the backend's opaque IDs, expected revision, and per-attempt idempotency key.
- The UI reloads the V2 read model after a successful mutation. Backend errors remain visible in the same action panel.

## What is intentionally not exposed

- The Supervisor cannot advance a Work Order through arbitrary statuses. Cleaners start Work and submit it for review. Supervisors act through assignment, reassignment, takeover, dismissal, and verification.
- Coordinate Manual Work is not shown in the existing modal. Its map is still an illustration with fixed anchors, so it cannot safely supply real metre coordinates. Camera-linked Manual Work is available now. Coordinate Work arrives with the true Site Map renderer.
- Cleaner actions, completion evidence upload, and Cleaner-side review submission remain Phase 12.4.

## Verification

```text
npm --workspace=frontend test
11 test files passed, 30 tests passed

npm --workspace=frontend run build
Passed

npm --workspace=backend run build
Passed

npm run validate:postman
Passed, 202 canonical resources validated

npm run test:emulator
Passed, including V2 Work Order, Alert test-support, Orchestrator, Cleaner, and operations integration workflows
```

## Manual browser checks

1. Sign in as the Root Supervisor and open a `waiting_for_cleaner` Alert.
2. Choose an available Cleaner in the assignment panel and assign the Alert. Confirm a Work Order appears after the page refreshes.
3. Open a different waiting Alert without Work, enter a dismissal reason, and dismiss it.
4. Open Work and create a Camera-linked Manual Work Order. Choose a Camera, available Cleaner, severity, and instructions.
5. Open an active Work Order. Enter a reason, select another available Cleaner, and reassign it.
6. For an awaiting-review fixture, choose pass, rework, or inconclusive, supply the reason, then submit the review. Use Override review only when a deterministic review outcome is already present.
7. Confirm all changes survive a browser reload and appear in the linked Alert/Work history.
8. Open a Camera with active Work. Confirm its current-assignment box shows the actual assigned Cleaner and non-editable status, recent history uses V2 records, and System Log shows only structured Orchestrator decisions. Use Cancel Work to dismiss the Work and its linked Alert with a reason.

## UI/backend mismatches found

- The supplied Manual Work map cannot create valid coordinate targets because it is decorative, not a V2 polygon map. This is deferred to the Site Map renderer work.
- Camera-target Work must ultimately navigate to Camera detail, while coordinate Work stays in Work detail/map context. The V2 Camera detail read model is ready; its UI integration follows the current frontend visual baseline.
- The existing Alert evidence layout assumes a retained image. Simulated Alerts may legitimately have none. The UI states that plainly.
