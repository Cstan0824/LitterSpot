# Phase 12.0 completed brief

Status: completed on branch `jeremy` without commit, push, merge, deployment, cloud mutation, or service restart.

## Files changed

- `docs/phase-12-frontend-contract-matrix.md`
- `frontend/package.json`
- `frontend/vitest.config.ts`
- `package-lock.json`
- Frontend V2 foundation and tests listed in the Phase 12.1 brief

`api-sandbox/` remains a separate workspace and was not changed.

## Behavior delivered

- Verified branch `jeremy`, commit `16ca799`, matching `origin/jeremy`, and a clean starting worktree.
- Verified the canonical Firebase project ID from safe project-only checks in `frontend/.env.local` and `.firebaserc`.
- Recorded the product frontend baseline, current page/action classifications, code/document contradictions, and future V2 endpoint/role/authority mappings.
- Added a practical Vitest setup for frontend service, session, routing, cleanup, idempotency, and media code.
- Kept all existing visual components and operational business pages in place.

## Tests run

```text
npm --workspace=frontend test
10 test files passed, 28 tests passed

npm --workspace=frontend run build
Passed

npm --workspace=backend run build
Passed

git diff --check
Passed
```

The Vite development server also returned HTTP 200 at `http://127.0.0.1:5173/`.

## Manual test instructions

1. Start only the existing LitterSpot frontend if no process owns port 5173.
2. Open `http://127.0.0.1:5173`.
3. Confirm the login page has no Cleaner demo button.
4. Sign in with each available role and confirm the destination matches the Phase 12.1 brief.
5. Do not exercise operational mutation controls as V2 acceptance in this phase; those pages remain V1, mock, or local-only by design.

## Known gaps

- Operational Dashboard, Alert, Work, Cleaner, Camera, monitoring, Bin Analysis, System, and Superadmin data are not wired.
- Several existing pages still display hardcoded Batu Caves labels and mock evidence.
- V1 and mock files remain because current runtime components still import them.
- No cloud smoke request was needed because unit tests and builds cover this phase without consuming Firestore quota.

## Exact next phase

Phase 12.2: Supervisor read-only V2 pages. Start with Dashboard, published Site Map, Alerts, Work, Cleaner list/detail, and Camera list/detail reads. Do not enable mutations in that phase.
