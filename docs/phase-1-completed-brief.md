# Phase 1 completed brief

## Status

Canonical migration Phase 1 is complete. It provides shared V2 persistence rules; it does not replace identity or operational services by itself.

## What was done

- Added a Site-scope assertion that returns not-found for cross-Site resources.
- Added a Site-scoped Firestore document loader for V2 repositories.
- Added optimistic `expectedRevision` enforcement with conflict responses.
- Added deterministic operation-key and request-body hashes.
- Added idempotency replay validation that rejects key reuse with different input.
- Added bounded audit-summary sanitization.
- Audit summaries now reject password, token, credential, authorization, secret, stack, path and raw-output fields at any nesting depth.
- Audit Events now include the planned `ipHash` field with a null prototype value.
- Added unit tests for Site isolation, revisions, idempotency and audit safety.
- Added an emulator integration test for Site-scoped loading and Audit Event persistence.
- Added the V2 foundation integration test to the standard emulator workflow.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm --workspace=backend run test -- --run \
  src/services/v2Persistence.test.ts \
  src/services/v2MigrationSafety.test.ts
Result: 2 files passed, 7 tests passed
```

## Testable behavior

- Loading a Camera from its own Site succeeds.
- Loading the same Camera under another Site returns 404 rather than revealing that it exists.
- A stale `expectedRevision` returns conflict.
- Reusing one idempotency key with another request body returns conflict.
- An Audit Event containing a nested `accessToken`, `password`, secret, stack or raw output is rejected.

## Guidance to test

Run the complete emulator workflow after starting no separate Firebase process:

```bash
npm run test:emulator
```

The workflow now includes `src/v2Foundation.integration.test.ts` and writes only to `demo-litterspot` emulators.

## Next phase

Phase 2 completes V2 identity, Site creation, Superadmin operations, Root/Regular Supervisor management, recovery, Site-state access checks and account-provisioning sagas.
