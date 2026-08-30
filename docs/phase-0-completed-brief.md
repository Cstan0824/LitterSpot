# Phase 0 completed brief

## Status

Canonical migration Phase 0 is complete. This phase changed migration tooling only. It did not reset or bootstrap cloud Firebase.

## What was done

- Kept the Firestore V2 contract and allowlisted collection catalogue in `backend/src/shared/v2Contracts.ts`.
- Added one migration-target guard shared by inspect, validate, reset and bootstrap commands.
- Restricted cloud migration commands to `litterspot-dev-jeremy/(default)`.
- Allowed destructive-path testing only against `demo-litterspot/litterspot` with both Firebase emulators enabled.
- Made reset dry-run by default.
- Required `--apply` plus an exact `--confirm-target=<project>/<database>` value for destructive reset.
- Changed reset to delete nested subcollections recursively. Deleting only parent documents would have left orphaned Site Map and history records.
- Changed dry-run counts to include nested subcollection documents.
- Changed target inspection to count every Firebase Authentication page rather than only the first user.
- Changed schema validation to fail when `systemMetadata/schema` is missing, not ready, or points to another environment.
- Fixed bootstrap transaction read ordering so all reads occur before queued writes.
- Added focused migration-safety tests.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm --workspace=backend run test -- --run \
  src/config/firebaseTargetSafety.test.ts \
  src/services/v2MigrationSafety.test.ts
Result: 2 files passed, 6 tests passed
```

No cloud reset or bootstrap command was executed.

## Testable commands

Inspect the configured target without writes:

```bash
npm --workspace=backend run v2:inspect-target
```

Validate an already bootstrapped V2 schema marker:

```bash
npm --workspace=backend run v2:validate-schema
```

Preview reset counts without deleting anything:

```bash
npm --workspace=backend run v2:reset-application-data
```

The output must show:

```text
target: litterspot-dev-jeremy/(default)
mode: dry-run
```

Do not use `--apply` unless the exact Firebase target has been inspected and destructive reset has been explicitly approved.

## Known boundary

Phase 0 does not prove V2 identity or business workflows. Bootstrap account creation and Site persistence are completed and tested in Phase 2.

## Next phase

Phase 1 builds the shared Site-scoped repository, audit-safety, revision, transaction and idempotency foundation used by every V2 service.
