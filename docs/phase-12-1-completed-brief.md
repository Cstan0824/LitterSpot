# Phase 12.1 completed brief

Status: implemented and locally verified. No backend response contract changed.

## Files changed

### Runtime

- `frontend/src/main.tsx`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/CameraRegistrationPage.tsx`
- `frontend/src/components/RoleIntegrationPendingPage.tsx`
- `frontend/src/features/operations/OperationsConsole.tsx`
- `frontend/src/features/operations/CameraOperationsPage.tsx`
- `frontend/src/session/SessionProvider.tsx`
- `frontend/src/styles.css`
- `backend/src/routes/siteMapRoutes.ts`

### Shared V2 layer

- `frontend/src/services/v2/accountScope.ts`
- `frontend/src/services/v2/errors.ts`
- `frontend/src/services/v2/http.ts`
- `frontend/src/services/v2/idempotency.ts`
- `frontend/src/services/v2/media.ts`
- `frontend/src/services/v2/routing.ts`
- `frontend/src/services/v2/session.ts`

### Tests and setup

- `frontend/vitest.config.ts`
- `frontend/src/services/v2/accountScope.test.ts`
- `frontend/src/services/v2/errors.test.ts`
- `frontend/src/services/v2/http.test.ts`
- `frontend/src/services/v2/idempotency.test.ts`
- `frontend/src/services/v2/media.test.ts`
- `frontend/src/services/v2/routing.test.ts`
- `frontend/src/services/v2/session.test.ts`
- `frontend/package.json`
- `package-lock.json`
- `postman/environments/LitterSpot Local.environment.yaml`
- `postman/collections/17 - V2 Phase 1-2 Identity/V2 Regular Supervisor Login.request.yaml`
- `postman/collections/17 - V2 Phase 1-2 Identity/V2 Regular Supervisor - Current User.request.yaml`
- `postman/collections/17 - V2 Phase 1-2 Identity/V2 Regular Supervisor - Root Audit Forbidden.request.yaml`
- `backend/src/v2SiteMap.integration.test.ts`

## Behavior delivered

- Firebase Email/Password remains the identity mechanism.
- One session provider owns Firebase auth-state changes and the authoritative `GET /api/me` call.
- The provider parses Superadmin, Supervisor, and Cleaner response shapes.
- Supervisor sessions retain `siteId` and `authority`, with tested root/regular capability derivation.
- Supervisors enter the existing Supervisor shell.
- Authenticated Cleaners enter a Cleaner integration-pending page. They cannot enter Supervisor pages and no mock Cleaner data is shown.
- Authenticated Superadmins enter a separate Superadmin integration-pending page. They are not presented as Site Supervisors.
- The unauthenticated Cleaner demo button and session bypass were removed.
- Root-only Camera creation controls are hidden from Regular Supervisors. Regular Supervisors can still open registration for an existing Camera.
- Postman can now sign in as the created Regular Supervisor, assert `/api/me` returns `authority: regular`, and verify the Root-only audit endpoint returns `403` without mutating data.
- Full Site Map draft save, validate, publish, and delete routes now apply the Root Supervisor middleware before parsing input or calling map services.
- Regular Supervisors retain the narrow Cleaner Station Point publication route required by the authority matrix.
- The typed V2 request layer gets a Firebase ID token for every request, supports JSON and FormData, carries `AbortSignal`, parses structured errors, and performs no automatic mutation retries.
- Structured errors preserve status, code, details, request ID, and `Retry-After`. `firestore_quota_exceeded` is a distinct 503 case.
- Login and session failures distinguish invalid credentials, disabled Firebase accounts, inactive application access, forbidden access, backend failure, and Firestore quota exhaustion.
- Mutation idempotency keys remain stable for one logical attempt and rotate only for a new mutation.
- The authenticated media loader fetches protected bytes with the shared request layer, returns object URLs, revokes replaced/released URLs, and registers account-scope cleanup.
- Account-scoped cleanup runs on logout and Firebase UID changes. Future caches and real-time listeners can register with the same cleanup registry.

## Tests and results

```text
npm --workspace=frontend test
10 test files passed, 28 tests passed

npm --workspace=frontend run build
Passed

npm --workspace=backend run build
Passed

git diff --check
Passed

Vite HTTP smoke at http://127.0.0.1:5173/
Passed with HTTP 200

npm run validate:postman
Passed, 202 canonical YAML resources and embedded scripts validated

Firebase Auth and Firestore emulator target:
src/v2SiteMap.integration.test.ts and src/v2Identity.integration.test.ts
2 test files passed, 10 tests passed
```

Coverage includes:

- all three `/api/me` response shapes;
- root and regular Supervisor capability derivation;
- role destinations and rejection of the former Cleaner hash route;
- logout and account-switch cleanup;
- structured error parsing;
- 401 versus `503 firestore_quota_exceeded`;
- idempotency-key stability and rotation;
- per-request Firebase token attachment;
- JSON, FormData, and `AbortSignal` handling;
- authenticated media object URL creation and revocation without returning protected URLs or tokens.

The targeted backend tests cover Regular Supervisor Firebase login, `/api/me`, Root-only Supervisor account creation, full Site Map mutation denial, Root map publication, and Regular Supervisor Cleaner Station Point publication.

The Impeccable detector reported the frontend's existing Inter/Space Grotesk and thick side-border warnings. Those styles predate Phase 12.1 and were left unchanged to preserve the current visual design.

## Manual browser tests

1. Check port ownership before starting Vite. Use `http://127.0.0.1:5173` only if it is free or already belongs to LitterSpot.
2. Open the login page and confirm there is no "Try Cleaner mobile demo" action.
3. Enter incorrect credentials and confirm the message says the email or password is incorrect.
4. Sign in as a Root Supervisor. Confirm the existing Supervisor shell opens and Add Camera is visible.
5. Sign in as a Regular Supervisor. Confirm the Supervisor shell opens, Add Camera is hidden, and existing Camera Registration remains reachable.
6. Sign in as a Cleaner. Confirm the Cleaner integration-pending page appears even if the URL hash points to `/alerts`, `/cameras`, or `/history`.
7. Sign in as a Superadmin. Confirm the separate Superadmin integration-pending page appears and no Site Supervisor navigation is shown.
8. Sign out from each role, then sign in as another role in the same tab. Confirm the new role destination replaces the previous account state.
9. Stop the Node service temporarily only if it is confirmed to be the LitterSpot process, then retry a signed-in session. Confirm the backend-unavailable state differs from invalid credentials and Firestore quota copy. Restart only that same LitterSpot service afterward.

## Known gaps

- Supervisor operational pages still use V1, mock, or local React-only data. This is intentional until Phase 12.2 and later.
- Cleaner business data remains unwired until Phase 12.4. The mock mobile component remains in the repository but has no operational login route.
- The separate Superadmin product area and Root Supervisor account-management UI remain Phase 13 work.
- The authenticated media loader is ready but operational pages do not consume it yet.
- Notification listeners are not started in Phase 12.1. The account cleanup registry is ready for them.
- Existing V1 service modules and types remain because current pages still consume them.
- The frontend bundle still reports the existing chunk-size warning. No code splitting was added because this phase is not a frontend restructuring pass.

## Integration baseline preparation

After this phase was implemented, the canonical `litterspot-v2-database/(default)` development database was prepared for the next integration steps.

- Corrected the Phase 11 seed so it reads the active V2 map revision and its `zoneGeometry` records. It no longer writes the obsolete map `zones` subcollection or assumes `sunway-theme-park-initial` remains active.
- Added `npm --workspace=backend run v2:prepare-integration-baseline`. The exact-target command reuses existing records, creates missing development fixtures, and never resets the database.
- Prepared an available second Cleaner, a Main Entrance laptop Camera, a Food Court looped-video Camera with a registered bin, and one open simulated Food Court litter Alert.
- Preserved the existing busy Cleaner and in-progress coordinate Work Order. These provide active-state fixture data for later screens.
- Refreshed the historical Phase 11 seed, Dashboard, and Bin Placement snapshot against the current active map.
- Disabled unsafe Postman bootstrap requests by default. A map bootstrap can replace every map placement and Cleaner station if published, so it now requires an explicit environment opt-in. Cleaner creation also requires an explicit opt-in and a fresh idempotency key.

The fixture data and safe Postman instructions are recorded in [Phase 12 integration baseline](phase-12-integration-baseline.md).

## Exact next phase

Phase 12.2: wire Supervisor read-only V2 pages only. Connect `GET /api/dashboard/v2`, `GET /api/site-map`, V2 Alert list/detail, V2 Work list/detail/history/Verifications, V2 Cleaner list/detail, and `GET /api/camera-creation/cameras`. Keep mutation controls disabled or unavailable and do not begin Cleaner mobile, monitoring, Bin Analysis, System, or Superadmin business integration. Prepare the [Phase 12 integration baseline](phase-12-integration-baseline.md) first so every page has stable cloud fixture data.
