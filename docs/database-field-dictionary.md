# LitterSpot database field dictionary

> This dictionary describes the implemented V1 fields. The planned V2 dictionary starts at [`data-model-v2/README.md`](data-model-v2/README.md).

Last checked: 2026-08-28. Code baseline: `2191394`.

## Contents

- [Scope, types, and shared fields](#1-scope-and-how-to-read-this-dictionary)
- [Firebase Authentication](#2-firebase-authentication-records-outside-firestore)
- [Role dispatch](#3-useraccountsuid), [Supervisors](#4-supervisorsuid), and [Cleaners](#5-cleanerscleanerid)
- [Sites, zones, and cameras](#6-location-hierarchy)
- [Media assets](#7-mediaassetsmediaid) and [processing jobs](#8-processingjobsjobid)
- [Analysis runs](#9-analysisrunsanalysisrunid) and [raw detections](#10-detectionsdetectionid)
- [Issue observations and flags](#11-grouped-issue-observations-and-flags)
- [Confirmation memory, alerts, and alert history](#12-confirmation-memory-and-active-incidents)
- [Cleaner presence and location](#13-cleaner-presence-and-location)
- [Work orders and assignment history](#14-work-orders-and-assignment-records)
- [Review requests and decisions](#15-review-records)
- [Notifications and push devices](#16-notifications-and-push-devices)
- [Orchestrator records](#17-orchestrator-records)
- [Dashboard summary](#18-dashboardsummariessiteid)
- [Analytics, rebuilds, and reports](#19-analytics-storage)
- [System events](#20-operational-system-events)
- [API-only fields](#21-fields-visible-in-apis-but-not-database-columns)
- [Configuration and structures not yet integrated](#22-configuration-files-and-proposed-structures)
- [End-to-end example](#23-end-to-end-lookup-example)
- [Maintenance and safety](#24-maintenance-and-safety-notes)
- [Source checklist](#25-source-checklist)

For a specific field, search its exact code name, for example
`qualificationThreshold`, `activeWorkOrderId`, or `analyticsAppliedAt`.

## 1. Scope and how to read this dictionary

This dictionary describes the fields that the current Node backend creates,
updates, or deliberately reads. It explains what each field represents and
where the workflow uses it. It is based on source code, not a dump of the live
cloud database. A collection may not exist in Firestore until its first use.

Firestore calls these **fields**, rather than SQL columns. A document is one
record. A collection contains documents; a subcollection contains records
beneath a particular document. Relationships are mostly string IDs that Node
validates, not database-enforced foreign keys.

- `Timestamp` means a stored Firestore timestamp. APIs usually return an ISO
  date-time string instead.
- `?` after a type means the value can be `null`.
- `optional` means the field can be absent, for example on old records or
  before a later workflow step writes it.
- `object` means a nested map; `[]` means an array.
- `{id}` in a path is the document ID, not necessarily a stored `id` field.
  Most response `id` properties are added by the API serializer.
- Tables list the union of normal creation fields and subsequent update
  fields. Not every record contains every field at every moment.
- A status allowed by a schema is not proof that an endpoint or worker already
  produces that status. Such distinctions are noted below.

Use this alongside the [API reference](./api-reference.md),
[architecture](./architecture.md), and
[Firestore data-model package](./data-model-v2/README.md). Where planning prose
disagrees with this dictionary, check the linked runtime writer before making a
change. This document records implementation, not a new schema proposal.

### 1.1 Collection index

| Area | Top-level collections | Subcollections |
| --- | --- | --- |
| Identity | `supervisors`, `userAccounts`, `cleaners`, `cleanerStaffCodes`, `userAccountEmails` | Cleaner `locationHistory` |
| Locations | `sites`, `zones`, `cameras`, `cameraCodes` | None |
| Files and processing | `mediaAssets`, `processingJobs`, `analysisRuns`, `detections` | Job `frameFailures` |
| Cleanliness | `issueObservations`, `flags`, `alertConfirmationStates`, `alertConfirmationResets`, `alerts`, `activeAlertKeys` | Alert `occurrences`, `statusHistory` |
| Cleaner operations | `cleanerPresence`, `workOrders`, `activeWorkOrderKeys`, `workOrderDecisions` | Work-order `assignmentAttempts`, `statusHistory`, `reviewRequests`, `reviews` |
| Notifications | `notifications`, `cleanerPushTokens` | None |
| Orchestration | `orchestratorRuns`, `orchestratorOutbox`, `orchestratorDecisions` | None |
| Dashboard | `dashboardSummaries` | None |
| Analytics | `analyticsSites`, `analyticsReconciliationLocks`, `analyticsBuckets`, `analyticsSampleApplications`, `analyticsIncidentApplications`, `analyticsPersistenceStates`, `analyticsReports` | Analytics-site `generations`, report `zoneResults` |
| Operational failures | `systemEvents` | Event `occurrences`, `recoveries` |

### 1.2 Shared audit fields

Each collection section states which of these fields it uses. Their meaning is
defined here to avoid repeating identical explanations in every table.

| Field | Stored type | Meaning and use |
| --- | --- | --- |
| `createdAt` | Timestamp | When this document was created. Supports history ordering and retention. Usually server-generated; some analytics rebuilds use `Timestamp.now()`. |
| `createdByUid` | string | Creator identity. Usually a Firebase UID; work-order code also stores an orchestrator actor ID here. Do not assume every value is an Auth UID. |
| `updatedAt` | Timestamp | Most recent recorded mutation, not necessarily capture time or last business activity. |
| `updatedByUid` | string | User that last changed configuration/personnel data, or a bootstrap sentinel. |
| `deactivatedAt` | Timestamp? | When a soft-deactivation occurred; cleared on reactivation. |
| `deactivatedByUid` | string? | Supervisor responsible for soft-deactivation. |
| `updatedByType` | string | Actor category such as `supervisor`, `cleaner`, or `orchestrator`. Used with `updatedById`. |
| `updatedById` | string | Actor identifier for the latest mutation; interpret it using `updatedByType`. |

Snapshot fields are copies made by a writer at that time. They support display
and historical interpretation without another read. They are not guaranteed
to update everywhere after a site, camera, or Cleaner is renamed.

### 1.3 Common relationship and retry fields

| Field/concept | Meaning and workflow use |
| --- | --- |
| `siteId` | Links to `sites/{siteId}` and scopes the record to an attraction/property. |
| `zoneId` | Links to `zones/{zoneId}` and identifies the cleaning area. |
| `cameraId` | Links to the logical `cameras` record that supplied the observation/upload. |
| `cleanerId` | Cleaner business ID under `cleaners`, not the Firebase login UID. |
| `alertId` | Confirmed cleanliness incident under `alerts`. |
| `workOrderId` | Assignment/work record under `workOrders`. |
| `analysisRunId` | One analyzed image/frame under `analysisRuns`. |
| `jobId` | Upload-processing job under `processingJobs`. |
| `evidenceMediaId` | A `mediaAssets` document used as evidence; not the file bytes themselves. |
| `idempotencyKey` | Caller-supplied action identity. Replaying the same action should not duplicate writes. Scope depends on the service. |
| `requestFingerprint` / `fingerprint` | Hash of relevant action contents, used to reject the same action key with different input. It is not a password or authentication signature. |
| `workflowVersion` | Identifies the record/workflow semantics, for example `grouped-temporal`. |
| `policyVersion` | Identifies the business rule set, for example `grouped-temporal`. It does not mean a full policy object is stored in that document. |

## 2. Firebase Authentication records, outside Firestore

Firebase Authentication owns login identities. Node links them to application
profiles. These values are not columns in a Firestore `users` table.

| Value used by the backend | Type | Meaning and use |
| --- | --- | --- |
| `uid` | string | Stable Firebase identity. Used as the `userAccounts` document ID and Supervisor profile ID. |
| `email` | string | Email/password sign-in address and invitation target. |
| `displayName` | string | Auth display name, also available as a profile fallback. |
| `disabled` | boolean | Firebase account disable switch. Cleaner disablement coordinates it with Firestore access checks. |
| `emailVerified` | boolean | Firebase verification state. Account creation starts false; it is distinct from the app's active status. |
| Password | Firebase-managed credential | Used for sign-in; no plaintext password is stored in Firestore. |
| ID token | short-lived credential | Sent as the API bearer token, verified by Node, not stored as business data. |
| Password setup link | one-time sensitive URL | Generated during Cleaner provisioning and returned for private delivery. Not stored in Firestore. |

See [Firebase configuration](../backend/src/config/firebase.ts) and
[authentication middleware](../backend/src/middleware/authenticateUser.ts).

## 3. `userAccounts/{uid}`

Purpose: map a verified Firebase identity to an application role and profile.
Node reads this before granting Supervisor or Cleaner access.

Shared fields: `createdAt`, `updatedAt`, optional `updatedByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{uid}` | string | Firebase Authentication UID being dispatched. |
| `role` | string | `supervisor` or `cleaner`; chooses the profile lookup and role-specific routes. |
| `profileId` | string | Supervisor profile ID or Cleaner business document ID. |
| `status` | string | `active` or `inactive`; application access gate independent of Firebase credentials. |
| `email` | string, optional | Provisioned Cleaner email copied into the dispatch record; legacy Supervisor dispatch records can omit it. |
| `migrationSource` | string, optional | Indicates creation from a legacy Supervisor profile or a migration script. Audit provenance, not a permission. |

Writers/readers: [authentication](../backend/src/middleware/authenticateUser.ts),
[Cleaner management](../backend/src/services/cleanerService.ts),
[identity operations](../backend/src/services/identityService.ts).

## 4. `supervisors/{uid}`

Purpose: Supervisor application profile and access state.

Shared fields: `createdAt`, `createdByUid`, `updatedAt`, `updatedByUid`,
`deactivatedAt`, `deactivatedByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{uid}` | string | Firebase UID of this Supervisor. |
| `uid` | string | Stored copy of that UID, written by bootstrap. |
| `email` | string | Supervisor contact/sign-in email snapshot. |
| `emailNormalized` | string | Lowercase trimmed email retained for consistent identity handling. |
| `displayName` | string | Name shown in the session and copied into alert history. |
| `role` | string | `supervisor`; checked alongside active status. |
| `status` | string | `active` or `inactive`; determines access after token verification. |
| `authDisabled` | boolean | Firebase disable state copied at bootstrap, not a live query of Firebase Auth on every read. |
| `reconciliationStatus` | string | Bootstrap writes `consistent` after linking identity and profile. This is not a general account-repair state machine. |

Writer: [Supervisor bootstrap](../backend/src/scripts/bootstrapSupervisor.ts).

## 5. `cleaners/{cleanerId}`

Purpose: personnel identity, normal assignment, permissions, skills, and explicit
Firebase login link. Creating personnel does not automatically create a login.

Shared fields: `createdAt`, `createdByUid`, `updatedAt`, `updatedByUid`,
`deactivatedAt`, `deactivatedByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{cleanerId}` | string | Stable business ID referenced by work orders, presence, and history. |
| `staffCode` | string | Human-facing staff identifier such as `CLN-001`. Remains reserved after deactivation. |
| `staffCodeNormalized` | string | Lowercase staff code associated with the reservation key. |
| `fullName` | string | Current personnel name; copied into work-order assignment snapshots. |
| `fullNameNormalized` | string | Lowercase normalized name. Stored for consistent lookup/sorting conventions; current list also sorts display names in memory. |
| `phone` | string | Contact detail for the Supervisor. Not the login identity. |
| `assignedSiteId` | string | Site of the Cleaner's normal assigned zone. |
| `assignedZoneId` | string | Normal working zone. Not proof of current GPS position. |
| `assignedZoneNameSnapshot` | string | Zone name copied on assignment/reassignment for display. |
| `permittedSiteIds` | string[] | Sites where this Cleaner may receive work. |
| `permittedZoneIds` | string[] | Zones where this Cleaner may receive work. Node checks assignment against these permissions. |
| `capabilities` | string[] | Supported work categories: `general_cleaning`, `floor_litter`, `bin_overflow`, `floor_spill`. General cleaning satisfies any current issue capability check. |
| `status` | string | Personnel enablement: `active` or `inactive`. Separate from login setup and online presence. |
| `notes` | string? | Supervisor-maintained personnel notes, not LLM instructions. |
| `authUid` | string? | Linked Firebase UID. Starts null; provisioning uses a deterministic UID derived from the Cleaner ID. |
| `email` | string? | Reserved account email. Starts null until provisioning. |
| `accountStatus` | string | `not_provisioned`, `provisioning`, `invited`, `active`, `disable_pending`, or `disabled`. Tracks cross-service account setup/access. |
| `accountProvisioningErrorCode` | string?, optional | Last recorded provisioning failure code. Supports retry/reconciliation; not a password or setup URL. |
| `accountProvisionedAt` | Timestamp, optional | When provisioning finalized the Auth/Firestore link. A provisioning replay can refresh it. |
| `authLinkedAt` | Timestamp? | Set when an invited Cleaner first makes a successful authenticated request. Name refers to activation of the linked account, not personnel creation. |

Account workflow: personnel creation -> provisioning -> invited -> first
authenticated request -> active. Disablement blocks personnel access and then
disables Auth. These statuses do not encode whether the Cleaner is on shift.

Sources: [Cleaner management](../backend/src/services/cleanerService.ts) and
[identity operations](../backend/src/services/identityService.ts).

### 5.1 `cleanerStaffCodes/{normalizedCode}`

Purpose: transactional uniqueness reservation. Shared fields: `createdAt`,
`createdByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Lowercase staff code, used as the atomic uniqueness key. |
| `cleanerId` | string | Cleaner that owns the reserved code. |
| `staffCode` | string | Display form of the reserved code. |

### 5.2 `userAccountEmails/{emailHash}`

Purpose: reserve a normalized email during Cleaner account provisioning.
Shared fields: `createdAt`, `createdByUid`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | SHA-256 of normalized email. The document itself still contains the email; hashing the ID is not encryption. |
| `email` | string | Trimmed lowercase email being reserved. |
| `uid` | string | Intended Firebase Auth UID. |
| `cleanerId` | string | Cleaner business record receiving the account. |
| `status` | string | `reserved` while setting up; `active` after successful finalization. |

## 6. Location hierarchy

Sources for all four collections below:
[location service](../backend/src/services/locationService.ts).

### 6.1 `sites/{siteId}`

Purpose: tourist attraction/property. Shared fields: all six personnel/config
audit fields from section 1.2, from `createdAt` through `deactivatedByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{siteId}` | string | Parent identity for zones and reporting. |
| `name` | string | Site display name, for example Batu Caves. |
| `nameNormalized` | string | Lowercase normalized name retained alongside the display value. |
| `description` | string? | Human explanation of the site. |
| `timezone` | string | IANA time zone, default `Asia/Kuala_Lumpur`; used for local calendar-day report coverage. |
| `status` | string | `active` or `inactive`. Parent checks prevent new active assignments under an inactive site. |

### 6.2 `zones/{zoneId}`

Purpose: cleaning/monitoring area within a site. Shared fields: the six
personnel/config audit fields.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{zoneId}` | string | Scope for incident deduplication, permissions, and priority ranking. |
| `siteId` | string | Parent site. |
| `siteNameSnapshot` | string | Parent name copied when creating the zone. |
| `name` | string | Zone display name, for example Food Court. |
| `nameNormalized` | string | Lowercase normalized name. |
| `code` | string? | Optional human-facing zone code. Unlike camera codes, there is no built separate zone-code reservation collection. |
| `description` | string? | Human explanation of the area. |
| `status` | string | `active` or `inactive`; controls valid camera/Cleaner assignment. |
| `analyticsEnabled` | boolean | Initialized true. Current aggregation does not use this as a complete user-configurable exclusion switch. |
| `mapCentroid` | null placeholder | Initialized null for future map placement; no completed map-coordinate workflow. |
| `mapPolygon` | array placeholder | Initialized empty for a future zone map. Not a floor-inference ROI. |

### 6.3 `cameras/{cameraId}`

Purpose: logical source for uploads and future streams. Shared fields: the six
personnel/config audit fields.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{cameraId}` | string | Links uploads, runs, observations, and confirmation state to a source. |
| `siteId` | string | Site inherited from the assigned zone. |
| `siteNameSnapshot` | string | Site name copied during assignment. |
| `zoneId` | string | Camera's current cleaning zone. |
| `zoneNameSnapshot` | string | Zone name copied during assignment. |
| `code` | string | Human camera code reserved in `cameraCodes`. |
| `name` | string | Camera display label. |
| `nameNormalized` | string | Lowercase normalized label. |
| `sourceMode` | string | `upload` or `stream`. `stream` is a configuration value, not evidence of implemented live ingestion. |
| `streamProtocol` | null placeholder | Initialized null; no stream-connection implementation currently populates it. |
| `streamUri` | null placeholder | Initialized null. Do not insert camera passwords here. |
| `status` | string | Administrative `active`/`inactive`. |
| `availability` | string | Observed `unknown`/`available`/`unavailable`; successful processing can mark the source available. |
| `focusRegionNormalized` | point[] | Initialized empty. Operational jobs receive their own uploaded focus polygon; do not assume this camera field is automatically applied to every job. |
| `latestAnalysisRunId` | string? | Latest relevant analysis pointer for dashboard display. Cleared when moving the camera to a new zone. |
| `latestAnalysisAt` | Timestamp? | When Node updated the latest-run pointer. |
| `latestCapturedAt` | Timestamp? | Capture time used to avoid replacing a newer frame with an older upload. |
| `lastHealthCheckAt` | Timestamp? | Initialized null; reserved for source health monitoring. |
| `unavailableReason` | string? | Initialized null; does not imply continuous camera monitoring exists. |

### 6.4 `cameraCodes/{normalizedCode}`

Purpose: camera-code uniqueness. Shared fields: `createdAt`, `createdByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Lowercase camera code checked in the create transaction. |
| `cameraId` | string | Camera owning the code. |
| `code` | string | Display form of the code. |

## 7. `mediaAssets/{mediaId}`

Purpose: metadata for a local original upload or extracted video frame. Bytes
live under the configured local media root, not inside Firestore.

Shared fields: `createdAt`, `createdByUid`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID `{mediaId}` | string | Opaque asset identity used in evidence references and content URLs. |
| `kind` | string | Current writers use `original_upload` or `extracted_frame`. Other kinds in planning documents are not current producers. |
| `sourceType` | string | `image_upload` or `video_upload`; an extracted frame retains `video_upload`. |
| `originalFileName` | string | Sanitized display name. Does not control the filesystem path. |
| `storageKey` | string, removable | Generated relative path such as `media/{id}/original.mp4`. Deleted from metadata after retention removes the file. |
| `storageStatus` | string | `pending`, `available`, `missing`, or `deleted`; content reads require available storage. |
| `uploadToken` | string, temporary | Identifies the current image-publication attempt so an older retry cannot finalize another attempt's metadata. Removed after completion/failure. |
| `stagingName` | string, temporary | Video staging file basename used to recover an interrupted upload. Removed after publication/failure. |
| `mimeType` | string | Detected canonical MIME type used when serving the file. |
| `byteSize` | number | File size in bytes, used for size/integrity checks and content response headers. |
| `sha256` | string | File-content digest. Detects incompatible upload retries and corrupt/missing recovery files. |
| `width` | number? | Pixel width; known at video probe/frame creation or after image inference. |
| `height` | number? | Pixel height with the same timing as width. |
| `durationSeconds` | number? | Probed video length; null for still images/frames. |
| `codecName` | string?, optional | Probed video codec such as H.264. |
| `formatName` | string, optional | ffprobe container format labels, retained for diagnostics. |
| `parentMediaId` | string? | Original video asset for an extracted frame; null for an original upload. |
| `frameIndex` | number? | Zero-based sampled-frame number, not necessarily the source video's physical frame number. |
| `videoOffsetSeconds` | number? | Sampling position within the original video. |
| `siteId` | string | Site at upload/frame creation. |
| `siteNameSnapshot` | string | Stored site display name at that time. |
| `zoneId` | string | Zone at upload/frame creation. |
| `zoneNameSnapshot` | string | Stored zone display name. |
| `cameraId` | string | Logical source record used for the upload. |
| `cameraCodeSnapshot` | string | Human source code captured with the media. |
| `cameraNameSnapshot` | string | Source name captured with the media. |
| `capturedAt` | Timestamp | Claimed image/video capture time; defaults to upload time when omitted. A video frame adds its offset to video capture start. |
| `isTest` | boolean | Test-data marker copied into jobs/runs. Does not mean the file is not stored. |
| `storageCheckedAt` | Timestamp, optional | Last publication, missing-file, recovery, or retention check. |
| `latestAnalysisRunId` | string, optional | Written when an uploaded image is analyzed; links back to its result. |
| `deletedAt` | Timestamp, optional | When retention recorded file deletion while preserving this document. |
| `deletionReason` | string, optional | Currently `retention_policy`. |
| `retentionPolicyVersion` | string, optional | Currently `local-media-retention-v1`, explaining the deletion rules used. |
| `retentionCutoffAt` | Timestamp, optional | Age cutoff used by that retention execution. |
| `storageProvider` | string, compatibility input | Retention accepts missing/null/local values and rejects cloud providers. Current media writers do not set this field. |

Sources: [media delivery](../backend/src/services/mediaService.ts),
[Camera source and reference uploads](../backend/src/services/cameraDraftService.ts),
[retention](../backend/src/services/mediaRetentionService.ts).

## 8. `processingJobs/{jobId}`

This section records the retired standalone image/video processing-job format.
The current Camera monitoring workflow does not create these records.

Purpose: track one upload's processing, retries, and result summary. ID is
deterministic from requesting Supervisor UID and `clientRequestId`.

Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `type` | string | `image` or `video`, selecting the processor. |
| `status` | string | `uploading`, `queued`, `processing`, `completed`, `failed`; schemas also recognize `cancelled`. A recognized value does not itself provide a cancellation API. |
| `sourceMediaId` | string | Original asset to process. |
| `sourceType` | string | `image_upload` or `video_upload`. |
| `siteId` | string | Site snapshot inherited from the source. |
| `zoneId` | string | Zone snapshot inherited from the source. |
| `cameraId` | string | Source used for all analysis/confirmation records. |
| `requestedByUid` | string | Supervisor that submitted the upload; part of upload-idempotency identity. |
| `requestedAt` | Timestamp | When the request was accepted. |
| `captureStartedAt` | Timestamp | Original capture start, distinct from request/processing time. |
| `startedAt` | Timestamp? | Start of the processing attempt. May change on retries. |
| `completedAt` | Timestamp? | Terminal success/failure time; cleared when retried. |
| `analyticsEligible` | boolean | Normally `!isTest`; eligible runs still require completed evaluation and valid metadata. |
| `isTest` | boolean | Excludes operational flags, temporal confirmation, alerts, and analytics contributions while keeping inspectable results. |
| `clientRequestId` | string | User-provided upload identity. Same UID/key selects the same job. |
| `sourceSha256` | string, optional on old jobs | Source-content digest for detecting reuse of a key with another file. |
| `requestFingerprint` | string, optional on old jobs | Hash of file and relevant processing options. Rejects semantic drift on replay. |
| `uploadToken` | string, temporary | Image-publication generation, matching the media attempt. |
| `options` | object | Settings described below. |
| `progress` | object | Sample-processing counters described below. |
| `summary` | object | Stored aggregate of results produced by this job. |
| `error` | object? | Latest failure details; null before failure or after retry/success. |
| `attemptCount` | number | Number of processing claims, not number of detected objects. |
| `claimToken` | string? | Current processing owner token, checked before result/progress writes. Cleared at completion/failure. |
| `leaseExpiresAt` | Timestamp? | Time when the current worker's ownership can expire and recovery may reclaim work. |
| `analysisRunId` | string? | Single image result pointer. Video runs are retrieved by `jobId`; do not treat this as the video's complete result list. |
| `video` | object, video only | Probe metadata used for frame planning. |
| `videoTrackingState` | object, video only | Last finalized bin-tracker checkpoint for retry/resume. |

### 8.1 Job nested fields

| Field path | Type | Meaning and workflow use |
| --- | --- | --- |
| `options.frameIntervalSeconds` | number? | Video sampling interval; null for image jobs. |
| `options.floorConfidence` | number? | Requested model-output confidence floor; processing uses a default when null. Not the Node dirty-condition threshold. |
| `options.binLocalizerConfidence` | number? | Requested bin-localizer confidence floor. |
| `options.focusRegionNormalized` | point[] | Uploaded normalized polygon restricting floor inference; people/bin inference still uses the full image. |
| `progress.plannedFrames` | number | Number of samples to attempt; one for an image. |
| `progress.processedFrames` | number | Finalized successful or recorded failed samples. |
| `progress.successfulFrames` | number | Samples whose analysis/business finalization succeeded. |
| `progress.failedFrames` | number | Recorded failed samples; does not alone describe whole-job success. |
| `progress.lastFrameIndex` | number? | Last finalized sample cursor, used to resume a video. |
| `summary.analysisRunCount` | number | Persisted successful runs included in finalized job results. |
| `summary.detectionCount` | number | Count of raw issue detection records, not alert count. |
| `summary.flagCount` | number | Count of grouped flags. One flagged frame/issue can represent several detections. |
| `summary.alertIds` | string[] | Distinct alerts linked by job evaluation, not every active site alert. |
| `error.code` | string | Failure category used for diagnostics/retry decisions. |
| `error.message` | string | Stored failure description. Do not equate this with the stricter system-event safe-details map. |
| `error.occurredAt` | Timestamp | When the failure was recorded. |
| `video.durationSeconds` | number | Source duration used to calculate sample offsets. |
| `video.width` | number | Probed source width in pixels. |
| `video.height` | number | Probed source height in pixels. |
| `video.codecName` | string? | Probed video codec. |
| `video.formatName` | string | Probed container format description. |

### 8.2 Bin tracking checkpoint shape

Used by `processingJobs.videoTrackingState` and
`analysisRuns.videoTrackingStateAfter`.

| Field path | Type | Meaning and workflow use |
| --- | --- | --- |
| `version` | string | `video-bin-tracking-v1`; identifies checkpoint format. |
| `nextId` | number | Next session-local bin identifier counter. |
| `tracks` | object keyed by bin ID | Current/recent tracks, not a permanent physical-bin collection. |
| `tracks.{binId}.bbox` | pixel box | Last bounding box used for IoU/proximity matching. |
| `tracks.{binId}.consecutiveSeen` | number | Consecutive sightings for identity confirmation. |
| `tracks.{binId}.missed` | number | Missed samples; old tracks expire after the configured tolerance. |
| `tracks.{binId}.confirmed` | boolean | Tracking diagnostic. Not Node's temporal overflow-alert confirmation. |

### 8.3 `processingJobs/{jobId}/frameFailures/{frameIndex}`

Purpose: deduplicate a recoverable frame failure. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Sample index converted to text; one failure marker per sample. |
| `frameIndex` | number | Failed sampled-frame index. |
| `videoOffsetSeconds` | number | Position that ffmpeg tried to extract. |
| `error.code` | string | Frame-processing failure category. |
| `error.message` | string | Failure description stored for diagnosis. |

The retired image/video writers and tracker have been removed. Existing records
remain documented for retention and migration work.

## 9. `analysisRuns/{analysisRunId}`

Purpose: one image/frame analysis result. Image run IDs equal their job ID;
video run IDs are deterministic for the job/sample. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `jobId` | string | Processing job that produced the result. |
| `sourceMediaId` | string | Original image/video. |
| `frameMediaId` | string? | Extracted video-frame asset; null for an image upload. |
| `evidenceMediaId` | string | Asset shown as this run's evidence, usually original image or extracted frame. |
| `sourceType` | string | `image_upload` or `video_upload`. |
| `siteId` | string | Site captured with the job. |
| `siteName` | string | Stored site display snapshot, despite lacking a `Snapshot` suffix. |
| `zoneId` | string | Zone captured with the job. |
| `zoneName` | string | Stored zone display snapshot. |
| `cameraId` | string | Source used for temporal confirmation. |
| `cameraCode` | string | Stored human source code. |
| `cameraName` | string | Stored source name. |
| `capturedAt` | Timestamp | Time represented by the sample, used by alert windows and analytics. |
| `frameIndex` | number? | Sample index for video; null for image upload. |
| `videoOffsetSeconds` | number? | Offset within the source video. |
| `image.width` | number | Inference-image width in pixels. |
| `image.height` | number | Inference-image height in pixels. |
| `focusRegionNormalized` | point[] | Floor ROI used for this inference and policy scoring. |
| `peopleCount` | number | People detected in this sample, not unique visitors across samples. |
| `people` | object[] | Embedded person confidence/geometry; no separate people collection. |
| `bins` | object[] | Embedded bin observations, including normal/full/unknown states as well as overflow. |
| `issueKinds` | string[] | Distinct issue types present in raw normalized detections. |
| `issueCounts.floorLitter` | number | Raw floor-litter detection count for this run. |
| `issueCounts.binOverflow` | number | Raw overflow detection count. |
| `issueCounts.floorSpill` | number | Raw spill detection count. |
| `modelVersions.floorHazard` | string | Floor model/version label returned by FastAPI. |
| `modelVersions.people` | string | People-detector version label. |
| `modelVersions.binLocalizer` | string | Bin-localizer version label. |
| `modelVersions.binState` | string | Bin-state classifier version label. |
| `processingTimeMs` | number | Inference-reported duration in milliseconds, not total upload/API time. |
| `isTest` | boolean | Copied test-data exclusion marker. |
| `analyticsEligible` | boolean | Whether this run may contribute operational analytics. |
| `alertWorkflowVersion` | string | Workflow format used when the run was created. Replay rejects incompatible old runs. |
| `alertEvaluationStatus` | string | `pending` or `completed`; controls safe continuation of interrupted evaluation. |
| `alertEvaluationPolicyVersion` | string? | Policy used when grouped evaluation completed. |
| `alertEvaluationWorkflowVersion` | string, optional | Workflow version explicitly recorded on completion. |
| `alertEvaluationAt` | Timestamp? | Evaluation completion timestamp. |
| `observationIds` | string[], optional | Generated per-issue grouped observations. |
| `flagIds` | string[], optional | Positive grouped flags produced for this run. |
| `alertIds` | string[], optional | Distinct alerts attached by this run's evaluation. |
| `analyticsAppliedAt` | Timestamp? | When analytics processing considered the run. May be set even if excluded. |
| `analyticsApplicationStatus` | string, optional | `applied` or `excluded`; inspect this rather than assuming a timestamp means contribution. |
| `analyticsGenerationId` | string, optional | Analytics generation that handled this run. |
| `analyticsBucketId` | string, optional | Hourly bucket receiving the contribution. |
| `analyticsPersistenceOutOfOrderIssueTypes` | string[], optional | Issues excluded from persistence advancement because capture order was older than current state. |
| `videoTrackingStateAfter` | object, video only | Tracker state after this sample; allows a persisted run to resume finalization without rerunning inference. |
| `videoJobAppliedAt` | Timestamp?, video only | Marker that this run has incremented video job progress/summary. Prevents double counting on resume. |

### 9.1 Embedded person and bin fields

| Field path | Type | Meaning and workflow use |
| --- | --- | --- |
| `people[].confidence` | number | Model confidence for one person observation. |
| `people[].bboxNormalized` | normalized box | Person location for display/inspection. |
| `bins[].entityId` | string | Image-local bin number or video tracker ID. Not a globally registered physical bin. |
| `bins[].state` | string | `normal`, `full`, `overflow`, or `unknown`. |
| `bins[].stableState` | string? | Compatibility/diagnostic slot, currently normally null in the stateless operational path. |
| `bins[].confidence` | number | State classification confidence. |
| `bins[].localizerConfidence` | number | Confidence that the localized region is a bin. |
| `bins[].bboxNormalized` | normalized box | Bin location in the full image. |
| `bins[].classificationRegionNormalized` | normalized box | Actual region used for state classification, which may include context padding. |
| `bins[].signals.binPresence` | number | Model bin-presence score. |
| `bins[].signals.fullness` | number | Model fullness score, not an independently measured fill percentage. |
| `bins[].signals.overflow` | number | Model overflow score. |
| `bins[].confirmed` | boolean? | Video identity confirmation diagnostic; not incident confirmation. |
| `bins[].stale` | boolean | Whether the observation is carried/stale; current tracker does not emit unseen carried detections. |

### 9.2 Reusable geometry fields

| Field | Type/unit | Meaning |
| --- | --- | --- |
| Normalized box `x1` | number, 0–1 | Left edge as a fraction of full-image width. |
| Normalized box `y1` | number, 0–1 | Top edge as a fraction of full-image height. |
| Normalized box `x2` | number, 0–1 | Right edge as a fraction of full-image width. |
| Normalized box `y2` | number, 0–1 | Bottom edge as a fraction of full-image height. |
| Normalized point `x` | number, 0–1 | Horizontal image fraction. |
| Normalized point `y` | number, 0–1 | Vertical image fraction. |
| Pixel box `x1`, `y1`, `x2`, `y2` | numbers, pixels | Same edges before normalization; used in transient inference and persisted tracker checkpoints. |

The retired image/video writers and normalization layer have been removed.
Existing records remain documented for retention and migration work.

## 10. `detections/{detectionId}`

Purpose: one normalized raw cleanliness detection. ID is deterministic from
run, issue, and entity. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `analysisRunId` | string | Parent image/frame result. |
| `jobId` | string | Original processing job, allowing video-wide queries. |
| `sourceMediaId` | string | Original upload. |
| `evidenceMediaId` | string | Evidence asset for this detection's frame. |
| `sourceType` | string | Image or video upload origin. |
| `siteId` | string | Site where the detection was observed. |
| `siteName` | string | Stored site-name snapshot. |
| `zoneId` | string | Cleaning zone used for incident routing. |
| `zoneName` | string | Stored zone-name snapshot. |
| `cameraId` | string | Source identity. |
| `cameraCode` | string | Stored human source code. |
| `cameraName` | string | Stored source name. |
| `issueType` | string | `floor_litter`, `floor_spill`, or `bin_overflow`. People are embedded in runs, not issue detections. |
| `confidence` | number | Raw model confidence retained even when policy rejects the detection. |
| `bboxNormalized` | normalized box | Detection bounds in the full image. |
| `polygonNormalized` | point[] | Floor segmentation polygon, capped at 128 points; empty for overflow. Omitted from compact list DTOs, not deleted from storage. |
| `entityId` | string | Run-local floor index or bin identity used for deterministic IDs. |
| `modelKey` | string | Current writers use `floor_hazard` or `bin_state`. |
| `modelVersion` | string | Version label of the model producing the issue. |
| `capturedAt` | Timestamp | Frame capture time, not processing completion time. |
| `thresholdApplied` | number? | Floor model's output filter; null for normalized overflow. Separate from business qualification threshold. |
| `localizerConfidence` | number? | Bin-localizer confidence for overflow; null for floor issues. |
| `signals` | object? | Bin `binPresence`, `fullness`, `overflow` scores; null for floor issues. |
| `confirmed` | boolean? | Bin tracking diagnostic; not permission to create an alert. |
| `stale` | boolean? | Bin staleness diagnostic; null for floor detections. |
| `qualificationStatus` | string | `pending_evaluation`, `qualified`, `rejected`, or `excluded`. |
| `qualifiedForFlag` | boolean? | Null before evaluation; true when included in a positive operational group. |
| `qualificationReason` | string | Explains test exclusion, confidence rejection, insufficient group magnitude, or grouped qualification. |
| `qualificationEvaluatedAt` | Timestamp? | When Node evaluated this detection as part of its group. |
| `qualificationPolicyVersion` | string, optional | Node policy version applied to the group. |
| `qualificationThreshold` | number, optional | Minimum detection confidence used by Node, not Python's output filter. |
| `observationId` | string, optional | The grouped issue observation containing this detection. |
| `flagId` | string? | Positive flag if this detection contributes; remains null for rejected/test data. |
| `analyticsEligible` | boolean | Source eligibility marker, not proof this individual detection contributed. |
| `isTest` | boolean | Source test-data marker. |

Raw detection records remain after rejection. `analyticsEligible: true` with
`qualifiedForFlag: false` is therefore possible and intentional.

## 11. Grouped issue observations and flags

This section documents the retired V1 grouped-observation and Flag format. Its
evaluator and policy implementation have been removed. Existing records remain
available for migration or historical inspection. Current Alerts are owned by
[the Alert service](../backend/src/services/alertService.ts) and
[current policy](../backend/src/services/alertPolicy.ts).

### 11.1 `issueObservations/{observationId}`

Purpose: one evaluated issue group for an analysis run. ID is a hash of run ID
and issue type. The evaluator creates groups for litter, overflow, and spill,
including negative groups when no qualifying detection exists.

Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workflowVersion` | string | Grouped-record format and workflow identifier. |
| `policyVersion` | string | Rule version used for this observation. |
| `analysisRunId` | string | Image/frame evaluated. |
| `jobId` | string | Source processing job. |
| `sourceType` | string | Source upload kind. |
| `siteId` | string | Incident/analytics site scope. |
| `siteNameSnapshot` | string | Site name copied from the run. |
| `zoneId` | string | Zone for alert deduplication. |
| `zoneNameSnapshot` | string | Zone name copied from the run. |
| `cameraId` | string | Camera whose confirmation buffer receives this sample. |
| `cameraCodeSnapshot` | string | Human source code copied from the run. |
| `cameraNameSnapshot` | string | Source name copied from the run. |
| `issueType` | string | Issue being evaluated independently of the other groups. |
| `evidenceMediaId` | string? | Frame/image used to support the observation. |
| `capturedAt` | Timestamp | Orders the observation and constrains its temporal window. |
| `frameIndex` | number? | Video sample index, if applicable. |
| `videoOffsetSeconds` | number? | Video sample offset, if applicable. |
| `detectionIds` | string[] | All raw detections assigned to this issue group. |
| `eligibleDetectionIds` | string[] | Detections passing the applicable confidence/geometry filters before the final group decision. |
| `rejectedDetectionIds` | string[] | Raw detections excluded from the group metrics/qualification path. |
| `detectionCount` | number | Number of raw detections grouped here, not necessarily `metrics.detectionCount`. |
| `positive` | boolean | Whether this group produced an operational flag. Test groups are not positive business observations even when metrics show an issue. |
| `excluded` | boolean | True for test runs, preventing confirmation/incident contributions. |
| `evaluationReason` | string | Policy result such as `test_data`, `below_detection_confidence`, `outside_analysis_region`, `below_dirty_magnitude`, or `alert_candidate`. |
| `severity` | string? | `warning`/`critical` for a positive group; otherwise null. |
| `metrics` | GroupMetrics | Computed group measurements, defined in section 11.3. Test groups keep inspectable measurements. |
| `minimumDetectionConfidence` | number | Confidence floor used to evaluate raw evidence. |
| `alertThreshold` | number? | Group magnitude threshold when relevant; not the temporal positive count. |
| `flagId` | string? | Deterministic positive grouped flag, or null. |
| `alertId` | string? | Incident to which the positive observation was attached. Negative samples do not attach to an old active incident. |
| `temporalStatus` | string | Persisted values include initial `pending_confirmation`, `awaiting_confirmation`, `attached`, `negative`, `excluded`, and `out_of_order`. |
| `confirmation` | object? | Evaluation of the recent camera sequence, defined in section 11.4. |
| `confirmationGeneration` | number? | Zone/issue reset generation used when applying this observation. |
| `temporalAppliedAt` | Timestamp? | Marker showing temporal handling has happened; supports idempotent replay. |
| `temporalResult.alertId` | string? | Saved result of temporal handling. |
| `temporalResult.temporalStatus` | string | Saved result category. Replay can return additional labels such as `pre_reset_replay` without rewriting the stored observation. |

### 11.2 `flags/{flagId}`

Purpose: a positive group awaiting temporal confirmation or attached to an
incident. ID is derived from observation ID. Shared fields: `createdAt`,
`updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workflowVersion` | string | Grouped-flag format/version. |
| `policyVersion` | string | Policy that qualified the group. |
| `observationId` | string | Positive grouped observation that owns this flag. |
| `analysisRunId` | string | Supporting frame/image run. |
| `detectionId` | string? | First eligible detection retained as a convenience/compatibility pointer. Not the complete evidence set. |
| `detectionIds` | string[] | All eligible detections supporting the flag. |
| `siteId` | string | Site scope. |
| `zoneId` | string | Incident uniqueness scope. |
| `cameraId` | string | Source confirmation sequence. |
| `issueType` | string | Litter, spill, or overflow issue. |
| `severity` | string | Group severity, used when creating/escalating an alert. |
| `confidence` | number | Maximum eligible detection confidence in this group. |
| `metrics` | GroupMetrics | Snapshot of the qualifying group's measurements. |
| `thresholdApplied` | number? | Group alert/magnitude threshold, not the model-output threshold with the same name on a detection. |
| `evidenceMediaId` | string? | Supporting image/frame asset. |
| `capturedAt` | Timestamp | Observation capture time. |
| `status` | string | `pending_confirmation`, `attached`, or `ignored_out_of_order` in current writers. |
| `alertId` | string? | Confirmed incident, once attached. |
| `failureReason` | null placeholder | Initialized null; no substantive failure-writing workflow currently uses it. |
| `confirmation` | object? | Temporal sequence result at evaluation/attachment. |
| `attachedAt` | Timestamp, optional | When the flag was linked to an incident. |

### 11.3 Shared `GroupMetrics` object

Stored on observations, flags, confirmation-buffer entries, and alert
occurrences. Exact interpretation follows the issue-specific policy.

| Field | Type/unit | Meaning and workflow use |
| --- | --- | --- |
| `detectionCount` | number | Count of detections used by the metric calculation after evidence filtering. |
| `maximumConfidence` | number | Highest confidence among retained evidence. |
| `meanConfidence` | number | Average confidence among retained evidence. |
| `mergedRegionCount` | number | Number of merged nearby litter regions; reduces treating adjacent fragments as independent dirty regions. |
| `coverageRatio` | number, 0–1 | Approximate union coverage within the analysis region, estimated by sampling. Not a surveyed ground-area measurement. |
| `occupiedGridCells` | number | Grid cells containing retained litter evidence. |
| `spatialDistribution` | number, 0–1 | Spread relative to valid grid coverage; supports the dirty-magnitude calculation. |
| `magnitudeScore` | number? | Weighted litter dirtiness score; null when the issue does not use the litter magnitude formula. |

### 11.4 Shared confirmation-result object

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `confirmed` | boolean | Whether the sampled positive/negative sequence satisfies the issue rule. |
| `mode` | string, optional | `at_least` or `consecutive`. Can be absent for an out-of-order rejection result. |
| `requiredPositive` | number, optional | Positives required by the rule. |
| `windowSize` | number, optional | Maximum recent observations considered. |
| `evaluatedObservationCount` | number | Samples available/considered in this evaluation. |
| `positiveCount` | number | Positive samples counted. |
| `reason` | string | Explains confirmed, insufficient positives, insufficient consecutive positives, or out-of-order handling. |

## 12. Confirmation memory and active incidents

### 12.1 `alertConfirmationStates/{stateId}`

Purpose: bounded rolling observation memory, keyed by zone, camera, and issue.
It is stored state, not LLM conversation memory. Shared fields: `createdAt`,
`updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workflowVersion` | string | Confirmation-state semantics. |
| `policyVersion` | string | Determines whether an old buffer can still be reused. |
| `siteId` | string | Site owning the sequence. |
| `zoneId` | string | Zone reset/incident scope. |
| `cameraId` | string | Camera whose samples form this sequence. |
| `issueType` | string | Independently confirmed issue. |
| `observations` | buffer entry[] | Recent samples bounded by rule size and capture-time horizon. |
| `lastCapturedAt` | Timestamp | Capture time of the latest buffered observation. |
| `lastObservationId` | string | Latest buffered observation identity. |
| `lastAlertId` | string? | Last incident associated with this sequence/generation. |
| `lastResetAt` | Timestamp? | Reset timestamp seen when state was applied. |
| `resetGeneration` | number | Reset counter applied to this buffer; mismatch causes old evidence to be discarded. |

Each `observations[]` entry contains:

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `observationId` | string | Source grouped observation and duplicate check. |
| `analysisRunId` | string | Source analysis for occurrence traceability. |
| `flagId` | string? | Positive flag; null for negative observations. |
| `positive` | boolean | Value used in temporal confirmation. |
| `capturedAt` | Timestamp | Window ordering/expiry time. |
| `evidenceMediaId` | string? | Evidence copied into an occurrence if confirmed. |
| `cameraId` | string | Source identity for incident camera aggregation. |
| `detectionIds` | string[] | Eligible group evidence. |
| `severity` | string? | Severity available for incident escalation. |
| `maximumConfidence` | number | Group maximum confidence. |
| `magnitudeScore` | number? | Group litter magnitude where relevant. |
| `metrics` | GroupMetrics | Measurement snapshot, section 11.3. |

### 12.2 `alertConfirmationResets/{activeKeyId}`

Purpose: reset all camera sequences for a resolved zone/issue. Shared field:
`updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workflowVersion` | string | Workflow that performed the reset. |
| `siteId` | string | Reset site scope. |
| `zoneId` | string | Zone whose incident ended. |
| `issueType` | string | Issue whose confirmation must start fresh. |
| `resolvedAlertId` | string | Incident that caused the latest reset. |
| `generation` | number | Incrementing reset counter. It is unrelated to an analytics rebuild generation. |
| `resetAt` | Timestamp | When the reset occurred. Generation comparison prevents reliance solely on potentially skewed capture times. |

### 12.3 `alerts/{alertId}`

Purpose: one confirmed zone/issue incident. A new incident also creates a Node
orchestrator run and outbox event. Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Deterministic incident identifier created from the triggering observation/generation context. |
| `workflowVersion` | string | Distinguishes current grouped alerts from legacy records. |
| `policyVersion` | string | Policy that first confirmed the incident. |
| `activeKey` | string | Human-readable `zoneId:issueType` uniqueness identity. |
| `activeKeyId` | string | Hashed `activeAlertKeys` document ID used for release/reset. |
| `siteId` | string | Site for dashboard, context, and analytics. |
| `zoneId` | string | Zone where cleaning is required. |
| `triggerCameraId` | string | Camera whose observation initially confirmed the alert. |
| `cameraId` | string | Trigger-camera compatibility pointer. Not necessarily the only contributing camera. |
| `latestCameraId` | string | Camera of the latest attached evidence. |
| `cameraIds` | string[] | Unique contributing cameras. |
| `siteNameSnapshot` | string | Site name copied at incident creation. |
| `zoneNameSnapshot` | string | Zone name copied at incident creation. |
| `cameraCodeSnapshot` | string | Initial source code snapshot. |
| `cameraNameSnapshot` | string | Initial source name snapshot. |
| `issueType` | string | `floor_litter`, `floor_spill`, or `bin_overflow`. |
| `severity` | string | `warning` or `critical`; supporting evidence can escalate it. |
| `status` | string | `new`, `acknowledged`, `in_progress`, `awaiting_verification`, or `resolved`. |
| `firstObservationId` | string | Earliest supporting observation, also used for analytics incident attribution. |
| `latestObservationId` | string | Latest attached observation by capture time. |
| `firstDetectionId` | string? | Convenience pointer into initial supporting detections. |
| `latestDetectionId` | string? | Convenience pointer into latest supporting detections. |
| `latestFlagId` | string? | Latest attached grouped flag. |
| `firstEvidenceMediaId` | string? | Initial incident evidence, used as review context. |
| `latestEvidenceMediaId` | string? | Most recent supporting media. |
| `occurrenceCount` | number | Number of attached grouped observations, not raw object count. |
| `firstDetectedAt` | Timestamp | Capture time of the earliest attached support. |
| `lastDetectedAt` | Timestamp | Latest attached support time; used for ordered incident lists. |
| `latestConfidence` | number | Latest group's maximum confidence. |
| `maximumConfidence` | number | Highest confidence seen across attached groups. |
| `latestMagnitudeScore` | number? | Latest litter magnitude, if applicable. |
| `maximumMagnitudeScore` | number | Highest attached magnitude; initialized through aggregation and may be zero for non-litter incidents. |
| `statusUpdatedAt` | Timestamp | When the business status last changed. |
| `statusUpdatedByUid` | string | Actor for status change. Despite the name, it can contain `system` or an orchestrator worker ID, not only Firebase UIDs. |
| `resolvedAt` | Timestamp? | Resolution time; null while active. |
| `resolvedByUid` | string? | Resolver; may be a Supervisor UID or orchestrator actor ID. |
| `analyticsIncidentAppliedAt` | Timestamp, optional | When this incident was applied to analytics by the live path. |
| `analyticsIncidentGenerationId` | string, optional | Analytics generation that received it. |
| `analyticsIncidentBucketId` | string, optional | Bucket receiving this incident count. |
| `automationException` | object, optional | Review exception requiring oversight; nested fields below. |
| `automationException.code` | string | Currently `review_supervisor_exception`. |
| `automationException.summary` | string | Submitted review rationale explaining the exception. |
| `automationException.recordedAt` | Timestamp | When the exception was recorded. |
| `automationException.recordedBy` | string | Review actor ID. |

### 12.4 `activeAlertKeys/{zoneIssueHash}`

Purpose: transactionally reserve one active incident per zone and issue.
Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workflowVersion` | string | Active-key format/workflow. |
| `alertId` | string | Current incident receiving later positive observations. |
| `siteId` | string | Site scope copied from the incident. |
| `zoneId` | string | Zone in the uniqueness key. |
| `issueType` | string | Issue in the uniqueness key. |

Resolution releases this key; `alertConfirmationResets` retains the reset
generation. They are different records with different lifetimes.

### 12.5 `alerts/{alertId}/occurrences/{flagId}`

Purpose: evidence groups attached to an incident. Shared field: `createdAt`.
The flag ID prevents attaching the same group twice.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `flagId` | string | Attached positive flag. |
| `observationId` | string | Source grouped observation. |
| `detectionId` | string? | First supporting detection convenience pointer. |
| `detectionIds` | string[] | Full eligible detection set for this occurrence. |
| `analysisRunId` | string | Supporting image/frame result. |
| `cameraId` | string | Contributing source. |
| `evidenceMediaId` | string? | Supporting media asset. |
| `confidence` | number | Group maximum confidence. |
| `magnitudeScore` | number? | Litter dirty-magnitude score. |
| `metrics` | GroupMetrics | Group measurements at attachment. |
| `severity` | string? | Supporting group severity. |
| `capturedAt` | Timestamp | Time represented by the occurrence. |

### 12.6 `alerts/{alertId}/statusHistory/{historyId}`

Purpose: record who changed incident state and when. Unlike occurrences, these
records describe operator/system actions rather than new visual evidence.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `previousStatus` | string? | Status before this action; null for initial creation. |
| `newStatus` | string | Status after this action. |
| `actorType` | string | `system`, `supervisor`, `cleaner`, or `orchestrator`, depending on writer. |
| `actorUid` | string? | Actor identity; can be a worker ID for orchestration and null for initial system creation. |
| `actorNameSnapshot` | string | Name/label recorded by the writer. Some automated paths use a fixed operator label rather than a looked-up person. |
| `actorEmailSnapshot` | string? | Human actor email snapshot where available. |
| `note` | string? | Operator note or review rationale. |
| `changedAt` | Timestamp | Time the status change was written. |

## 13. Cleaner presence and location

This section records the retired V1 GPS/presence format. Current Cleaner
availability uses [schedules and Station Points](../backend/src/services/cleanerAvailability.ts).
The location-history retention tool remains available for historical data.

### 13.1 `cleanerPresence/{cleanerId}`

Purpose: current operational read model for assignment and mobile status.
Shared field: `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `cleanerId` | string | Cleaner business identity, also the document ID. |
| `availability` | string | `online`, `busy`, `break`, or `offline`. Mobile inputs expose online/break/offline; work-order writers set busy/release state. |
| `activeWorkOrderId` | string? | Current work reservation. The current backend uses it to prevent assigning conflicting active work. |
| `locationConsent` | boolean, optional until heartbeat | Whether the Cleaner permitted location processing. Withdrawing consent clears the current location. |
| `lastHeartbeatAt` | Timestamp, optional | Last accepted presence update; used for online freshness. Not necessarily when GPS was measured. |
| `lastLocation` | object?, optional | Last accepted measurement. An older sample does not replace a newer one. |
| `lastLocation.latitude` | number, degrees | Latitude, validated within -90 to 90. |
| `lastLocation.longitude` | number, degrees | Longitude, validated within -180 to 180. |
| `lastLocation.accuracyMeters` | number | Device-reported positional accuracy, not distance to the work site. |
| `lastLocation.capturedAt` | Timestamp | When the measurement was taken. |
| `lastLocation.source` | string | `browser_geolocation` or `manual_check_in`. |

`locationStatus` and `freshnessSeconds` are API-calculated, not stored columns.
The regular presence API checks consent, availability, heartbeat age, and
measurement age. The existing orchestrator candidate service uses a narrower
heartbeat-age calculation under the same `locationStatus` name; do not assume
it proves fresh GPS coordinates.

### 13.2 `cleaners/{cleanerId}/locationHistory/{locationId}`

Purpose: idempotent individual measurements with privacy expiry. The ID hashes
Cleaner ID and heartbeat ID.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `cleanerId` | string | Owner of the measurement. |
| `latitude` | number, degrees | Recorded latitude. |
| `longitude` | number, degrees | Recorded longitude. |
| `accuracyMeters` | number | Reported measurement uncertainty. |
| `capturedAt` | Timestamp | Device measurement time. |
| `receivedAt` | Timestamp | Time Node accepted it; can differ from capture time. |
| `source` | string | Browser geolocation or manual check-in. |
| `clientHeartbeatId` | string | Caller-provided sample identity. |
| `requestFingerprint` | string | Hash covering submitted location/consent/availability contents; conflicts return 409. |
| `retentionExpiresAt` | Timestamp | Seven days after receipt under the current policy. The cleanup command uses it; it does not imply automatic Firestore TTL is enabled. |

## 14. Work orders and assignment records

The fields below document the retired V1 Work format. Current Work is owned by
[the operational Work service](../backend/src/services/workOrderService.ts).

### 14.1 `workOrders/{workOrderId}`

Purpose: assigned physical work for an alert. Creation ID hashes actor ID and
action idempotency key. Shared fields: `createdAt`, `createdByUid`, `updatedAt`,
`updatedByType`, `updatedById`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `alertId` | string | Incident the Cleaner must address. |
| `siteId` | string | Site from the incident. |
| `siteNameSnapshot` | string | Site display name at creation. |
| `zoneId` | string | Work location. |
| `zoneNameSnapshot` | string | Work-location display name at creation. |
| `issueType` | string | Cleanliness issue determining capability and instructions. |
| `status` | string | Schema supports `unassigned`, `assigned`, `accepted`, `in_progress`, `ready_for_review`, `rework_required`, `completed`, `rejected`, `cancelled`. Normal create writes `assigned`; there is no normal precreated unassigned-task flow. |
| `assignedCleanerId` | string | Current primary Cleaner's business ID. |
| `assignedCleanerUid` | string | Login UID used to address notification delivery. |
| `assignedCleanerNameSnapshot` | string | Assigned person's name at assignment. Reassignment replaces current snapshot, preserving old attempts separately. |
| `assignedCleanerStaffCodeSnapshot` | string | Staff code of the assigned person. |
| `assignmentAttempt` | number | Starts at one and increments on reassignment. |
| `instructions` | string | Bounded cleaning instructions supplied by the caller. Not currently generated automatically by the assignment prototype. |
| `assignmentDecisionId` | string | External/manual decision identity reserved in `workOrderDecisions`. |
| `idempotencyKey` | string | Original create-action key. |
| `requestFingerprint` | string | Original create contents hash; detects changed create requests. Later transition fingerprints live in history. |
| `availabilityOverride` | boolean | Records an explicit bypass of ordinary availability/fresh-heartbeat checks. Does not bypass all account/permission/capability checks. |
| `assignedAt` | Timestamp | Current assignment time; refreshed on reassignment. |
| `acceptedAt` | Timestamp? | Acceptance time; reset when reassigned. |
| `startedAt` | Timestamp? | Work-start time; a later rework start can replace it. Consult history for all cycles. |
| `readyForReviewAt` | Timestamp? | Latest submission time. |
| `readyForReviewEvidenceMediaIds` | string[] | Cleaner-submitted evidence references for review. Default empty; not equivalent to uploaded/verified image contents. |
| `completedAt` | Timestamp? | Completion time. Clean review can also set this. |
| `rejectedAt` | Timestamp? | Rejection time; cleared when reassigned. |
| `cancelledAt` | Timestamp? | Cancellation time. |

The current single-primary-Cleaner rule is enforced with presence state and an
active key per alert. The friend's proposed multiple queued assignments are
not the currently implemented rule.

### 14.2 `activeWorkOrderKeys/{alertHash}`

Purpose: reserve one non-terminal work order for the alert. Shared field:
`createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `alertId` | string | Incident whose work is reserved. |
| `workOrderId` | string | Current work record. Completion/cancellation releases the key. |

### 14.3 `workOrderDecisions/{decisionHash}`

Purpose: uniqueness marker for an assignment decision, not a complete LLM
audit record. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `assignmentDecisionId` | string | Original caller-supplied decision identifier. |
| `workOrderId` | string | Work record that consumed the decision. |
| `alertId` | string | Related incident. |

### 14.4 `workOrders/{workOrderId}/assignmentAttempts/{attemptId}`

Purpose: immutable assignment/reassignment snapshots. Shared field:
`createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `attempt` | number | Assignment sequence number. |
| `cleanerId` | string | Cleaner selected in this attempt. |
| `cleanerUid` | string | Their Auth UID at assignment. |
| `cleanerNameSnapshot` | string | Name at assignment time. |
| `cleanerStaffCodeSnapshot` | string | Staff code at assignment time. |
| `assignmentDecisionId` | string | Decision leading to this attempt. |
| `instructions` | string | Instructions issued for this attempt. |
| `actorType` | string | Supervisor/orchestrator actor category from the writer. |
| `actorId` | string | Issuing user or worker identity. |

### 14.5 `workOrders/{workOrderId}/statusHistory/{historyId}`

Purpose: explain every work status change, including rework cycles. Shared
field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `fromStatus` | string? | State before the action; null for creation. |
| `toStatus` | string | State after the action. |
| `actorType` | string | Cleaner, Supervisor, or orchestrator actor category. |
| `actorId` | string | Actor's business/user/worker identity according to type. |
| `note` | string? | Human note or review explanation. |
| `idempotencyKey` | string | Action identity for replay handling. |
| `requestFingerprint` | string, optional | Contents hash on transition/review entries; initial creation history does not populate it. |
| `evidenceMediaIds` | string[], optional | Evidence IDs recorded on Cleaner review submission. |

## 15. Review records

This section records retired V1 review structures. Current Work verification
is owned by [the operational Work service](../backend/src/services/workOrderService.ts).
These structures accept and store verification requests/decisions. They do not
by themselves capture a camera frame or invoke an LLM/VLM.

### 15.1 `workOrders/{workOrderId}/reviewRequests/{reviewRequestId}`

Purpose: ask for verification after cleaning. The ID hashes work ID and request
idempotency key. Shared fields: `createdAt`, optional `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workOrderId` | string | Work to verify. |
| `alertId` | string | Incident whose status is `awaiting_verification`. |
| `status` | string | Current writers create `requested` and later set `fulfilled`; schemas also allow `expired`/`cancelled`. |
| `beforeEvidenceMediaIds` | string[] | Baseline references copied from alert evidence. Extra-evidence requests can also include previous submission evidence. |
| `afterEvidenceMediaIds` | string[] | Cleaner-submitted or review-supplied evidence, empty when none exists. |
| `requestedByType` | string | Cleaner, Supervisor, or orchestrator requester. |
| `requestedById` | string | Requester's corresponding identity. |
| `idempotencyKey` | string | Identity of the request/submission. |
| `requestFingerprint` | string | Detects altered retries. |
| `rationale` | string? | Why verification/fresh evidence was requested. |
| `fulfilledAt` | Timestamp? | When a review decision consumed this request. |
| `decision` | string? | Decision that fulfilled it: clean, rework, more evidence, or exception. |
| `decisionReviewId` | string? | Link to the stored review result. |

### 15.2 `workOrders/{workOrderId}/reviews/{reviewId}`

Purpose: immutable submitted verification result. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `workOrderId` | string | Reviewed work record. |
| `alertId` | string | Related incident. |
| `reviewRequestId` | string | Request fulfilled by this result. |
| `beforeEvidenceMediaIds` | string[] | Baseline evidence copied from the request. |
| `afterEvidenceMediaIds` | string[] | Evidence supplied with the decision. |
| `visionResults` | object | Caller-supplied model result map. Current schema is generic, not a fixed validated VLM result format. |
| `decision` | string | `clean`, `rework`, `more_evidence`, or `supervisor_exception`. Drives transactional status changes. |
| `rationaleSummary` | string | Bounded explanation for the outcome; used in history and rework notification text. |
| `modelVersions` | object | Caller-supplied version map. It is not proof a model actually ran. |
| `promptPolicyVersion` | string? | Optional version of the reviewing prompt/policy. |
| `actorType` | string | Type of reviewing actor. |
| `actorId` | string | Reviewing operator/worker identity. |
| `idempotencyKey` | string | Decision action identity. |
| `requestFingerprint` | string | Protects against replay with a different decision. |

Workflow effects: `clean` completes work, resolves the alert, releases active
keys, resets confirmation, and releases the Cleaner. `rework` returns the alert
to `in_progress` and work to `rework_required`. `more_evidence` leaves the
business status waiting; a further request/worker action is still needed.
`supervisor_exception` records `alerts.automationException`.

Evidence ID lists are references, not files. Their presence or a non-empty
`visionResults` object must not be mistaken for a fully implemented automated
verification pipeline.

## 16. Notifications and retired push devices

Current durable in-app notifications are owned by
[the notification service](../backend/src/services/notificationService.ts).
The push-device fields below describe the retired V1 FCM implementation.

### 16.1 `notifications/{notificationId}`

Purpose: durable inbox entry. Current records use `schemaVersion: 2`, Site and
recipient scope, and a deterministic recipient-event identity. The detailed
delivery fields below belong to the retired V1 push implementation.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `recipientUid` | string | Cleaner's Firebase identity at notification creation. |
| `recipientCleanerId` | string | Business owner used to restrict inbox queries. |
| `type` | string | Current work hooks use `work_assigned`, `work_reassigned`, `rework_required`, `work_cancelled`; helper type also allows `system_message`. |
| `workOrderId` | string? | Work to open after reading the notification. |
| `title` | string | Short generated inbox/push heading. |
| `body` | string | Instructions or action explanation. |
| `status` | string | `pending`, `sent`, `failed`, or `read`. Currently combines delivery and reading state in one field. |
| `deliveryAttempts` | number | Recorded delivery attempts, including attempts with no registered token. Not a count of Cleaner views. |
| `deliveryReasonCode` | string? | For example `no_registered_push_token`, `push_delivery_failed`, or `push_service_unavailable`. |
| `sentAt` | Timestamp? | Set when at least one push delivery succeeds. Does not prove the Cleaner saw it. |
| `readAt` | Timestamp? | When the Cleaner marked the inbox item read. |

`failed` items remain in the unread inbox. No background retry scheduler is
implied merely by having `deliveryAttempts`.

### 16.2 `cleanerPushTokens/{deviceHash}`

Purpose: store one device registration per Cleaner/device identity. Shared
fields: `createdAt`, `updatedAt`; registration can refresh the creation value.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Hash of Cleaner ID and caller device ID. |
| `cleanerId` | string | Cleaner owning this registration. |
| `uid` | string | Firebase identity that registered the device. |
| `deviceId` | string | Stable client/browser installation label, used to update/remove that device. |
| `token` | string, removable | Sensitive FCM delivery token. Not a Firebase login token. Removed on explicit device deactivation. |
| `userAgent` | string? | Optional bounded browser description for diagnostics. |
| `status` | string | `active`, `invalid`, or `inactive`. Delivery uses active registrations only. |
| `invalidatedAt` | Timestamp? | When FCM reported an invalid registration; reset on re-registration. |

## 17. Orchestrator records

The fields below document the retired V1 Orchestrator format. Current Runs and
outbox processing are owned by
[the Orchestrator service](../backend/src/services/orchestratorService.ts)
and [worker](../backend/src/services/orchestratorWorker.ts).

### 17.1 `orchestratorRuns/{runId}`

Purpose: durable processing state for an alert. Current ID is deterministic
from the alert ID, so there is one run identity per alert. Shared fields:
`createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `alertId` | string | Incident being handled. |
| `threadKey` | string | `alert:{alertId}`, a stable correlation label. It is not a persisted LangGraph checkpoint. |
| `status` | string | `queued`, `running`, `waiting`, `completed`, `failed`, `paused`. Current worker completion accepts queue/wait/complete/fail; not every state has a dedicated operator action. |
| `triggerEventId` | string | Matching outbox document used in claim/completion transactions. |
| `siteId` | string | Site copied at enqueue time. |
| `zoneId` | string | Zone copied at enqueue time. |
| `issueType` | string | Incident issue copied at enqueue time. |
| `attemptCount` | number | Incremented when the run is claimed. |
| `workerId` | string? | Worker that claimed or last processed the run. |
| `claimToken` | string? | Random current claim identity checked by private write operations. Not for the LLM prompt or public UI. |
| `leaseExpiresAt` | Timestamp? | Claim expiry used by claim checks and recovery. |
| `currentWorkOrderId` | string? | Work created through the orchestrator command. |
| `lastError` | object? | Latest recorded worker/recovery failure. |
| `lastError.code` | string | Stable worker/recovery error category, such as `lease_expired`. |
| `lastError.message` | string? | Bounded worker explanation or recovery message. |
| `lastError.occurredAt` | Timestamp | When failure was recorded. |
| `result` | object? | Worker-supplied completion/wait result. Currently a generic map, not a fixed assignment-result schema. |
| `completedAt` | Timestamp? | Set for completed runs, cleared on a new claim. |

There is no stored `stage` field distinguishing assignment from review yet.
`waiting` alone does not encode what the worker is waiting for.

### 17.2 `orchestratorOutbox/{eventId}`

Purpose: durable initial alert trigger. Created in the same transaction as a
new confirmed alert and its run. Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Currently deterministic from alert ID, not from multiple event types. |
| `type` | string | Current producer writes only `alert_confirmed`. Rejection/review event types remain proposed. |
| `alertId` | string | Incident that caused the trigger. |
| `runId` | string | Run responsible for handling it. |
| `status` | string | Produced values include `pending`, `claimed`, `completed`, `failed`; schema also recognizes `paused`. |
| `attemptCount` | number | Number of claims reflected on this event. |
| `workerId` | string? | Worker associated with the claim. |
| `claimToken` | string? | Claim identity kept consistent with the run. |
| `leaseExpiresAt` | Timestamp? | Event claim expiry. |
| `lastError` | object? | Failure map with `code`, `message`, and `occurredAt`, as on the run. |
| `completedAt` | Timestamp? | Trigger completion timestamp. |

### 17.3 `orchestratorDecisions/{decisionId}`

Purpose: audit one private tool action. ID hashes run ID and action ID. Shared
field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `runId` | string | Run that owns the action. |
| `alertId` | string | Incident copied from the run. |
| `actionId` | string | Caller action identity used to deduplicate this audit record. |
| `toolName` | string | Tool category such as context lookup, eligible-Cleaner lookup, work creation, evidence request, rework, resolution, or exception. Allowed names do not prove every tool has a wired endpoint. |
| `outcome` | string | `succeeded`, `rejected`, or `failed`. |
| `input` | object | Recorded input facts. Current schema allows a generic map; callers must keep credentials and unrestricted prompts out. |
| `result` | object? | Recorded action result, such as a work-order ID. |
| `rationale` | string? | Bounded explanation supplied by the worker. |
| `idempotencyKey` | string | Business action key, distinct from the audit document's action ID. |
| `fingerprint` | string | Hash of the decision request for conflict detection. |
| `workerId` | string | Worker that recorded the action. |

Dedicated assignment `provider`, `model`, and `policyVersion` columns are not
currently written here. Generic `input`/`result` maps can carry supplied data,
but that is not the same as an established typed model-metadata contract.

## 18. `dashboardSummaries/{siteId}`

The fields below describe the retired V1 summary format. The current dashboard
uses `calculationVersion: "dashboard-v3"`, `counts`, `generatedAt`, and
`staleAfter`, written by the active Phase 11 service. These historical fields
must not be treated as the current dashboard contract.

Purpose: rebuildable snapshot of site counts. Manual reconciliation writes it;
it can become stale after later mutations. The live dashboard response is a
separate calculated DTO. Shared field: `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `version` | string | `site-dashboard-summary-v1`, the summary DTO/data format. |
| `workflowVersion` | string | Alert workflow included in counts. |
| `siteId` | string | Site owning this summary, also the document ID. |
| `activeAlertCounts.new` | number | Current-workflow new incidents at reconciliation. |
| `activeAlertCounts.acknowledged` | number | Acknowledged incidents. |
| `activeAlertCounts.inProgress` | number | Incidents in cleaning work. |
| `activeAlertCounts.awaitingVerification` | number | Incidents awaiting review. |
| `activeAlertCounts.total` | number | Sum of those active categories. |
| `resolvedAlertCount` | number | Current-workflow resolved incidents. |
| `configuredCameraCount` | number | All site cameras, including inactive configuration records. |
| `activeCameraCount` | number | Administratively active cameras. |
| `availableCameraCount` | number | Active cameras whose availability is available. |
| `unavailableCameraCount` | number | Active cameras marked unavailable. |
| `unknownCameraCount` | number | Active cameras without known available/unavailable state. |
| `latestDetectionAt` | Timestamp? | Latest detection capture timestamp found during reconciliation. |
| `latestJobFailureAt` | Timestamp? | Latest failure time derived from error or completion metadata. |
| `reconciledAt` | Timestamp | When the snapshot was rebuilt. |
| `reconciledByUid` | string | Supervisor that requested the rebuild. |

Current writer: [Phase 11 dashboard service](../backend/src/services/phase11Service.ts).

## 19. Analytics storage

This section documents the retired V1 analytics collections. Their writers,
report generator, and scoring policy have been removed. Existing records remain
available for migration or manual historical inspection. Current dashboard,
daily analytics, and bin placement are owned by
[the Phase 11 service](../backend/src/services/phase11Service.ts).

An analytics generation is a rebuild version of the aggregated dataset. It is
not a model version and not an alert confirmation reset counter.

### 19.1 `analyticsSites/{siteHash}`

Purpose: choose the published analytics generation for a site. Shared fields:
`createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Hash derived from site ID. Not the raw site ID. |
| `siteId` | string | Site owning this aggregation state. |
| `currentGenerationId` | string | Generation used by live contribution and report reads. |
| `previousGenerationId` | string?, optional | Prior generation before the last successful rebuild. |
| `aggregationVersion` | string | `hourly-zone-v1`, the aggregation format. |
| `lastReconciledAt` | Timestamp, optional | Latest successful rebuild publication time. |
| `lastReconciledByUid` | string, optional | Supervisor that requested that rebuild. |

### 19.2 `analyticsSites/{siteHash}/generations/{generationId}`

Purpose: metadata for a staged/rebuilt generation. Initial live generations
can exist without one of these reconciliation-generated metadata documents.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `siteId` | string | Owning site. |
| `generationId` | string | Rebuilt dataset identity. |
| `aggregationVersion` | string | Aggregation algorithm/data version. |
| `status` | string | Written as `ready`, then `active`; an earlier published generation can become `superseded`. |
| `source` | string | Currently `reconciliation`. |
| `requestedByUid` | string | Supervisor requesting the rebuild. |
| `includedRunCount` | number | Eligible runs used in the rebuild. |
| `excludedRunCount` | number | Test/ineligible runs excluded. |
| `invalidRunCount` | number | Runs unusable because required data/workflow state is invalid or missing. |
| `includedIncidentCount` | number | Incident contributions applied. |
| `excludedIncidentCount` | number | Incident records not meeting contribution requirements. |
| `bucketCount` | number | Hourly zone buckets built. |
| `builtAt` | Timestamp | When staging data was assembled. |
| `publishedAt` | Timestamp, optional | When the site pointer made this generation active. |
| `supersededAt` | Timestamp, optional | When another generation replaced it. |

### 19.3 `analyticsReconciliationLocks/{siteHash}`

Purpose: prevent conflicting rebuilds and live writes during reconciliation.
The successful rebuild deletes this lock rather than keeping it as history.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `siteId` | string | Site locked for reconciliation. |
| `token` | string | Ownership token checked before publication/release. |
| `status` | string | Current writer uses `building`. |
| `requestedByUid` | string | Requesting Supervisor. |
| `generationId` | string | Generation under construction. |
| `acquiredAt` | Timestamp | Lock acquisition time. |
| `expiresAt` | Timestamp | Lease expiry preventing a failed rebuild from blocking forever. |

### 19.4 `analyticsBuckets/{bucketId}`

Purpose: one generation/site/zone/hour's aggregated operational samples and
incidents. The ID hashes those dimensions. Shared fields: `createdAt`,
`updatedAt`.

| Field | Type/unit | Meaning and workflow use |
| --- | --- | --- |
| `aggregationVersion` | string | Current bucket format/algorithm version. |
| `granularity` | string | `hour`. |
| `generationId` | string | Dataset generation containing the bucket. |
| `bucketStart` | Timestamp | Start of the UTC hourly bucket. Local report-day coverage is calculated separately. |
| `bucketEnd` | Timestamp | End of the hour. |
| `siteId` | string | Site reporting scope. |
| `zoneId` | string | Zone being ranked. |
| `analyticsEligible` | boolean | True on generated operational buckets; scorer also checks it defensively. |
| `isTest` | boolean | False on generated operational buckets. |
| `sampleCount` | number | Successful plus failed sample counts represented in the bucket. |
| `successfulSampleCount` | number | Successfully applied analysis samples. |
| `failedSampleCount` | number | Failure-count slot. Current normal aggregation does not comprehensively ingest inference failures that create no run. A zero value is not proof no processing failed. |
| `cameraIds` | string[] | Unique contributing camera IDs. |
| `peopleCountSum` | number | Sum of per-sample people counts, used to calculate average pressure. Not unique visitors. |
| `peopleCountMax` | number | Largest people count in a sample. |
| `peoplePresentSamples` | number | Samples containing people. |
| `litterPositiveSamples` | number | Positive operational litter observations. |
| `litterDetectionCount` | number | Eligible litter detections contributed by observations. |
| `litterIncidentCount` | number | Confirmed litter incidents applied once per incident marker, not once per frame. |
| `overflowPositiveSamples` | number | Positive overflow observations. |
| `overflowDetectionCount` | number | Eligible overflow detections contributed by observations. |
| `overflowIncidentCount` | number | Confirmed overflow incidents applied once. |
| `spillPositiveSamples` | number | Positive spill observations. |
| `spillDetectionCount` | number | Eligible spill detections contributed by observations. |
| `optionalSpillIncidentCount` | number | Persisted spill-incident count. The in-memory accumulator is named `spillIncidentCount`; the stored name is different. |
| `issuePersistenceSeconds` | number, seconds | Estimated duration across consecutive positive samples, capped by the policy horizon. Not continuously observed wall-clock dirtiness. |
| `issuePersistenceSecondsByType.floor_litter` | number, seconds | Litter portion of estimated persistence. |
| `issuePersistenceSecondsByType.floor_spill` | number, seconds | Spill portion. |
| `issuePersistenceSecondsByType.bin_overflow` | number, seconds | Overflow portion. |
| `persistenceMethod` | string | Versioned label identifying the persistence approximation. |
| `modelVersions` | string[] | Unique contributing model labels. |
| `modelVersionSampleCounts[].version` | string | Model label counted in this bucket. |
| `modelVersionSampleCounts[].sampleCount` | number | Number of contributed samples mentioning that label. |

### 19.5 `analyticsSampleApplications/{markerId}`

Purpose: prevent applying one run twice within the same generation. ID hashes
generation and analysis run.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `aggregationVersion` | string | Contribution format/version. |
| `generationId` | string | Generation in which the decision was made. |
| `analysisRunId` | string | Run already considered. |
| `siteId` | string | Site scope. |
| `zoneId` | string? | Zone scope; can be null on excluded malformed/ineligible context. |
| `cameraId` | string? | Source scope. |
| `bucketId` | string, optional | Bucket receiving an applied contribution. |
| `status` | string | `applied` or `excluded`; existence also prevents repeated consideration. |
| `exclusionReason` | string, optional | For example `test_data` or `not_analytics_eligible`. |
| `persistenceOutOfOrderIssueTypes` | string[], optional | Issues whose persistence state was not advanced by an older sample. |
| `source` | string, optional | `reconciliation` on rebuild-generated markers. |
| `appliedAt` | Timestamp | When the contribution/exclusion was recorded. |

### 19.6 `analyticsIncidentApplications/{markerId}`

Purpose: count a confirmed incident once per generation using its first
supporting observation. Separate from sample markers because the confirming
frame can arrive after the first supporting sample.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `aggregationVersion` | string | Incident contribution version. |
| `generationId` | string | Target dataset generation. |
| `alertId` | string | Incident being counted. |
| `firstObservationId` | string | First supporting observation used for attribution. |
| `analysisRunId` | string | Run containing that observation. |
| `siteId` | string | Site scope. |
| `zoneId` | string? | Zone receiving the incident. |
| `issueType` | string? | Litter, overflow, or spill counter to increment. |
| `bucketId` | string, optional | Hourly bucket receiving the incident. |
| `status` | string | `applied` or `excluded`. |
| `exclusionReason` | string, optional | For example `test_or_ineligible` or `unsupported_issue_type`. |
| `source` | string, optional | `reconciliation` for rebuilt markers. |
| `appliedAt` | Timestamp | Contribution/exclusion time. |

### 19.7 `analyticsPersistenceStates/{stateId}`

Purpose: remember the previous sample for one generation/site/zone/camera/issue
series. Shared fields: `createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `aggregationVersion` | string | Contribution format/version. |
| `persistenceMethod` | string | Approximation algorithm label. |
| `generationId` | string | Dataset this series belongs to. |
| `siteId` | string | Site scope. |
| `zoneId` | string | Zone scope. |
| `cameraId` | string | Source series; samples from unrelated cameras are not treated as one continuous observation. |
| `issueType` | string | Independently tracked issue. |
| `lastAnalysisRunId` | string | Previous accepted run. |
| `lastCapturedAt` | Timestamp | Previous sample capture time, used to calculate a gap. |
| `lastPositive` | boolean | Whether the previous sample was positive, needed to count consecutive-positive persistence. |

### 19.8 `analyticsReports/{reportId}`

Purpose: saved, explainable priority-zone report for a site/time range. The
report records the generation and scoring policy it used.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| Document ID | string | Random UUID identifying this report snapshot. |
| `siteId` | string | Site being compared. |
| `zoneIds` | string[] | Selected zones, also the expected `zoneResults` children. |
| `periodStart` | Timestamp | Inclusive reporting-range start. |
| `periodEnd` | Timestamp | Exclusive range end. Buckets are selected by their start timestamps; this is not arbitrary within-hour resampling. |
| `status` | string | `pending`, `completed`, `insufficient_data`, or `failed`. |
| `policyVersion` | string | Scoring policy label. |
| `aggregationVersion` | string | Bucket version used. |
| `generationId` | string | Published dataset generation read for the report. |
| `generatedByUid` | string | Requesting Supervisor. |
| `generatedAt` | Timestamp | Report creation/start time, used for report history ordering. |
| `completedAt` | Timestamp? | Report success/failure completion time. |
| `error` | object? | Null unless report generation fails. |
| `error.message` | string | Stored report-generation failure description. |
| `siteNameSnapshot` | string, optional until completion | Site display name used by the report. |
| `siteTimeZoneSnapshot` | string, optional until completion | IANA timezone used for local-day coverage. |
| `policy` | object, optional until completion | Full scoring-policy snapshot, described below. |
| `selection` | object, optional until completion | Counts of included/excluded input buckets. |
| `sufficientZoneCount` | number, optional | Zones meeting the coverage gate. |
| `insufficientZoneCount` | number, optional | Zones failing the gate. |
| `highPriorityZoneCount` | number, optional | Sufficient zones in the high band. |
| `mediumPriorityZoneCount` | number, optional | Sufficient zones in the medium band. |
| `lowPriorityZoneCount` | number, optional | Sufficient zones in the low band. |
| `bucketQueryMode` | string, optional | `indexed` or `fallback_bounded_scan`; query diagnostic, not model confidence. |

### 19.9 Report `policy` snapshot

| Field path | Type | Meaning and workflow use |
| --- | --- | --- |
| `policy.version` | string | `priority-zone-v1-provisional`. |
| `policy.provisional` | boolean | True; warns that scoring has not been finalized through field calibration. |
| `policy.granularity` | string | `hour`, matching bucket granularity. |
| `policy.normalization` | string | `within_site_max_relative_over_sufficient_zones`; factors are compared against sufficient zones in this report, not a universal site-independent scale. |
| `policy.factorDefinitions.litterBurden` | string | `litter_incident_count`, explaining what the factor measures. |
| `policy.factorDefinitions.visitorPressure` | string | `average_people_per_successful_sample`. |
| `policy.factorDefinitions.overflowBurden` | string | `overflow_incident_count`. |
| `policy.factorDefinitions.issuePersistence` | string | `issue_persistence_hours`. |
| `policy.weights.litterBurden` | number | Current weight 0.35. |
| `policy.weights.visitorPressure` | number | Current weight 0.30. |
| `policy.weights.overflowBurden` | number | Current weight 0.25. |
| `policy.weights.issuePersistence` | number | Current weight 0.10. |
| `policy.bands.highMinimum` | number | Current high-band score floor, 70. |
| `policy.bands.mediumMinimum` | number | Current medium-band floor, 40; sufficient lower scores are low. |
| `policy.sufficiency.minimumSuccessfulHourlyBuckets` | number | Current minimum 8 successful hourly buckets. Not eight frames in one hour. |
| `policy.sufficiency.minimumLocalCalendarDays` | number | Current minimum 2 local dates containing successful buckets. |
| `policy.sufficiency.minimumSampleSuccessRatio` | number | Current minimum ratio 0.8, subject to the failure-ingestion limitation noted above. |

### 19.10 Report `selection` fields

| Field path | Type | Meaning and workflow use |
| --- | --- | --- |
| `selection.inputBucketCount` | number | Bucket records passed into the scorer. |
| `selection.includedOperationalBucketCount` | number | Valid operational buckets included in the scoring input. |
| `selection.excludedBucketCounts.test` | number | Excluded test buckets. |
| `selection.excludedBucketCounts.notAnalyticsEligible` | number | Buckets without analytics eligibility. |
| `selection.excludedBucketCounts.otherSite` | number | Buckets belonging to another site. |
| `selection.excludedBucketCounts.unknownZone` | number | Buckets whose zone is not selected/configured for this report. |
| `selection.excludedBucketCounts.outsidePeriod` | number | Buckets outside the requested reporting period. |

### 19.11 `analyticsReports/{reportId}/zoneResults/{zoneId}`

Purpose: a zone's rank, factor explanation, and coverage within one report.
Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `zoneId` | string | Ranked zone, also the document ID. |
| `zoneName` | string | Display name produced by the scorer. |
| `zoneNameSnapshot` | string | Duplicate name retained by the persistence layer for historical display. |
| `siteId` | string | Report site. |
| `reportId` | string | Parent report ID. |
| `rank` | number? | One-based order among sufficient zones. Null means insufficient data, not last place. |
| `priorityBand` | string | `high`, `medium`, `low`, or `insufficient_data`. |
| `totalScore` | number? | Sum of weighted factor contributions, null when coverage is insufficient. |
| `factors` | object | Four named factor results described below. |
| `evidence` | object | Raw supporting measures for the report. |
| `coverage` | object | Data-sufficiency measurements. |
| `reasons` | string[] | Human-readable scoring or insufficiency explanation used in UI/CSV. |

The following four field prefixes each have the same four child fields:
`factors.litterBurden`, `factors.visitorPressure`, `factors.overflowBurden`,
`factors.issuePersistence`.

| Child field | Type | Meaning and workflow use |
| --- | --- | --- |
| `.raw` | number | Incident count, people average, overflow count, or persistence hours depending on factor. |
| `.normalized` | number? | 0–100 value relative to this report's maximum among sufficient zones. |
| `.weight` | number | Factor weight copied from the report policy. |
| `.weightedContribution` | number? | Normalized value multiplied by weight. Null when insufficient. |

| Evidence/coverage field | Type | Meaning and workflow use |
| --- | --- | --- |
| `evidence.litterIncidents` | number | Deduplicated litter incidents in the selected buckets. |
| `evidence.overflowIncidents` | number | Deduplicated overflow incidents. |
| `evidence.averagePeoplePerSuccessfulSample` | number | People-count sum divided by successful samples, not unique visitors. |
| `evidence.peakPeople` | number | Highest recorded per-sample people count. |
| `evidence.issuePersistenceSeconds` | number | Combined estimated persistence in seconds. |
| `coverage.eligibleHourlyBucketCount` | number | Included operational hourly buckets for the zone. |
| `coverage.successfulHourlyBucketCount` | number | Buckets with at least one successful sample. |
| `coverage.localCalendarDayCount` | number | Distinct local dates represented by successful buckets. |
| `coverage.successfulSampleCount` | number | Applied successful samples in the report. |
| `coverage.failedSampleCount` | number | Failures represented in selected buckets. |
| `coverage.sampleSuccessRatio` | number | Successful divided by successful plus failed samples under the scorer's empty-data handling. |
| `coverage.sufficient` | boolean | Whether all report coverage gates pass. |
| `coverage.insufficiencyReasons` | string[] | Machine-readable reasons such as too few hours, too few days, or low success ratio. |

## 20. Operational system events

Sources: [system-event persistence](../backend/src/services/systemEventService.ts),
[lifecycle rules](../backend/src/services/systemEventState.ts), and
[safe-detail schema](../backend/src/schemas/systemEvent.ts).

A system event means something such as an unavailable inference service. An
alert means a dirty physical area. They must not be counted as the same kind
of incident.

### 20.1 `systemEvents/{eventKey}`

Purpose: deduplicate dependency failures while retaining recovery/reopening
history. The key hashes dependency, event code, and scope. Shared fields:
`createdAt`, `updatedAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `eventKey` | string | Stored copy of the deterministic document ID, validated during presentation. |
| `dependency` | string | `ai_service`, `video_processing`, or `analytics_rebuild`. |
| `eventCode` | string | Stable lower-snake-case failure category, such as an inference-request failure. |
| `scopeType` | string | `global`, `site`, or `job`. |
| `scopeId` | string? | Site/job ID; null for global events. |
| `status` | string | `open` or `resolved`. |
| `severity` | string | Lifecycle severity, `warning` or `critical`, maintained by event rules. |
| `maximumSeverity` | string | Maximum severity retained by the lifecycle logic, used by severity filters. |
| `generation` | number | Failure/reopening generation. Prevents an old recovery from resolving a later failure episode. |
| `occurrenceCount` | number | Occurrences counted in the current failure generation. |
| `lifetimeOccurrenceCount` | number | Total counted occurrences across generations. |
| `resolutionCount` | number | Number of accepted resolutions. |
| `reopenCount` | number | Number of later failure episodes reopening this event. |
| `firstSeenAt` | Timestamp | Start of the current failure generation. |
| `lastSeenAt` | Timestamp | Latest counted failure time. |
| `firstEverSeenAt` | Timestamp | First occurrence across the event's lifetime. |
| `resolvedAt` | Timestamp? | Resolution time for the current state; null while open. |
| `lastResolvedAt` | Timestamp? | Last historical resolution, retained across reopening. |
| `reopenedAt` | Timestamp? | When a later failure reopened the event. |
| `latestSafeDetails` | object | Allowlisted current failure context, defined below. |
| `latestRecoverySafeDetails` | object? | Allowlisted context of recovery, same child schema. |

### 20.2 Allowed children of both safe-detail maps

All children are optional. The fields below describe exactly which values are
allowed; arbitrary keys, stacks, tokens, headers, and raw URLs are not accepted.

| Child field | Type | Meaning and workflow use |
| --- | --- | --- |
| `operation` | string | Stable operation code, such as `analyze_frame`. |
| `reasonCode` | string | Stable diagnostic category without raw error payloads. |
| `retryable` | boolean | Whether the producer considers retry appropriate. |
| `httpStatus` | number | Upstream HTTP response code where relevant. |
| `siteId` | string | Related site. |
| `zoneId` | string | Related zone. |
| `cameraId` | string | Related source. |
| `jobId` | string | Related processing job. |
| `mediaId` | string | Related media metadata. |
| `analysisRunId` | string | Related analysis result. |
| `analyticsBucketId` | string | Related analytics bucket. |
| `frameIndex` | number | Related video sample. |
| `videoOffsetSeconds` | number | Related source-video time offset. |
| `attemptCount` | number | Attempt count reported by the producer. |
| `succeededItemCount` | number | Successful items in the reported operation. |
| `failedItemCount` | number | Failed items in the reported operation. |
| `durationMs` | number | Operation duration in milliseconds. |
| `periodStart` | ISO string | Optional reporting/processing range start. Unlike main Firestore timestamp fields, these schema-validated strings remain strings in the details map. |
| `periodEnd` | ISO string | Optional range end; validated to follow the start when both are present. |

### 20.3 `systemEvents/{eventKey}/occurrences/{occurrenceKey}`

Purpose: idempotency marker for one failure occurrence. ID hashes parent key
and caller occurrence identity. Shared field: `createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `eventKey` | string | Parent operational event. |
| `action` | string | `opened`, `occurrence_recorded`, `reopened`, or `stale_occurrence`. Explains how this input affected the event. |
| `appliedGeneration` | number | Failure generation associated with the input. |
| `occurredAt` | Timestamp | Producer's failure occurrence time. |

### 20.4 `systemEvents/{eventKey}/recoveries/{recoveryKey}`

Purpose: idempotency marker for one attempted recovery. Shared field:
`createdAt`.

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `eventKey` | string | Parent event. |
| `action` | string | `resolved`, `already_resolved`, `stale_generation`, or `stale_recovery`. A missing event returns an error rather than storing a successful marker. |
| `appliedGeneration` | number | Event generation observed during recovery handling. |
| `expectedGeneration` | number | Generation the caller intended to resolve; detects stale recovery. |
| `recoveredAt` | Timestamp | Producer's recovery time. |

## 21. Fields visible in APIs but not database columns

These values must not accidentally become new stored fields just because the
frontend or the LLM sees them.

| Response field | Origin and use |
| --- | --- |
| `id` | Usually the Firestore document ID added by serialization. Explicit stored IDs such as `eventKey` are documented separately. |
| `contentUrl` | Computed protected media route, not a stored absolute path. |
| `evidenceContentUrl` | Computed from an evidence media ID on run/detection/occurrence DTOs. |
| `firstEvidenceContentUrl`, `latestEvidenceContentUrl` | Computed alert evidence links. |
| `detailUrl` | Computed detection-detail API link. |
| `siteName`, `zoneName`, `cameraName`, `cameraCode` | Often renamed from snapshot fields in location/media DTOs. Runs and detections do store fields with these names, as documented in their tables. |
| `assignedZoneName`, `assignedCleanerName`, `assignedCleanerStaffCode` | Cleaner/work display aliases of stored snapshot fields. |
| `locationStatus`, `freshnessSeconds` | Presence freshness calculated on read, not persisted as authoritative phone state. |
| `eligible`, `ineligibilityReasons` | Orchestrator candidate evaluation calculated from account, permissions, capabilities, heartbeat, availability, and current work. |
| `fullName`, `staffCode`, `capabilities`, `permittedSiteIds`, `permittedZoneIds`, `activeWorkOrderId` in a candidate DTO | Projections of existing Cleaner/presence fields, not a separate candidate-history collection. |
| `idempotent`, `alreadyCompleted`, `alreadyAssigned` | Result of a request/replay path. `alreadyAssigned` belongs to the isolated assignment simulation, not our work-order document. |
| `nextCursor`, `historyNextCursor`, `occurrencesNextCursor` | Pagination continuation values calculated from the last returned document and query context. |
| `paginationMode`, `resultCompleteness`, `scannedCount` | Pagination/fallback diagnostics, not business record properties. |
| `page.limit`, `page.hasMore`, `page.nextCursor` | System-event list envelope metadata. |
| `requestId` | HTTP tracing value, also logged. Not a field automatically written onto every business record. |
| `supervisor`, `cleaner`, `role` in `/api/me` | Authenticated session DTOs. Actual role dispatch is stored in `userAccounts`. |
| `setupLink` | Sensitive password-setup URL returned by provisioning. Never persist it in business documents. |
| Dashboard `cameras`, `activeAlerts`, `recentDetections`, `recentFailedJobs`, `completeness`, `sourceQueryMode`, `generatedAt` | Assembled live dashboard response. Do not confuse it with persisted `dashboardSummaries`. |
| Analytics list `queryMode` | List-query diagnostic. Report `bucketQueryMode`, in contrast, is persisted. |
| System-event `title`, `scope` | Generated display title and structured scope DTO derived from `dependency`, `eventCode`, `scopeType`, and `scopeId`. |

Pagination cursors encode query scope, ordered timestamp, and document ID. They
are not Auth tokens and should be passed unchanged only with the same filters.

## 22. Configuration, files, and proposed structures

### 22.1 Built but not stored in Firestore

| Structure | Where it lives and how it is used |
| --- | --- |
| Alert policy | `backend/src/services/alertPolicy.ts`; source-code rules for current Alert qualification, priority, and status progression. |
| Model weights/version configuration | FastAPI configuration and local model files. Firestore stores version labels and results, not model binaries. |
| FastAPI inference DTO | Transient response with image, people, bins, hazards, model versions, timing. Node normalizes/persists selected fields. No Python application database write. |
| Local media files | Filesystem under `MEDIA_STORAGE_ROOT`, linked by generated storage keys. Not automatically synchronized between team laptops. |
| Index/rule definitions | `firestore.indexes.json` and `firestore.rules`. Indexes are query infrastructure, not collections. |

### 22.2 Not implemented in the main application database

| Proposed/simulated structure | Current boundary |
| --- | --- |
| Cleaner `workSchedule` | Proposed for assignment integration; not a main-backend stored schedule yet. |
| `zoneDistances` | Exists in the friend's JSON simulation, not as a connected Firestore collection. |
| `assignmentRuns` | Proposed in the assignment prototype README; current backend already uses `orchestratorRuns` and `orchestratorOutbox`. |
| Stored workload counters | Not implemented. Candidate workload from the simulation is not a current Firestore field. |
| `assignmentSource`, `assignmentProvider`, `assignmentModel`, `assignmentReason` | Proposed work-order additions in the friend's README, not current fixed fields written by Node. |
| Extra outbox event types and run business `stage` | Discussed for rejection/review handling; current producer remains `alert_confirmed` and run has processing `status`. |
| LangGraph/PostgreSQL checkpoints, RAG, conversation memory | Not the existing Firestore records. No running integration is implied by `threadKey`. |
| Permanent physical bins/visitor identities | No current `bins` or `people` business collections; these are per-frame embedded observations. |
| Camera-stream data | Configuration placeholders exist, but the operational processing sources are currently uploads. |

`task-assignment-llm/database/assignment_simulation.json` is an isolated mock
with `metadata`, `zones`, `zoneDistances`, `cleaners`, `alerts`, and `tasks`.
Its uppercase states, schedules, availability/workload calculations, and
registered-zone fields are not the main Firestore contract.

## 23. Historical V1 lookup example

The following relationship describes persisted V1 processing history. The
current monitoring workflow does not create these processing-job records.

1. Find the camera in `cameras`. Its `zoneId` identifies Food Court and `siteId`
   identifies the attraction.
2. `mediaAssets` holds the original video metadata. `processingJobs.sourceMediaId`
   points to it.
3. Each sampled frame has a media asset and an `analysisRuns` record linked by
   `jobId`. People/bin observations live inside that run.
4. `detections.analysisRunId` finds the raw issue detections for the frame.
5. `issueObservations` explains how those detections became positive, negative,
   or excluded. `flags` identifies positive operational groups.
6. `alertConfirmationStates` supplies the recent sequence. On confirmation,
   `alerts` records the incident, `activeAlertKeys` reserves it, and alert
   `occurrences` preserves the supporting groups.
7. `orchestratorRuns` and `orchestratorOutbox` record the automation trigger.
   Private tool actions can be audited in `orchestratorDecisions`.
8. A work-order command creates `workOrders`, an active-work key, a decision
   marker, an assignment attempt, history, and a durable notification. Cleaner
   presence points to the active work.
9. Cleaner submission creates a `reviewRequests` child and changes alert/work
   status. A supplied review result creates `reviews` and drives clean/rework
   transitions. Automatic model execution is a separate integration task.
10. Operational samples/incidents contribute once to analytics through separate
    application markers. Reports read the active generation and preserve their
    policy, factors, and coverage explanation.

## 24. Maintenance and safety notes

- A dictionary entry explains a field; it is not permission to manually edit
  Firestore. Use Node workflows so related keys, histories, and status changes
  stay consistent.
- Never confuse personnel `status`, login `accountStatus`, presence
  `availability`, work-order `status`, alert `status`, and run `status`.
- A detected object is not a positive group; a positive group is not necessarily
  a confirmed incident; a completed work order is not evidence that a model
  verified the scene.
- File hashes and request fingerprints have different purposes. Neither is an
  access credential. Claim tokens and push tokens are sensitive and have
  different purposes again.
- Avoid writing fake records directly into the shared cloud database to test
  these relationships. Use emulator acceptance tests or the documented APIs.
- Field descriptions describe the current implementation, including gaps.
  Generic `visionResults`, empty evidence arrays, initialized map fields, and
  stored status labels do not prove all associated validation or automation
  exists.
- When a writer adds/removes a stored field, update this dictionary, the public
  API contract if exposed, tests, and any required indexes together.

## 25. Source checklist

This dictionary was checked against the production writers/readers in:

- [Firebase setup](../backend/src/config/firebase.ts)
- [Auth dispatch](../backend/src/middleware/authenticateUser.ts)
- [Supervisor bootstrap](../backend/src/scripts/bootstrapSupervisor.ts)
- [Cleaner management](../backend/src/services/cleanerService.ts)
- [Identity operations](../backend/src/services/identityService.ts)
- [Location hierarchy](../backend/src/services/locationService.ts)
- [Media delivery](../backend/src/services/mediaService.ts)
- [Camera source and reference uploads](../backend/src/services/cameraDraftService.ts)
- [Alert workflow](../backend/src/services/alertService.ts)
- [Cleaner availability](../backend/src/services/cleanerAvailability.ts)
- [Work orders](../backend/src/services/workOrderService.ts)
- [Operational verification](../backend/src/services/workOrderService.ts)
- [Notifications](../backend/src/services/notificationService.ts)
- [Orchestrator](../backend/src/services/orchestratorService.ts)
- [Current dashboard](../backend/src/services/phase11Service.ts)
- [System events](../backend/src/services/systemEventService.ts)
- [Media retention](../backend/src/services/mediaRetentionService.ts)
