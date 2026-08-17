# LitterSpot Node API reference

Last updated: 2026-08-17

This document is the integration contract for the public Node/Express API. The
React application and external API clients must call Node at `/api`; they must
not call Firestore or the private FastAPI service directly.

## 1. Current contract status

| Status | Routes | Persistence | Safe for future frontend integration? |
| --- | --- | --- | --- |
| Stable foundation | `/api/me`, `/api/sites`, `/api/zones`, `/api/cameras`, `/api/cleaners`, `/api/cleaner/*`, `/api/work-orders`, `/api/media`, `/api/processing-jobs`, `/api/analysis-runs`, `GET /api/detections*`, `/api/issue-observations`, `/api/flags`, `/api/alerts`, `/api/dashboard`, `/api/analytics`, `/api/system-events` | Firebase Authentication, cloud Firestore, FCM, and Node-owned local media storage | Yes |
| AI model-test adapter | `POST /api/detections/bin-state`, `POST /api/detections/bin-state/batch` | Private FastAPI inference only; no application persistence | Use only for isolated model testing; the operational workflow uses processing jobs |
| Public health checks | `/api/health/live`, `/api/health/ready` (`/api/health` is a readiness alias) | None | Yes |

The former `/api/operations/*`, `/api/detections/pipeline/*`, and legacy image
detector routes are retired. New business services use the stable conventions
below and remain Node/Firestore-owned.

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
not replaced by the Auth UID. Existing records are upgraded idempotently with:

```bash
npm --workspace=backend run migrate:cleaner-accounts -- --dry-run
npm --workspace=backend run migrate:cleaner-accounts -- --execute
```

## 8. Cleaner mobile operations and work orders

All `/api/cleaner/*` routes require a linked, active Cleaner Firebase token.
They never accept a Cleaner ID from the browser to choose ownership.

### Cleaner presence and location

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/cleaner/me` | Authenticated Cleaner personnel self-profile |
| `GET` | `/api/cleaner/presence` | Own availability, active work, consent, last measurement, and derived freshness |
| `PUT` | `/api/cleaner/presence` | Set online/break/offline and optionally submit an idempotent consented location heartbeat |
| `GET` | `/api/cleaners/{cleanerId}/presence` | Supervisor view of one Cleaner presence |
| `GET` | `/api/cleaners/{cleanerId}/locations?limit=25&cursor={cursor}` | Supervisor-only seven-day bounded location history |

Location payload:

```json
{
  "availability": "online",
  "locationConsent": true,
  "clientHeartbeatId": "mobile-heartbeat-001",
  "location": {
    "latitude": 3.2379,
    "longitude": 101.684,
    "accuracyMeters": 15,
    "capturedAt": "2026-08-18T00:00:00.000Z",
    "source": "browser_geolocation"
  }
}
```

`clientHeartbeatId` is required with location and conflicts with different
measurement content. `busy` is system-owned. Freshness is five minutes and is
derived at read time; an old measurement is labelled `stale`, never live.
Disabling consent clears the presence read-model location. Detailed history
has `retentionExpiresAt` and the privacy cleanup is dry-run-first:

```bash
npm --workspace=backend run location:retention -- --dry-run
npm --workspace=backend run location:retention -- --execute
```

### Work orders

One active work-order key is allowed per alert, and one primary Cleaner is
assigned per work order. Creating/assigning requires an active Phase 4 alert,
linked active Cleaner, site/zone permission, capability, no other active work,
and a fresh online heartbeat unless the Supervisor explicitly records an
availability override.

| Method | Route | Role | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/work-orders` | Supervisor | Create one assigned work order and durable notification |
| `GET` | `/api/work-orders?status=active&alertId={id}&cleanerId={id}&limit=25&cursor={cursor}` | Supervisor | Bounded newest-first list; use at most one ownership filter |
| `GET` | `/api/work-orders/{id}` | Supervisor | Work-order detail |
| `GET` | `/api/work-orders/{id}/history` | Supervisor | Immutable newest-first status history |
| `POST` | `/api/work-orders/{id}/reassign` | Supervisor | Reassign assigned/rejected work to a different eligible Cleaner |
| `PATCH` | `/api/work-orders/{id}/status` | Supervisor | Manual accept/start/review/rework/completion/cancellation override |
| `GET` | `/api/cleaner/work-orders` | Cleaner | Only the authenticated Cleaner queue/history |
| `GET` | `/api/cleaner/work-orders/{id}` | Cleaner | Own work-order detail only |
| `POST` | `/api/cleaner/work-orders/{id}/accept` | Cleaner | `assigned -> accepted` |
| `POST` | `/api/cleaner/work-orders/{id}/reject` | Cleaner | `assigned -> rejected` |
| `POST` | `/api/cleaner/work-orders/{id}/start` | Cleaner | `accepted/rework_required -> in_progress` |
| `POST` | `/api/cleaner/work-orders/{id}/ready-for-review` | Cleaner | `in_progress -> ready_for_review` |

Create body:

```json
{
  "alertId": "alert-id",
  "assignedCleanerId": "cleaner-business-id",
  "instructions": "Clean the lower staircase and submit for review.",
  "assignmentDecisionId": "manual-or-future-agent-decision-id",
  "idempotencyKey": "work-order-request-001",
  "overrideAvailability": false
}
```

The work-order lifecycle is:

```text
assigned -> accepted -> in_progress -> ready_for_review -> completed
    |                         ^                |
    -> rejected -> reassign  |                -> rework_required
                              +------------------------
active state -> cancelled (Supervisor override)
```

Every create, reassignment, and transition has semantic idempotency. Reusing a
key with different content returns `409`. Rejection releases the Cleaner but
keeps the alert's active work record for reassignment. Completion/cancellation
releases both Cleaner and active key. Phase 11 manual completion does not yet
resolve the Phase 4 alert; Phase 14 will require automated evidence review.

### Notifications and FCM

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/cleaner/notifications?status=unread&limit=25&cursor={cursor}` | Own durable inbox; unread includes pending/sent/failed push delivery |
| `POST` | `/api/cleaner/notifications/{id}/read` | Idempotently mark own notification read |
| `PUT` | `/api/cleaner/push-token` | Register/update one FCM web token by stable device ID |
| `DELETE` | `/api/cleaner/push-token/{deviceId}` | Invalidate that Cleaner device token |

Work assignment, reassignment, rework, and cancellation create deterministic
Firestore notifications inside the business transaction. FCM happens only
after commit and is best-effort. No token or push failure leaves a visible
`failed` in-app notification rather than losing the instruction.

## 9. Media assets and processing jobs

These stable routes implement authenticated, Camera-linked image and video
intake. Node generates every storage key, stores media bytes under the configured
local media root, and writes metadata—not bytes or absolute paths—to Firestore.

### `POST /api/media/images`

Multipart fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image` | Yes | JPEG, PNG, or WebP; maximum 10 MiB |
| `cameraId` | Yes | Firestore document ID of an active Camera |
| `clientRequestId` | Yes | 8–128 safe characters; idempotency key scoped to the Supervisor |
| `isTest` | No | Defaults to `true`; `false` makes the job analytics-eligible |
| `capturedAt` | No | ISO 8601 timestamp with offset; defaults to upload time |
| `floorConfidence` | No | `0.01`–`0.99` future inference option |
| `binLocalizerConfidence` | No | `0.01`–`0.99` future inference option |
| `focusRegion` | No | JSON-encoded normalized polygon with at least three points |

Node verifies the file signature instead of trusting only the supplied MIME
type. Generic `application/octet-stream` declarations from clients such as
Postman are accepted after the bytes identify a supported image; an explicit
but incorrect image MIME type is rejected. Browser filenames are retained only
as cleaned display metadata.

Create response (`201`):

```json
{
  "media": {
    "id": "media-document-id",
    "kind": "original_upload",
    "sourceType": "image_upload",
    "originalFileName": "staircase.jpg",
    "storageStatus": "available",
    "mimeType": "image/jpeg",
    "byteSize": 123456,
    "sha256": "hex-digest",
    "siteId": "site-id",
    "zoneId": "zone-id",
    "cameraId": "camera-id",
    "isTest": true,
    "contentUrl": "/api/media/media-document-id/content"
  },
  "job": {
    "id": "deterministic-job-id",
    "type": "image",
    "status": "queued",
    "sourceMediaId": "media-document-id",
    "analyticsEligible": false,
    "isTest": true,
    "clientRequestId": "manual-upload-001"
  },
  "idempotent": false
}
```

Sending the same file, processing options, and `clientRequestId` again returns
the original media/job with HTTP `200` and `idempotent: true`; it does not store
a duplicate file. Reusing the key with a different image, Camera, capture time,
test mode, focus polygon, or confidence option returns `409`.

### `POST /api/media/videos`

Multipart fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `video` | Yes | Genuine MP4 or WebM; default maximum 250 MiB and 600 seconds |
| `cameraId` | Yes | Firestore document ID of an active Camera |
| `clientRequestId` | Yes | 8–128 safe characters; idempotency key scoped to the Supervisor |
| `isTest` | No | Defaults to `true`; `false` makes every successful frame analytics-eligible |
| `capturedAt` | No | ISO 8601 timestamp with offset for the start of capture; defaults to upload time |
| `frameIntervalSeconds` | No | Sampling interval from `1`–`10`; defaults to `2` |
| `floorConfidence` | No | `0.01`–`0.99`; defaults to the frame-inference value |
| `binLocalizerConfidence` | No | `0.01`–`0.99`; defaults to the frame-inference value |
| `focusRegion` | No | JSON-encoded normalized floor polygon with at least three points |

The server streams the multipart upload to a temporary file instead of holding
the full video in memory. It checks the MP4/WebM signature, accepts only
compatible declared types (including safe Postman binary/MP4 aliases), rejects
a genuine MP4/WebM conflict, and uses ffprobe to verify that the container has
a valid video stream, duration, and dimensions. `ffmpeg` and `ffprobe` must be on
PATH, or `FFMPEG_PATH` and `FFPROBE_PATH` must point to the executables.

The default limits are configurable with `VIDEO_MAX_BYTES` (250 MiB),
`VIDEO_MAX_DURATION_SECONDS` (600), `VIDEO_FRAME_INTERVAL_SECONDS` (2), and
`VIDEO_MAX_FRAMES` (300). The number of planned frames is
`min(maximumFrames, ceil(duration / interval))`, with at least one frame.

The response has the same `{ media, job, idempotent }` envelope as image upload.
The media record additionally exposes `width`, `height`, and `durationSeconds`;
the job has `type: "video"`, `sourceType: "video_upload"`, a frame plan, and
initial status `queued` after local storage succeeds. HTTP `201` means the
upload was created. Re-sending the same file and `clientRequestId` returns the
original records with HTTP `200` and `idempotent: true`. Reusing that key with a
different video file or Camera returns `409`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/media?cameraId={cameraId}&isTest=true&limit=25` | List media metadata |
| `GET` | `/api/media/{mediaId}` | Get one metadata record |
| `GET` | `/api/media/{mediaId}/content` | Authenticated media bytes; marks missing files in Firestore and returns `410` |
| `GET` | `/api/processing-jobs?status=all&limit=25` | List jobs; status may be `uploading`, `queued`, `processing`, `completed`, `failed`, or `cancelled` |
| `GET` | `/api/processing-jobs/{jobId}` | Get one job and progress/summary/error state |
| `POST` | `/api/processing-jobs/{jobId}/process` | Process an image synchronously, or enqueue a video and return `202` |
| `POST` | `/api/processing-jobs/{jobId}/retry` | Retry a failed image synchronously, or enqueue a failed video and return `202`; every other state returns `409` |
| `GET` | `/api/analysis-runs?jobId={jobId}&cameraId={cameraId}&limit=25&cursor={cursor}` | List analysis runs newest first, with at most one supplied filter and opaque cursor continuation |
| `GET` | `/api/analysis-runs/{analysisRunId}` | Get people count, bin observations, issues, model versions, and processing metadata |
| `POST` | `/api/analysis-runs/{analysisRunId}/evaluate-alerts` | Idempotently replay grouped observation and alert-policy evaluation for a compatible run |
| `GET` | `/api/detections?analysisRunId={runId}&jobId={jobId}&cameraId={cameraId}&issueType={type}&limit=25` | List stored issue detections; the service applies the first supplied ownership filter |
| `GET` | `/api/detections/{detectionId}` | Get one stored issue detection |

Image processing is synchronous: the HTTP request remains open while FastAPI
runs the models. Node claims the job with a two-minute lease, calls the
stateless private frame endpoint, normalizes pixel coordinates, writes the
analysis run and raw issue detections, evaluates the grouped temporal alert
workflow, and then completes the job. A failed call marks the job `failed`;
deterministic run, observation, and flag identifiers make an interrupted
evaluation safe to replay.

The process/retry response is intentionally compact:

```json
{
  "job": {
    "id": "job-id",
    "status": "completed",
    "attemptCount": 1,
    "analysisRunId": "job-id",
    "progress": { "plannedFrames": 1, "processedFrames": 1, "successfulFrames": 1, "failedFrames": 0, "lastFrameIndex": 0 },
    "summary": { "analysisRunCount": 1, "detectionCount": 2, "flagCount": 0, "alertIds": [] },
    "error": null,
    "startedAt": "2026-08-12T01:00:00.000Z",
    "completedAt": "2026-08-12T01:00:01.000Z"
  },
  "result": {
    "analysisRunId": "job-id",
    "evidenceMediaId": "media-id",
    "evidenceContentUrl": "/api/media/media-id/content",
    "siteId": "site-id",
    "zoneId": "zone-id",
    "cameraId": "camera-id",
    "peopleCount": 0,
    "issueKinds": ["floor_litter"],
    "issueCounts": { "floorLitter": 2, "binOverflow": 0, "floorSpill": 0 },
    "detectionCount": 2,
    "detectionIds": ["detection-id-1", "detection-id-2"],
    "processingTimeMs": 408.4
  },
  "alreadyCompleted": false
}
```

`summary.flagCount` counts grouped positive flags for this analysis run, not raw
detection boxes. `summary.alertIds` contains only active alerts created or
attached by this run; it remains empty while a positive sequence is awaiting
temporal confirmation.

### Asynchronous video processing

Uploading a video only creates a queued job. Start it explicitly:

```http
POST /api/processing-jobs/{videoJobId}/process
Authorization: Bearer <Firebase ID token>
```

The response is HTTP `202`:

```json
{
  "processingJob": {
    "id": "video-job-id",
    "type": "video",
    "status": "queued",
    "sourceMediaId": "video-media-id",
    "isTest": true,
    "analyticsEligible": false,
    "progress": {
      "plannedFrames": 4,
      "processedFrames": 0,
      "successfulFrames": 0,
      "failedFrames": 0,
      "lastFrameIndex": null
    }
  },
  "enqueued": true
}
```

`enqueued: false` means that this Node process already has the job queued; it is
not a second job. Poll `GET /api/processing-jobs/{videoJobId}` until the status
is `completed` or `failed`. A completed job may still report some failed frames
when at least one frame succeeded. The `summary` accumulates analysis-run,
detection, and grouped-flag counts plus distinct alert IDs across successful frames.
Use `GET /api/analysis-runs?jobId={videoJobId}` to retrieve each successful
frame run and its `frameMediaId`/`videoOffsetSeconds`; use the existing detection
and issue-observation APIs for details.

Node processes video frames sequentially in an in-process concurrency-one
worker. Each frame is extracted as a bounded JPEG with ffmpeg, inferred by the
private FastAPI frame endpoint, stored as an `extracted_frame` media asset, and
evaluated by Node's `grouped-temporal-v2` policy. Python inference messages do
not become business flags. Per-video bin tracking provides stable diagnostic
entity IDs across nearby frames, while the authoritative issue confirmation and
active-alert deduplication remain Node business rules.

Frame media and analysis-run IDs are deterministic from job ID plus frame
index. Progress, the bin-tracking checkpoint, and whether a persisted frame has
already been applied to the job summary are saved in Firestore. A retry resumes
after the last applied frame and does not intentionally duplicate runs, grouped
flags, occurrences, alerts, or counts. Non-fatal frame extraction/validation
errors are recorded and processing continues; an inference-service failure or
a video with no successful frames fails the job. `POST .../retry` accepts only
a failed video job, resets it to queued, enqueues it, and returns HTTP `202`.

The server recovers queued jobs and processing jobs with expired leases on
startup. It also reconciles the short-lived internal `uploading` state after an
interrupted local-file move. This queue is process-local and intended for the
single-Node prototype; multi-instance deployment requires a persistent external
queue. Closing Postman or a browser does not stop a job once Node has started it,
but shutting Node down pauses work until startup recovery.

Test video frames behave exactly like test images for business policy: Node
stores inference results and scored grouped observations, but does not update
confirmation buffers, create flags or alerts, or make them analytics-eligible.
Operational video requires explicit `isTest=false` at upload time.

### Persisted analysis results

For images, the analysis-run ID equals the job ID. Detection IDs are deterministic,
so retries cannot create duplicate logical results. People count and person
boxes are embedded in the analysis run and are analytics-only. Only
`floor_litter`, `floor_spill`, and `bin_overflow` become raw detection
documents; normal/full/unknown bin observations remain embedded. The original
upload is the current evidence media reference. Successful processing also
creates one grouped issue observation for each of those three issue types,
including negative observations when the run has no matching detections.

Node caps segmentation polygons at 128 evenly distributed points before new
detections are stored. Detection list responses omit `polygonNormalized`
entirely; `GET /api/detections/{detectionId}` returns the capped polygon. This
read-time cap also keeps older, already-stored dense masks out of public API
responses. FastAPI returns no business flags; Node derives grouped observations,
flags, and alerts from validated inference data. Each analysis/detection also
provides an authenticated `evidenceContentUrl`.

New detections briefly use `qualificationStatus: "pending_evaluation"` while
the grouped policy is running. Completed operational processing changes them to
`qualified` or `rejected`; completed test processing changes them to
`excluded`. A rejected raw detection remains queryable and can still contribute
to model review even though it did not produce a positive issue group.

The API deliberately omits `storageKey` and every absolute local path. The
current list routes are prototype-bounded to 100 Firestore records and return at
most the requested limit; cursor pagination will be added when necessary.

## 10. AI inference boundary and model-test adapters

The two authenticated Node adapters below proxy multipart images to the private
classifier endpoints. They are useful for isolated model testing, but bypass
the stable media/job/Firestore workflow and persist no application records.

All images must be JPEG, PNG, or WebP and no larger than 10 MiB.

| Method | Route | Multipart fields | Current purpose |
| --- | --- | --- | --- |
| `POST` | `/api/detections/bin-state` | `image`; optional `cameraId` + `binId`, `autoLocate`, ROI coordinates, `confirmationFrames` | Classify one bin region |
| `POST` | `/api/detections/bin-state/batch` | Up to 10 `images`; optional `localizerConfidence`, `maxBins`, `confirmationFrames` | Find/classify bins in images |

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
trusted site/zone/camera context from the processing job, generates application
IDs, performs video identity tracking, and owns all business decisions.

`focusRegion` is a JSON-encoded array supplied as a multipart text field:

```json
[{"x":0.1,"y":0.2},{"x":0.9,"y":0.2},{"x":0.9,"y":0.9},{"x":0.1,"y":0.9}]
```

## 11. Flags and alerts

The current workflow is `grouped-temporal-v2`, with policy version
`cleanliness-v2`. Raw detections remain available, but workflow decisions are
made per analysis run and issue type:

1. Node creates exactly one deterministic issue observation for each of floor
   litter, floor spill, and bin overflow, even when the result is negative.
2. A positive group creates at most one deterministic flag containing the
   contributing detection IDs and group metrics. A negative group creates no
   flag.
3. Operational observations update an independent rolling sequence for their
   camera and issue type. Only a confirmed sequence creates an alert.
4. Confirmed positive flags create or attach to the single active alert for the
   cleaning zone and issue type.

The provisional policy is available at `GET /api/alerts/policy`:

| Issue | Positive group rule | Temporal confirmation per camera | Critical rule |
| --- | --- | --- | --- |
| Floor litter | Detection confidence at least `0.50` and grouped magnitude at least `0.40` | At least 3 positive observations in the latest 5 within 30 minutes | Magnitude at least `0.75` |
| Floor spill | Detection confidence at least `0.50` | 2 consecutive positive observations within 10 minutes | Maximum confidence at least `0.75` |
| Bin overflow | Detection confidence at least `0.50` | At least 2 positive observations in the latest 3 within 15 minutes | Maximum confidence at least `0.75` |

Floor-litter magnitude combines merged regions, approximate coverage, and
spatial distribution. These centralized values are business-policy
calibration parameters, not model-training thresholds. They are provisional
and should remain configurable as real attraction data becomes available.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/analysis-runs/{analysisRunId}/evaluate-alerts` | Idempotently replay qualification/alert handling for pending or interrupted work |
| `GET` | `/api/issue-observations?analysisRunId={id}&cameraId={id}&issueType={type}&positive=true&limit=25` | List positive and negative grouped observations; the service applies the first supplied ownership filter |
| `GET` | `/api/issue-observations/{observationId}` | Get group metrics, policy result, temporal result, and traceability |
| `GET` | `/api/flags?analysisRunId={id}&detectionId={id}&alertId={id}&workflow=current&limit=25` | List grouped positive flags using the first supplied ownership filter and workflow scope |
| `GET` | `/api/flags/{flagId}` | Get flag-to-observation/detections-to-alert traceability |
| `GET` | `/api/alerts/policy` | Get the current provisional policy |
| `GET` | `/api/alerts?status=all&issueType={type}&severity={severity}&siteId={id}&zoneId={id}&cameraId={id}&workflow=current&limit=25` | List alerts with filters and workflow scope |
| `GET` | `/api/alerts/{alertId}` | Get the alert plus status history and occurrences |
| `GET` | `/api/alerts/{alertId}/history` | Get chronological append-only status history |
| `GET` | `/api/alerts/{alertId}/occurrences` | Get qualifying detections/evidence attached to the incident |
| `PATCH` | `/api/alerts/{alertId}/status` | Move status forward with optional Supervisor note |

Status body:

```json
{ "status": "in_progress", "note": "Cleaning team dispatched" }
```

Statuses are lowercase API values: `new`, `acknowledged`, `in_progress`, and
`resolved`. Stages may be skipped forward. Same-status, backward, and reopen
requests return `409`. Every successful update and the system-created `new`
state are recorded in status history with actor snapshots.

Flag and alert list routes default `workflow` to `current`, meaning documents
whose `workflowVersion` is exactly `grouped-temporal-v2`. Use
`workflow=legacy` to inspect documents with another or missing workflow version,
or `workflow=all` to disable workflow filtering. These options affect list
routes only; detail endpoints retrieve the requested ID directly.

One active alert is guaranteed per `zoneId + issueType` through a deterministic
Firestore key document. Once an alert is active, later positive groups in that
zone create grouped flags and occurrences on the same alert, update latest
evidence/confidence, and may escalate severity to critical. Negative
observations update the relevant camera sequence but neither attach to nor
resolve an alert.

Resolving an alert atomically releases the active key and advances the
zone-and-issue reset generation. Earlier confirmation history cannot create or
attach to the later incident: a new alert requires a fresh qualifying temporal
sequence after resolution. Phase 11 also blocks `resolved` while the alert has
an active work-order key; complete or cancel that work first. Cleaner
`ready_for_review` never resolves the alert by itself.

Test uploads still calculate and persist grouped metrics so the policy can be
inspected, but their observations have temporal status `excluded`; they create
no flags, update no confirmation state, create/attach to no alerts, and remain
excluded from analytics. Consequently a completed test job normally reports
`flagCount: 0` and `alertIds: []` even if its raw detections are positive.

## 12. Site dashboard

The Phase 5 dashboard backend is authenticated and site-scoped. It is a stable
backend contract, but the existing React operations console has intentionally
not been migrated to it yet.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard?siteId={siteId}&alertLimit=10&detectionLimit=10&failedJobLimit=10` | Build the live site dashboard DTO from authoritative Firestore records |
| `GET` | `/api/dashboard/summary?siteId={siteId}` | Read the latest reconciled compact site summary |
| `POST` | `/api/dashboard/reconcile` | Rebuild and overwrite the compact site summary from authoritative collections |

`siteId` is required. Each list limit defaults to `10` and accepts `1`–`50`.
The full dashboard returns `404` when the site does not exist. Summary retrieval
also returns `404` until that site has been reconciled at least once.

Reconcile body:

```json
{ "siteId": "site-document-id" }
```

### Full dashboard DTO

`GET /api/dashboard` returns the following stable envelope. Timestamps are ISO
8601 strings or `null`; the notation below shows field types compactly.

```ts
{
  dashboard: {
    contractVersion: "site-dashboard-v1",
    workflowVersion: "grouped-temporal-v2",
    generatedAt: string,
    site: {
      id: string,
      name: string | null,
      timezone: string,
      status: string | null
    },
    summary: {
      configuredCameraCount: number,
      activeCameraCount: number,
      availableCameraCount: number,
      unavailableCameraCount: number,
      unknownCameraCount: number,
      activeAlertCounts: {
        new: number,
        acknowledged: number,
        inProgress: number,
        total: number
      },
      latestDetectionAt: string | null,
      latestJobFailureAt: string | null
    },
    cameras: Array<{
      id: string,
      zoneId: string | null,
      zoneName: string | null,
      code: string | null,
      name: string | null,
      status: string | null,
      availability: string,
      sourceMode: string | null,
      latestAnalysisRunId: string | null,
      latestAnalysisAt: string | null,
      latestRun: null | {
        id: string,
        sourceType: string | null,
        capturedAt: string | null,
        peopleCount: number,
        issueKinds: string[],
        issueCounts: object,
        image: object,
        processingTimeMs: number,
        evidenceMediaId: string | null,
        evidenceContentUrl: string | null,
        isTest: boolean,
        alertWorkflowVersion: string | null,
        alertEvaluationStatus: string | null
      }
    }>,
    activeAlerts: Array<{
      id: string,
      workflowVersion: string | null,
      siteId: string | null,
      zoneId: string | null,
      zoneName: string | null,
      issueType: string | null,
      severity: string | null,
      status: string | null,
      cameraIds: string[],
      triggerCameraId: string | null,
      latestCameraId: string | null,
      occurrenceCount: number,
      firstDetectedAt: string | null,
      lastDetectedAt: string | null,
      latestConfidence: number,
      latestMagnitudeScore: number | null,
      latestEvidenceMediaId: string | null,
      latestEvidenceContentUrl: string | null
    }>,
    recentDetections: Array<{
      id: string,
      analysisRunId: string | null,
      zoneId: string | null,
      zoneName: string | null,
      cameraId: string | null,
      cameraCode: string | null,
      cameraName: string | null,
      issueType: string | null,
      confidence: number,
      capturedAt: string | null,
      qualificationStatus: string | null,
      qualifiedForFlag: boolean | null,
      observationId: string | null,
      flagId: string | null,
      isTest: boolean,
      evidenceMediaId: string | null,
      evidenceContentUrl: string | null,
      detailUrl: string
    }>,
    recentFailedJobs: Array<{
      id: string,
      type: string | null,
      status: string | null,
      sourceType: string | null,
      zoneId: string | null,
      cameraId: string | null,
      sourceMediaId: string | null,
      requestedAt: string | null,
      completedAt: string | null,
      attemptCount: number,
      isTest: boolean,
      analyticsEligible: boolean,
      error: {
        code: string | null,
        message: string | null,
        occurredAt: string | null
      }
    }>,
    completeness: {
      activeAlerts: "complete" | "more_available",
      configuredCameras: "complete" | "bounded_source_scan",
      latestRuns: "complete_for_configured_cameras",
      recentDetections: "complete_within_site_query" | "bounded_source_scan",
      recentFailedJobs: "complete_within_site_query" | "bounded_source_scan"
    },
    sourceQueryMode: {
      activeAlerts: "indexed",
      detections: "indexed" | "fallback_bounded_scan",
      failedJobs: "indexed" | "fallback_bounded_scan"
    }
  }
}
```

Only active `grouped-temporal-v2` alerts appear in `activeAlerts`. Its three
status counts are exact Firestore aggregate counts and are not derived from the
bounded response list. `completeness.activeAlerts` is `more_available` when at
least one additional active alert exists beyond `alertLimit`. Cameras include
their latest analysis-run snapshot and authenticated evidence URL when
available. Recent detection DTOs deliberately omit polygons; use each
`detailUrl` when geometry is needed.

The tracked composite indexes support the active alert list, recent site
detections, and failed jobs. The alert list requires its index. Until either
recent-feed index is deployed to a Firebase environment, Firestore can return a
missing-index error; Node then reads and sorts at most 500 matching site
candidates. `sourceQueryMode` reports `fallback_bounded_scan`, and the matching
completeness field reports `bounded_source_scan`, because older records may lie
beyond that bound. All three modes should normally be `indexed` after
`firestore.indexes.json` is deployed.

The `completeness` object makes prototype bounds explicit: configured cameras
are scanned up to 200, the indexed active-alert list reads `alertLimit + 1`,
and the recent lists use the requested response limits.

### Reconciled summary DTO

Both summary endpoints return:

```ts
{
  summary: {
    id: string,
    version: "site-dashboard-summary-v1",
    workflowVersion: "grouped-temporal-v2",
    siteId: string,
    activeAlertCounts: {
      new: number,
      acknowledged: number,
      inProgress: number,
      total: number
    },
    resolvedAlertCount: number,
    configuredCameraCount: number,
    activeCameraCount: number,
    availableCameraCount: number,
    unavailableCameraCount: number,
    unknownCameraCount: number,
    latestDetectionAt: string | null,
    latestJobFailureAt: string | null,
    reconciledAt: string,
    reconciledByUid: string,
    updatedAt: string
  }
}
```

Reconciliation reads the site's cameras, alerts, latest detection, and latest
failed job, counts only current-workflow alerts, then overwrites
`dashboardSummaries/{siteId}` with the authenticated Supervisor UID and server
timestamps. The summary is a rebuildable snapshot and can become stale between
reconciliations; the full dashboard endpoint currently builds directly from
authoritative records rather than reading this document.

## 13. Priority-zone analytics

Phase 7 is an authenticated, Node-owned Firestore service. It turns eligible
operational analysis samples and deduplicated alert incidents into explainable
**zone priorities**. It does not select an exact bin-placement point and does
not train or invoke an additional analytics model.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/analytics/reconcile` | Rebuild a site's hourly analytics into a new generation and atomically publish it |
| `POST` | `/api/analytics/reports` | Generate and persist a priority-zone report for a site/time range |
| `GET` | `/api/analytics/reports?siteId={siteId}&status=all&limit=20&cursor={reportId}` | List saved reports using a report-document ID cursor |
| `GET` | `/api/analytics/reports/{reportId}` | Get one report and all persisted zone results |
| `GET` | `/api/analytics/reports/{reportId}/csv` | Download the same zone results as UTF-8 CSV |

All routes require the Firebase Supervisor bearer token.

### Analytics aggregation and idempotency

Every successful operational analysis run contributes once to the active
generation's UTC-hour bucket for its `siteId + zoneId`. Its sample contribution
includes people count, positive grouped-sample counts, qualifying detection
counts, model-version sample counts, and approximate persistence. A
deterministic `analyticsSampleApplications` marker scoped to the active
generation makes retrying that application safe.

Alert incidents are applied separately because confirmation can create an
alert from earlier buffered observations. A deterministic marker scoped by the
active generation, alert ID, and `firstObservationId` increments the issue
incident in that first observation's hour exactly once. Later occurrences on
the same active alert do not create new incidents. Floor-litter and overflow
incidents are report factors; optional spill metrics remain available in the
hourly bucket but are not a v1 scoring factor.

Runs with `isTest=true` or `analyticsEligible=false` receive an excluded sample
application and never alter analytics buckets. Current failed inference jobs do
not produce an `analysisRun`, so they remain visible in job/dashboard failure
APIs but do not yet increment `failedSampleCount`. Consequently the current
sample-success ratio does not measure those pre-run failures; this is a known
prototype coverage limitation.

Persistence is deterministic and approximate. For each camera and issue type,
Node adds the positive-to-positive capture-time gap only when both consecutive
samples are positive and the gap is within that issue's confirmation horizon:
30 minutes for litter, 15 for overflow, and 10 for spill. An out-of-order live
sample adds zero and does not move the series state; chronological
reconciliation is the repair path.

### `POST /api/analytics/reconcile`

Request:

```json
{ "siteId": "site-document-id" }
```

Reconciliation is intended after an upgrade/import or when analytics needs to
be repaired from authoritative `analysisRuns`, `issueObservations`, and
`alerts`. Node obtains a site lock, builds deterministic buckets, application
markers, incident markers, and persistence state under a new staging
generation, then atomically switches `analyticsSites` to that generation only
after every staged write succeeds. Incremental applications return `409` while
the lock is active. The previous generation remains retained; automatic old-
generation garbage collection is not implemented yet.

Response:

```ts
{
  reconciliation: {
    siteId: string,
    generationId: string,
    aggregationVersion: "hourly-zone-v1",
    includedRunCount: number,
    excludedRunCount: number,
    invalidRunCount: number,
    includedIncidentCount: number,
    excludedIncidentCount: number,
    bucketCount: number,
    sourceLimits: {
      runs: 5000,
      observations: 15001,
      alerts: 5000
    }
  }
}
```

The prototype also accepts at most 1,000 configured zones. Exceeding a bound
returns `409` instead of silently publishing a partial generation.

### `POST /api/analytics/reports`

Request:

```json
{
  "siteId": "site-document-id",
  "periodStart": "2026-08-01T00:00:00.000Z",
  "periodEnd": "2026-09-01T00:00:00.000Z",
  "zoneIds": ["optional-zone-id"]
}
```

The interval is start-inclusive/end-exclusive. Timestamps must contain an
offset, `periodEnd` must be later, and the interval cannot exceed 366 days.
`zoneIds` is optional, unique, limited to 1,000, and every requested zone must
belong to the site. Without it, all configured site zones are included.

The response is HTTP `201` and has the same detail shape as the detail route:

```ts
{
  report: {
    id: string,
    siteId: string,
    siteNameSnapshot: string,
    siteTimeZoneSnapshot: string,
    zoneIds: string[],
    periodStart: string,
    periodEnd: string,
    status: "completed" | "insufficient_data",
    policyVersion: "priority-zone-v1-provisional",
    aggregationVersion: "hourly-zone-v1",
    generationId: string,
    policy: object,
    selection: {
      inputBucketCount: number,
      includedOperationalBucketCount: number,
      excludedBucketCounts: object
    },
    sufficientZoneCount: number,
    insufficientZoneCount: number,
    highPriorityZoneCount: number,
    mediumPriorityZoneCount: number,
    lowPriorityZoneCount: number,
    bucketQueryMode: "indexed" | "fallback_bounded_scan",
    generatedByUid: string,
    generatedAt: string,
    completedAt: string,
    error: null
  },
  zoneResults: Array<{
    id: string,
    reportId: string,
    siteId: string,
    zoneId: string,
    zoneName: string,
    zoneNameSnapshot: string,
    rank: number | null,
    priorityBand: "high" | "medium" | "low" | "insufficient_data",
    totalScore: number | null,
    factors: {
      litterBurden: { raw: number, normalized: number | null, weight: 0.35, weightedContribution: number | null },
      visitorPressure: { raw: number, normalized: number | null, weight: 0.30, weightedContribution: number | null },
      overflowBurden: { raw: number, normalized: number | null, weight: 0.25, weightedContribution: number | null },
      issuePersistence: { raw: number, normalized: number | null, weight: 0.10, weightedContribution: number | null }
    },
    evidence: {
      litterIncidents: number,
      overflowIncidents: number,
      averagePeoplePerSuccessfulSample: number,
      peakPeople: number,
      issuePersistenceSeconds: number
    },
    coverage: {
      eligibleHourlyBucketCount: number,
      successfulHourlyBucketCount: number,
      localCalendarDayCount: number,
      successfulSampleCount: number,
      failedSampleCount: number,
      sampleSuccessRatio: number,
      sufficient: boolean,
      insufficiencyReasons: string[]
    },
    reasons: string[],
    createdAt: string
  }>
}
```

A report snapshots its active analytics generation and policy. Each factor is
normalised from 0–100 relative to the largest raw value among sufficient zones
in the same site/report, then weighted as follows:

```text
35% litter incident burden
30% average people per successful sample
25% overflow incident burden
10% approximate issue persistence hours
```

The provisional sufficiency gate requires at least 8 successful hourly
buckets, observations across at least 2 local calendar days in the site's IANA
time zone, and at least an 80% sample-success ratio. A sufficient score is
`high` at 70 or above, `medium` at 40–69.999..., and `low` below 40. A zone that
fails any sufficiency condition gets `rank: null`, `totalScore: null`, and
`priorityBand: "insufficient_data"`; weak data is never presented as a
confident placement recommendation.

Report generation reads at most 100,000 selected buckets. The tracked
`siteId + generationId + bucketStart` index provides the normal `indexed`
query. If it is missing, Node may scan at most 10,000 site buckets and reports
`bucketQueryMode: "fallback_bounded_scan"`; once that bound is full it returns
`409` rather than risk an incomplete report.

### Report list, detail, and CSV

List parameters:

- `siteId` is required;
- `status` is `all` (default), `completed`, `insufficient_data`, or `failed`;
- `limit` defaults to 20 and accepts 1–100;
- `cursor`, when supplied, is the last report document ID from the preceding
  response and must belong to the same site.

Response:

```ts
{
  reports: object[],
  nextCursor: string | null,
  queryMode: "indexed" | "fallback_bounded_scan"
}
```

The indexed path reads `limit + 1`. If the report-history index is absent, the
explicit fallback scans and sorts at most 1,000 site reports. Detail returns
the report plus at most 1,000 `zoneResults`. CSV is available only for
`completed` or `insufficient_data` reports and returns `text/csv; charset=utf-8`
with ranking, evidence, coverage, factor, and reason columns.

## 14. System events and operational hardening

System events are generated by Node when AI inference, server-owned video
processing, or analytics rebuild dependencies fail. A later successful
operation resolves the matching generation. Repeated failures and recoveries
are idempotent and preserve lifetime counts without exposing raw errors,
stacks, URLs, headers, tokens, or unrestricted metadata.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/system-events?status=open&dependency={dependency}&severity={severity}&scopeType={type}&scopeId={id}&limit=25&cursor={cursor}` | Newest events with bounded opaque-cursor pagination |
| `GET` | `/api/system-events/{eventKey}` | One safe generated event |

`status` defaults to `open` and accepts `open`, `resolved`, or `all`. Use at
most one of dependency, severity, or scope filtering; `status=all` cannot be
combined with another filter. Non-global scopes require both `scopeType` and
`scopeId`. The list envelope is:

```ts
{
  events: Array<{
    eventKey: string,
    dependency: "ai_service" | "video_processing" | "analytics_rebuild",
    eventCode: string,
    title: string,
    scope: { type: "global" } | { type: "site" | "job", id: string },
    status: "open" | "resolved",
    severity: "warning" | "critical",
    maximumSeverity: "warning" | "critical",
    generation: number,
    occurrenceCount: number,
    lifetimeOccurrenceCount: number,
    resolutionCount: number,
    reopenCount: number,
    firstSeenAt: string,
    lastSeenAt: string,
    resolvedAt: string | null,
    latestSafeDetails: object
  }>,
  page: { limit: number, hasMore: boolean, nextCursor: string | null }
}
```

There is intentionally no public system-event mutation endpoint. Media
retention, backup/recovery, index deployment, incident response, and the full
Phase 9 verification command are documented in
[operations-runbook.md](./operations-runbook.md).

## 15. Postman workflow

In Postman Desktop v12, connect the repository root through Native Git and use
Local View. The collection is stored in the v3 YAML directory at
`postman/collections/`, and the environment is
`postman/environments/LitterSpot Local.environment.yaml`; no recurring JSON
import is required.

Select the **LitterSpot Local** environment and set these local-only values:

1. `firebaseWebApiKey` from `VITE_FIREBASE_API_KEY` in `frontend/.env.local`;
2. `supervisorEmail`;
3. `supervisorPassword`.

Do not send these values in chat or commit an exported environment containing
them. Run **Firebase Login**, then **Current Supervisor**. The create requests
save `siteId`, `zoneId`, `cameraId`, and `cleanerId` automatically for later
requests. The intended order is Site, Zone, Camera, then Cleaner.

For media testing, select an image in **Upload Test Image** after creating an
active Camera. The request saves `mediaId` and `processingJobId`. Re-send it
unchanged to test idempotency; change `clientRequestId` before intentionally
creating another upload. Run **Process Image Job** next. It saves
`analysisRunId` and, when the image contains an issue, `detectionId`. The
**Analysis results** requests then retrieve the Firestore-owned output.

For video testing, use the **Video processing** folder. Select a local MP4 or
WebM in **Upload Test Video**; its request has a dedicated editable idempotency
key and saves `mediaId` and `processingJobId`. Run **Enqueue Video Job**, then send
**Poll Video Job** until it reports `completed` or `failed`. A completed job's
frame runs are available through **List Analysis Runs** with the saved job ID.
Use **Upload Operational Video** only when you intentionally want sampled
frames to feed confirmation, flags, alerts, and analytics. **Retry Failed
Video Job** intentionally returns `409` unless the selected video job failed.

Use the **Priority-zone analytics** folder after operational runs exist. Run
**Reconcile Site Analytics** first when importing or repairing historical data,
then set `analyticsPeriodStart` and `analyticsPeriodEnd` to an ISO range that
contains those captures. **Generate Priority Zone Report** saves
`analyticsReportId`; the list, detail, and CSV requests reuse it. A site without
enough operational coverage correctly returns `insufficient_data` rather than
making the Postman test fail.

Use **System events and hardening** to verify public liveness/readiness,
request/security headers, rate-limit headers, and the read-only operational
event contract. A healthy system may return an empty event list; run the
emulator system-event smoke or wait for a real dependency failure before
running **Get System Event**.

For Phase 10-11 testing, keep Supervisor and Cleaner sessions separate. In
**Cleaner identity and mobile presence**, set `cleanerEmail`, run **Provision
Cleaner Account**, deliver/use the returned setup link privately, set the
chosen local `cleanerPassword`, then run **Cleaner Firebase Login**. Cleaner
requests use `cleanerFirebaseIdToken`; they never overwrite or inherit the
Supervisor token. Run **Cleaner - Go Online with Location** before assignment.

In **Work orders and Cleaner notifications**, create work using an active Phase
4 `alertId` and the linked/online `cleanerId`, then switch between Supervisor
and `Cleaner -` requests according to the lifecycle. Accept and Reject are
alternatives for a newly assigned order. Rework and Complete are alternatives
after review. Reassignment requires a separately linked, permitted, freshly
online `replacementCleanerId`. FCM registration is optional; a missing token
correctly leaves a failed-but-visible durable inbox record.

Send requests individually during the first test; do not run the complete
collection as one Runner job. Deactivation requests appear inside each resource
folder and must be sent child-first only after the hierarchy has been tested.

For the two model-test adapter requests, select a local image in Postman's file
picker; collection files intentionally contain no machine-specific image paths.

## 16. Future frontend integration rule

Until the React structure is stable, new modules are backend-first:

1. define/update this contract;
2. implement Node/Firebase/FastAPI ownership;
3. add automated tests;
4. add Postman requests and examples;
5. integrate React later against the stable contract.

Existing Firebase login and location/cleaner UI integration can remain. The
Phase 5 dashboard backend is complete, but the current React dashboard remains
on dummy frontend data by decision; no React dashboard cutover was performed in
that phase. Phase 7 priority-zone analytics is also backend-complete while its
React ranking/heatmap cutover remains deferred. Future integration should
consume both stable DTOs in one coordinated pass. Upload, processing,
detection, alert, dashboard, and analytics backend work must not depend on the
current dummy React data.
