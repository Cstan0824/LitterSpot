# Identity, tenancy and Site Map

## Firebase Authentication

Firebase Authentication stores email/password credentials and account disablement. The backend creates accounts with the Admin SDK. Passwords never enter Firestore, logs, audit summaries, or API responses.

Every application user must have a matching `userAccounts/{uid}` document. Authentication without that document fails closed.

## `userAccounts/{uid}`

This is the authorization record loaded after Firebase token verification.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `uid` | string | yes | Firebase UID. Must equal the document ID. |
| `role` | enum | yes | `superadmin`, `supervisor`, or `cleaner`. Selects the API permission family. |
| `siteId` | string or null | yes | Null only for Superadmin. Required for Supervisor and Cleaner tenant isolation. |
| `profileId` | string | yes | Supervisor UID or stable Cleaner ID used to load the domain profile. For Superadmin it equals UID. |
| `authority` | enum or null | yes | `root` or `regular` for Supervisors; null otherwise. |
| `emailNormalized` | string | yes | Lowercase trimmed email for display and reconciliation. Authentication still owns the credential. |
| `displayName` | string | yes | Current user-facing name. Histories store their own snapshot. |
| `status` | enum | yes | `active` or `inactive`. An inactive account cannot use application APIs. |
| `lastLoginAt` | timestamp or null | yes | Best-effort application login time for account administration. |
| `createdAt` | timestamp | yes | Profile creation time. |
| `createdByUid` | string or null | yes | Superadmin, Root Supervisor, or bootstrap actor. |
| `updatedAt` | timestamp | yes | Latest profile/authorization update. |
| `updatedByUid` | string or null | yes | Actor responsible for that update. |
| `revision` | integer | yes | Optimistic concurrency counter. |

Rules:

- Role, Site, and authority changes require privileged backend workflows.
- A Site can have exactly one active Root Supervisor.
- Site deactivation blocks Site users even before their account documents are reconciled.
- Firebase Auth `disabled=true` and Firestore `status=inactive` are reconciled by a repair job. Both are checked when practical.

## `userAccountEmails/{emailHash}`

This reserves an email across Supervisor and Cleaner provisioning. `emailHash` is SHA-256 of `emailNormalized`.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `emailNormalized` | string | yes | Reserved email. Store only normalized form. |
| `uid` | string | yes | Owning Firebase UID. |
| `role` | enum | yes | Owning human role. |
| `profileId` | string | yes | Domain profile reference. |
| `siteId` | string or null | yes | Owning Site, or null for Superadmin. |
| `state` | enum | yes | `reserved`, `active`, or `release_pending`. Supports Auth/Firestore saga recovery. |
| `operationId` | string | yes | Provisioning or recovery operation that last changed the reservation. |
| `createdAt` | timestamp | yes | First reservation time. |
| `updatedAt` | timestamp | yes | Latest saga update. |

## `identityOperations/{operationId}`

Firebase Auth and Firestore cannot commit together. This durable saga record makes Site/Root, Supervisor and Cleaner account provisioning recoverable.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `operationId` | string | yes | Document ID and idempotency identity. |
| `type` | enum | yes | `create_site_root`, `create_supervisor`, `create_cleaner`, or `recover_root`. |
| `siteId` | string or null | yes | Target Site when known. |
| `emailNormalized` | string | yes | Account email being provisioned. |
| `authUid` | string or null | yes | Created/reused Firebase UID. |
| `profileId` | string or null | yes | Created domain profile. |
| `status` | enum | yes | `started`, `auth_created`, `firestore_committed`, `completed`, `compensation_required`, or `failed`. |
| `lastCompletedStep` | string or null | yes | Resume checkpoint. |
| `errorCode` | string or null | yes | Safe failure category. |
| `requestedByUid` | string | yes | Superadmin or Root/Supervisor actor. |
| `requestId` | string | yes | HTTP trace. |
| `createdAt` | timestamp | yes | Saga start. |
| `updatedAt` | timestamp | yes | Latest checkpoint. |
| `completedAt` | timestamp or null | yes | Terminal success time. |

## `supervisors/{uid}`

This stores Supervisor profile data. Authorization still comes from `userAccounts`.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `uid` | string | yes | Firebase UID and document ID. |
| `siteId` | string | yes | Supervisor tenant. |
| `authority` | enum | yes | `root` or `regular`. Mirrors the authorization record. |
| `fullName` | string | yes | Display name. |
| `phone` | string or null | yes | Optional client contact information. |
| `status` | enum | yes | `active` or `inactive`. |
| `createdAt` | timestamp | yes | Account creation time. |
| `createdByUid` | string | yes | Superadmin for Root, Root Supervisor for Regular. |
| `updatedAt` | timestamp | yes | Latest profile change. |
| `updatedByUid` | string | yes | Latest actor. |
| `deactivatedAt` | timestamp or null | yes | Deactivation time. |
| `deactivatedByUid` | string or null | yes | Deactivating actor. |
| `revision` | integer | yes | Concurrency counter. |

The document does not store a password, permission array, or cross-Site access list.

## `cleaners/{cleanerId}`

This is both the Cleaner profile and the atomic assignment lock. `cleanerId` remains stable if the Firebase account must be recovered.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `cleanerId` | string | yes | Stable domain ID and document ID. |
| `authUid` | string | yes | Firebase UID used for login and Cleaner authorization. |
| `siteId` | string | yes | Cleaner tenant. |
| `staffCode` | string | yes | Site-unique human code. |
| `staffCodeNormalized` | string | yes | Uppercase canonical code used for uniqueness checks. |
| `fullName` | string | yes | Display name. |
| `phone` | string | yes | Supervisor-managed contact field. |
| `profileMediaId` | string or null | yes | Optional portrait used in Cleaner and Work lists. |
| `notes` | string or null | yes | Supervisor-only notes. Never sent to the Orchestrator. |
| `status` | enum | yes | `active` or `inactive`. Inactive Cleaners cannot log in or receive Work. |
| `availabilityOverride` | enum | yes | `none` or `unavailable`. Supervisors control this. |
| `availabilityOverrideAt` | timestamp or null | yes | When the current override was set or cleared. |
| `availabilityOverrideByUid` | string or null | yes | Supervisor responsible for the current value. |
| `weeklySchedule` | map | yes | Keys `mon` through `sun`; each value is null or one `{startMinute,endMinute}` range. |
| `scheduleTimeZone` | string | yes | Site timezone snapshot used to interpret the schedule. |
| `activeWorkOrderId` | string or null | yes | Atomic busy lock. Non-null makes the Cleaner unavailable for new Work. |
| `activeWorkAssignedAt` | timestamp or null | yes | Assignment time for stale-lock diagnosis. |
| `lastResolvedWorkOrderId` | string or null | yes | Most recently resolved Work used for assignment context traceability. |
| `lastResolvedWorkTarget` | Work target snapshot or null | yes | Approximate Recent Work Location; never presented as live position. |
| `lastResolvedWorkAt` | timestamp or null | yes | Freshness clock for the Recent Work Location. |
| `lastResolvedMapRevisionId` | string or null | yes | Must match the Active Map Revision before recent location is considered. |
| `createdAt` | timestamp | yes | Profile creation time. |
| `createdByUid` | string | yes | Creating Supervisor or Superadmin. |
| `updatedAt` | timestamp | yes | Latest mutable profile change. |
| `updatedByUid` | string | yes | Latest actor. |
| `deactivatedAt` | timestamp or null | yes | Deactivation time. |
| `deactivatedByUid` | string or null | yes | Deactivating actor. |
| `revision` | integer | yes | Concurrency counter. |

### Schedule range

| Field | Type | Meaning |
| --- | --- | --- |
| `startMinute` | integer 0..1439 | Minutes after local midnight on the weekday where the shift starts. |
| `endMinute` | integer 0..1439 | Minutes after local midnight. A value less than or equal to `startMinute` means the range crosses midnight. |

Station Point and containing Zone are not duplicated on the Cleaner document. Resolve them from `siteMapRevisions/{activeMapRevisionId}/cleanerStations/{cleanerId}`. API presentation may return derived `stationPoint`, `stationZoneId`, and `availability`.

Cleaner availability is true only when all conditions pass:

```text
Site active
and Auth/application account active
and Cleaner active
and Availability Override is none
and current Site-local time falls in the recurring schedule
and activeWorkOrderId is null
and Active Map Revision has one valid Station Point
```

Resolving Work atomically updates the four `lastResolved*` projection fields. Dismissing Work does not update them. Assignment context falls back to Station Point when the projection is missing, stale or belongs to another map revision.

## `cleanerStaffCodeKeys/{keyHash}`

This transaction key enforces a Site-unique Cleaner staff code. `keyHash` is SHA-256 of `siteId` and `staffCodeNormalized`.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Uniqueness scope. |
| `staffCodeNormalized` | string | yes | Reserved canonical code. |
| `cleanerId` | string | yes | Owning Cleaner. |
| `createdAt` | timestamp | yes | Reservation time. |

Create, code change and Cleaner purge update this key in the same Firestore transaction as the Cleaner profile. Normal deactivation keeps the reservation so history cannot become ambiguous.

## `sites/{siteId}`

The Site is the tenant and one physical venue.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Stable ID and document ID. |
| `name` | string | yes | Client/Site display name, initially `Sunway Theme Park` in development. |
| `nameNormalized` | string | yes | Normalized name for deterministic sorting and duplicate warnings. |
| `description` | string or null | yes | Optional venue description. |
| `timeZone` | IANA string | yes | Used for schedules, local dates, charts and daily aggregation. |
| `status` | enum | yes | `active` or `inactive`. Inactive blocks Site operations immediately. |
| `rootSupervisorUid` | string | yes | The one active Root Supervisor. |
| `activeMapRevisionId` | string | yes | Canonical pointer to the complete current Site Map. |
| `mapDraftExists` | boolean | yes | Cheap indicator for Root UI. The draft document remains authoritative. |
| `firstCameraCreated` | boolean | yes | Enforces that the first Camera uses `laptop_camera`. |
| `laptopCameraId` | string or null | yes | Enforces at most one laptop Camera. |
| `defaultSampleIntervalSeconds` | number | yes | Starts at `2`; Site-level monitoring default. |
| `fullBinAlertsEnabled` | boolean | yes | Can disable unreliable `full` without disabling overflow. |
| `alertPolicyVersion` | string | yes | Active qualification/aging policy. |
| `analyticsPolicyVersion` | string | yes | Active aggregation and ranking policy. |
| `createdAt` | timestamp | yes | Site creation time. |
| `createdByUid` | string | yes | Superadmin creator. |
| `updatedAt` | timestamp | yes | Latest Site metadata/config update. |
| `updatedByUid` | string | yes | Latest actor. |
| `deactivatedAt` | timestamp or null | yes | Site deactivation time. |
| `deactivatedByUid` | string or null | yes | Superadmin responsible. |
| `deactivationOperationId` | string or null | yes | Reconciliation operation that dismisses active workflows. |
| `revision` | integer | yes | Concurrency counter. |

## `siteOperations/{operationId}`

This tracks Site-wide jobs whose effects can exceed one Firestore transaction, initially deactivation reconciliation.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `operationId` | string | yes | Document ID. |
| `siteId` | string | yes | Target Site. |
| `type` | enum | yes | `deactivate` or `reactivate`. |
| `status` | enum | yes | `pending`, `running`, `completed`, or `failed`. |
| `reason` | string | yes | Required Superadmin reason. |
| `requestedByUid` | string | yes | Superadmin actor. |
| `requestId` | string | yes | HTTP trace/idempotency link. |
| `counts` | map | yes | Discovered and processed Alerts, Work Orders, Cleaners and outbox events. |
| `cursorState` | map | yes | Resumable collection cursors. |
| `lastErrorCode` | string or null | yes | Safe retry diagnosis. |
| `createdAt` | timestamp | yes | Request time. |
| `startedAt` | timestamp or null | yes | Worker start. |
| `updatedAt` | timestamp | yes | Latest checkpoint. |
| `completedAt` | timestamp or null | yes | Reconciliation completion. |

## `zones/{zoneId}`

This is stable Zone identity. Geometry belongs to map drafts and revisions.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `zoneId` | string | yes | Stable ID and document ID. |
| `siteId` | string | yes | Owning Site. |
| `name` | string | yes | Current display name. |
| `nameNormalized` | string | yes | Site-scoped duplicate detection and sorting. |
| `description` | string or null | yes | Optional operational description. |
| `lifecycleStatus` | enum | yes | `active` or `retired`. Current map membership still comes from Active Map Revision. |
| `createdAt` | timestamp | yes | Identity creation time. |
| `createdByUid` | string | yes | Root Supervisor or Superadmin. |
| `updatedAt` | timestamp | yes | Latest name/description change. |
| `updatedByUid` | string | yes | Latest actor. |
| `retiredAt` | timestamp or null | yes | When removed from active use. |
| `retiredByUid` | string or null | yes | Actor who retired it. |
| `revision` | integer | yes | Concurrency counter. |

A retired Zone may still appear in old Work, Alert, analytics and map revisions through snapshots.

## `siteMapDrafts/{siteId}`

At most one editable map draft exists per Site.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Document ID and tenant. |
| `baseRevisionId` | string | yes | Published revision copied when editing began. |
| `widthMeters` | number | yes | Positive approximate Site width. |
| `heightMeters` | number | yes | Positive approximate Site height. |
| `gridSizeMeters` | number | yes | Display grid spacing; coordinates remain authoritative. |
| `backgroundMediaId` | string or null | yes | Optional floor-plan/image asset. |
| `backgroundTransform` | map | yes | Visual placement of the background within the coordinate plane. |
| `validationStatus` | enum | yes | `not_validated`, `valid`, or `invalid`. |
| `validationErrors` | array | yes | Bounded safe validation results for the editor. |
| `createdAt` | timestamp | yes | Draft creation time. |
| `createdByUid` | string | yes | Root Supervisor or structural Superadmin actor. |
| `updatedAt` | timestamp | yes | Latest edit time. |
| `updatedByUid` | string | yes | Latest editor. |
| `revision` | integer | yes | Optimistic concurrency counter for draft saves. |

### Background transform

| Field | Type | Meaning |
| --- | --- | --- |
| `xMeters` | number | Background left edge on the Site plane. |
| `yMeters` | number | Background top edge on the Site plane. |
| `widthMeters` | number | Rendered background width. |
| `heightMeters` | number | Rendered background height. |
| `opacity` | number 0..1 | Editor/viewer opacity. |

## `siteMapDrafts/{siteId}/zoneGeometry/{zoneId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `zoneId` | string | yes | Stable Zone identity and document ID. |
| `zoneNameSnapshot` | string | yes | Label shown during editing. |
| `polygon` | point array | yes | Non-self-intersecting metre coordinates inside Site bounds. |
| `centroid` | point | yes | Server-calculated polygon centroid for labels and fallback distance. |
| `areaSquareMeters` | number | yes | Server-calculated approximate area. |
| `updatedAt` | timestamp | yes | Latest geometry change. |
| `updatedByUid` | string | yes | Latest editor. |

## `siteMapDrafts/{siteId}/cameraPlacements/{cameraId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `cameraId` | string | yes | Existing or reserved Camera ID and document ID. |
| `cameraNameSnapshot` | string | yes | Editor label. |
| `point` | point | yes | Metre coordinate inside exactly one draft Zone. |
| `zoneId` | string | yes | Server-derived containing Zone. Never trusted from the client. |
| `updatedAt` | timestamp | yes | Latest placement change. |
| `updatedByUid` | string | yes | Latest editor. |

## `siteMapDrafts/{siteId}/cleanerStations/{cleanerId}`

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `siteId` | string | yes | Tenant. |
| `cleanerId` | string | yes | Stable Cleaner ID and document ID. |
| `cleanerNameSnapshot` | string | yes | Editor label. |
| `point` | point | yes | Metre coordinate inside exactly one draft Zone. |
| `zoneId` | string | yes | Server-derived containing Zone. |
| `updatedAt` | timestamp | yes | Latest Station Point change. |
| `updatedByUid` | string | yes | Latest editor. |

## `siteMapRevisions/{revisionId}`

Published revisions are immutable. The Site pointer, not a mutable revision status, says which revision is active.

| Field | Type | Required | Meaning and workflow use |
| --- | --- | ---: | --- |
| `schemaVersion` | integer | yes | `2`. |
| `revisionId` | string | yes | Document ID. |
| `siteId` | string | yes | Owning Site. |
| `revisionNumber` | integer | yes | Site-local monotonically increasing display number. |
| `parentRevisionId` | string or null | yes | Previous published revision. |
| `widthMeters` | number | yes | Published Site width. |
| `heightMeters` | number | yes | Published Site height. |
| `gridSizeMeters` | number | yes | Published display grid spacing. |
| `backgroundMediaId` | string or null | yes | Historical background reference. |
| `backgroundTransform` | map | yes | Historical visual transform. |
| `zoneCount` | integer | yes | Validation/export summary. |
| `cameraPlacementCount` | integer | yes | Validation/export summary. |
| `cleanerStationCount` | integer | yes | Validation/export summary. |
| `contentHash` | string | yes | Hash of canonical geometry used to detect incomplete/corrupt copies. |
| `publishedAt` | timestamp | yes | Publication time. |
| `publishedByUid` | string | yes | Publishing Root/Regular Supervisor or Superadmin actor. Regular is allowed only for a server-generated Cleaner Station-only revision. |
| `publicationRequestId` | string | yes | Idempotency and audit link. |

Its three subcollections have the same shapes as the draft subcollections, except they use `publishedAt` and `publishedByUid` instead of mutable update fields.

Regular Supervisors do not receive general map-draft publication authority. Cleaner Station Point create/update uses a narrow backend operation that copies the Active Map Revision, changes one Station Point, performs full validation and publishes a generated station-only revision. Root Supervisors and Superadmins use the full draft flow for dimensions, backgrounds, Zones and Camera Placements.

## Map validation and publication

Validation rejects:

- non-positive dimensions;
- a background outside allowed file and size rules;
- polygons with fewer than three unique points, self-intersections, zero area, or points outside the Site;
- any overlap between active Zone polygons;
- Camera or Cleaner points outside the Site or not contained by exactly one active Zone;
- missing placement for an operational Camera or active Cleaner;
- stale edits whose `baseRevisionId` no longer equals the Site's Active Map Revision.

Publication stages and verifies every immutable revision document first. One Firestore transaction then confirms the base revision and switches `sites.activeMapRevisionId`. All application reads resolve geometry through that pointer. Search-oriented projections may update afterward, but they are never authoritative.
