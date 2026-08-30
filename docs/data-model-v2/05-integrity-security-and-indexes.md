# Integrity, security and indexes

## Canonical embedded types

### Map point

```json
{ "xMeters": 12.5, "yMeters": 8.25 }
```

Both coordinates are finite, non-negative and inside the published Site dimensions. Normalized coordinates remain limited to Camera image geometry.

### Actor

```json
{
  "type": "human",
  "uid": "firebase-uid",
  "role": "supervisor",
  "authority": "regular",
  "displayNameSnapshot": "A. Supervisor"
}
```

Non-human actor types are `orchestrator`, `verification_engine`, `scheduler`, and `system`. They store `serviceId` and display label instead of UID.

### Safe error

Persist `code`, bounded `message`, component and retryability. Never persist stack traces, credentials, authorization headers, raw provider responses, absolute paths, uploaded file bytes or plaintext passwords.

## Canonical enums

| Concept | Values |
| --- | --- |
| Human role | `superadmin`, `supervisor`, `cleaner` |
| Supervisor authority | `root`, `regular` |
| Entity lifecycle | `active`, `inactive` |
| Zone lifecycle | `active`, `retired` |
| Camera source | `laptop_camera`, `looped_video` |
| Camera connection | `online`, `offline` |
| Camera cleanliness | `clean`, `alerted`, `cleaning_in_progress`, `awaiting_review`, `unknown` |
| Issue type | `floor_litter`, `floor_spill`, `bin_service`, `general_cleaning` |
| Observed condition | `litter`, `spill`, `full`, `overflow` |
| Severity | `warning`, `critical` |
| Alert status | `waiting_for_cleaner`, `assigned`, `in_progress`, `awaiting_review`, `resolved`, `dismissed` |
| Work status | `assigned`, `in_progress`, `awaiting_review`, `resolved`, `dismissed` |
| Work origin | `alert`, `manual` |
| Management mode | `orchestrated`, `manual` |
| Verification outcome | `passed`, `failed`, `inconclusive` |
| Availability Override | `none`, `unavailable` |

Do not reintroduce V1 values such as `new`, `acknowledged`, `awaiting_verification`, `unassigned`, `accepted`, `rejected`, `ready_for_review`, `rework_required`, `completed`, `cancelled`, `online`, `break`, assigned Zone, permitted Zones or Cleaner capabilities.

## Authorization matrix

| Action | Superadmin interface | Root Supervisor | Regular Supervisor | Cleaner | Orchestrator |
| --- | ---: | ---: | ---: | ---: | ---: |
| Create Site and first Root | yes | no | no | no | no |
| Recover Root / activate Site | yes | no | no | no | no |
| View selected-Site operational data | yes | yes | yes | own Work only | controlled tools only |
| Daily Alert/Work decisions | no | yes | yes | own transitions only | controlled tools only |
| Supervisor account management | recovery only | yes | no | no | no |
| Site Map dimensions/Zone/Camera placement | structural admin | yes | no | no | no |
| Camera Registration/re-registration | structural admin | yes | yes | no | no |
| Cleaner profile/schedule/station/override | structural admin | yes | yes | no | no |
| Pause/resume Orchestrator | structural admin | yes | yes | no | no |
| Read own notifications through Firestore | no product need | yes | yes | yes | no |
| Write operational Firestore directly | Admin backend only | no | no | no | no |

Superadmin access to selected-Site operational pages is read and structural in its separate interface. Daily dismissal, replacement, resolution and Verification override remain in the Client Supervisor interface.

## Required invariants

### Tenant and identity

- Every tenant-owned document has one valid `siteId`.
- Backend queries always add the caller's Site before other filters.
- Resource IDs from a request are loaded and checked against the caller's Site before mutation.
- Exactly one active Root Supervisor exists per active Site.
- A Cleaner and Supervisor belongs to one Site only.
- Email and Cleaner staff code are unique under their defined scopes.

### Site Map

- One Active Map Revision per Site.
- One editable Site Map Draft per Site.
- Published revisions never mutate.
- Active Zone polygons do not overlap.
- Camera Placements, Cleaner Station Points and coordinate Work targets fall inside exactly one active Zone.
- Operational and historical records snapshot their map revision, Zone label and point.

### Cameras

- The first Site Camera uses laptop source.
- At most one active laptop Camera exists per Site.
- Later prototype Cameras use looped video and publish with `monitoringEnabled=false`.
- Camera publication requires a ready source and validated initial Registration.
- Source replacement publishes its new Registration in the same transaction as the source pointer.
- Only one unexpired Monitoring Session lease owns Site capture.
- A sample must match the owner lease, Camera source revision, Registration revision, Monitoring Episode and next sequence.
- Replay/test samples never enter operational workflow.

### Alerts and Work

- One active Alert per Camera and issue type.
- One active Work Order per Alert.
- One active Work Order per Cleaner.
- A waiting Alert has `activeWorkOrderId=null`.
- An assigned/in-progress/awaiting-review Alert has one matching active Work.
- Alert and Work statuses advance together for Alert-origin Work.
- Manual Work has no Alert and starts already assigned.
- Coordinate Work requires Completion Evidence before `awaiting_review`.
- Assignment equals acceptance; Cleaner cannot reject or report a problem.
- Failed Verification reuses the same Cleaner and Work Order.
- Supervisor takeover sets management mode to manual and blocks later Orchestrator mutations.
- Resolution or dismissal releases the Cleaner and deletes active uniqueness keys.
- Dismissing linked Alert or Work dismisses both.

### Analytics and automation

- One minute bucket per Site/UTC minute.
- One daily summary per Site/local date.
- Event-to-daily-summary application is idempotent and versioned.
- Orchestrator only sees backend-validated waiting Alerts, available Cleaners, calculated Station Point distances and fresh Recent Work Location distances.
- The model selects an Alert and Cleaner pair. Node rejects either ID when it is absent from the supplied context or no longer eligible.
- Recent Work Location is ignored when stale or tied to a different Active Map Revision. It never represents live tracking.
- Each Cleaner is reserved at most once within one assignment run.
- Technical provider retries do not count as Cleaner attempts.
- Paused/inactive/manual state rejects Orchestrator tool mutations even if a worker has stale context.

## Atomic operations

### Create Site and Root Supervisor

Firebase Auth and Firestore cannot share a transaction. Use a recoverable saga:

1. validate the Superadmin and reserve email;
2. create Firebase Auth user;
3. transactionally create Site, initial empty map revision, `userAccounts`, `supervisors`, Root pointer, Orchestrator config and audit success;
4. mark email reservation active;
5. compensate or leave a repairable operation state if any step fails.

The Site remains non-operational until the Firestore transaction completes.

### Create Supervisor or Cleaner account

Use the same email-reservation saga. Cleaner creation also writes its profile and publishes one server-generated Station-only map revision through the approved narrow workflow. Account creation must fail closed if it cannot create a valid Station Point.

### Publish Site Map

Write and hash the immutable candidate revision and subcollections first. A transaction then checks draft revision/base pointer and changes `sites.activeMapRevisionId`. Because all reads follow this pointer, users see either the old complete map or the new complete map.

### Publish Camera Creation or replacement

Stage source, Registration and any new map revision documents. In one transaction:

- validate actor authority and Site state;
- validate draft/base revisions and media availability;
- create/update Camera;
- switch active source and Registration pointers;
- switch the Site map pointer when placement changed;
- create pointer summaries and audit event;
- delete or mark the draft published.

New looped Cameras start structurally active with monitoring disabled. Initial laptop Camera starts monitoring enabled.

### Create or update Alert

Transactionally load the active key, current Alert and Flag. Create an Alert/key or append an occurrence and update condition/severity/evidence metadata. Media bytes are finalized through the media pending/available protocol before the Alert points to them.

### Assign Cleaner and create Work

One transaction checks Site and Orchestrator state, Alert status/mode/revision, Cleaner status/schedule/override/station/`activeWorkOrderId`, and active keys. It then creates the Work and event, reserves the Cleaner, updates the Alert, creates uniqueness key, records Orchestrator action and creates notifications.

### Work transition and Verification

Each transaction checks actor, current revision and allowed transition. Applying a Verification updates Verification, Work, Alert, Camera derived state, Cleaner lock, keys, events and notifications together.

### Supervisor takeover or replacement

One transaction changes management mode to manual, invalidates pending automation for the aggregate, reserves/replaces Cleaner when requested, updates linked Alert/Work and appends events/audit.

### Site deactivation

Firestore cannot atomically update an unbounded number of Alert, Work and Cleaner documents. The database therefore uses an observable atomic boundary:

1. one transaction sets Site inactive, blocks access/monitoring/Orchestrator actions, records `deactivationOperationId`, cancels claimable Site outbox items, and writes the audit event;
2. an idempotent reconciliation worker pages through active Alerts and Work Orders, marks them dismissed with `site_deactivated`, releases Cleaners and writes histories;
3. APIs treat every operation under an inactive Site as effectively dismissed while reconciliation finishes;
4. the operation records counts and completes only after no active records remain.

This preserves the user-visible requirement without relying on Firestore's 500-write transaction limit. Reactivation never reopens dismissed records.

## Query and composite index plan

Create only indexes used by API contracts. Required composite indexes are:

| Collection | Fields in query order | Use |
| --- | --- | --- |
| `sites` | `status`, `nameNormalized` | Superadmin Site list |
| `identityOperations` | `status`, `updatedAt` | Provisioning recovery |
| `siteOperations` | `siteId`, `createdAt desc` | Site deactivation progress/history |
| `supervisors` | `siteId`, `status`, `fullName` | Site Supervisor list |
| `cleaners` | `siteId`, `status`, `fullName` | Cleaner management |
| `zones` | `siteId`, `lifecycleStatus`, `nameNormalized` | Zone identity list |
| `cameras` | `siteId`, `status`, `nameNormalized` | Camera list |
| `cameraSourceRevisions` | `cameraId`, `revisionNumber desc` | Source history |
| `cameraRegistrationRevisions` | `cameraId`, `revisionNumber desc` | Registration history |
| `monitoringEpisodes` | `cameraId`, `startedAt desc` | Camera history/support |
| `flags` | `siteId`, `cameraId`, `capturedAt desc` | Alert technical trace |
| `flags` | `alertId`, `capturedAt desc` | Alert Flag trace |
| `alerts` | `siteId`, `status`, `priorityScore desc`, `createdAt asc` | Alert queue/list |
| `alerts` | `siteId`, `severity`, `status`, `updatedAt desc` | Filtered Alert list |
| `alerts` | `cameraId`, `status`, `updatedAt desc` | Camera Details history/current |
| `workOrders` | `siteId`, `status`, `updatedAt desc` | Work list |
| `workOrders` | `assignedCleanerId`, `status`, `updatedAt desc` | Cleaner active/history |
| `workOrders` | `cameraId` derived target mirror, `updatedAt desc` | Camera Details work history |
| `orchestratorOutbox` | `status`, `availableAt` | Worker claims |
| `orchestratorRuns` | `siteId`, `createdAt desc` | System-page runs |
| `orchestratorRuns` | `alertId`, `createdAt desc` | Alert decision history |
| `notifications` | `recipientUid`, `createdAt desc` | Real-time inbox |
| `auditEvents` | `siteId`, `occurredAt desc` | Root audit view |
| `auditEvents` | `actorUid`, `occurredAt desc` | Superadmin investigation |
| `systemEvents` | `siteId`, `status`, `lastOccurredAt desc` | System page |
| `analyticsMinuteBuckets` | `siteId`, `bucketStart` | 15-minute and short-range charts |
| `analyticsDailySummaries` | `siteId`, `localDate` | Long-range analytics |
| `binPlacementInterventions` | `siteId`, `implementedAt desc` | Intervention history |
| `mediaAssets` | `ownerType`, `ownerId`, `createdAt desc` | Aggregate media history |
| `processingJobs` | `siteId`, `createdAt desc` | Replay job list |

Firestore may require separate variants for optional filters. Add one only after an endpoint and emulator test prove it is needed. Do not retain obsolete V1 indexes after V2 cutover.

Disable indexing for large maps/arrays: geometry, detections, model versions, input snapshots, decision factors, safe before/after maps, zone analytics maps, Dashboard arrays and validation arrays.

## Firestore Security Rules

Default deny remains the base:

```text
all collections: no direct client read or write
notifications: addressed authenticated user may read only
notifications: no direct client write
```

Notification read rule checks:

- request is authenticated;
- `resource.data.recipientUid == request.auth.uid`;
- the matching `userAccounts/{uid}` exists and is active;
- its Site matches the notification Site and the Site is active.

The frontend query must filter its own UID. Rules are not filters and reject an unbounded notification query.

The Admin SDK bypasses rules, so Node authorization tests remain mandatory.

## Retention table

| Data | Retention |
| --- | --- |
| Sites, users, stable entities, map revisions | Prototype lifetime |
| Alerts, Flags, Work, Verification, histories, audit | Prototype lifetime |
| Alert/Completion/configuration media | Prototype lifetime |
| Minute analytics | 90 days |
| Daily summaries and Interventions | Prototype lifetime |
| Notifications | 90 days by default, configurable |
| Orchestrator structured Runs/actions | Prototype lifetime |
| Raw Orchestrator debug files | 14 days, developer mode only |
| Monitoring episodes and system-event occurrences | 90 days |
| Operation keys | 30 days |
| Replay/test assets | 30 days by default |

Cleanup jobs mark media metadata before removing bytes, use allowlisted roots, and never operate on the shared production project during development.

## Schema evolution

- Every repository schema change increments a named contract version when meaning changes.
- Readers may temporarily accept V1 during a migration phase, but every V2 writer emits only V2.
- Historical snapshots are never silently rewritten just because names changed.
- Rebuildable caches may be deleted and regenerated.
- Migration scripts support dry-run, exact project/database validation, counts, resumable checkpoints and idempotent reruns.
