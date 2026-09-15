# Media, analytics and derived views

## `mediaAssets/{mediaId}`

Firestore stores metadata; bytes stay in the configured local media root for the prototype.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `mediaId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `purpose` | enum | yes | `site_map_background`, `camera_source_video`, `camera_reference`, `alert_evidence`, `work_creation_evidence`, `work_completion_evidence`, `replay_upload`, or `replay_frame`. |
| `ownerType` | enum | yes | `site`, `camera`, `camera_draft`, `alert`, `work_order`, or `processing_job`. |
| `ownerId` | string | yes | Aggregate responsible for retention. |
| `cameraId` | string or null | yes | Camera context when applicable. |
| `mimeType` | string | yes | Validated content type. |
| `originalFileName` | string | yes | Sanitized display filename. |
| `byteSize` | integer | yes | Validated size. |
| `sha256` | string | yes | Content integrity and deduplication aid. |
| `storageKey` | string | yes | Relative opaque key under the configured media root. Never an absolute path. |
| `storageStatus` | enum | yes | `pending`, `available`, `missing`, or `deleted`. |
| `width` / `height` | integer or null | yes | Image dimensions. |
| `durationSeconds` | number or null | yes | Video duration. |
| `capturedAt` | timestamp or null | yes | Source capture time for evidence/reference frames. |
| `retentionClass` | enum | yes | `operational`, `configuration`, `temporary`, or `test`. |
| `expiresAt` | timestamp or null | yes | Cleanup target for temporary/test data. Null for retained operational/configuration media. |
| `createdAt` | timestamp | yes | Metadata creation time. |
| `createdByUid` | string or null | yes | Uploading actor or system. |
| `deletedAt` | timestamp or null | yes | Tombstone time after byte deletion. |
| `revision` | integer | yes | State counter. |

Allowed uploads use signature validation, not filename extension alone. Metadata creation and byte storage use recoverable pending/available states because Firestore and local files cannot share one transaction.

## Replay collections

`processingJobs`, `analysisRuns`, `detections`, and `processingJobs/{jobId}/frameFailures` keep their current role for isolated image/video tests. The production model adds tenant, schema, registration, model and simulation metadata consistently.

They are not the live monitoring data model. Operational live frames do not become Processing Jobs.

### `processingJobs/{jobId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `jobId` | string | yes | Deterministic/idempotent document ID. |
| `siteId` / `cameraId` | string | yes | Operational context. |
| `mapRevisionId` / `zoneId` | string | yes | Location snapshot. |
| `registrationRevisionId` | string | yes | Registration used for processing. |
| `type` | enum | yes | `image` or `video`. |
| `sourceMediaId` | string | yes | Original uploaded media. |
| `status` | enum | yes | `queued`, `processing`, `completed`, or `failed`. |
| `workflowMode` | enum | yes | `trace_only` or `operational_replay`. Operational replay may exercise production Flag/Alert logic. |
| `isTest` | boolean | yes | True excludes operational workflow and analytics regardless of mode. |
| `isSimulation` | boolean | yes | Inherited Camera traceability. |
| `analyticsEligible` | boolean | yes | Explicit operational analytics gate. |
| `requestedByUid` | string | yes | Authenticated Supervisor. |
| `clientRequestId` | string | yes | Caller idempotency. |
| `options` | map | yes | Frame interval, confidence settings and bounded processing options. |
| `progress` | map | yes | Planned, processed, successful and failed frame counts plus last index. |
| `summary` | map | yes | Run, detection, Flag and Alert counts and IDs. |
| `attemptCount` | integer | yes | Processing retries. |
| `error` | safe error or null | yes | Terminal failure summary. |
| `requestedAt` / `startedAt` / `completedAt` | timestamp or null | yes | Lifecycle timing. |
| `createdAt` / `updatedAt` | timestamp | yes | Persistence timing. |
| `revision` | integer | yes | State counter. |

### `processingJobs/{jobId}/frameFailures/{frameIndex}`

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` / `jobId` | string | Tenant and parent. |
| `frameIndex` | integer | Failed frame and document ID. |
| `videoOffsetSeconds` | number | Source time. |
| `error` | safe error | Redacted failure. |
| `failedAt` | timestamp | Failure time. |

### `analysisRuns/{runId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `runId` / `jobId` | string | yes | Trace IDs. |
| `siteId` / `zoneId` / `cameraId` | string | yes | Location context. |
| `mapRevisionId` / `registrationRevisionId` | string | yes | Geometry provenance. |
| `sourceMediaId` / `frameMediaId` | string or null | yes | Source and extracted frame references. |
| `sourceType` | enum | yes | `image_upload` or `video_upload`. |
| `frameIndex` | integer or null | yes | Video frame identity. |
| `videoOffsetSeconds` | number or null | yes | Video source time. |
| `capturedAt` | timestamp | yes | Logical frame time. |
| `image` | map | yes | Width and height. |
| `peopleCount` | integer | yes | Analytics signal. |
| `people` | array | yes | Bounded normalized person detections when retained for trace. |
| `bins` | array | yes | Registered-bin states and evidence signals. |
| `issueCounts` | map | yes | Litter, spill, full and overflow counts. |
| `modelVersions` | map | yes | Model provenance. |
| `processingTimeMs` | number | yes | End-to-end inference time. |
| `workflowMode` / `isTest` / `isSimulation` | enum/boolean | yes | Operational gates and traceability. |
| `analyticsEligible` | boolean | yes | Whether aggregation may use the run. |
| `createdAt` | timestamp | yes | Persistence time. |

### `detections/{detectionId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `detectionId` / `analysisRunId` / `jobId` | string | yes | Trace IDs. |
| `siteId` / `zoneId` / `cameraId` | string | yes | Location context. |
| `mapRevisionId` / `registrationRevisionId` | string | yes | Geometry provenance. |
| `sourceMediaId` / `evidenceMediaId` | string or null | yes | Media references. |
| `issueType` | enum | yes | Floor litter, floor spill, bin full/overflow trace, or person. |
| `confidence` | number 0..1 | yes | Model confidence. |
| `bboxNormalized` | map or null | yes | Box coordinates. |
| `polygonNormalized` | point array or null | yes | Segmentation geometry. |
| `entityId` | string | yes | Frame-local detection or stable registered `binId`. |
| `modelKey` / `modelVersion` | string | yes | Model provenance. |
| `binSignals` | map or null | yes | Fullness/overflow/occlusion inputs where applicable. |
| `binState` | enum or null | yes | `normal`, `full`, `overflow`, `review`, or `unknown`. |
| `capturedAt` / `createdAt` | timestamp | yes | Source and persistence times. |
| `workflowMode` / `isTest` / `isSimulation` | enum/boolean | yes | Operational gates. |
| `flagId` | string or null | yes | Flag created by operational replay. |

An `operational_replay` uses the same qualification service as live sampling but remains visibly traceable by job/run IDs. It is a testing input path, not a second monitoring architecture.

Retention defaults:

- test replay media and documents: 30 days;
- operational manually uploaded replay jobs: 90 days unless explicitly retained;
- Camera Registration references, simulation source videos, Alert Evidence, Completion Evidence and Work creation evidence: retained for the prototype lifetime;
- normal extracted frames not chosen as evidence: delete after the job finishes or its short recovery window ends.

## `analyticsMinuteBuckets/{bucketId}`

One document represents one UTC minute for one Site and holds per-Zone numeric aggregates. It replaces one-document-per-two-second-sample storage.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `bucketId` | string | yes | Deterministic hash of Site and UTC minute. |
| `siteId` | string | yes | Tenant. |
| `bucketStart` | timestamp | yes | Inclusive UTC minute. |
| `bucketEnd` | timestamp | yes | Exclusive UTC minute. |
| `siteLocalDate` | string | yes | `YYYY-MM-DD` under Site timezone. |
| `timeZoneSnapshot` | string | yes | Timezone used for local date. |
| `mapRevisionIds` | string array | yes | Revisions represented if publication occurred mid-minute. |
| `zoneMetrics` | map | yes | Zone ID to aggregate object. Indexing disabled. |
| `siteTotals` | map | yes | Sum/maximum fields for Site-level Dashboard use. |
| `aggregationVersion` | string | yes | Minute accumulator contract. |
| `finalizedAt` | timestamp | yes | Flush completion. |
| `lastReconciledAt` | timestamp or null | yes | Optional rebuild time. |
| `expiresAt` | timestamp | yes | `bucketEnd + 90 days`. Firestore TTL or cleanup job target. |

### Minute Zone metrics

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `zoneNameSnapshot` | string | Historical label. |
| `eligibleCameraCount` | integer | Active, monitoring-enabled Cameras expected in the Zone. |
| `sampleAttemptCount` | integer | Frames accepted for processing. |
| `successfulSampleCount` | integer | Successful inference samples. |
| `failedSampleCount` | integer | Failed/invalid samples. |
| `peopleObservationCount` | integer | Successful people-count observations. |
| `peopleSum` | integer | Sum used for averages. |
| `peopleMax` | integer | Peak count. |
| `qualifyingLitterCount` | integer | Qualifying live issue groups in the minute. |
| `qualifyingSpillCount` | integer | Qualifying spill groups. |
| `qualifyingBinFullCount` | integer | Full groups when enabled. |
| `qualifyingBinOverflowCount` | integer | Overflow groups. |
| `inferenceLatencyMsSum` | number | Performance aggregate. |
| `inferenceLatencySampleCount` | integer | Denominator. |
| `offlineCameraSeconds` | number | Approximate source downtime in the minute. |
| `simulationSampleCount` | integer | Internal traceability; included in prototype calculations. |

Node writes the bucket with deterministic merge operations. Late samples can reconcile only inside a bounded lateness window. Daily aggregation reads final minute buckets plus operational events.

The implemented `minute-v3` path adds an unindexed `contributions` map. Stable Camera/Episode contribution IDs allow retry replacement and merging of late contributions. Live lateness is limited to two minutes. Coverage contributions estimate offline seconds at minute granularity, not as precise connection histories.

## `analyticsDailySummaries/{summaryId}`

One compact Site-wide document per Site-local calendar date survives after minute buckets expire.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `summaryId` | string | yes | Deterministic hash of Site and local date. |
| `siteId` | string | yes | Tenant. |
| `localDate` | string | yes | Site-local `YYYY-MM-DD`. |
| `timeZoneSnapshot` | string | yes | Calendar interpretation. |
| `periodStart` / `periodEnd` | timestamp | yes | UTC boundaries of that local day. |
| `zoneMetrics` | map | yes | Per-Zone daily aggregates. Indexing disabled. |
| `siteTotals` | map | yes | Site-level totals. |
| `coverage` | map | yes | Minute/sample coverage and partial-data warnings. |
| `aggregationVersion` | string | yes | Daily summary contract. |
| `status` | enum | yes | `provisional` or `final`. Current local day remains provisional. |
| `generatedAt` | timestamp | yes | Latest build. |
| `lastReconciledAt` | timestamp | yes | Latest source reconciliation. |

### Daily Zone metrics

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `zoneNameSnapshot` | string | Historical label. |
| `successfulSampleCount` / `failedSampleCount` | integer | Coverage. |
| `peopleObservationCount` / `peopleSum` / `peopleMax` | integer | Visitor activity. |
| `litterAlertCount` | integer | New floor-litter Alerts. |
| `spillAlertCount` | integer | New floor-spill Alerts. |
| `binServiceAlertCount` | integer | New bin-service Alerts. |
| `overflowEscalationCount` | integer | Existing bin-service Alerts escalated to overflow. |
| `resolvedWorkCount` | integer | Work Orders resolved that day. Used as cleaning frequency. |
| `dismissedWorkCount` | integer | Operational context, excluded from cleaning success. |
| `workDurationSecondsSum` / `workDurationCount` | integer | Mean handling time. |
| `activeWorkPeak` | integer | Peak simultaneous active Work. |
| `simulationSampleCount` / `simulationAlertCount` | integer | Internal traceability, included in prototype totals. |

Operational Alert/Work events remain the rebuild source of truth. Event documents store `analyticsAppliedVersion` and `analyticsAppliedAt` so a transaction can apply each event to a daily summary once. Rebuild tooling can discard/recreate summaries by date from retained histories.

The implemented `daily-v3` path instead replaces snapshots from retained event timestamps, without depending on incremental event-marker fields. It adds `sourceSignature` for stale detection, `zoneMinuteMetrics` for retained sampling totals, and `minuteDataRetired` to preserve them after expiry. Expired source data must not overwrite previously preserved minute totals with zero.

## `dashboardSummaries/{siteId}`

This is a replaceable read cache, not a source of truth.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Document ID. |
| `counts` | map | yes | Zone, Camera, Cleaner, Alert and Work counts. |
| `orchestrator` | map | yes | Running/paused/health summary. |
| `topAlerts` | array | yes | Up to three snapshots using unresolved priority or resolved fallback. |
| `busyZones` | array | yes | Up to three current rankings. |
| `availableCleaners` | array | yes | Bounded current Cleaner summaries. |
| `assignedWork` | array | yes | Bounded active Work summaries. |
| `windowStart` / `windowEnd` | timestamp | yes | 15-minute Busy Zone calculation window. |
| `calculationVersion` | string | yes | Dashboard policy version. |
| `generatedAt` | timestamp | yes | Cache freshness. |
| `staleAfter` | timestamp | yes | API recomputes after this time. |

Dashboard `counts` contains `zoneCount`, `cameraCount`, `onlineCameraCount`, `cleanerCount`, `availableCleanerCount`, Alert counts by status/severity, and Work counts by status. `orchestrator` contains status, last run/success/failure times and safe failure code.

Each `topAlerts` item stores Alert ID, Camera/Zone labels, issue, condition, status, severity, priority, evidence thumbnail media ID and created/terminal time. Each `busyZones` item stores Zone ID/name, rank, combined score, normalized/raw people pressure, active Work points and qualifying issue count. Cleaner and assigned-Work arrays contain IDs, display snapshots, current status and the minimum navigation fields needed by the Dashboard.

Busy Zone score uses:

```text
50% normalized rolling average people count over the latest 15 minutes
+ 50% normalized active Work points

warning Work = 1 point
critical Work = 2 points
```

Tie order follows the clarified requirements: qualifying issues in the same 15-minute window, people pressure, Zone name, then Zone ID. Active Work points already contribute to the 50/50 score.

## `binPlacementSnapshots/{siteId}`

This singleton holds the latest calculated current recommendation list. Refresh replaces it. It is not a pending workflow record.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Document ID. |
| `requestedLookbackDays` | integer | yes | Supervisor-selected or scheduled lookback, minimum 2. Daily default starts at 30. |
| `availableStart` / `availableEnd` | timestamp | yes | Actual data coverage. May be shorter than requested. |
| `calculatedAt` | timestamp | yes | Daily/manual refresh time. |
| `calculatedBy` | actor map | yes | Scheduler or Supervisor. |
| `policyVersion` | string | yes | Ranking contract. |
| `status` | enum | yes | `ready`, `partial_data`, or `insufficient_data`. |
| `zoneRankings` | array | yes | Bounded current rankings for active Zones. |
| `sourceSummaryIds` | string array | yes | Daily summary traceability. |
| `nextScheduledRefreshAt` | timestamp | yes | Daily job target. |

### Zone ranking

| Field | Type | Meaning and workflow use |
| --- | --- | --- |
| `zoneId` / `zoneNameSnapshot` | string | Ranked Zone. |
| `rank` | integer or null | 1 is highest priority; null for insufficient data. |
| `totalScore` | number 0..100 or null | Equal-third score; null with fewer than two observed completed days. |
| `peopleActivity` | factor map | Raw, normalized, one-third contribution. |
| `cleaningFrequency` | factor map | Resolved Work raw count, normalized, one-third contribution. |
| `binServiceFrequency` | factor map | Bin-service Alert raw count, normalized, one-third contribution. |
| `coverage` | map | Requested/available days and quality warnings. |
| `reasonSummary` | string | Short user-facing reason. |
| `excludedUntil` | timestamp or null | Zone exclusion after an Intervention. |

Recommendations update daily and on Supervisor refresh. Implementing one does not create a pending state. It creates an Intervention and excludes that Zone from recommendation ranking for two full Site-local days.

The implementation also stores `sourceFingerprint`, `mapRevisionId`, `timeZoneSnapshot`, `requestedStart`, `requestedEnd` and `availableDays`. Like factors are normalized across sufficient active Zones. API ranges allow 2 through 3660 calendar days. Offline-only coverage cannot qualify a Zone for scoring.

## `binPlacementInterventions/{interventionId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `interventionId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `zoneId` | string | yes | Implemented Zone. |
| `zoneNameSnapshot` | string | yes | Historical label. |
| `mapRevisionId` | string | yes | Map context at implementation. |
| `implementedAt` | timestamp | yes | The comparison split point. |
| `implementedByUid` | string | yes | Supervisor. |
| `sourceSnapshotCalculatedAt` | timestamp | yes | Recommendation cache version acted upon. |
| `rankingSnapshot` | map | yes | Rank, total and all three factor values at implementation. |
| `requestedLookbackDaysSnapshot` | integer | yes | Source analysis range. |
| `availableCoverageSnapshot` | map | yes | Honest source coverage. |
| `exclusionEndsAt` | timestamp | yes | End of two complete Site-local-day exclusion. |
| `note` | string or null | yes | Optional Supervisor note. No exact bin coordinate is required. |
| `createdAt` | timestamp | yes | Record creation time, normally equal to implementation time. |

Before/after comparison is calculated on request from this timestamp and daily summaries. The Supervisor may request any integer day count of at least 2. The API returns partial coverage when the intervention is newer than the requested after period or old source data is unavailable. It never pads missing days.

## `phase11MaintenanceStates/{siteId}`

One internal marker prevents repeated daily analytics work for an unchanged Site-local date.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Site and document identity. |
| `lastCompletedLocalDate` | string | yes | Site-local date whose scheduled finalization, retention and recommendation maintenance completed. |
| `lastCompletedAt` | timestamp | yes | Completion time of that daily sweep. |
| `recommendationLookbackDays` | integer | yes | Lookback retained for the scheduled recommendation refresh. Defaults to 30. |

The marker is replaceable worker state, not operational history. Missing state triggers one bounded daily check. It never stores a minute-bucket cursor or causes a scan of retained history.

## Analytics indexing and write cost

- Disable single-field indexing for `zoneMetrics`, `siteTotals`, ranking arrays, model maps, geometry arrays and safe-detail maps.
- Query minute buckets only by `siteId` plus `bucketStart` range.
- Query daily summaries only by `siteId` plus `localDate` range.
- Use one minute bucket per Site, not one per Camera or Zone.
- Keep Dashboard and Bin Placement documents replaceable so repeated refreshes do not create unbounded history.
- Keep durable Alert, Work and Intervention histories separate from short-lived analytics storage.
