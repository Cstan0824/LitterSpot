# Phase 10 backend delivery brief

Status: notification delivery, Site cleanup and System read APIs are implemented and tested locally. No product frontend integration or cloud rules/index deployment was performed.

## What changed

- Added an immutable recipient-event writer and V2 inbox queries.
- Cleaner inbox reads now use the Firebase Auth recipient UID, not the old V1 Cleaner-ID query.
- Resolution, rework, dismissal and replacement notify the affected Cleaner.
- Replacement tells the old Cleaner the task was removed and sends an assignment to the new Cleaner.
- New Alerts and priority escalations notify Supervisors when automation is paused.
- Root Supervisors can read only their Site's audit events through the new route.
- Administrative account/map/Work transaction audits remain. A supplemental audit records successful Camera draft, map draft, monitoring control, Supervisor-account and Alert control requests without copying bodies or credentials.
- Deactivation creates a durable operation. It dismisses active Work and Alerts, releases Cleaner locks, cancels pending Orchestrator work, releases monitoring ownership and removes active uniqueness keys.
- Historical records and evidence remain. Dismissal does not update the Cleaner's recent resolved location.
- Small Sites finish cleanup during the status request. Larger Sites resume through a five-second maintenance tick or a Superadmin reconciliation request.
- Reactivation is blocked until cleanup completes. It does not reopen Work or resume the Orchestrator automatically.
- System API reports configuration, process worker-enabled state, recent decisions and safe aggregated events.
- Run attempt/action timestamps now use ISO strings. Completed assignment Runs inherit the selected Alert's simulation flag.
- New persisted provider errors are generic. Raw provider exceptions are not added to the System-page response.

## API and Postman

Folder: `postman/collections/23 - V2 Phase 10 Operations/`.

Reuse the existing V2 login requests. Root requests use `v2RootToken`, Cleaner requests use `v2CleanerToken`, and Superadmin requests use `v2SuperadminToken`.

| Request | Endpoint | Access |
| --- | --- | --- |
| 01 System | GET /api/operations/v2/system | Site Supervisor |
| 02 Notifications | GET /api/operations/v2/notifications | Own Supervisor inbox |
| 03 Audit Events | GET /api/operations/v2/audit-events | Root, own Site only |
| 04 Cleaner Notifications | GET /api/cleaner/notifications | Own Cleaner inbox |
| 10 Deactivate Test Site | PATCH /api/superadmin/sites/:siteId/status | Superadmin |
| 11 Read Site Operation | GET /api/superadmin/sites/:siteId/operations/:operationId | Superadmin |
| 12 Reconcile Site | POST /api/superadmin/sites/:siteId/operations/:operationId/reconcile | Superadmin |
| 13 Reactivate Test Site | PATCH /api/superadmin/sites/:siteId/status | Superadmin |

There are no V2 push-token, mark-read, unread-count or notification acknowledgement endpoints.

## What to test yourself

### Safe read tests

1. Restart Node after pulling these changes.
2. Sign in as Root and send requests 01 through 03.
3. In System, `runtime.backgroundWorkerEnabled` reflects the environment setting. It is separate from `configuration.status` and `assignmentEnabled`.
4. For the paused-Alert notification test, change `v2TestAlertRequestId` and use a Camera/issue without an active Alert. Request 05b must return `idempotent: false` and `status: waiting_for_cleaner`.
5. Sign in as the assigned Cleaner and send request 04. The assignment notification should appear.
6. Complete or dismiss Work through existing Phase 8 controls and inspect the corresponding Cleaner event.
7. Repeat inbox reads. Reading does not mark events read or remove them.

The System response deliberately uses `providerConnectivity: not_probed`. A running configuration does not prove that Ollama is reachable.

### Optional destructive Site test

Use only the isolated development project. Deactivation dismisses active Work and Alerts permanently. Reactivation restores access, not those operational states.

1. Set Postman `allowSiteDeactivationTest=true` only after checking the backend's Firebase target.
2. Sign in as Superadmin and send request 10.
3. Request 10 saves `v2SiteOperationId`.
4. Use request 11 to check cleanup status. Request 12 processes another page if needed.
5. Site users must be rejected while the Site is inactive.
6. Wait for `operation.status=completed`, then send request 13.
7. Sign in as Root again. Old Work and Alerts remain dismissed; the Orchestrator stays paused until explicitly resumed.
8. Reset `allowSiteDeactivationTest=false`.

No cloud Site was deactivated by the automated tests.

## Real-time behavior and security

The frontend subscribes only to its own notification documents with a Site filter and creation-time ordering. Node remains the writer. Firestore rules deny direct writes, other recipients, other Sites, inactive accounts and inactive Sites.

The emulator suite uses the Firebase client SDK, signs in through the Auth emulator and attaches a real `onSnapshot` listener. It verifies delivery plus permission-denied responses. These are not Admin-SDK-only access checks.

Postman can verify persisted inbox data, but it does not reproduce a browser Firestore listener.

## Verification commands

Verified locally: 245 backend unit tests, the full Auth/Firestore emulator suite, four platform-operation scenarios, 22 hardened Orchestrator scenarios, 188 Postman YAML resources and the TypeScript build.

```bash
npm --workspace=backend run build
npm run validate:postman
npm run test:emulator
```

The Phase 10 tests cover immutable writes, client delivery, inbox reload, access rules, deactivation, resumable pagination, reactivation blocking, history preservation, tenant-scoped audit reads and System event recovery. Existing Work tests check rework and resolved notification creation.

## Deployment and limitations

- No cloud data, credentials or product frontend files were changed in this phase.
- New notification and Run-list query indexes were added to `firestore.indexes.json`. `firebase.development.json` targets `(default)` for your isolated development project, while the existing emulator/legacy config remains unchanged. Nothing was deployed automatically. Once signed into Firebase CLI, deploy only to the development project with:

  ```bash
  npx firebase deploy --project litterspot-dev-jeremy --config firebase.development.json --only firestore:indexes,firestore:rules
  ```

  Wait for indexes to finish building before testing their cloud queries.
- Expiry timestamps describe the notification retention policy; this phase does not enable managed Firestore TTL billing or delete stored notification history.
- Supplemental request-level audit writes happen after the domain action and before the success response. Core domain transaction audits are atomic; request supplements are not a replacement for them.
- Historical V1 code remains until the planned frontend cutover. V2 does not expose FCM or read-receipt actions.
- The Phase 9 follow-up checks are now complete. See [the resolved audit](phase-9-follow-up-audit.md).

## Next work

Phase 11 completes Dashboard and analytics APIs. Product frontend wiring remains Phase 12.
