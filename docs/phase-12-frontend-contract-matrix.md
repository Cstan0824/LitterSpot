# Phase 12 frontend contract matrix

Status: Phase 12.0 baseline recorded at commit `16ca7998d32c0af9cc8d739458e7341eb6efffa8` on branch `jeremy`.

## Baseline

| Item | Verified value |
| --- | --- |
| Working branch | `jeremy` |
| Starting commit | `16ca7998d32c0af9cc8d739458e7341eb6efffa8` |
| Remote branch | `origin/jeremy` at the same commit |
| Starting worktree | Clean |
| Product frontend | `frontend/` |
| Developer API tool | `api-sandbox/`, kept separate and unchanged |
| Firebase project | `litterspot-v2-database` |
| Firestore database | `(default)` |
| Target checks | `frontend/.env.local` project ID and `.firebaserc` default both match the canonical project |
| Background workers | `ANALYTICS_WORKER_ENABLED=false`, `ORCHESTRATOR_WORKER_ENABLED=false` |

No credential, token, Web API key, password, or Admin JSON content was read into this document.

## Classification

| Label | Meaning |
| --- | --- |
| real V2 | Uses the current V2 identity, role, or business contract. |
| V1 | Calls an older or transitional Node contract that remains for compatibility. |
| mock | Uses hardcoded demonstration records, images, dates, or labels. |
| local React-only | Changes component state or navigation without changing backend data. |
| missing | Required UI or integration does not exist. |

## Documentation and code contradictions

1. The handoff named `docs/data-model-v2/02-cleanliness-workflow.md`. The repository file is `docs/data-model-v2/02-cameras-and-operations.md`; that file was used.
2. `docs/phase-12-ui-v2-integration-plan.md` names `78d6157` as the integration baseline. The verified session baseline is `16ca799`.
3. Early sections of `docs/api-reference.md` describe V1 Cleaner presence, GPS, assigned Zones, capabilities, accept/reject, FCM, read receipts, and old Alert/Work statuses. Current V2 code and requirements explicitly reject those contracts.
4. The main requirements originally say Node preselects one Alert. The continuation's Phase 9 decision supersedes that rule with LLM-selected Alert-Cleaner pairs. This does not affect Phase 12.1 routing.
5. The current tested `/api/me` route supports Superadmin, Supervisor, and Cleaner responses. The previous frontend assumed every authenticated account had a `supervisor` property.
6. The frontend still displays `Batu Caves` and fake coordinates in several operational components. The canonical V2 development Site is Sunway Theme Park. Replacing operational page data belongs to Phase 12.2 and later.

## Current page and component inventory

| Route or component | Current data | Visible behavior | Classification | Phase 12.1 result |
| --- | --- | --- | --- | --- |
| Login | Firebase Email/Password | Sign in | real V2 identity | Kept; copy covers all roles and errors distinguish common Firebase failures. |
| Application session | `GET /api/me` | Role and account loading | real V2 | Central provider parses all three response shapes. |
| Supervisor shell | Authenticated Supervisor profile | Navigation and sign out | real V2 identity plus local routing | Preserved. Root/regular authority stays in session state. |
| Superadmin entry | Previously entered Supervisor code path | None | missing | Explicit separate integration-pending page. Never rendered as a Site Supervisor. |
| Cleaner entry | Unauthenticated demo bypass | Mock mobile application | mock | Demo bypass removed. Authenticated Cleaner gets an integration-pending page and cannot enter Supervisor routes. |
| `FieldStationNavigation` | Supervisor identity; hardcoded Site label and local Alert count | Route buttons, Site shortcut, sign out | real V2 identity, mock label, local React-only routing | Preserved. |
| Geographic Dashboard | V1 Sites/Zones/Cameras/Cleaners, mock Alerts, V1 bin replacement, invented anchors/scores | Select Zone, zoom, navigate to pages | V1, mock, local React-only | Not wired. Phase 12.2. |
| Camera wall/detail | V1 Camera records, uploaded-video local store, mock evidence and assignments | Filter, grid layout, open detail, history links | V1, mock, local React-only | Not wired. Root-only Add Camera entry is hidden from Regular Supervisors. |
| Add Camera modal | V1 create Zone and Camera calls; plotted boundary is not persisted | Create Zone/Camera | V1 plus local React-only geometry | Root-only guard added. V2 replacement is Phase 12.5. |
| Camera Registration page and prototype | V1 Camera/Registration services and authenticated media fetches | Select/create Camera, upload, draw, validate, publish | V1/transitional real API | Regular Supervisors can re-register existing Cameras; new Camera creation remains Root-only. V2 adaptation is Phase 12.5. |
| Alert Management | `demoAlerts`, mock evidence, V1-shaped statuses | Filters, detail, overlay toggle, local status buttons | mock and local React-only | Not wired. Phase 12.2 reads and Phase 12.3 actions. |
| Work Management | Creates one local Work item from every mock Alert; manual Work is local | Filters, create, reassign, arbitrary status changes | mock and local React-only | Not wired. Phase 12.2 reads and Phase 12.3 actions. |
| Team Management | Initial V1 Cleaner list; invented Station Points and schedules | Create/edit/filter Cleaner in component state | V1 seed plus local React-only | Not wired. Phase 12.4. |
| Bin Analysis | `/api/bin-replacement/:zoneId/evaluate` | Refresh short-window recommendation cards | V1 | Not wired. Phase 12.7. |
| System | Public readiness `/api/health` | Check connection, open model playground | real public health check, missing V2 System | Not wired. Phase 12.7. |
| Pipeline | V1 registered Camera and Processing Job services | Upload image/video, process, stop polling, inspect frames | real developer/model-test workflow, V1/transitional | Preserved as a developer tool route. Not operational monitoring. |
| Detection playground | `/api/detections/bin-state/batch` | Upload images, tune settings, run/reset | real developer model-test adapter | Preserved as a developer tool route. |
| `AlertsPage.tsx` | `alertAPI.ts` and old alert types | V1 list/status UI | V1, currently unrouted | Retained because it may still be reference code. |
| `LocationManagementPage` inside `OperationsConsole` | V1 Site/Zone/Camera/Cleaner services | V1 create/toggle forms | V1, currently not selected by runtime routing | Retained. |
| `CleanerMobileApp` | `cleanerMobileMock.ts`, local object URLs and state | Full mock Cleaner journey | mock and local React-only | Retained but no longer reachable from operational login. |
| Superadmin Site/account pages | No current product components | None | missing | Phase 13 backlog; Phase 12.1 uses a clear pending page. |
| Root Supervisor account management | No current product component | None | missing | Phase 13 backlog. |
| Full Site Map editor | Partial decorative plotting in Camera/Team/Work components | Local point/polygon editing | local React-only and missing | Phase 13 unless delivered earlier. |
| `api-sandbox/` | Separate developer application | Browser-native API exercises | real developer tool | Preserved unchanged and outside product routing. |

## Visible action to V2 contract map

### Shared identity, session, and media

| Current or future action | V2 contract | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| Sign in | Firebase Email/Password | All human roles | Active Firebase identity | real V2 |
| Load application role | `GET /api/me` | All human roles | Active `userAccounts` profile and active Site where applicable | real V2 |
| Sign out | Firebase `signOut` | All human roles | Signed-in account | real V2 |
| Load protected image/video | `GET /api/media/:mediaId/content` | Owning authorized role | Tenant and resource ownership checks | shared loader built; page wiring pending |
| Clear cached/listener/media state | Client account-scope registry | All human roles | Logout or UID change | real V2 foundation |

### Supervisor Dashboard and navigation

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| Read Dashboard | `GET /api/dashboard/v2` | Supervisor | Root or regular | missing, Phase 12.2 |
| Refresh Dashboard | `POST /api/dashboard/v2/refresh` | Supervisor | Root or regular | missing, Phase 12.2 |
| Read published Site Map | `GET /api/site-map` | Supervisor | Root or regular | missing, Phase 12.2 |
| Navigate between product pages | Client routing | Supervisor | Root or regular | local React-only |

### Site Map and Cameras

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| Read map revisions | `GET /api/site-map/revisions` | Supervisor | Root or regular | missing |
| Read/create map draft | `GET /api/site-map/draft`, `POST /api/site-map/draft` | Supervisor | Root for create/mutation | missing |
| Validate/publish/delete map draft | `POST /api/site-map/draft/validate`, `POST /api/site-map/draft/publish`, `DELETE /api/site-map/draft` | Supervisor | Root | missing |
| Read V2 Cameras | `GET /api/camera-creation/cameras` | Supervisor | Root or regular | missing, Phase 12.2 |
| Start Camera creation draft | `POST /api/camera-creation/drafts/start` | Supervisor | Root | current V1 action; V2 Phase 12.5 |
| Start Camera reconfiguration draft | `POST /api/camera-creation/drafts/start` with `kind=reconfigure` | Supervisor | Root or regular | current V1 action; V2 Phase 12.5 |
| Upload Camera reference | `POST /api/camera-creation/drafts/:draftId/reference` | Supervisor | Root for create; root or regular for reconfigure | current V1 action; V2 Phase 12.5 |
| Upload looped source | `POST /api/camera-creation/drafts/:draftId/source-video` | Supervisor | Root for create; root or regular for reconfigure | current V1 action; V2 Phase 12.5 |
| Save Registration geometry | `PUT /api/camera-creation/drafts/:draftId/registration` | Supervisor | Root for create; root or regular for reconfigure | current V1 action; V2 Phase 12.5 |
| Validate/publish/cancel Camera draft | `POST /api/camera-creation/drafts/:draftId/validate`, `POST /api/camera-creation/drafts/:draftId/publish`, `DELETE /api/camera-creation/drafts/:draftId` | Supervisor | Backend checks draft kind and authority | current V1 action; V2 Phase 12.5 |
| Enable/disable monitoring | `PATCH /api/camera-creation/cameras/:cameraId/monitoring` | Supervisor | Root or regular | missing, Phase 12.6 |

### Alerts and Work

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| List/read Alerts | `GET /api/alerts`, `GET /api/alerts/:alertId` | Supervisor | Root or regular | mock now; Phase 12.2 |
| Dismiss waiting Alert | `POST /api/alerts/:alertId/dismiss` | Supervisor | Root or regular; expected revision and reason | local-only now; Phase 12.3 |
| Assign waiting Alert manually | `POST /api/alerts/:alertId/manual-assignment` | Supervisor | Root or regular; idempotency key | local-only now; Phase 12.3 |
| List/read Work | `GET /api/work-orders`, `GET /api/work-orders/:workOrderId` | Supervisor | Root or regular | mock now; Phase 12.2 |
| Read Work history/Verifications | `GET /api/work-orders/:id/history`, `GET /api/work-orders/:id/verifications` | Supervisor | Root or regular | missing, Phase 12.2 |
| Create manual Work | `POST /api/work-orders/manual` | Supervisor | Root or regular; available Cleaner and idempotency key | local-only now; Phase 12.3 |
| Reassign or take over Work | `POST /api/work-orders/:id/reassign`, `POST /api/work-orders/:id/takeover` | Supervisor | Root or regular; revision/reason/idempotency as required | local-only now; Phase 12.3 |
| Dismiss Work | `POST /api/work-orders/:id/dismiss` | Supervisor | Root or regular; reason, revision, idempotency key | local-only now; Phase 12.3 |
| Apply/override Verification | `POST /api/work-orders/:id/verification`, `POST /api/work-orders/:id/verification/override` | Supervisor | Root or regular; override requires reason | missing, Phase 12.3 |

### Cleaners and Supervisor accounts

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| List/read Cleaners | `GET /api/cleaners`, `GET /api/cleaners/:cleanerId` | Supervisor | Root or regular | V1 now; Phase 12.2/12.4 |
| Create/update/deactivate Cleaner | `POST /api/cleaners`, `PATCH /api/cleaners/:cleanerId`, `DELETE /api/cleaners/:cleanerId` | Supervisor | Root or regular | local/V1 now; Phase 12.4 |
| Update schedule | `PUT /api/cleaners/:cleanerId/schedule` | Supervisor | Root or regular | local-only now; Phase 12.4 |
| Set Availability Override | `PUT /api/cleaners/:cleanerId/availability-override` | Supervisor | Root or regular | missing, Phase 12.4 |
| Publish Station Point | `PUT /api/site-map/station-points/:cleanerId` | Supervisor | Root or regular, narrow station-only publication | local-only now; Phase 12.4 |
| List Supervisors | `GET /api/supervisors` | Supervisor | Root or regular read contract | missing |
| Create/update Regular Supervisor | `POST /api/supervisors`, `PATCH /api/supervisors/:uid` | Supervisor | Root | missing, Phase 13 UI |

### Cleaner mobile

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| Read Cleaner profile | `GET /api/cleaner/me` | Cleaner | Own active account | mock now; Phase 12.4 |
| Read own Work | `GET /api/cleaner/work-orders`, `GET /api/cleaner/work-orders/:id` | Cleaner | Assigned Cleaner only | mock now; Phase 12.4 |
| Start Work | `POST /api/cleaner/work-orders/:id/start` | Cleaner | Assigned Cleaner, valid current status, idempotency key | local-only now; Phase 12.4 |
| Upload Completion Evidence | `POST /api/cleaner/work-orders/:id/completion-evidence` | Cleaner | Assigned Cleaner; coordinate Work rules | local object URL now; Phase 12.4 |
| Submit for review | `POST /api/cleaner/work-orders/:id/ready-for-review` | Cleaner | Assigned Cleaner, idempotency key | local-only now; Phase 12.4 |
| Read notifications | `GET /api/cleaner/notifications` plus recipient-only Firestore listener | Cleaner | Own UID and Site | mock now; Phase 12.4 |

### Analytics and System

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| Read/refresh recommendations | `GET /api/bin-placement/v2/recommendations`, `POST /api/bin-placement/v2/recommendations/refresh` | Supervisor | Root or regular | V1 now; Phase 12.7 |
| Implement recommendation | `POST /api/bin-placement/v2/zones/:zoneId/implement` | Supervisor | Root or regular; reviewed snapshot timestamp | missing, Phase 12.7 |
| Read Intervention history/comparison | `GET /api/bin-placement/v2/interventions`, `GET /api/bin-placement/v2/interventions/:id/comparison` | Supervisor | Root or regular | missing, Phase 12.7 |
| Read System | `GET /api/operations/v2/system` | Supervisor | Root or regular | public health only now; Phase 12.7 |
| Pause/resume Orchestrator | `POST /api/orchestrator/v2/status` | Supervisor | Root or regular | missing, Phase 12.7 |
| Read Orchestrator Runs | `GET /api/orchestrator/v2/runs`, `GET /api/orchestrator/v2/runs/:runId` | Supervisor | Root or regular | missing, Phase 12.7 |
| Read Supervisor notifications | `GET /api/operations/v2/notifications` plus recipient-only Firestore listener | Supervisor | Own UID and Site | missing, later integration |
| Read audit events | `GET /api/operations/v2/audit-events` | Supervisor | Root | missing, Phase 13 UI |

### Superadmin

| Action | V2 endpoint | Role | Authority | Current state |
| --- | --- | --- | --- | --- |
| List/create Sites | `GET /api/superadmin/sites`, `POST /api/superadmin/sites` | Superadmin | Superadmin | missing UI; explicit pending page |
| Activate/deactivate Site | `PATCH /api/superadmin/sites/:siteId/status` | Superadmin | Superadmin; required reason | missing UI |
| Recover Root | `POST /api/superadmin/sites/:siteId/root-recovery` | Superadmin | Superadmin; idempotency and reason | missing UI |
| Read/reconcile Site operation | `GET/POST /api/superadmin/sites/:siteId/operations/:operationId[/reconcile]` | Superadmin | Superadmin | missing UI |
| Read Superadmin audit | `GET /api/superadmin/audit-events` | Superadmin | Superadmin | missing UI |

## Phase boundary

Phase 12.1 stops at shared identity, session, request, error, idempotency, media, cleanup, and role routing. None of the operational pages above were migrated to V2 business data in this phase.
