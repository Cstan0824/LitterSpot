# Phase 6 completed brief

## Status

Canonical migration Phase 6 is complete. The backend now accepts lease-owned browser Camera samples and sends them through the private FastAPI frame-inference contract without storing ordinary frames.

## What was done

- Completed one-owner Monitoring Session claim, heartbeat, release and expired-lease failover.
- Fixed lease restoration to read Firestore `leaseExpiresAt` correctly.
- Added hashed lease-token validation. Raw tokens are returned only to the claiming browser.
- Added authenticated Monitoring Episodes pinned to Camera source, Registration, Site Map revision and Zone.
- Starting a simulation episode clears that Camera's in-memory temporal, evidence and minute state.
- Added strict sequential sample numbers and duplicate/replay rejection.
- Added JPEG, PNG and WebP signature validation for browser samples.
- Added active Site, Camera, monitoring toggle, source revision, Registration revision, map placement and ownership checks.
- Added per-Camera serialized inference so multiple samples cannot run the same Camera's model work concurrently.
- Reused the existing private FastAPI `/analyze/frame` adapter with Registration geometry, reference image and bin review enabled.
- Added Camera Runtime State with connection, latest sample/inference, people count, issue summary and safe source errors.
- Added bounded in-memory five-sample temporal windows.
- Added highest-confidence evidence candidates in memory. Phase 7 persists only the selected Alert Evidence.
- Added Site/Camera/minute accumulators and Site-wide `analyticsMinuteBuckets` flush.
- Minute buckets retain Site timezone, map revisions, per-Zone people/issues/sample coverage, simulation counts and 90-day expiry.
- Confirmed ordinary live frames do not create `mediaAssets`, `analysisRuns` or `detections` documents.
- Added offline timeout detection that closes the Monitoring Episode and marks Camera Runtime State offline.
- Session release closes its active Episodes and marks their Cameras offline.
- Restricted offline and minute-flush maintenance to the authenticated Supervisor's Site.
- Added required Firestore indexes for Monitoring Episodes and Camera Runtime State.

## APIs

```text
POST /api/monitoring/sessions/claim
POST /api/monitoring/sessions/:sessionId/heartbeat
POST /api/monitoring/sessions/:sessionId/release
POST /api/monitoring/sessions/:sessionId/cameras/:cameraId/start
POST /api/monitoring/sessions/:sessionId/cameras/:cameraId/samples
POST /api/monitoring/offline-sweep
POST /api/monitoring/minute-flush
```

The sample endpoint accepts multipart form data:

```text
frame       File
episodeId   Text
sequence    Text integer starting at 1
capturedAt  ISO 8601 timestamp
```

Send the raw lease token in `x-monitoring-token`.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm run test:backend
Result: 60 test files passed, 239 tests passed

npm run test:emulator
Result: passed

V2 Monitoring integration
Result: 1 file passed, 3 tests passed

git diff --check
Result: passed
```

The emulator workflow verifies:

- first browser claims ownership;
- second claim fails while the lease is active;
- valid Camera Episode starts;
- sample reaches a controlled inference adapter;
- Camera Runtime State becomes online;
- simulation metadata propagates;
- temporal and evidence buffers receive the observation;
- one Site-wide minute bucket is persisted;
- ordinary frame/media/inference documents are not persisted;
- duplicate sequence fails;
- stale Camera becomes offline;
- expired lease permits another claim;
- wrong release token fails;
- correct owner release succeeds.

The emulator substitutes a deterministic inference response. It tests the Node/Firebase live workflow without loading the trained models. The existing FastAPI contract tests cover response validation; practical model behavior remains a manual calibration task.

## Guidance to test manually

1. Start FastAPI and the Node backend.
2. Sign in as a Supervisor.
3. Ensure a Camera is active, registered and `monitoringEnabled=true`.
4. Claim a Monitoring Session and save its `sessionId` and `leaseToken` in memory only.
5. Start a Camera Episode.
6. Capture one browser frame every two seconds.
7. Send monotonically increasing sequence values.
8. Send a heartbeat before the 30-second lease expires.
9. Inspect `cameraRuntimeStates/{cameraId}` for connection, people and issue updates.
10. Confirm the uploaded frame does not appear in `mediaAssets`.
11. Flush completed minutes and inspect `analyticsMinuteBuckets`.

## Cloud state

No Monitoring Session, Episode, sample, runtime state or analytics bucket was written to cloud Firebase. Automated verification used `demo-litterspot` emulators.

## Known boundary

- Phase 6 keeps possible issue evidence frames only in process memory. A Node restart loses unconfirmed temporal/evidence state, which is acceptable for the prototype.
- Alert qualification and persistent Alert Evidence begin in Phase 7.
- Offline and minute-flush functions currently have authenticated maintenance endpoints. A later scheduler can call the same services automatically.
- A browser sandbox for webcam/video playback is still needed for visual manual testing, but it is not product frontend work.

## Next phase

Phase 7 consumes the live temporal and evidence buffers to persist V2 Flags, create one Camera-scoped Alert per issue, retain highest-confidence evidence, apply `bin_service` escalation, age priority and expose Alert traceability.
