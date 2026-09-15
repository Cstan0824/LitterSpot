# Cameras and cleanliness operations

Runtime behavior is described in [camera monitoring](../camera-monitoring.md). All new Cameras begin disabled; creation order does not restrict source type. Live frames travel through authenticated event streaming and are not Firestore documents. Current runtime freshness, frame sequence, rolling qualification, evidence candidates, and partial Camera Verification samples stay in Node memory. Firestore records material transitions and minute summaries. A Node restart begins a new episode and reloads unfinished durable Verification requests.

## `cameraDrafts/{draftId}`

A Camera Draft supports both initial Camera Creation and later source/Registration replacement. It is never returned as an operational Camera.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `draftId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `kind` | enum | yes | `create` or `reconfigure`. |
| `cameraId` | string | yes | Reserved new ID or existing Camera ID. |
| `baseCameraRevision` | integer or null | yes | Required for reconfiguration conflict detection. |
| `baseMapRevisionId` | string | yes | Map against which placement is validated. |
| `name` | string | yes | Proposed Camera name. |
| `description` | string or null | yes | Optional metadata. |
| `placement` | map or null | yes | `{point, zoneId}` for create or structural move. `zoneId` is server-derived. |
| `provisionalZone` | map or null | yes | Optional `{zoneId, zoneNameSnapshot, polygon}` created inside Camera registration. It is copied into the Active Map only when this Camera Draft publishes. |
| `source` | map | yes | Proposed source settings. |
| `registration` | map or null | yes | Reference, floor polygon, bins and quality settings. |
| `validationStatus` | enum | yes | `not_validated`, `valid`, or `invalid`. |
| `validationErrors` | array | yes | Bounded safe editor feedback. |
| `referenceCapturedAt` | timestamp or null | yes | When the selected clean reference frame was captured. |
| `createdAt` | timestamp | yes | Draft creation time. |
| `createdByUid` | string | yes | Root/Regular Supervisor or Superadmin. Regular Supervisor may re-register but not create/move Cameras. |
| `updatedAt` | timestamp | yes | Latest draft save. |
| `updatedByUid` | string | yes | Latest editor. |
| `revision` | integer | yes | Optimistic concurrency counter. |

### Source draft

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | enum | `laptop_camera` or `looped_video`. |
| `sourceMediaId` | string or null | Required for looped video; null for laptop Camera. |
| `browserDeviceHint` | string or null | Non-secret best-effort webcam label. It is not stable identity. |
| `sampleIntervalSeconds` | number | Camera override or Site default, initially 1. |
| `isSimulation` | boolean | True exactly when source type is looped video. |

### Registration draft

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | Registration contract version. Starts at `2`. |
| `referenceMediaId` | string | Stored clean reference frame. |
| `referenceSource` | map | Image, laptop capture, or video media/time offset used for the frame. |
| `sourceWidth` | integer | Reference pixel width. |
| `sourceHeight` | integer | Reference pixel height. |
| `walkableFloorPolygon` | normalized point array | Visible floor region, each coordinate 0..1. |
| `bins` | registered-bin array | Zero to 32 stable physical bins. |
| `quality` | map | Alignment, visibility and frame-age thresholds. |

Registered-bin fields are `binId`, `displayName`, `binType` and `binPolygon`. `binType` is `open_top`, `lidded`, or `unknown`. A `binId` remains stable within the Camera across later registrations when it represents the same physical bin.

## `cameras/{cameraId}`

This is stable Camera identity and active revision pointers.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `cameraId` | string | yes | Stable ID and document ID. |
| `siteId` | string | yes | Tenant. |
| `name` | string | yes | Current display name. |
| `nameNormalized` | string | yes | Site-scoped duplicate detection and sorting. |
| `description` | string or null | yes | Optional metadata. |
| `status` | enum | yes | `active`, `inactive`, or terminal `removed`. Structural lifecycle is Root-controlled. |
| `monitoringEnabled` | boolean | yes | Reversible operational sampling control. |
| `activeSourceRevisionId` | string | yes | Current source configuration. |
| `activeRegistrationRevisionId` | string | yes | Current image-space geometry. |
| `sourceType` | enum | yes | Denormalized `laptop_camera` or `looped_video` for filtering. |
| `isSimulation` | boolean | yes | True for looped video. Internal traceability only. |
| `createdAt` | timestamp | yes | First composite publication time. |
| `createdByUid` | string | yes | Root Supervisor or Superadmin. |
| `updatedAt` | timestamp | yes | Latest identity/pointer/control change. |
| `updatedByUid` | string | yes | Latest actor. |
| `deactivatedAt` | timestamp or null | yes | Structural deactivation time. |
| `deactivatedByUid` | string or null | yes | Deactivating actor. |
| `removedAt` | timestamp or null | no | Time the Camera left active Site operations. |
| `removedByUid` | string or null | no | Root Supervisor who removed it. |
| `removalReason` | string or null | no | Required operational reason. |
| `removedFromMapRevisionId` | string or null | no | Last Active Map Revision containing the Camera Placement. |
| `removalMapRevisionId` | string or null | no | Replacement Active Map Revision that omits the Camera Placement. |
| `revision` | integer | yes | Optimistic concurrency counter. |

Camera Zone, map point and map revision are resolved from the Active Map Revision. API read models return them as derived fields.

A removed Camera is omitted from current Camera lists and monitoring configuration. Its stable Camera document, published source revisions, Camera Registration, evidence, Alerts, Work, and audit events remain available for historical lookup.

### Development playback fields

`cameras/{cameraId}.demoPlayback` contains `mediaId`, `sourceRevisionId`, `generation`, and `selectedAt` as epoch milliseconds. It is a development control beneath the published source. Selection leaves the Camera revision, source/Registration pointers, monitoring episode and sequence unchanged. Clients receive `playbackGeneration` and the selected media content URL through `/api/monitoring/live/config`.

`cameras/{cameraId}/demoScenes/{key}` contains `schemaVersion`, `siteId`, `cameraId`, `key`, `mediaId`, `sourceRevisionId`, `registrationRevisionId`, and `createdAt`. Keys are immutable and tied to one source/Registration pair. The associated media asset uses purpose `camera_source_video` and owner type `camera`.

Retained Alert Evidence additionally includes `observation`, `people`, `bins`, dimensions and `coordinateSpace=image_pixels`. Its media asset keeps the same observation as `evidenceObservation` for reusable history thumbnails. These nested evidence payloads are excluded from indexing. Ordinary observations and frames stay transient.

## `cameraSourceRevisions/{sourceRevisionId}`

Source revisions are immutable.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `sourceRevisionId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Owning Camera. |
| `revisionNumber` | integer | yes | Camera-local display revision. |
| `type` | enum | yes | `laptop_camera` or `looped_video`. |
| `sourceMediaId` | string or null | yes | Looped video asset or null. |
| `browserDeviceHint` | string or null | yes | Non-authoritative laptop hint. |
| `sampleIntervalSeconds` | number | yes | Persisted sampling configuration. |
| `isSimulation` | boolean | yes | Derived from type. |
| `publishedAt` | timestamp | yes | Activation time. |
| `publishedByUid` | string | yes | Publishing actor. |
| `contentHash` | string | yes | Canonical source config hash. |

## `cameraRegistrations/{cameraId}`

This singleton is a fast pointer and summary for the active Registration.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Document ID. |
| `activeRegistrationRevisionId` | string | yes | Canonical immutable revision. |
| `revisionNumber` | integer | yes | Current Camera registration number. |
| `status` | enum | yes | `ready`, `stale`, or `invalid`. Only ready can sample operationally. |
| `referenceMediaId` | string | yes | Convenience reference for editor/API. |
| `binCount` | integer | yes | Convenience summary. |
| `updatedAt` | timestamp | yes | Pointer change time. |
| `updatedByUid` | string | yes | Publishing actor. |

## `cameraRegistrationRevisions/{registrationRevisionId}`

Immutable image-space configuration.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `registrationRevisionId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Owning Camera. |
| `sourceRevisionId` | string | yes | Source scene for which geometry is valid. |
| `revisionNumber` | integer | yes | Camera-local monotonic number. |
| `referenceMediaId` | string | yes | Clean reference frame. |
| `referenceSource` | map | yes | Capture/source metadata. |
| `sourceWidth` | integer | yes | Pixel width. |
| `sourceHeight` | integer | yes | Pixel height. |
| `walkableFloorPolygon` | normalized point array | yes | Floor ROI. |
| `bins` | registered-bin array | yes | Physical-bin identities and polygons. |
| `quality` | map | yes | Registration validation thresholds. |
| `validation` | map | yes | Passed checks, warnings, model/check versions. |
| `contentHash` | string | yes | Integrity hash. |
| `publishedAt` | timestamp | yes | Publication time. |
| `publishedByUid` | string | yes | Root, Regular, or Superadmin actor. |

## `cameraRuntimeStates/{cameraId}`

This replaceable document is a durable transition checkpoint, not a per-frame heartbeat. The API overlays current in-memory runtime data while Node is running.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Document ID. |
| `connectionStatus` | enum | yes | `online` or `offline`. |
| `cleanlinessState` | enum | yes | `clean`, `alerted`, `cleaning_in_progress`, `awaiting_review`, or `unknown`. Derived from active Alert/Work. |
| `monitoringSessionId` | string or null | yes | Current owning browser session. |
| `monitoringEpisodeId` | string or null | yes | Current enable/playback episode. |
| `lastFrameCapturedAt` | timestamp or null | yes | Browser capture time at the latest durable runtime transition. Live freshness is in memory. |
| `lastSampleAcceptedAt` | timestamp or null | yes | Accepted sample time at the latest durable runtime transition. |
| `lastInferenceSucceededAt` | timestamp or null | yes | Successful inference time at the latest durable runtime transition. |
| `lastPeopleCount` | integer or null | yes | Current Dashboard/live card value. Not historical analytics. |
| `lastIssueSummary` | map | yes | Bounded current issue counts/conditions for Camera Details. |
| `sourceErrorCode` | string or null | yes | Safe error code. |
| `sourceErrorMessage` | string or null | yes | Safe UI message without local paths. |
| `updatedAt` | timestamp | yes | Runtime state update. |
| `expiresAt` | timestamp or null | yes | Optional cleanup after Camera removal. |

## `monitoringSessions/{siteId}`

This document records the latest lease claim or release for traceability. The single Node prototype enforces the live lease and accepts heartbeats in memory, so heartbeat requests do not write Firestore.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Document ID. |
| `sessionId` | string | yes | Current browser session ID. |
| `ownerUid` | string | yes | Supervisor who owns capture. |
| `leaseTokenHash` | string | yes | Hash of secret token returned only to the owner. |
| `claimedAt` | timestamp | yes | Lease start. |
| `heartbeatAt` | timestamp | yes | Heartbeat time at claim. Live heartbeat freshness is in memory. |
| `leaseExpiresAt` | timestamp | yes | Durable claim-time expiry snapshot. Node owns the live expiry. |
| `status` | enum | yes | `active` or `released`. |
| `revision` | integer | yes | Lease compare-and-set counter. |

## `monitoringEpisodes/{episodeId}`

An episode starts when monitoring begins or a simulation Camera is enabled/restarted.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `episodeId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Camera being sampled. |
| `monitoringSessionId` | string | yes | Owning session. |
| `sourceRevisionId` | string | yes | Active source at episode start. |
| `registrationRevisionId` | string | yes | Active Registration at episode start. |
| `isSimulation` | boolean | yes | Downstream traceability. |
| `startedAt` | timestamp | yes | Start time. |
| `endedAt` | timestamp or null | yes | Stop/restart time. |
| `endReason` | enum or null | yes | `disabled`, `session_lost`, `source_error`, `camera_inactive`, or `restarted`. |
| `lastSequence` | integer | yes | Highest accepted sequence when the episode ended. Live replay protection is in memory. |

## Replay and model-test collections

The existing `mediaAssets`, `processingJobs`, `analysisRuns`, and `detections` collections remain for uploaded image/video jobs, model debugging and sandbox replay. Operational live monitoring does not create one document per sample in these collections.

Every replay document adds `schemaVersion`, `siteId`, `cameraId`, `isTest`, `isSimulation`, model/registration versions, timestamps and existing trace IDs. Replay data with `isTest=true` never creates operational Flags, Alerts, Work Orders, notifications or analytics.

## Live AI Observation

A live AI Observation is an in-memory Node object. It contains sample identity, capture time, people count, floor issues, registered-bin states, model versions, latency, source/Registration revisions and simulation marker. It is discarded after it contributes to:

- current in-memory Camera Runtime State;
- a minute analytics accumulator;
- an in-memory temporal qualification window;
- a persisted Flag;
- an Alert Evidence candidate buffer.

## `flags/{flagId}`

A Flag persists when an issue first passes its rolling confidence and magnitude gates, or when that confirmed condition materially escalates. Repeated frames from one unchanged confirmed condition do not create more Flags.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `flagId` | string | yes | Deterministic ID and document ID for one Camera/sample/issue. |
| `siteId` | string | yes | Tenant. |
| `mapRevisionId` | string | yes | Location context. |
| `zoneId` | string | yes | Zone snapshot at capture. |
| `zoneNameSnapshot` | string | yes | Historical label. |
| `cameraId` | string | yes | Source Camera. |
| `cameraNameSnapshot` | string | yes | Historical label. |
| `registrationRevisionId` | string | yes | Geometry used by inference. |
| `monitoringEpisodeId` | string | yes | Runtime episode. |
| `sampleId` | string | yes | Deterministic live sample identity. |
| `issueType` | enum | yes | `floor_litter`, `floor_spill`, or `bin_service`. |
| `observedCondition` | enum | yes | `litter`, `spill`, `full`, or `overflow`. |
| `severityCandidate` | enum | yes | `warning` or `critical`. |
| `confidence` | number 0..1 | yes | Highest/combined qualifying confidence. |
| `magnitude` | map | yes | Issue count, normalized coverage and affected-bin count as applicable. |
| `affectedBinIds` | string array | yes | Empty for floor issues. |
| `detections` | array | yes | Bounded normalized boxes/polygons and labels needed for traceability. |
| `modelVersions` | map | yes | Models that contributed. |
| `qualificationPolicyVersion` | string | yes | Gate version. |
| `qualificationSnapshot` | map | yes | Thresholds and measurements that passed. |
| `capturedAt` | timestamp | yes | Frame capture time. |
| `isSimulation` | boolean | yes | Internal traceability. |
| `alertId` | string or null | yes | Set when consumed by an Alert. |
| `createdAt` | timestamp | yes | Persistence time. |

Flag geometry arrays are bounded. A Flag does not keep ordinary frame bytes. Node holds candidate bytes briefly until an Alert selects evidence.

## `activeAlertKeys/{keyHash}`

This transaction lock enforces one active Alert per Site, Camera and issue type.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Natural-key component. |
| `issueType` | enum | yes | Natural-key component. |
| `alertId` | string | yes | Active Alert. |
| `createdAt` | timestamp | yes | Key acquisition time. |

Delete the key only in the transaction that resolves or dismisses its Alert.

## `alerts/{alertId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `alertId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `mapRevisionId` | string | yes | Map context at creation. |
| `zoneId` | string | yes | Zone at creation. |
| `zoneNameSnapshot` | string | yes | Historical label. |
| `cameraId` | string | yes | Camera scope. |
| `cameraNameSnapshot` | string | yes | Historical label. |
| `registrationRevisionId` | string | yes | Registration used for evidence. |
| `issueType` | enum | yes | `floor_litter`, `floor_spill`, or `bin_service`. |
| `observedCondition` | enum | yes | Current strongest condition. `bin_service` moves from `full` to `overflow` in one Alert. |
| `status` | enum | yes | `waiting_for_cleaner`, `assigned`, `in_progress`, `awaiting_review`, `resolved`, or `dismissed`. |
| `severity` | enum | yes | Current displayed `warning` or `critical`. |
| `highestSeverity` | enum | yes | Historical maximum used by Dashboard fallback. |
| `priorityScore` | number | yes | Last calculated queue score. Age continues until terminal state. |
| `priorityPolicyVersion` | string | yes | Scoring/aging version. |
| `nextEscalationAt` | timestamp or null | yes | Scheduler wake-up for warning-to-critical aging. |
| `firstDetectedAt` | timestamp | yes | First Flag in the episode. |
| `lastDetectedAt` | timestamp | yes | Latest occurrence. |
| `occurrenceCount` | integer | yes | Number of linked qualifying Flags. |
| `affectedBinIds` | string array | yes | Stable registered bins affected by bin service. |
| `evidence` | map | yes | Highest-confidence persisted Alert Evidence snapshot. |
| `activeWorkOrderId` | string or null | yes | Assigned Work, or null while waiting. |
| `managementMode` | enum | yes | `orchestrated` or `manual`. Supervisor takeover sets manual permanently for this Alert. |
| `isSimulation` | boolean | yes | Inherited from Camera source. |
| `resolvedAt` | timestamp or null | yes | Terminal resolution time. |
| `resolvedBy` | actor map or null | yes | Supervisor or Orchestrator action. |
| `dismissedAt` | timestamp or null | yes | Terminal dismissal time. |
| `dismissedBy` | actor map or null | yes | Supervisor/system action. |
| `dismissReason` | string or null | yes | Required safe reason. |
| `createdAt` | timestamp | yes | Alert creation time. |
| `updatedAt` | timestamp | yes | Latest parent state change. |
| `revision` | integer | yes | Concurrency counter. |

### Alert Evidence map

| Field | Type | Meaning |
| --- | --- | --- |
| `mediaId` | string | Original retained frame. |
| `flagId` | string | Flag that supplied the frame. |
| `capturedAt` | timestamp | Evidence capture time. |
| `confidence` | number | Selection score. |
| `width` / `height` | integer | Frame dimensions. |
| `detections` | array | Normalized boxes/polygons, labels, confidence and bin IDs. |
| `modelVersions` | map | Model provenance. |
| `selectionPolicyVersion` | string | Highest-confidence policy. |

## `alerts/{alertId}/occurrences/{flagId}`

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string | Tenant. |
| `alertId` | string | Parent Alert. |
| `flagId` | string | Source Flag and document ID. |
| `capturedAt` | timestamp | Occurrence time. |
| `confidence` | number | Flag confidence. |
| `observedCondition` | enum | Condition at this occurrence. |
| `severityCandidate` | enum | Candidate severity. |
| `becameEvidence` | boolean | Whether this occurrence supplied current Alert Evidence. |
| `createdAt` | timestamp | Link creation time. |

## `alerts/{alertId}/events/{eventId}`

Append-only state, severity, assignment, takeover, resolution and dismissal history.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string | Tenant. |
| `alertId` | string | Parent. |
| `type` | enum | `created`, `occurrence`, `severity_changed`, `assigned`, `work_started`, `awaiting_review`, `resolved`, `dismissed`, `takeover`, or `note`. |
| `fromStatus` / `toStatus` | enum or null | Workflow transition when applicable. |
| `fromSeverity` / `toSeverity` | enum or null | Severity transition when applicable. |
| `workOrderId` | string or null | Related Work. |
| `actor` | actor map | Human, Orchestrator, or system identity. |
| `reasonCode` | string or null | Machine-readable reason. |
| `note` | string or null | Bounded safe explanation. |
| `requestId` | string | Trace/audit link. |
| `occurredAt` | timestamp | Event time. |
| `analyticsAppliedVersion` | string or null | Exactly-once daily-summary application version. |
| `analyticsAppliedAt` | timestamp or null | Application time. |

## `activeWorkOrderKeys/{alertHash}`

For Alert-origin Work only, this lock prevents two active Work Orders for one Alert. It stores `siteId`, `alertId`, `workOrderId`, `cleanerId`, `createdAt`, and `schemaVersion`.

## `workOrders/{workOrderId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `workOrderId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `origin` | enum | yes | `alert` or `manual`. |
| `alertId` | string or null | yes | Required for Alert origin, null for manual. |
| `managementMode` | enum | yes | `orchestrated` or `manual`. Manual creation/takeover uses manual. |
| `status` | enum | yes | `assigned`, `in_progress`, `awaiting_review`, `resolved`, or `dismissed`. |
| `severity` | enum | yes | `warning` or `critical`. Manual creator chooses it. |
| `issueType` | enum | yes | Cleanliness issue or `general_cleaning` for manual Work. |
| `title` | string | yes | Node-generated for Alert Work; Supervisor-provided for manual Work. |
| `instructions` | string | yes | Node-generated for Alert Work; Supervisor-provided for manual Work. |
| `target` | discriminated map | yes | Camera target or coordinate target. |
| `mapRevisionId` | string | yes | Queryable mirror of `target.mapRevisionId`. |
| `zoneId` | string or null | yes | Queryable mirror of `target.zoneId`; null for coordinate Work in an Unzoned Area. |
| `cameraId` | string or null | yes | Queryable mirror for Camera targets; null for coordinate-only Work. |
| `assignedCleanerId` | string | yes | One Cleaner. Assignment counts as acceptance. |
| `cleanerNameSnapshot` | string | yes | Historical display. |
| `assignedAt` | timestamp | yes | Work creation or latest replacement time. |
| `assignedBy` | actor map | yes | Orchestrator or Supervisor. |
| `startedAt` | timestamp or null | yes | Cleaner moved to in progress. |
| `submittedAt` | timestamp or null | yes | Cleaner submitted for review. |
| `resolvedAt` | timestamp or null | yes | Successful terminal time. |
| `resolvedBy` | actor map or null | yes | Supervisor or Orchestrator. |
| `dismissedAt` | timestamp or null | yes | Dismissal time. |
| `dismissedBy` | actor map or null | yes | Supervisor/system. |
| `dismissReason` | string or null | yes | Required dismissal reason. |
| `creationEvidenceMediaId` | string or null | yes | Optional Supervisor evidence for manual Work. |
| `completionEvidenceMediaId` | string or null | yes | Required when any Supervisor-created manual Work enters awaiting review. |
| `latestVerificationId` | string or null | yes | Most recent Verification. |
| `latestVerificationOutcome` | enum or null | yes | `passed`, `failed`, or `inconclusive`. |
| `reworkCount` | integer | yes | Failed Verification count. Same Cleaner remains assigned. |
| `isSimulation` | boolean | yes | True for Work derived from simulation Alert. Manual Work is false. |
| `createdAt` | timestamp | yes | Work creation time. |
| `createdByUid` | string or null | yes | Supervisor for manual Work; null for Orchestrator-created. |
| `updatedAt` | timestamp | yes | Latest parent state change. |
| `revision` | integer | yes | Concurrency counter. |

### Work target

Camera target:

```json
{
  "type": "camera",
  "mapRevisionId": "...",
  "zoneId": "...",
  "zoneNameSnapshot": "...",
  "point": { "xMeters": 10, "yMeters": 20 },
  "cameraId": "...",
  "cameraNameSnapshot": "..."
}
```

Coordinate target uses the same map and point fields without Camera fields. `zoneId` is the containing active Zone when one exists, otherwise null with `zoneNameSnapshot` set to `Unzoned area`. Terminal Work retains this snapshot after the Site Map changes. Active Camera-targeted Work is retargeted, with an append-only before/after event, when Root publishes a same-Zone Map Position Correction.

## `workOrders/{workOrderId}/events/{eventId}`

Append-only Work history.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string | Tenant. |
| `workOrderId` | string | Parent. |
| `type` | enum | `assigned`, `reassigned`, `started`, `submitted`, `verification_passed`, `verification_failed`, `verification_inconclusive`, `resolved`, `dismissed`, `takeover`, or `note`. |
| `fromStatus` / `toStatus` | enum or null | State transition. |
| `cleanerId` | string or null | Cleaner affected. |
| `previousCleanerId` | string or null | Replacement history. |
| `actor` | actor map | Human, Orchestrator, Cleaner, or system. |
| `reasonCode` | string or null | Machine reason. |
| `note` | string or null | Safe explanation. |
| `evidenceMediaIds` | string array | Related evidence. |
| `requestId` | string | Trace link. |
| `occurredAt` | timestamp | Event time. |
| `analyticsAppliedVersion` | string or null | Exactly-once daily-summary application version. |
| `analyticsAppliedAt` | timestamp or null | Application time. |

## `workOrders/{workOrderId}/verifications/{verificationId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `workOrderId` | string | yes | Parent Work. |
| `alertId` | string or null | yes | Alert context. |
| `kind` | enum | yes | `camera_deterministic` for Alert Work or `manual_supervisor` for Supervisor-created Manual Work. Historical `coordinate_supervisor` records remain readable. |
| `status` | enum | yes | `collecting`, `ready`, or `applied`. |
| `requestedAt` | timestamp | yes | Review request time. |
| `requestedBy` | actor map | yes | Cleaner submission/system workflow. |
| `requiredSampleCount` | integer or null | yes | 3 litter, 2 spill/bin, null for manual review. |
| `acceptedSampleCount` | integer | yes | Fresh valid samples collected. |
| `sampleSummaries` | array | yes | Bounded outcomes, capture times, model/Registration versions and reasons. |
| `outcome` | enum or null | yes | `passed`, `failed`, or `inconclusive`. |
| `outcomeReasonCodes` | string array | yes | Safe deterministic reasons. |
| `completionEvidenceMediaId` | string or null | yes | Required for manual review. |
| `decidedAt` | timestamp or null | yes | Outcome time. |
| `decidedBy` | actor map or null | yes | Verification engine or Supervisor. |
| `override` | map or null | yes | Supervisor override outcome and required reason. |
| `appliedAt` | timestamp or null | yes | When Alert/Work state changed. |
| `requestId` | string | yes | Idempotency and tracing. |

For Alert Work, passed resolves, failed returns the same Work to `in_progress`, and inconclusive leaves it `awaiting_review` and notifies Supervisors. Supervisor-created Manual Work always uses its Cleaner completion photo and requires a Supervisor's final application. Ordinary negative monitoring never creates a Verification.

## `operationKeys/{keyHash}`

This bounded collection protects operations that cannot use a natural deterministic document ID.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string or null | Tenant when applicable. |
| `actorId` | string | Calling UID or service actor ID. |
| `operation` | string | Stable operation name. |
| `idempotencyKeyHash` | string | Hash, also part of document ID. |
| `requestBodyHash` | string | Rejects reuse with different input. |
| `resourceType` / `resourceId` | string | Created or changed aggregate. |
| `responseStatus` | integer | Original HTTP status. |
| `createdAt` | timestamp | First completion. |
| `expiresAt` | timestamp | Cleanup after 30 days. |
