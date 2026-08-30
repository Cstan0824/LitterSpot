# LitterSpot Firestore V2 plan

## Status and authority

This directory defines the target application database for the clarified LitterSpot product. It is a design contract, not an implemented schema.

Use these documents for the backend rebuild and later frontend API integration. The older [`firestore-data-model.md`](../firestore-data-model.md) and [`database-field-dictionary.md`](../database-field-dictionary.md) describe the currently implemented V1 database. They remain useful when deciding what code to retain, but they do not override this V2 plan.

No Firebase data was changed while preparing this plan.

## Design decisions

- Firestore remains the application database.
- Firebase Authentication owns credentials. Firestore never stores passwords.
- `Site` is the tenant. There is no `clientId` or Client Organization document.
- Queryable domain records use top-level collections and carry `siteId`.
- A Site's `activeMapRevisionId` selects all current map geometry atomically.
- Published map revisions and workflow event histories are append-only.
- Parent Alert and Work Order documents keep their latest state for fast screens.
- Node/Express is the only writer of operational data.
- The frontend may directly read only its own `notifications` through Firestore rules.
- Ordinary two-second Camera samples and frames are not stored in Firestore.
- Alert Evidence and required Completion Evidence use local prototype media storage with Firestore metadata.
- Raw LLM output stays outside Firestore in ignored developer storage.
- Every persisted document starts with `schemaVersion: 2` unless the collection is explicitly external or temporary.

## Document set

| Document | Contents |
| --- | --- |
| [`01-identity-and-map.md`](01-identity-and-map.md) | Users, Sites, map drafts/revisions, Zones, Camera placement, Cleaner Station Points |
| [`02-cameras-and-operations.md`](02-cameras-and-operations.md) | Camera creation, registration, monitoring, inference traces, Flags, Alerts, Work Orders, Verification |
| [`03-automation-and-audit.md`](03-automation-and-audit.md) | Orchestrator, notifications, administrative audit and system health |
| [`04-analytics-and-media.md`](04-analytics-and-media.md) | Media, minute/daily analytics, Dashboard cache, bin-placement snapshots and interventions |
| [`05-integrity-security-and-indexes.md`](05-integrity-security-and-indexes.md) | Enums, invariants, transactions, indexes, rules and retention |
| [`06-migration-plan.md`](06-migration-plan.md) | Full V1-to-V2 backend and database migration sequence |

## Relationship overview

```text
Firebase Auth uid
    -> userAccounts/{uid}
       -> supervisors/{uid}
       -> cleaners/{cleanerId}

sites/{siteId}
    -> activeMapRevisionId
       -> siteMapRevisions/{revisionId}
          -> zoneGeometry/{zoneId}
          -> cameraPlacements/{cameraId}
          -> cleanerStations/{cleanerId}

cameras/{cameraId}
    -> activeSourceRevisionId
    -> activeRegistrationRevisionId
    -> live sample in memory
       -> persisted Flag when qualification passes
          -> one active Alert per Camera and issue
             -> one assigned Work Order
                -> Verification
                   -> resolved or rework

waiting Alert
    -> orchestratorOutbox
       -> orchestratorRun
          -> available Cleaner selected
             -> atomic Cleaner reservation and Work Order creation

operational events and minute Camera aggregates
    -> analyticsMinuteBuckets
    -> analyticsDailySummaries
       -> binPlacementSnapshots
          -> binPlacementInterventions when implemented
```

## Collection catalogue

### Identity and tenancy

```text
userAccounts
userAccountEmails
identityOperations
supervisors
cleaners
cleanerStaffCodeKeys
sites
siteOperations
zones
```

### Site Map

```text
siteMapDrafts
  /zoneGeometry
  /cameraPlacements
  /cleanerStations
siteMapRevisions
  /zoneGeometry
  /cameraPlacements
  /cleanerStations
```

### Cameras and monitoring

```text
cameraDrafts
cameras
cameraSourceRevisions
cameraRegistrations
cameraRegistrationRevisions
cameraRuntimeStates
monitoringSessions
monitoringEpisodes
```

### Replay and inference traceability

```text
mediaAssets
processingJobs
  /frameFailures
analysisRuns
detections
```

### Cleanliness operations

```text
flags
alerts
  /occurrences
  /events
activeAlertKeys
workOrders
  /events
  /verifications
activeWorkOrderKeys
operationKeys
```

### Automation and presentation

```text
orchestratorConfigs
orchestratorOutbox
orchestratorRuns
  /attempts
  /actions
notifications
auditEvents
systemEvents
systemMetadata
dashboardSummaries
```

### Analytics

```text
analyticsMinuteBuckets
analyticsDailySummaries
binPlacementSnapshots
binPlacementInterventions
```

## Shared field rules

All tenant-owned documents include `siteId`. A child history document may inherit the Site from its parent path, but it still stores `siteId` when collection-group queries or exports need it.

All timestamps are Firestore server timestamps. API responses convert them to ISO 8601 strings. Local calendar dates use `YYYY-MM-DD` in the Site timezone.

Common mutation fields are:

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | Stored document contract. V2 uses `2`. |
| `createdAt` | timestamp | First successful persistence time. |
| `createdByUid` | string or null | Human UID that created the record. Null means a system actor. |
| `updatedAt` | timestamp | Latest parent-document mutation time. |
| `updatedByUid` | string or null | Human UID responsible for the latest mutation. |
| `revision` | integer | Optimistic concurrency counter on mutable documents. |

Snapshot fields deliberately repeat names and labels. Historical pages must still make sense after a user, Zone, Camera, or Site is renamed.

## Document identifiers

- Human and stable entity IDs use Firebase-generated IDs unless the path is tied to an Auth UID.
- `userAccounts/{uid}` and `supervisors/{uid}` use the Firebase UID.
- `siteMapDrafts/{siteId}` allows only one map draft per Site.
- `cameraRegistrations/{cameraId}`, `cameraRuntimeStates/{cameraId}`, `monitoringSessions/{siteId}`, `orchestratorConfigs/{siteId}`, `dashboardSummaries/{siteId}`, and `binPlacementSnapshots/{siteId}` are singleton documents.
- Active uniqueness keys use a SHA-256 hash of their natural key. The source fields remain in the document for debugging.
- Analytics bucket IDs use deterministic hashes of `siteId` and bucket start.
- API idempotency records use a hash of actor, operation and client idempotency key.

## Write ownership

| Data | Writer | Reader |
| --- | --- | --- |
| Auth accounts | Node Firebase Admin | Node |
| Operational Firestore | Node Firebase Admin | Node APIs |
| Notifications | Node Firebase Admin | Node and addressed frontend user |
| Model inference | FastAPI returns data to Node | Node only |
| Raw LLM debug files | Orchestrator worker | Developers only |
| Local media bytes | Node media service | Authenticated Node media endpoint |

## Explicit non-collections

These concepts are derived and must not become competing sources of truth:

- Cleaner availability. Derive it from account status, Site status, recurring schedule, Availability Override, valid Station Point and `activeWorkOrderId`.
- Camera Zone. Resolve it from the Camera Placement in the Site's Active Map Revision.
- Busy Zone rank. Calculate it from the latest 15 minutes and active Work Orders, then cache it in `dashboardSummaries`.
- current Alert age and priority. Calculate from timestamps and policy, then persist recalculated values when scheduler or workflow activity occurs.
- live recommendations. `binPlacementSnapshots/{siteId}` is a replaceable calculation cache, not a history of pending recommendations.
- two-second AI Observation. Keep it in Node memory unless it becomes a persisted Flag, replay trace, or aggregate.
