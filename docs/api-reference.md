# LitterSpot API reference

## 1. Conventions

Node serves the public application API. Protected requests use:

```http
Authorization: Bearer <Firebase ID token>
```

JSON requests use `Content-Type: application/json`. Upload routes use `multipart/form-data`. Responses use JSON except media content.

### Errors

```json
{
  "error": "Safe message",
  "code": "optional_machine_code",
  "details": {},
  "requestId": "trace-id"
}
```

Common status codes are 400 invalid input, 401 missing or invalid identity, 403 wrong role or inactive access, 404 missing or cross-Site resource, 409 stale revision or state conflict, 413 oversized upload, 415 unsupported media, 429 rate limit, 503 unavailable dependency or Firestore quota, and 500 internal failure.

### Pagination

Ledger routes accept `limit` and opaque `cursor`. Responses include `nextCursor`, `hasMore`, and `totalCount`. Cursors are bound to resource, order, and filters.

### Idempotency and revisions

Create and command routes that expose `idempotencyKey` return the committed result on an identical replay and reject changed input. Mutations that expose `expectedRevision`, `expectedCameraRevision`, or `expectedMapRevisionId` reject stale state.

## 2. Public health and private inference

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health/live` | Public | Node process liveness |
| GET | `/api/health` | Public | Node readiness and safe AI dependency state |
| GET | `/api/health/ready` | Public | Alias of readiness |
| GET | FastAPI `/health` | Private network | Detailed model readiness for operators |
| POST | FastAPI `/analyze/frame` | `X-Internal-Token` when configured | Stateless frame inference |

FastAPI analysis accepts `file`, `floor_confidence`, `localizer_confidence`, and `focus_region`. `focus_region` may carry normalized points, Registration context, a base64 reference image, and the bin-review switch.

## 3. Session and role dispatch

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/me` | Authenticated | Return the active Superadmin, Supervisor, or Cleaner application session |

The role returned by this endpoint determines the frontend application area.

## 4. Site and spatial administration

### Superadmin

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/superadmin/sites` | Paginated Site list with status filter |
| GET | `/api/superadmin/sites/:siteId` | Site administration detail |
| POST | `/api/superadmin/sites` | Create Site, initial map, and Root Supervisor |
| PATCH | `/api/superadmin/sites/:siteId/status` | Start Site activation or deactivation operation |
| POST | `/api/superadmin/sites/:siteId/root-recovery` | Reset or replace Root access |
| GET | `/api/superadmin/sites/:siteId/operations/:operationId` | Read Site-operation progress |
| POST | `/api/superadmin/sites/:siteId/operations/:operationId/reconcile` | Process one cleanup page |
| GET | `/api/superadmin/audit-events` | Paginated Superadmin audit ledger |

Superadmin Site View:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/superadmin/sites/:siteId/view/operations` | Initial operational read model |
| GET | `/api/superadmin/sites/:siteId/view/lists/:resource` | Paginated Alerts, Work, Cleaners, Supervisors, or Runs |
| GET | `/api/superadmin/sites/:siteId/view/alerts/:alertId` | Alert detail |
| GET | `/api/superadmin/sites/:siteId/view/cameras/:cameraId` | Camera detail |
| GET | `/api/superadmin/sites/:siteId/view/work-orders/:workOrderId` | Work detail |
| GET | `/api/superadmin/sites/:siteId/view/system/runs/:runId` | Run detail |
| GET | `/api/superadmin/sites/:siteId/view/analytics` | Daily analytics and bin-placement snapshot |
| GET | `/api/superadmin/sites/:siteId/view/audit-events` | Site audit events caused by Superadmin actions |
| GET | `/api/superadmin/sites/:siteId/view/media/:mediaId/content` | Authorized Site media bytes |
| GET | `/api/superadmin/sites/:siteId/view/media/:mediaId/overlay` | Authorized evidence overlay |

### Supervisor accounts

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/supervisors` | Supervisor | List Site Supervisors |
| POST | `/api/supervisors` | Root | Create Regular Supervisor identity and profile |
| PATCH | `/api/supervisors/:supervisorUid` | Root | Update profile or active status |

### Site Map

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/site-map` | Supervisor | Active map projection |
| GET | `/api/site-map/revisions` | Supervisor | Published revision list |
| GET | `/api/site-map/retired-zones` | Root | Retired Zone list |
| GET | `/api/site-map/draft` | Root | Current draft |
| POST | `/api/site-map/draft/start` | Root | Start draft from active map |
| POST | `/api/site-map/draft` | Root | Save draft geometry and settings |
| POST | `/api/site-map/draft/validate` | Root | Validate current draft |
| POST | `/api/site-map/draft/publish` | Root | Publish immutable revision |
| DELETE | `/api/site-map/draft` | Root | Discard draft |
| POST | `/api/site-map/background` | Root | Upload map background |
| POST | `/api/site-map/camera-placements/:cameraId` | Root | Map Position Correction or Physical Camera Move |
| PUT | `/api/site-map/station-points/:cleanerId` | Supervisor | Publish Cleaner Station Point in active map |

The current frontend also reads Supervisor-scoped `/api/sites`, `/api/zones`, and `/api/cameras` list and record routes for operational adapters. Their POST, PATCH, and DELETE methods remain mounted for authenticated Supervisors, while the primary structural workflows above enforce Root authority.

## 5. Camera monitoring and AI

### Camera Creation and lifecycle

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/camera-creation/cameras` | Supervisor | Current Camera configuration list |
| GET | `/api/camera-creation/cameras/:cameraId/detail` | Supervisor | Camera, Work, history, Run trace, and audit detail |
| GET | `/api/camera-creation/cameras/:cameraId/draft` | Supervisor | Unfinished Camera draft |
| POST | `/api/camera-creation/drafts/start` | Root for creation; Supervisor for reconfiguration | Start guided draft |
| POST | `/api/camera-creation/drafts/:draftId/reference` | Draft owner or allowed Supervisor | Upload reference image |
| POST | `/api/camera-creation/drafts/:draftId/source-video` | Draft owner or allowed Supervisor | Upload looped source |
| PUT | `/api/camera-creation/drafts/:draftId/registration` | Draft access | Save floor and bins |
| POST | `/api/camera-creation/drafts/:draftId/validate` | Draft access | Validate draft |
| GET | `/api/camera-creation/drafts/:draftId` | Supervisor | Read draft |
| DELETE | `/api/camera-creation/drafts/:draftId` | Supervisor | Cancel draft and clean draft media |
| POST | `/api/camera-creation/drafts/:draftId/publish` | Supervisor | Publish Camera or replacement |
| PATCH | `/api/camera-creation/cameras/:cameraId/monitoring` | Supervisor | Enable or disable monitoring |
| POST | `/api/camera-creation/cameras/:cameraId/deactivate` | Supervisor route | Deactivate structural Camera record |
| POST | `/api/camera-creation/cameras/:cameraId/remove` | Root | Remove Camera from active Site operation |

### Monitoring

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/monitoring/live/config` | Enabled Camera capture configuration |
| GET | `/api/monitoring/live/events` | Server-sent analyzed snapshots and workflow/control events |
| POST | `/api/monitoring/sessions/claim` | Claim Site capture ownership |
| POST | `/api/monitoring/sessions/:sessionId/heartbeat` | Extend lease |
| POST | `/api/monitoring/sessions/:sessionId/release` | Release lease |
| POST | `/api/monitoring/sessions/:sessionId/cameras/:cameraId/start` | Start or resume episode |
| POST | `/api/monitoring/sessions/:sessionId/cameras/:cameraId/samples` | Submit ordered JPEG sample |
| POST | `/api/monitoring/sessions/:sessionId/cameras/:cameraId/stop` | End episode |
| POST | `/api/monitoring/offline-sweep` | Mark stale runtime Cameras offline |
| POST | `/api/monitoring/minute-flush` | Persist completed minute accumulators |

Monitoring mutation routes require `X-Monitoring-Token` after claim.

### Development scenes

Routes under `/api/development/cameras/:cameraId/scenes` list, upload, or select scene keys. They are available only when `CAMERA_DEMO_SCENES_ENABLED=true`; production additionally requires Root authority.

## 6. Alert and evidence management

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/alerts` | Paginated Alert ledger with status, Zone, Camera, and severity filters |
| GET | `/api/alerts/:alertId` | Alert, occurrences, events, Flags, and evidence detail |
| POST | `/api/alerts/age` | Apply current age and priority policy |
| POST | `/api/alerts/:alertId/dismiss` | Dismiss an unlinked unresolved Alert |
| POST | `/api/alerts/:alertId/manual-assignment` | Assign an eligible Cleaner and create linked Work |

### Media

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/media/:mediaId` | Authorized metadata |
| GET | `/api/media/:mediaId/content` | Authorized bytes with video Range support |
| GET | `/api/media/:mediaId/overlay` | Reconstructed SVG overlay from stored evidence geometry |

## 7. Cleaner and Work operations

### Cleaner administration

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/cleaners` | Paginated Cleaner list |
| GET | `/api/cleaners/:cleanerId` | Cleaner detail and calculated availability |
| POST | `/api/cleaners` | Create Firebase identity, profile, schedule, and Station Point |
| PATCH | `/api/cleaners/:cleanerId` | Update profile and status |
| PUT | `/api/cleaners/:cleanerId/schedule` | Replace weekly schedule |
| PUT | `/api/cleaners/:cleanerId/availability-override` | Set or clear Supervisor override |
| DELETE | `/api/cleaners/:cleanerId` | Deactivate Cleaner and identity access |

### Cleaner mobile

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/cleaner/me` | Cleaner profile and availability |
| GET | `/api/cleaner/map` | Active map with Zone geometry and only this Cleaner's Station Point |
| GET | `/api/cleaner/map/background` | Authorized map background bytes |
| GET | `/api/cleaner/work-orders` | Own Work ledger |
| GET | `/api/cleaner/work-orders/:workOrderId` | Own Work detail |
| GET | `/api/cleaner/work-orders/:workOrderId/camera-evidence` | Own assigned Camera Evidence |
| POST | `/api/cleaner/work-orders/:workOrderId/start` | Move assigned Work to in progress |
| POST | `/api/cleaner/work-orders/:workOrderId/completion-evidence` | Upload Manual Work photo |
| GET | `/api/cleaner/work-orders/:workOrderId/completion-evidence` | Read own Completion Evidence |
| POST | `/api/cleaner/work-orders/:workOrderId/ready-for-review` | Submit Work for review |
| GET | `/api/cleaner/notifications` | Own notification inbox |

### Supervisor Work

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/work-orders` | Paginated and filtered Work ledger with status counts |
| POST | `/api/work-orders/manual` | Create assigned Manual Work |
| GET | `/api/work-orders/:workOrderId` | Work detail |
| GET | `/api/work-orders/:workOrderId/history` | Paginated events |
| GET | `/api/work-orders/:workOrderId/verifications` | Paginated Verifications |
| POST | `/api/work-orders/:workOrderId/reassign` | Replace Cleaner |
| POST | `/api/work-orders/:workOrderId/takeover` | Set manual management mode |
| POST | `/api/work-orders/:workOrderId/dismiss` | Dismiss Work and linked Alert when present |
| POST | `/api/work-orders/:workOrderId/verification` | Apply Supervisor Verification |
| POST | `/api/work-orders/:workOrderId/verification/override` | Override stored review with reason |

Other mounted Work create and status routes support current adapters but the routes above are the primary product contract.

## 8. Orchestration and operational intelligence

### Supervisor operations

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/operations/notifications` | Supervisor notification inbox |
| GET | `/api/operations/system` | Configuration, runtime, backlog, control history, Runs, and safe events |
| GET | `/api/operations/audit-events` | Root Site audit ledger |
| GET | `/api/dashboard` | Cached current dashboard |
| POST | `/api/dashboard/refresh` | Force dashboard rebuild |
| GET | `/api/analytics/daily` | Daily summaries for date range |
| POST | `/api/analytics/daily/rebuild` | Rebuild selected dates |
| POST | `/api/analytics/minute/cleanup` | Delete eligible minute buckets after daily preservation |
| GET | `/api/bin-placement/recommendations` | Current recommendation snapshot |
| POST | `/api/bin-placement/recommendations/refresh` | Recalculate snapshot |
| POST | `/api/bin-placement/zones/:zoneId/implement` | Record implemented recommendation |
| GET | `/api/bin-placement/interventions` | Intervention ledger |
| GET | `/api/bin-placement/interventions/:id/comparison` | Before-and-after Zone comparison |
| POST | `/api/bin-replacement/:zoneId/evaluate` | Short-window provisional bin replacement evaluation |
| GET | `/api/bin-replacement/:zoneId` | Read provisional evaluation |

### Orchestrator

| Method | Route | Purpose |
| --- | --- |
| GET | `/api/orchestrator/config` | Site configuration |
| POST | `/api/orchestrator/status` | Pause or resume |
| GET | `/api/orchestrator/runs` | Paginated Runs |
| GET | `/api/orchestrator/runs/:runId` | Run, attempts, actions, and references |
| POST | `/api/orchestrator/assignment-cycle` | Start one Supervisor-triggered assignment cycle |

Internal routes require `X-Orchestrator-Token` and `X-Orchestrator-Worker-ID`:

| Method | Route | Purpose |
| --- | --- |
| POST | `/internal/orchestrator/assignment-runs` | Create leased assignment Run |
| GET | `/internal/orchestrator/runs/:runId/assignment-context` | Return bounded validated context |
| POST | `/internal/orchestrator/runs/:runId/assign-cleaner` | Validate and commit selected pair |
| POST | `/internal/orchestrator/review-runs` | Create leased review Run |
| GET | `/internal/orchestrator/runs/:runId/review-context` | Read ready deterministic outcome |
| POST | `/internal/orchestrator/runs/:runId/resolve-verified-work` | Apply passed outcome |
| POST | `/internal/orchestrator/runs/:runId/request-rework` | Apply failed outcome |

## 9. Development-only test support

`POST /api/test-support/alerts` creates a traceable simulated Flag and Alert. It requires Root authority and is rejected in production-cloud mode.
