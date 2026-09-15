# Automation, notifications and audit

## `orchestratorConfigs/{siteId}`

One mutable Site configuration controls automation.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Document ID and tenant. |
| `status` | enum | yes | `running` or `paused`. Site inactivity also blocks execution. |
| `pausedAt` | timestamp or null | yes | Current pause time. |
| `pausedByUid` | string or null | yes | Root or Regular Supervisor. |
| `pauseReason` | string or null | yes | Bounded optional operational note. |
| `controlHistory` | array, maximum 20 | no | Recent pause/resume actions for the System page. Each entry stores the new status, Supervisor UID/name/authority, optional reason, and server-side occurrence time. This is a safe projection for Root and Regular Supervisors; the immutable full record remains in `auditEvents`. |
| `assignmentEnabled` | boolean | yes | Allows assignment runs. |
| `reviewEnabled` | boolean | yes | Allows deterministic review application runs. |
| `provider` | string | yes | Configured LLM provider key, such as `ollama`. |
| `model` | string | yes | Configured model name. |
| `assignmentPolicyVersion` | string | yes | Candidate-context and retry contract. |
| `reviewPolicyVersion` | string | yes | Review tool contract. |
| `technicalRetryLimit` | integer | yes | Additional LLM retries, initially 3. |
| `technicalRetryDelaysMs` | integer array | yes | Initially `[1000,2000,4000]`. |
| `requestTimeoutMs` | integer | yes | Provider request timeout. |
| `activeRunId` | string or null | yes | Site-wide assignment/review mutex. Cleared by atomic completion or expired-lease recovery. |
| `lastRunAt` | timestamp or null | yes | Latest started run for System page. |
| `lastSuccessfulRunAt` | timestamp or null | yes | Health summary. |
| `lastFailureAt` | timestamp or null | yes | Health summary. |
| `lastFailureCode` | string or null | yes | Safe error category. |
| `updatedAt` | timestamp | yes | Latest config/state update. |
| `updatedByUid` | string or null | yes | Supervisor or system. |
| `revision` | integer | yes | Concurrency counter. |

Pause/resume writes an `auditEvents` document and appends the bounded `controlHistory` projection. When paused, unassigned Alerts remain waiting and Supervisors receive notifications instead of assignment runs.

## `orchestratorOutbox/{eventId}`

The outbox makes assignment/review triggers durable and retryable.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `eventId` | string | yes | Deterministic document ID. |
| `siteId` | string | yes | Tenant. |
| `type` | enum | yes | `assign_alert`, `retry_waiting_alerts`, or `review_work`. |
| `aggregateType` | enum | yes | `site`, `alert`, or `work_order`. Site is used for backlog scans before the LLM selects an Alert. |
| `aggregateId` | string | yes | Target ID. |
| `triggerType` | string | yes | Alert created, Cleaner available, scheduled scan, review ready, and similar safe code. |
| `verificationId` | string or null | yes | Exact ready Verification for a review trigger. |
| `isRunRecord` | boolean | yes | Internal Run event marker. Workers process only external trigger events. |
| `status` | enum | yes | `pending`, `claimed`, `completed`, `failed`, or `cancelled`. |
| `availableAt` | timestamp | yes | Earliest worker claim time. |
| `claimTokenHash` | string or null | yes | Lease token hash. |
| `claimedBy` | string or null | yes | Worker identity. |
| `claimExpiresAt` | timestamp or null | yes | Recovery boundary. |
| `deliveryAttempts` | integer | yes | Worker-delivery count. |
| `lastErrorCode` | string or null | yes | Safe failure code. |
| `runId` | string or null | yes | Created Orchestrator Run. |
| `createdAt` | timestamp | yes | Trigger persistence time. |
| `updatedAt` | timestamp | yes | Latest claim/result time. |

Only one pending assignment event per Alert and one pending review event per Work Order may exist. Deterministic IDs enforce this.

## `orchestratorRuns/{runId}`

Each assignment or review episode receives a new Run. A prior run does not block later rework/retry episodes.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `runId` | string | yes | Document ID. |
| `siteId` | string | yes | Tenant. |
| `type` | enum | yes | `assignment` or `review`. |
| `status` | enum | yes | `queued`, `running`, `succeeded`, `failed`, `exhausted`, or `cancelled`. |
| `triggerEventId` | string | yes | Outbox event. |
| `alertId` | string or null | yes | Alert selected by the completed assignment decision, or the review Alert. Null before assignment selection. |
| `workOrderId` | string or null | yes | Review/result Work. |
| `managementModeSnapshot` | enum | yes | Cancels tool actions when Alert/Work changed to manual. |
| `requestedWorkerId` | string | yes | Worker identity fixed when the Run starts. |
| `configRevision` | integer | yes | Orchestrator configuration revision required at commit. |
| `verificationId` | string or null | yes | Exact Verification owned by a review Run. |
| `inputSnapshot` | map | yes | Bounded structured issue, target, availability and Verification context. Assignment Runs freeze offered Alerts, Cleaners and valid pairs. Review Runs freeze a display-safe Work snapshot. No private notes. |
| `contextHash` | string or null | yes | Canonical hash of the saved assignment snapshot used as its pair allowlist. |
| `candidateCount` | integer | yes | Available Cleaner count at first assignment context. |
| `inputAlertCount` | integer | yes | Waiting Alerts offered to the assignment decision, maximum 10. |
| `candidatePairCount` | integer | yes | Valid Alert–Cleaner combinations supplied after backend calculation. |
| `selectedAlertId` | string or null | yes | Alert ID returned by the model and accepted by Node. |
| `selectedCleanerId` | string or null | yes | Final accepted selection. |
| `decisionSummary` | string or null | yes | Concise Supervisor-visible explanation. Not hidden chain of thought. |
| `decisionFactors` | map | yes | Structured distances, availability facts and outcome facts. |
| `provider` | string | yes | Provider key. |
| `model` | string | yes | Model name. |
| `providerRequestCount` | integer | yes | Initial plus technical retries. |
| `candidateAttemptCount` | integer | yes | Distinct Cleaners attempted. |
| `toolCallCount` | integer | yes | Controlled Node tool calls. |
| `resultCode` | string or null | yes | `assigned`, `resolved`, `rework`, `no_candidates`, `all_candidates_conflicted`, and similar. |
| `errorCode` | string or null | yes | Safe failure category. |
| `errorMessage` | string or null | yes | Safe summary. Raw response is not stored here. |
| `isSimulation` | boolean | yes | Inherited operational traceability. |
| `leaseOwner` | string or null | yes | Worker claim identity. |
| `leaseExpiresAt` | timestamp or null | yes | Stale-run recovery. |
| `startedAt` | timestamp or null | yes | Execution start. |
| `completedAt` | timestamp or null | yes | Terminal time. |
| `createdAt` | timestamp | yes | Run creation. |
| `updatedAt` | timestamp | yes | Latest state. |
| `commandFingerprint` | string or null | yes | Exact committed command identity for replay conflict detection. |
| `commandResult` | map or null | yes | Bounded response returned to an exact command replay. |

## `orchestratorRuns/{runId}/attempts/{attemptId}`

Assignment attempts record technical retries and Cleaner reservation attempts without creating fake Work Orders.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string | Tenant. |
| `runId` | string | Parent. |
| `sequence` | integer | Total attempt order. |
| `kind` | enum | `provider_request` or `cleaner_reservation`. |
| `selectedAlertId` | string or null | Alert returned or attempted for this step. |
| `selectedCleanerId` | string or null | Returned/attempted Cleaner. |
| `candidateIds` | string array | Bounded IDs offered in that provider call. |
| `excludedCleanerIds` | string array | Candidates already rejected in the run. |
| `distanceMeters` | number or null | Selected Cleaner distance. |
| `outcome` | enum | `selected`, `invalid_selection`, `provider_error`, `timeout`, `malformed_output`, `reservation_conflict`, `reserved`, or `cancelled`. |
| `reasonCode` | string or null | Safe validation/conflict reason. |
| `retryDelayMs` | integer or null | Technical retry delay. |
| `startedAt` / `completedAt` | timestamp | Timing. |

## `orchestratorRuns/{runId}/actions/{actionId}`

This is the structured System-page tool log.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | `2`. |
| `siteId` | string | Tenant. |
| `runId` | string | Parent. |
| `sequence` | integer | Display order. |
| `tool` | enum | `get_assignment_context`, `assign_cleaner`, `get_review_context`, `resolve_verified_work`, or `request_rework`. |
| `inputSummary` | map | Redacted bounded parameters. |
| `outcome` | enum | `succeeded`, `rejected`, or `failed`. |
| `resultSummary` | map | Redacted structured result. |
| `errorCode` | string or null | Safe failure. |
| `startedAt` / `completedAt` | timestamp | Timing. |

Raw provider output is written only when development debug mode is enabled. Files live under `data/orchestrator-debug`, are ignored by Git, cap each response at 64 KiB, rotate after 14 days, and use Run ID for correlation.

## `notifications/{notificationId}`

Notifications are immutable recipient events. There is no read/unread field, delivery receipt, FCM token or mark-read API.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `notificationId` | string | yes | Deterministic ID and document ID. |
| `siteId` | string | yes | Tenant. |
| `recipientUid` | string | yes | Only this Firebase user may read it directly. |
| `recipientRole` | enum | yes | `supervisor` or `cleaner`. |
| `type` | enum | yes | See event list below. |
| `title` | string | yes | Short display copy. |
| `body` | string | yes | Bounded display copy without secrets. |
| `entityType` | enum | yes | `alert`, `work_order`, `camera`, `orchestrator_run`, or `site`. |
| `entityId` | string | yes | Navigation target. |
| `cameraId` | string or null | yes | Optional Camera Details target. |
| `alertId` | string or null | yes | Optional Alert target. |
| `workOrderId` | string or null | yes | Optional Work target. |
| `severity` | enum or null | yes | Optional warning/critical styling. |
| `isSimulation` | boolean | yes | Internal only; frontend does not display a label. |
| `createdAt` | timestamp | yes | Inbox ordering and real-time delivery. |
| `expiresAt` | timestamp | yes | Default 90-day notification cleanup. Operational history remains elsewhere. |

Initial notification types:

- `work_assigned`, `work_rework`, `work_resolved`, `work_dismissed` for Cleaners;
- `alert_waiting_orchestrator_paused`, `alert_escalated`, `assignment_failed`, `verification_inconclusive`, `camera_offline`, and `site_operation_failed` for Supervisors.

Frontend queries must include `recipientUid == request.auth.uid` and order by `createdAt desc`. Firestore rules permit reads of matching documents and deny every direct notification write.

## `auditEvents/{auditEventId}`

Audit Events are immutable administrative accountability records. Workflow event subcollections explain domain state changes; Audit Events identify privileged actors and safe before/after values.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `auditEventId` | string | yes | Document ID. |
| `siteId` | string or null | yes | Affected Site. Null only for platform actions without a Site. |
| `siteNameSnapshot` | string or null | yes | Historical tenant label. |
| `actorUid` | string | yes | Human Firebase UID. |
| `actorRole` | enum | yes | `superadmin` or `supervisor`. |
| `actorAuthority` | enum or null | yes | `root`, `regular`, or null. |
| `actorNameSnapshot` | string | yes | Historical display. |
| `action` | string | yes | Stable action code. |
| `resourceType` | string | yes | Site, Supervisor, Cleaner, map, Zone, Camera, Alert, Work, config, and similar. |
| `resourceId` | string or null | yes | Target when known. |
| `outcome` | enum | yes | `succeeded` or `failed`. |
| `reason` | string or null | yes | Required for overrides, dismissal, deactivation and recovery. |
| `before` | map or null | yes | Allowlisted safe summary. Never credentials, tokens, filesystem paths or raw model output. |
| `after` | map or null | yes | Allowlisted safe summary. |
| `errorCode` | string or null | yes | Safe failure code. |
| `requestId` | string | yes | HTTP trace. |
| `ipHash` | string or null | yes | Optional salted diagnostic hash, never raw IP. |
| `occurredAt` | timestamp | yes | Server time. |

Every Superadmin mutation creates one, including failed attempts. Root can query only events for its Site. Regular Supervisors cannot read this collection. Read-only Superadmin actions are not logged.

Supervisor audit coverage includes account changes, map publication, Station Point/schedule/override changes, monitoring controls, Orchestrator pause/resume, manual takeover, Cleaner replacement, dismissal and Verification override.

## `systemEvents/{eventKey}`

System Events aggregate recurring dependency/runtime faults without flooding Firestore.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `eventKey` | string | yes | Deterministic component/error key and document ID. |
| `siteId` | string or null | yes | Site-scoped when applicable. |
| `component` | enum | yes | `node`, `fastapi`, `firestore`, `media`, `orchestrator`, or `monitoring`. |
| `code` | string | yes | Stable safe error code. |
| `status` | enum | yes | `open` or `recovered`. |
| `severity` | enum | yes | `warning` or `critical`. |
| `message` | string | yes | Safe display summary. |
| `firstOccurredAt` | timestamp | yes | First occurrence in episode. |
| `lastOccurredAt` | timestamp | yes | Latest occurrence. |
| `occurrenceCount` | integer | yes | Aggregated count. |
| `recoveredAt` | timestamp or null | yes | Recovery time. |
| `safeDetails` | map | yes | Bounded allowlisted diagnostics. |
| `updatedAt` | timestamp | yes | Latest state. |

Optional `occurrences` and `recoveries` subcollections retain bounded recent transitions for support. No stack traces, raw headers, tokens, credentials or paths are stored.

The V2 System page currently uses these persisted codes:

- `orchestrator_no_available_cleaner` when Alerts remain waiting because Node found no assignable Cleaner;
- `orchestrator_provider_unavailable` when provider requests fail through the retry limit;
- `orchestrator_invalid_selection` when every returned Alert/Cleaner pair fails Node validation;
- `orchestrator_assignment_failed` when assignment stops for another internal reason;
- `orchestrator_review_inconclusive` when a Supervisor must decide the review;
- `orchestrator_review_failed` when automatic review stops unexpectedly;
- `site_operation_failed` for failed Site cleanup reconciliation.

`orchestrator_worker_disabled` is a response-only runtime warning. Node derives it during `GET /api/operations/system` when Site configuration says `running` but this process has the background worker disabled. It is not stored as a Firestore event.

## `systemMetadata/schema`

This singleton lets startup and migration tools reject an incompatible database before serving traffic.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `databaseModel` | string | yes | `litterspot-firestore`. |
| `migrationState` | enum | yes | `initializing`, `ready`, or `blocked`. |
| `minimumBackendVersion` | string | yes | Old binaries below this version refuse startup. |
| `firebaseProjectId` | string | yes | Target identity written at bootstrap. |
| `firestoreDatabaseId` | string | yes | Expected database, `(default)` in isolated dev. |
| `environment` | string | yes | `emulator`, `development-cloud`, or approved deployment environment. |
| `initializedAt` | timestamp | yes | First V2 bootstrap time. |
| `initializedBy` | string | yes | Migration/bootstrap run ID. |
| `updatedAt` | timestamp | yes | Latest schema-state change. |

This document contains no credentials. The backend still validates its environment and service account independently before connecting.
