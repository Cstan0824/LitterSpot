# Phase 2 completed brief

## Status

Canonical migration Phase 2 is complete and bootstrapped in the isolated development Firebase project.

## What was done

- Fixed V2 Root/Regular Supervisor authentication. V2 profiles no longer fail the legacy `role` field check.
- Added active-Site validation to Supervisor and Cleaner authentication.
- Added global email reservations and durable identity-operation checkpoints.
- Added compensation that deletes a newly created Auth identity and releases its reservation when Firestore provisioning fails.
- Added idempotent Site plus first-Root creation.
- Site creation now accepts initial dimensions, grid size and optional background reference.
- Added Root-only Regular Supervisor listing, creation, profile update, activation and deactivation.
- Added Root self-deactivation and Root-deactivation protections.
- Added Superadmin Root password reset and complete Root replacement.
- Root replacement changes the Site pointer, demotes/disables the old Root, and activates the new Root atomically in Firestore.
- Added immediate inactive-Site access blocking.
- Added durable Site-operation records for deactivation/reactivation. Full Alert/Work reconciliation remains Phase 10.
- Made identity and privileged mutations write Audit Events in the same Firestore transaction as their domain changes where possible.
- Added HTTP/Auth/Firestore emulator coverage for the complete identity journey.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm run test:emulator
Result: passed, including V2 identity workflow

Targeted V2 identity test
Result: 1 file passed, 5 tests passed
```

The tested journey creates a Site and Root, signs in the Root, creates and signs in a Regular Supervisor, rejects Regular account administration, updates the Regular profile, blocks Site access on deactivation, reactivates the Site, resets the Root password, replaces the Root, and disables the old identity.

## Isolated development bootstrap

Verified target:

```text
Firebase project: litterspot-dev-jeremy
Firestore database: (default)
```

Created:

```text
Site: Sunway Theme Park
Superadmin: superadmin@litterspot.com
Root Supervisor: root@sunway-test.com
```

Passwords were supplied only as runtime environment variables. They were not written to Firestore, tracked files, briefs or logs.

Post-bootstrap validation:

```text
Auth users: 2
userAccounts: 2
userAccountEmails: 2
identityOperations: 1
sites: 1
supervisors: 1
siteMapRevisions: 1
orchestratorConfigs: 1
systemMetadata: 1
schema validation: valid
```

## Guidance to test

1. Start the API with `npm start`.
2. Sign in through Firebase Authentication using either supplied account.
3. Call `GET /api/me` with the Firebase ID token.
4. The Superadmin receives a Superadmin response.
5. The Root receives `siteId=sunway-theme-park` and `authority=root`.
6. As Root, test `GET/POST/PATCH /api/supervisors`.
7. As Superadmin, test Site status and Root recovery endpoints only in the isolated project.

## Remaining later work

Site deactivation blocks access immediately, but dismissing every active Alert/Work and releasing every Cleaner is intentionally completed in Phase 10 because it needs the V2 workflow collections.

## Next phase

Phase 3 completes Site Map draft lifecycle, Zone identity, background configuration, safe immutable revision staging, Station-only updates, audit and integration tests.
