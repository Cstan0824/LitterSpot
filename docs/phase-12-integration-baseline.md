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
- Six named integration Cleaners are created only if missing, alongside the existing first Cleaner. Their all-day development schedules make them available whenever they do not have an active Work Order.
- `Main Entrance Camera` is the first laptop-camera fixture. It is the only browser-camera source.
- `Food Court Demo Camera` is a looped-video fixture with a registered bin. Its source is local development media and it is not a real CCTV feed.
- A current waiting Alert is available for manual assignment. A separate simulated Alert is assigned by a deterministic development Orchestrator run, so the System page has a completed Run without calling a real model provider.
- The Work list contains examples of `assigned`, `in_progress`, `awaiting_review`, `resolved`, and `dismissed`. One in-progress Work has a rework count. One resolved coordinate Work has real local completion-image metadata and Verification history.
- Alert data includes waiting, assigned, in-progress, dismissed, and resolved examples. Work transitions create recipient notifications, so Cleaner notification screens have real inbox items.
- The existing Cleaner and in-progress coordinate Work Order remain untouched. They provide a second busy-Cleaner example.
- The Phase 11 development seed is refreshed against the current active map. It creates historical resolved simulation data, daily summaries, a Dashboard snapshot, and Bin Placement recommendations.

The command records its result in `systemMetadata/integrationBaseline`. It stores the fixture IDs needed for targeted manual testing. The marker is for development inspection only, not product behaviour.

## What is deliberately not pre-created

A live Monitoring Session, webcam stream, looped-video playback lease, sampled inference result, and a real alert-evidence frame only exist while a browser owns monitoring. Phase 12.6 must create and release those at runtime. The two published Cameras provide the laptop and looped-video sources needed for that test.

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
