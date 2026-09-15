# LitterSpot Node API reference

Last updated: 2026-09-15

This document is the integration contract for the public Node/Express API. The
React application and external API clients must call Node at `/api`; they must
not call Firestore or the private FastAPI service directly.

## 1. Current contract status

| Status | Routes | Persistence | Safe for future frontend integration? |
| --- | --- | --- | --- |
| Current product | `/api/me`, `/api/superadmin/*`, `/api/site-map/*`, `/api/camera-creation/*`, `/api/monitoring/*`, `/api/cleaners`, `/api/cleaner/*`, `/api/work-orders`, `/api/alerts`, `/api/dashboard`, `/api/analytics`, `/api/bin-placement`, `/api/operations`, `/api/orchestrator` | Firebase Authentication, cloud Firestore, and local media | Yes |
| Protected media | `/api/media/:mediaId`, `/api/media/:mediaId/content`, `/api/media/:mediaId/overlay` | Authenticated Site-scoped local file delivery | Yes |
| Retired APIs | Former media intake, processing jobs, analysis/detection inspection, raw Flags/Issue Observations, unversioned dashboard/analytics, public System-event ledger, and `/api/cameras/{cameraId}/registration/*` | Internal services and persisted history retained | No; routes return 404 |
| Public health checks | `/api/health/live`, `/api/health/ready`, `/api/health` | None | Yes |

Private orchestrator-worker routes under `/internal/orchestrator/*` are not
Firebase-user APIs. They require the separately configured internal token and
worker ID described in section 15.1.

The former `/api/operations/*`, `/api/detections/pipeline/*`, and legacy image
detector routes are retired. The former unversioned Camera registration routes
are also retired. Camera setup and reconfiguration use `/api/camera-creation/*`.
New business services use the stable conventions below and remain
Node/Firestore-owned.

## 2. Common conventions

- Local base URL: `http://127.0.0.1:3000`
- Data format: JSON, except image/video uploads use `multipart/form-data`.
- Authentication: `Authorization: Bearer <Firebase ID token>` on every route
  except `/api/health`, `/api/health/live`, and `/api/health/ready`.
- Firebase ID tokens expire. Sign in again when the API returns `401` for an
  expired token.
- Firestore timestamps are returned as ISO 8601 strings or `null` while a
  just-written server timestamp is still unresolved.
- Normal deletion is soft deactivation. `DELETE` returns the preserved record
  with `status: "inactive"`.
- Collection responses use a named envelope such as `{ "sites": [] }`.
- Single-record responses use a named envelope such as `{ "site": {} }`.
- Successful creates return HTTP `201`; reads and updates return `200`.
- Unknown routes return `404 { "error": "Route not found." }`.

### Standard errors

```json
{
  "error": "Human-readable error message.",
  "requestId": "same value as the X-Request-ID response header"
}
```

Validation errors may also include `details`:

```json
{
  "error": "Invalid request.",
  "details": {
    "fieldErrors": {
      "name": ["Too small: expected string to have >=2 characters"]
    }
  }
}
```

Relevant statuses:

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid fields or inactive/missing parent assignment |
| `401` | Missing, invalid, revoked, or expired Firebase ID token |
| `403` | Valid Firebase user without an active role/profile or using a route for the other role |
| `404` | Record or route not found |
| `409` | Uniqueness conflict or blocked parent deactivation |
| `413` | Upload exceeds its route limit (10 MiB image; 250 MiB default video) |
| `415` | Unsupported image/video type or a genuine declared/content conflict |
| `429` | Authenticated user or route-specific request limit exceeded; inspect `Retry-After` |
| `500` | Unexpected Node failure |
| `502`/`503` | FastAPI failed or is unavailable |

## 3. Authentication and health

### Public health routes

- `GET /api/health/live` returns `200 { "status": "ok" }` when Node can answer
  HTTP. It does not claim dependency readiness.
- `GET /api/health/ready` and the compatibility alias `GET /api/health` return
  `200 { "status": "ok", "dependencies": { "aiInference": "ready" } }` or
  `503` with a generic degraded/unavailable value. Model paths, versions,
  devices, and errors are deliberately not public.

Every response carries `X-Request-ID`, Helmet security headers, and no
`X-Powered-By`. Browser origins are limited by `CORS_ORIGINS`; non-browser
clients are allowed. Authenticated responses also carry `RateLimit-Limit`,
`RateLimit-Remaining`, and `RateLimit-Reset`; `429` adds `Retry-After`.

### Firebase Email/Password sign-in

Authentication is performed by Firebase, not by a Node login route:

```http
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_WEB_API_KEY>
Content-Type: application/json

{
  "email": "supervisor@example.com",
  "password": "local-secret",
  "returnSecureToken": true
}
```

Use the returned `idToken` as the Node bearer token. The Web API key is the
`VITE_FIREBASE_API_KEY` value in the developer's untracked
`frontend/.env.local`. It is not the Firebase Admin service-account key.

### `GET /api/me`

Returns the active authenticated role without allowing the caller to choose a
role. Supervisor compatibility response:

```json
{
  "role": "supervisor",
  "supervisor": {
    "uid": "firebase-auth-uid",
    "email": "supervisor@example.com",
    "displayName": "Site Supervisor"
  }
}
```

An authenticated Cleaner receives `role: "cleaner"` and only their bounded
identity/permission context. The full Cleaner personnel self-profile is
`GET /api/cleaner/me`.

## 4. Sites

Site resource:

```json
{
  "id": "firestore-document-id",
  "name": "Batu Caves",
  "description": null,
  "timezone": "Asia/Kuala_Lumpur",
  "status": "active",
  "createdAt": "2026-08-12T10:00:00.000Z",
  "updatedAt": "2026-08-12T10:00:00.000Z"
}
```

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/sites?status=all` | List sites; status is `active`, `inactive`, or `all` |
| `GET` | `/api/sites/{siteId}` | Get one site |
| `POST` | `/api/sites` | Create an active site |
| `PATCH` | `/api/sites/{siteId}` | Edit or change status |
| `DELETE` | `/api/sites/{siteId}` | Soft-deactivate |

Create body:

```json
{
  "name": "Batu Caves",
  "description": "Prototype attraction site",
  "timezone": "Asia/Kuala_Lumpur"
}
```

Update fields: `name`, `description`, or `status`. At least one is required.
An active zone blocks site deactivation.

## 5. Zones

Zone resource:

```json
{
  "id": "firestore-document-id",
  "siteId": "parent-site-id",
  "siteName": "Batu Caves",
  "name": "Lower Main Staircase",
  "code": "LOWER_STAIRS",
  "description": null,
  "status": "active",
  "createdAt": "2026-08-12T10:01:00.000Z",
  "updatedAt": "2026-08-12T10:01:00.000Z"
}
```

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/zones?status=all&siteId={siteId}` | List/filter zones; default status is `active` |
| `GET` | `/api/zones/{zoneId}` | Get one zone |
| `POST` | `/api/zones` | Create under an active site |
| `PATCH` | `/api/zones/{zoneId}` | Edit or change status |
| `DELETE` | `/api/zones/{zoneId}` | Soft-deactivate |

Create body:

```json
{
  "siteId": "parent-site-id",
  "name": "Lower Main Staircase",
  "code": "LOWER_STAIRS",
  "description": null
}
```

Update fields: `name`, `code`, `description`, or `status`. An active camera or
active assigned cleaner blocks zone deactivation. Reactivation requires an
active parent site. There is intentionally no Area resource or `areaId` field.

## 6. Cameras

Camera resource:

```json
{
  "id": "firestore-document-id",
  "siteId": "parent-site-id",
  "siteName": "Batu Caves",
  "zoneId": "parent-zone-id",
  "zoneName": "Lower Main Staircase",
  "code": "CAMERA-1",
  "name": "Lower staircase view",
  "sourceMode": "upload",
  "status": "active",
  "availability": "unknown",
  "createdAt": "2026-08-12T10:02:00.000Z",
  "updatedAt": "2026-08-12T10:02:00.000Z"
}
```

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/cameras?status=all&siteId={siteId}&zoneId={zoneId}` | List/filter cameras |
| `GET` | `/api/cameras/{cameraId}` | Get one camera |
| `POST` | `/api/cameras` | Register under an active zone |
| `PATCH` | `/api/cameras/{cameraId}` | Rename, reassign, change source mode/status |
| `DELETE` | `/api/cameras/{cameraId}` | Soft-deactivate |

Create body:

```json
{
  "zoneId": "parent-zone-id",
  "code": "CAMERA-1",
  "name": "Lower staircase view",
  "sourceMode": "upload"
}
```

Camera codes must match `CAMERA-<positive integer>` and remain permanently
reserved after deactivation. Update fields are `zoneId`, `name`, `sourceMode`,
and `status`; camera code cannot be changed. Reactivation or reassignment
requires an active zone.

## 7. Cleaners

Cleaner resource:

```json
{
  "id": "firestore-document-id",
  "staffCode": "CLN-001",
  "fullName": "Aisyah Rahman",
  "phone": "+60 12-345 6789",
  "assignedSiteId": "site-id",
  "assignedZoneId": "zone-id",
  "assignedZoneName": "Lower Main Staircase",
  "status": "active",
  "notes": null,
  "createdAt": "2026-08-12T10:03:00.000Z",
  "updatedAt": "2026-08-12T10:03:00.000Z",
  "deactivatedAt": null
}
```

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/cleaners?status=all` | List cleaners |
| `GET` | `/api/cleaners/{cleanerId}` | Get one cleaner |
| `POST` | `/api/cleaners` | Create a personnel record |
| `PATCH` | `/api/cleaners/{cleanerId}` | Edit, reassign, or change status |
| `DELETE` | `/api/cleaners/{cleanerId}` | Soft-deactivate |

Create body:

```json
{
  "staffCode": "CLN-001",
  "fullName": "Aisyah Rahman",
  "phone": "+60 12-345 6789",
  "assignedZoneId": "zone-id",
  "notes": null
}
```

Staff codes match `CLN-` followed by at least three digits and remain reserved.
Update fields are `fullName`, `phone`, `assignedZoneId`, `notes`, and `status`.
The assigned zone must be active when creating, reassigning, or reactivating.

Cleaner records now also expose `authUid`, `email`, `accountStatus`,
`permittedSiteIds`, `permittedZoneIds`, `capabilities`, and `authLinkedAt`.
Permissions must include the assigned site/zone and every supplied site/zone
must be active and consistent. Capabilities are `general_cleaning`,
`floor_litter`, `bin_overflow`, or `floor_spill`.

Account provisioning routes are Supervisor-only:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/cleaners/{cleanerId}/account` | Idempotently reserve email, create/link deterministic Firebase Auth UID, activate `userAccounts`, and return a one-time password setup link |
| `POST` | `/api/cleaners/{cleanerId}/account/reconcile` | Resume a partial Auth/Firestore provisioning operation using the reserved email |
| `DELETE` | `/api/cleaners/{cleanerId}` | Soft-deactivate personnel record, role dispatch, and Firebase Auth identity; blocked while active work remains |

Provision body is `{ "email": "cleaner@example.com" }`. The setup link is a
credential: deliver it privately over HTTPS, never log/commit it, and do not
store it in Firestore. The Cleaner business document ID never changes and is
not replaced by the Auth UID. The former V1 Cleaner-account migration command
is retired. Current Cleaner records are created directly with the current
schema.

## 8. Cleaner mobile operations and Work

All `/api/cleaner/*` routes require a linked active Cleaner profile using the
current schema. V1 Cleaner profiles are rejected without auto-linking or
changing their records. Ownership always comes from the verified session.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/cleaner/me` | Current Cleaner profile, schedule, and availability |
| GET | `/api/cleaner/map` | Active geometry and only this Cleaner's Station Point |
| GET | `/api/cleaner/map/background` | Authenticated current Site background |
| GET | `/api/cleaner/work-orders` | Own active Work and bounded recent history |
| GET | `/api/cleaner/work-orders/:id` | Own Work detail |
| POST | `/api/cleaner/work-orders/:id/start` | Start assigned Work |
| POST | `/api/cleaner/work-orders/:id/ready-for-review` | Submit Work for verification |
| POST | `/api/cleaner/work-orders/:id/completion-evidence` | Upload required completion photo |
| GET | `/api/cleaner/work-orders/:id/completion-evidence` | Deliver own completion photo |
| GET | `/api/cleaner/work-orders/:id/camera-evidence` | Read assigned Alert evidence; `content=true` delivers its image |
| GET | `/api/cleaner/notifications` | Paginated recipient-scoped inbox |

Transitions retain semantic idempotency. Current Work uses `assigned`,
`in_progress`, `awaiting_review`, `resolved`, and `dismissed`.
Cleaner submission does not resolve Work. Manual Work requires completion
evidence and Supervisor review; automated review uses the current Orchestrator.
V1 accept/reject actions and GPS/presence, push-token, notification-read,
and old review contracts are retired. The final production database contains
no historical Cleaner location records.

Current Supervisor Work and verification routes are served by
`/api/work-orders`; current Orchestrator contracts are in section 15.1.

## 9. Protected media delivery

Media bytes remain on the Node host. Current routes are:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/media/:mediaId/content` | Authenticated local content with byte-range support |
| GET | `/api/media/:mediaId/overlay` | Exact evidence observation or null |
| GET | `/api/media/:mediaId` | Metadata without storage paths |

Camera reference/source uploads use `/api/camera-creation/drafts/:draftId`;
Cleaner evidence uses `/api/cleaner/work-orders/:workOrderId/completion-evidence`;
Site backgrounds use `/api/site-map/background`. Those workflows remain.
Standalone media intake, processing-job, and analysis-run APIs are retired.
Stored history, media, and internal startup recovery are not deleted.

## 10. Private AI inference boundary

Public Node bin-state testing adapters and standalone FastAPI model-test routes
are retired. Operational sampling uses the private frame contract below.

### Private FastAPI `POST /analyze/frame`

This endpoint is an internal Node-to-FastAPI contract, not a public application
API. It performs one stateless combined inference and never writes SQLite,
Firestore, media, jobs, flags, alerts, analytics, or evidence.

Multipart request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `file` | Yes | JPEG, PNG, or WebP; maximum 10 MiB |
| `floor_confidence` | No | Floor-hazard model threshold from `0.01` to `0.99`; default `0.25` |
| `localizer_confidence` | No | Bin-localizer threshold from `0.01` to `0.99`; configured default `0.80` |
| `focus_region` | No | JSON array of at least three normalized `{ x, y }` points; affects floor-hazard inference only |

When `INTERNAL_API_TOKEN` is configured, Node supplies it as
`x-internal-token`. The old `camera_id`, `confirmation_frames`, and
`persist_result` fields are not part of this contract.

The top-level response contains exactly:

```ts
{
  image: { width: number, height: number },
  focusRegion: Array<{ x: number, y: number }>,
  peopleCount: number,
  people: Array<{ confidence: number, bbox: BoundingBox }>,
  bins: Array<{
    binIndex: number,
    localizerConfidence: number,
    bbox: BoundingBox,
    classificationRegion: BoundingBox,
    state: "normal" | "full" | "overflow" | "unknown",
    stateConfidence: number,
    signals: { binPresence: number, fullness: number, overflow: number },
    unknownReasons: string[],
    processingTimeMs: number
  }>,
  floorHazards: Array<{
    className: "floor_litter" | "floor_spill",
    confidence: number,
    bbox: BoundingBox,
    polygon: Array<{ x: number, y: number }>
  }>,
  modelVersions: {
    floorHazard: string,
    people: string,
    binLocalizer: string,
    binState: string
  },
  processingTimeMs: number
}
```

`BoundingBox` contains numeric `x1`, `y1`, `x2`, and `y2` pixel coordinates.
The response deliberately has no analysis ID, image/camera identity, demo or
source type, flag, tracking/session field, or persistence control. Node supplies
trusted Site, Zone, Camera, registration, and sample context from the current
monitoring session. Node owns evidence persistence and all business decisions.

`focusRegion` is a JSON-encoded array supplied as a multipart text field:

```json
[{"x":0.1,"y":0.2},{"x":0.9,"y":0.2},{"x":0.9,"y":0.9},{"x":0.1,"y":0.9}]
```

## 11. Operational Alerts

Current Camera-scoped Alerts use the authenticated Site-isolated router:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/alerts` | Paginated and filtered ledger |
| GET | `/api/alerts/:alertId` | Detail and evidence |
| POST | `/api/alerts/:alertId/manual-assignment` | Assign an available Cleaner |
| POST | `/api/alerts/:alertId/dismiss` | Dismiss an unlinked Alert with reason and expected revision |
| POST | `/api/alerts/age` | Apply current Alert aging policy |

Statuses are `waiting_for_cleaner`, `assigned`, `in_progress`,
`awaiting_review`, `resolved`, and `dismissed`. Linked Work dismissal uses
the Work workflow. Former raw Flags and Issue Observation public APIs are
retired. Internal qualification and stored history remain.

## 12. Site dashboard

Use `GET /api/dashboard` and `POST /api/dashboard/refresh` for the
current dashboard. Section 16 documents the active dashboard/analytics
contracts. Former dashboard summary and reconcile APIs are retired.

## 13. Bin placement and analytics

Current analytics and bin-placement snapshots use `/api/analytics` and
`/api/bin-placement`, documented in section 16. Former analytics report,
CSV, and reconciliation public APIs are retired.
Their V1 report generator and bucket writer have been removed. Existing
historical records are not deleted by this code cleanup.

### Short-window bin replacement evaluation

The placement decision is a narrow, provisional zone-level recommendation. It
reads eligible `analysisRuns` from Firestore, ignores test runs, and persists
the current decision plus an immutable evaluation history under
`binReplacementRecommendations/{zoneId}`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/bin-replacement/{zoneId}/evaluate?windowMinutes=10` | Evaluate the latest 5–30 minute window and advance the Firestore hysteresis state |
| `GET` | `/api/bin-replacement/{zoneId}` | Read the last persisted recommendation |

The response includes score, bin/litter/spill/popularity signals, coverage,
unknown-state ratio, and raise/clear streaks. Raw one-frame overflow is not a
capacity trigger; stable/confirmed overflow is required. Insufficient coverage
preserves the previous recommendation. This endpoint does not claim a
rim-crossing overflow ground truth or dispatch a cleaner automatically.


## 14. System events and operational hardening

The current System page reads `GET /api/operations/system`. Its safe event,
configuration, backlog, and Run contracts are in section 16. The former public
`/api/system-events` ledger is retired. Internal dependency-event generation
remains used by frame inference and startup recovery. See
[the operations runbook](operations-runbook.md) for tests and recovery.

## 15. Retired legacy Orchestrator entry points

Legacy recovery, decision, and review endpoint shapes under
`/api/orchestrator/*` and `/internal/orchestrator/*` remain retired. Their
services have been removed. This cleanup does not delete stored Runs, Work,
review history, or Alerts. Use the current routes below for operational
assignment and review.

## 15.1 Orchestrator assignment and review

The LLM selects one Alert and Cleaner pair from a bounded Node-validated context. Node calculates priority, eligibility, Station Point distance and fresh Recent Work distance. Python never reads Firestore.

Supervisor routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/orchestrator/config` | Read configuration and health timestamps |
| `POST` | `/api/orchestrator/status` | Pause or resume with `{ "status": "running" | "paused", "reason": null }` |
| `GET` | `/api/orchestrator/runs?limit=50` | List Site-scoped Runs. Each Run includes display-safe `references` for its Alert, Cleaner, and Work when known. |
| `GET` | `/api/orchestrator/runs/{runId}` | Read Run, display-safe references, provider attempts, and Node tool actions. |
| `POST` | `/api/orchestrator/assignment-cycle` | Run one real provider-backed cycle |

Private routes require `X-Orchestrator-Token` and `X-Orchestrator-Worker-ID`:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/internal/orchestrator/assignment-runs` | Create a leased assignment Run |
| `GET` | `/internal/orchestrator/runs/{runId}/assignment-context?siteId={siteId}` | Return up to 10 waiting Alerts, available Cleaners and eligible pairs |
| `POST` | `/internal/orchestrator/runs/{runId}/assign-cleaner` | Validate and commit the selected pair |
| `POST` | `/internal/orchestrator/review-runs` | Create a leased deterministic review Run |
| `GET` | `/internal/orchestrator/runs/{runId}/review-context?siteId={siteId}&workOrderId={workOrderId}` | Read ready Verification outcome |
| `POST` | `/internal/orchestrator/runs/{runId}/resolve-verified-work` | Apply only a passed outcome |
| `POST` | `/internal/orchestrator/runs/{runId}/request-rework` | Apply only a failed outcome |

Assignment decision body:

```json
{
  "siteId": "sunway-theme-park",
  "alertId": "alert-id-from-context",
  "cleanerId": "cleaner-id-from-context",
  "rationaleSummary": "Short Supervisor-visible explanation."
}
```

The pair must appear in the current context and still pass the Work Order transaction. A stale selection returns `409`; it never bypasses Cleaner availability or Alert state.

The first assignment-context response is fixed to that Run and hashed. Re-reading it returns the same snapshot. Assignment and review commands are exactly replayable after completion when the body is unchanged; changed replay returns `409`. Only one assignment or review Run can be active for a Site.

Camera Verification is automatic but deterministic. Fresh ordered samples move the Verification to `ready` and enqueue `review_work`. The worker resolves passed Work, returns failed Work to the same Cleaner, and leaves inconclusive Work for Supervisor review. Pausing the Orchestrator blocks review mutation as well as assignment.

## 16. Current API contracts

### Analytics APIs

All routes require an active Site Supervisor and use the authenticated Site.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/dashboard` | `{ dashboard }`, one-minute cache |
| POST | `/api/dashboard/refresh` | `201 { dashboard }` |
| GET | `/api/analytics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ summaries }` |
| POST | `/api/analytics/daily/rebuild` | `{ summaries }`; supply `localDate` or array `dates`, never both |
| POST | `/api/analytics/minute/cleanup` | `{ deleted }`; expired minutes after daily preservation |
| GET | `/api/bin-placement/recommendations?days=30` | `{ snapshot }`; cheap cached read, refreshing when missing, expired, or the requested window changes |
| POST | `/api/bin-placement/recommendations/refresh` | `201 { snapshot }`; body `{ "days": 30 }` |
| POST | `/api/bin-placement/zones/:zoneId/implement` | `201 { intervention }` |
| GET | `/api/bin-placement/interventions` | `{ interventions }`, newest first |
| GET | `/api/bin-placement/interventions/:id/comparison?days=7` | `{ comparison }`, selected Zone only |

Ranges accept integer days from 2 to 3660, without fixed presets. Recommendations use completed local days. Fewer than two observed days produces `insufficient_data` and null score/rank. Enough observed days but fewer than requested produces `partial_data`.

Implementation body:

```json
{"snapshotCalculatedAt":"2026-08-31T02:00:00.000Z","note":"Optional installation note"}
```

Use the reviewed snapshot's timestamp. Stale snapshots, insufficient data and active exclusion return `409`. Identical implementation replay returns the existing Intervention. Exclusion spans two complete local calendar days, not 48 hours from a midday action.

Comparison sides include `requestedStart`, `requestedEnd`, `availableDays`, `partialDays`, `partial`, `missingDates` and `series`. Series rows contain local date, exact bounded period, `cleaningFrequency`, `binOverflowFrequency` and coverage details. Boundary-day events are split at the Intervention timestamp; missing days are not zero-filled. `availableDays` can be fractional for partial days.

See [the operations runbook](operations-runbook.md) for index deployment instructions.

The automatic worker finalizes only the previous Site-local day. Use the explicit daily rebuild endpoint for older repair dates. An array rebuild shares one Alert/Work history read across the batch. Firestore quota exhaustion returns `503` with `code: "firestore_quota_exceeded"`.

### Platform APIs

| Method | Route | Access and response |
| --- | --- | --- |
| GET | `/api/operations/system` | Supervisor's Site; configuration, runtime worker setting, backlog counts, recent control history, 20 recent Runs, and safe events |
| GET | `/api/operations/notifications?limit=50` | Supervisor's own inbox; `{ notifications }` |
| GET | `/api/cleaner/notifications?limit=50` | Cleaner's own inbox; `{ notifications }` |
| GET | `/api/cleaner/map` | Cleaner's active-map projection; `{ map }` containing dimensions, Zone polygons, and only that Cleaner's Station Point |
| GET | `/api/operations/audit-events` | Root's own Site only; `{ events }` |
| GET | `/api/superadmin/sites/:siteId/operations/:operationId` | Superadmin; `{ operation }` |
| POST | `/api/superadmin/sites/:siteId/operations/:operationId/reconcile` | Superadmin; processes one cleanup page and returns `{ operation }` |

Site-status mutation returns `site.operationId`. Deactivation immediately blocks Site access and schedules cleanup. Reactivation returns `409` until cleanup completes. It never reopens dismissed work. See [the operations runbook](operations-runbook.md) for automated tests and Firestore deployment commands.

Notifications are immutable; no read receipts or direct frontend writes are supported. Client Firestore queries must filter both `recipientUid` and `siteId` and sort by `createdAt desc`.

The System response separates process state from Site configuration:

- `configuration.status` is the Site's saved `running` or `paused` state;
- `runtime.backgroundWorkerEnabled` reports whether this Node process starts the Orchestrator worker;
- `runtime.providerConnectivity` stays `not_probed`; the endpoint does not call Ollama merely to paint the page;
- `runtime.backlog.waitingAlertCount` counts Alerts still waiting for a Cleaner;
- `runtime.backlog.awaitingReviewWorkOrderCount` counts Work awaiting review;
- `controlHistory` contains up to 20 recent pause/resume actions, newest first;
- `recentRuns` contains at most 20 Runs with display-safe references and retry/tool counts;
- `events` contains persisted safe fault summaries plus a response-only `orchestrator_worker_disabled` warning when configuration and process settings disagree.

`recentRuns[].references` is built from the Run's frozen input/result snapshot. Polling the System page does not fetch each referenced Alert, Cleaner, and Work document. Older failed review Runs created before this snapshot field was added can still have a null display name; their UUID remains available for diagnosis.

`GET /api/cleaner/map` deliberately excludes map drafts, Camera placements, and every other Cleaner's Station Point. A returned Station Point may have `zoneId: null` when it is in an unzoned but in-boundary part of the Site Map. Coordinate Work already carries its own target point; Camera-targeted Work is represented by its Camera reference until the live-monitoring integration is available.

### Site Map administration API

All routes require an active Site Supervisor. Mutations are Root-only except the narrow Cleaner Station Point route.

| Method | Route | Behaviour |
| --- | --- | --- |
| GET | `/api/site-map` | Active Site Map, user-defined boundary, coordinate convention, background metadata, Zones, Camera Placements, and Cleaner Station Points. |
| GET | `/api/site-map/draft` | Root only. Recover the Site's one editable draft, geometry, and authenticated background metadata. |
| GET | `/api/site-map/retired-zones` | Root only. List retired stable Zones that retain their last published name and geometry for restoration. |
| POST | `/api/site-map/draft/start` | Root only. Copies the active revision into a new draft and rejects a second concurrent draft. |
| POST | `/api/site-map/draft` | Root only. Saves one complete valid draft snapshot using `expectedRevision` concurrency. |
| POST | `/api/site-map/draft/validate` | Root only. Revalidates geometry, background ownership, and active Camera coverage, then records a success or failure audit. |
| POST | `/api/site-map/draft/publish` | Root only. Revalidates and atomically publishes the immutable replacement revision. |
| DELETE | `/api/site-map/draft` | Root only. Discards the draft without changing the active revision. |
| POST | `/api/site-map/background` | Root-only multipart `image`. Stores one Site-owned configuration image and returns its media ID, content URL, MIME type, width, and height. |
| POST | `/api/site-map/camera-placements/{cameraId}` | Root only. Publishes a confirmed same-Zone `map_position_correction`, or starts a `physical_camera_move` draft for an active or provisional destination Zone that must continue through fresh Camera Registration. The response is `{ placement }`. |
| PUT | `/api/site-map/station-points/{cleanerId}` | Root or Regular. Publishes one in-boundary Station Point; `zoneId` may be null. |

Site Map draft body:

```json
{
  "baseRevisionId": "active-revision-id",
  "expectedRevision": 1,
  "widthMeters": 2000,
  "heightMeters": 1200,
  "gridSizeMeters": 20,
  "backgroundMediaId": "site-background-media-id",
  "backgroundTransform": {
    "xMeters": 0,
    "yMeters": 0,
    "widthMeters": 1800,
    "heightMeters": 1200,
    "opacity": 1
  },
  "zones": [],
  "cameraPlacements": [],
  "cameraPlacementChanges": [],
  "cleanerStations": []
}
```

Background alignment must preserve the uploaded image aspect ratio. The coordinate convention is top-left origin, X right, and Y down. Resizing the Site boundary preserves every existing absolute metre coordinate and reports anything now outside the boundary.

Invalid Zone geometry returns `422` with `details.code=site_map_geometry_invalid`, flat `errors`, structured `issues`, and `zoneConflicts`. Active Zones cannot contain, overlap, cross, share edges or vertices, or touch at one point. Near but separate geometry is valid.

A changed Camera point inside a general Site Map draft requires `cameraPlacementChanges[]` with `mode=map_position_correction`, `confirmation=true`, and a reason. Physical movement cannot use this path.

Camera placement change body:

```json
{
  "point": { "xMeters": 640.25, "yMeters": 315.5 },
  "mode": "map_position_correction",
  "reason": "The original Site Map pin was measured incorrectly.",
  "expectedCameraRevision": 4,
  "expectedMapRevisionId": "active-revision-id",
  "confirmation": true
}
```

`map_position_correction` publishes a map-only replacement revision and retains Camera Registration. `physical_camera_move` requires monitoring to be disabled and returns `status=registration_required` with a protected Root-only Camera Draft. That draft cannot publish until a new reference and floor/bin Registration validate. Publication changes placement, source, and Registration atomically.

### Camera detail API

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/camera-creation/cameras/{cameraId}/detail` | `{ camera, currentAssignments, recentHistory, orchestratorTrace, auditEvents }` |
| GET | `/api/camera-creation/cameras/{cameraId}/draft` | `{ draft }`; returns the Camera's unfinished draft or `null`. A Physical Camera Move draft remains Root-only. |

The caller must be an active Supervisor for the Camera's Site. `camera` includes the active placement, runtime state, source, Registration, and active map revision. `currentAssignments` contains active Camera-targeted Work Orders. `recentHistory` combines Camera Alerts and Work Orders with status, Cleaner snapshot, time, and evidence media reference when one exists.

`orchestratorTrace` is a safe audit view of related assignment/review Runs. It includes the structured decision summary, decision factors, selected Cleaner, provider/model identifiers, result, error code, and timestamps. It deliberately excludes raw provider output, internal tool input, and assignment context snapshots. `auditEvents` supplies related Supervisor/system audit entries.

### Camera registration lifecycle

Camera Creation and `POST /api/site-map/camera-placements/{cameraId}` for a Physical Camera Move may include a `provisionalZone` alongside the Camera placement. The backend validates that Zone against the active Site Map, stores it only in the Camera Draft, and accepts the Camera point only when it falls inside exactly that active or provisional Zone.

`POST /api/camera-creation/drafts/{draftId}/publish` publishes a provisional Zone, Camera placement, source and Registration in one transaction. The active Site Map does not change before this call.

`DELETE /api/camera-creation/drafts/{draftId}` cancels unfinished registration. It deletes the Camera Draft and its draft-owned reference/source media. A provisional Zone inside that draft is never published.

### Development-only simulated Alerts

`POST /api/test-support/alerts` requires a Root Supervisor bearer token and is rejected in production-cloud mode. Site identity comes from the authenticated account.

```json
{
  "cameraId": "existing-active-camera-id",
  "issueType": "floor_litter",
  "condition": "litter",
  "severity": "warning",
  "confidence": 0.99,
  "clientRequestId": "phase9-fake-alert-001"
}
```

Returns `201 { alert, flag, idempotent }`. Same input replays the same Alert. Changed input with the same request identity or another active Alert for that Camera/issue returns `409`. The response has no evidence image. This creates real development workflow data and queues automatic assignment; it does not run inference or fabricate verification evidence.

### Integration boundary

Until the React structure is stable, new modules are backend-first:

1. define/update this contract;
2. implement Node/Firebase/FastAPI ownership;
3. add automated tests;
4. integrate React against the stable contract.

The current React application uses the Site-scoped dashboard, analytics, and
bin-placement contracts documented in section 16.
# Camera monitoring redesign endpoints, 2026-09-05

These endpoints require a Supervisor Bearer token. Cleaner accounts cannot own monitoring.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/monitoring/live/config` | Camera source settings, playback generation, and current runtime; no lease secrets. |
| GET | `/api/monitoring/live/events` | Authenticated SSE with `control`, `workflow`, and `observation` events. Observation and exact frame data URL are paired. Reconnect after the 50-second connection lifetime. |
| PATCH | `/api/camera-creation/cameras/:cameraId/monitoring` | `{monitoringEnabled, expectedRevision}`; returns the new revision. Laptop conflicts return 409 with the conflicting Camera ID/name. |
| POST | `/api/camera-creation/cameras/:cameraId/deactivate` | Root only; `{expectedRevision}`; disables and structurally deactivates the Camera. |
| POST | `/api/camera-creation/cameras/:cameraId/remove` | Root only; `{reason, confirmation:true, expectedCameraRevision, expectedMapRevisionId, idempotencyKey}`; removes the Camera from active Site operations and the replacement Active Map Revision while preserving published history. |
| POST | `/api/monitoring/sessions/:sessionId/cameras/:cameraId/stop` | Owner token in `x-monitoring-token`; body `{episodeId, reason}`. Stops only this episode. |
| GET | `/api/media/:mediaId/overlay` | Same-Site retained `observation`, or null for older/non-evidence media. |
| GET | `/api/cleaner/work-orders/:workOrderId/camera-evidence` | Assigned Cleaner only; linked Alert Evidence. Add `?content=true` for the image bytes. |
| GET | `/api/development/cameras/:cameraId/scenes` | Development scene list. |
| POST | `/api/development/cameras/:cameraId/scenes/:key` | Multipart `video`; creates an immutable scene with exact Registration dimensions. |
| POST | `/api/development/cameras/:cameraId/scenes/:key/select` | Select scene without resetting monitoring or workflow state. |

Development scene routes also require `CAMERA_DEMO_SCENES_ENABLED=true` and a development application environment. Source scene selection controls do not appear in the product UI.

Sample requests retain their existing multipart contract and accept optional `sourceTimeSeconds` and integer `playbackGeneration`. Successful responses include `nextSequence` and queue diagnostics. Overload returns 429 before consuming a sequence. A client recovering an ambiguous response may repeat episode start to obtain the authoritative next sequence without resetting the active episode.

The single Node prototype owns live leases, heartbeat expiry, episode sequence, current runtime freshness, rolling qualification, candidate evidence, and partial Camera Verification samples in memory. Session claim/release and Episode start/end remain durable transition records. After the first accepted frame changes a Camera to online, an ordinary frame performs no Firestore read or write. A continuing confirmed issue also remains transient until its condition materially changes. Live configuration and Camera list routes reuse a Site snapshot until Camera, scene, or map configuration changes.
