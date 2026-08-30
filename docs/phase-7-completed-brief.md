# Phase 7 completed brief

## Status

Canonical migration Phase 7 is complete. `/api/alerts` now uses the V2 Camera-scoped Alert model, and live samples automatically feed Flag and Alert qualification.

## What was done

- Connected Phase 6 live observations to persistent V2 Flags.
- Added the provisional 0.5 confidence gate and persisted qualification snapshots/model versions.
- Implemented floor litter as three positives among the latest five, triggering as soon as three positives exist.
- Implemented floor spill from one qualifying observation.
- Implemented bin service as two positives among the latest three, triggering as soon as two positives exist.
- Combined registered-bin full and overflow into one `bin_service` Alert.
- Full creates warning; overflow escalates the same Alert to critical.
- Added one active Alert key per Site, Camera and issue type.
- Added Alert occurrences and append-only events.
- Added highest-confidence Alert Evidence persistence with original frame and structured detection geometry.
- Equal-confidence overflow evidence can replace full-bin evidence because it represents the stronger condition.
- Ordinary frames remain in memory and are not persisted unless chosen as Alert Evidence.
- Added Alert priority score, unresolved aging and warning-to-critical escalation after 15 minutes.
- Added Site-scoped Alert list/detail APIs.
- Alert details include technical Flags, occurrences and events without adding a separate product Flag page.
- Added Supervisor dismissal with required reason, optimistic revision check, active-key release and history.
- Replaced the mounted V1 `/api/alerts` routes with V2 routes.

## APIs

```text
GET  /api/alerts
GET  /api/alerts/:alertId
POST /api/alerts/age
POST /api/alerts/:alertId/dismiss
```

The live sample response also includes `alertEvaluation` so the sandbox can show whether each issue produced a Flag or Alert.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm run test:backend
Result: 60 test files passed, 239 tests passed

npm run test:emulator
Result: passed

V2 live monitoring and Alert integration
Result: 1 file passed, 5 tests passed

git diff --check
Result: passed
```

The emulator workflow verifies:

- one spill sample creates one spill Alert;
- only chosen Alert Evidence becomes a media asset;
- two qualifying full-bin samples create one warning `bin_service` Alert;
- overflow updates that same Alert to critical rather than opening another Alert;
- one active key exists for Camera plus bin service;
- list/detail returns Flags, occurrences and events;
- a warning older than 15 minutes ages to critical;
- Supervisor dismissal becomes terminal and releases the active key;
- duplicate live sample sequences remain rejected.

## Guidance to test manually

1. Start monitoring and submit live Camera samples as described in the Phase 6 brief.
2. Use a frame with a qualifying spill. One positive sample should create a critical spill Alert.
3. Use repeated full-bin frames. The second qualifying positive within the latest three should create one warning bin-service Alert.
4. Submit an overflow frame. The existing bin-service Alert should become critical.
5. Call `GET /api/alerts/:alertId` and inspect its evidence, Flags, occurrences and events.
6. Confirm only Alert Evidence is stored under `mediaAssets`.
7. Dismiss a false Alert with its current `revision` and a reason.

## Cloud state

No Flags, Alerts or Alert Evidence were written to cloud Firebase. Verification used `demo-litterspot` emulators and isolated emulator media storage.

## Known boundary

- Thresholds remain provisional and configurable calibration work is still needed.
- V2 Alert creation currently leaves an Alert in `waiting_for_cleaner`. Phase 8 adds manual and atomic Work Order assignment; Phase 9 later connects autonomous assignment.
- Evidence media from earlier lower-confidence selections is retained for prototype history rather than physically deleted when better evidence replaces it.
- Alert aging has an authenticated service endpoint. A later scheduler can invoke the same service automatically.

## Next phase

Phase 8 builds V2 Work Orders and Verification: atomic Cleaner reservation, manual Camera/coordinate Work, simplified Cleaner actions, Completion Evidence, deterministic Camera review, Supervisor takeover/replacement and linked Alert/Work state updates.
