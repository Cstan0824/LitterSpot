# Phase 12 integration baseline

The canonical development target is `litterspot-v2-database/(default)`. This document describes the repeatable fixture set used while wiring the delivered frontend to V2 APIs.

## Prepare the baseline

From the repository root, run:

```bash
INTEGRATION_FIXTURE_PASSWORD='set-a-local-test-password' npm --workspace=backend run v2:prepare-integration-baseline
```

The command refuses every Firebase target except `litterspot-v2-database/(default)`. It does not reset or delete application data. It only creates a missing fixture, then reuses matching existing records.

It requires the active Sunway map to already contain the V2 `zoneGeometry` polygons for Main Entrance and Food Court. That is true for the current canonical database.

## Fixture data

- Existing Superadmin, Root Supervisor, Regular Supervisor, and Cleaner accounts remain unchanged.
- `Integration Test Cleaner` is created only if missing. Their station is in Food Court and their all-day development schedule makes them available when they have no active Work Order.
- `Main Entrance Camera` is the first laptop-camera fixture. It is the only browser-camera source.
- `Food Court Demo Camera` is a looped-video fixture with a registered bin. Its source is local development media and it is not a real CCTV feed.
- One simulated Floor Litter Alert is created for Food Court Demo Camera. It stays open so alert, assignment, and work screens have a predictable item to render.
- The existing Cleaner and in-progress coordinate Work Order remain untouched. They exercise busy-cleaner and active-work views.
- The Phase 11 development seed is refreshed against the current active map. It creates historical resolved simulation data, daily summaries, a Dashboard snapshot, and Bin Placement recommendations.

The command records its result in `systemMetadata/integrationBaseline`. That marker is for development inspection only, not product behaviour.

## Safe Postman use

Run **V2 Map - Get Active Map** first. It updates `v2ActiveMapRevisionId` from the live database.

The Postman map bootstrap save/publish requests are disabled by default through `v2BootstrapMapOnly=false`. They replace the complete map draft, including camera placements and Cleaner stations, if published. Enable them only for an intentional clean bootstrap.

Cleaner creation is also disabled by default through `v2CleanerBootstrapOnly=false`. To create a new Cleaner deliberately, use a new email, staff code, and `v2CleanerCreateIdempotencyKey`. Do not reuse a key whose previous identity operation is terminal.

## Workers during frontend work

Keep these local settings disabled while testing fixtures:

```text
ANALYTICS_WORKER_ENABLED=false
ORCHESTRATOR_WORKER_ENABLED=false
```

Manual Dashboard, analytics, alert, work, and orchestration routes still work. Disabling the loops protects the Firebase Spark read quota and prevents the simulated alert from being assigned behind the UI's back.
