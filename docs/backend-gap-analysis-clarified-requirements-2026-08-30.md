# Backend gap analysis against clarified requirements

## 1. Purpose and scope

This report compares the current LitterSpot repository and live Firestore shape with:

- [`current-clarified-requirements.md`](current-clarified-requirements.md);
- [`current-clarified-requirements-continuation.md`](current-clarified-requirements-continuation.md);
- [`../CONTEXT.md`](../CONTEXT.md).

The review covers Node/Express, Firebase Authentication, Firestore, local media storage, FastAPI inference, `task-assignment-llm`, Postman, tests, and the current React frontend boundary.

This is a read-only implementation assessment. It does not authorize or perform the backend migration.

## 2. Executive conclusion

The repository is a healthy backend foundation built around an older product model. The code is tested, transactional, idempotent, and already separates Node business state from private FastAPI inference. The new requirements do not call for a rewrite from zero.

The following foundations should remain:

- Node/Express as the authoritative application backend;
- Firebase Authentication and named cloud Firestore database;
- FastAPI as a stateless private inference service;
- registered-camera floor/bin inference;
- local prototype media storage;
- deterministic IDs, transactions, leases, idempotency keys, cursor pagination, request IDs, rate limits, dependency health, and emulator tests;
- internal Flag and Alert traceability;
- Work Order history and review/audit patterns;
- the teammate LLM provider adapters and structured Cleaner-ID validation.

The largest changes are not in the trained models. They are in:

1. identity, Site tenancy, Root/Regular/Superadmin authorization;
2. Site Map revisions and geometry;
3. Cleaner Station Points and schedules instead of Zone/GPS presence;
4. composite Camera Creation and browser-owned live sampling;
5. camera-scoped `bin_service` Alerts and simplified Work states;
6. Firestore real-time in-app notifications instead of FCM/read receipts;
7. a narrower Orchestrator contract and new assignment retry policy;
8. minute/daily analytics and the new Bin Placement Intervention model.

The current `frontend/` should receive no new product integration. Visual API testing, when needed, belongs in a separate disposable sandbox.

## 3. Verified current baseline

### 3.1 Git and repository state

- Last committed baseline: `850f7b4` on `main`/`origin/main`.
- The working tree contains uncommitted backend, docs, Postman, and frontend changes from the recent Camera Registration and processing-result work.
- This report evaluates both committed code and visible working-tree additions. No existing change should be discarded during migration without explicit review.

### 3.2 Automated verification

Current checks pass:

- backend TypeScript build;
- 210 backend unit tests;
- 18 emulator-only tests skipped by the ordinary unit command but executed in the emulator workflow;
- 27 FastAPI/AI contract tests;
- 12 isolated assignment-agent tests;
- Firestore emulator HTTP, authentication, pagination, image upload, Cleaner workflow, retention, Alert, Dashboard, analytics, and system-event smoke workflows;
- 122 Postman YAML resources and scripts validate;
- current frontend production build.

The passing tests prove consistency with the old contracts. Many tests must be replaced because those old contracts are intentionally changing.

The real assignment-model smoke test is currently blocked by local model setup, not application code:

```text
Ollama service: available
Configured model: qwen3.5:4b
Result: HTTP 404, model not installed
```

Phase 0 must pin an installed model name or install the agreed checkpoint before live LLM acceptance testing.

### 3.3 Live Firestore size

The live prototype database is small enough for a controlled migration. Relevant counts observed during this read-only audit include:

| Collection | Documents |
| --- | ---: |
| Sites | 3 |
| Zones | 3 |
| Cameras | 6 |
| Active Camera Registrations | 5 |
| Camera Registration Revisions | 10 |
| Supervisors | 1 |
| Cleaners | 2 |
| Alerts | 3 |
| Flags | 14 |
| Work Orders | 1 |
| Notifications | 1 |
| Analysis Runs | 41 |
| Detections | 102 |
| Media Assets | 115 |
| Analytics Buckets | 7 |
| Analytics Reports | 2 |

Migration remains necessary because field meanings differ, but scale is not a blocker.

## 4. Current architecture assessment

| Boundary | Current state | Decision |
| --- | --- | --- |
| Node/Express | Owns Firestore and business workflows | Keep |
| FastAPI | Stateless `/analyze/frame` and isolated model adapters | Keep and slightly extend contract metadata only |
| Firebase Auth | Supervisor/Cleaner identities | Keep, add Superadmin and Supervisor authority/site scope |
| Firestore | All application state, currently backend-only | Keep; add one narrow notification read exception |
| Local media | Durable original uploads, extracted frames and evidence | Keep for prototype, change live-frame retention behavior |
| Current React | Contains old product UI and recent test page | Exclude from product integration; mine only for disposable sandbox ideas |
| Postman | Broad API-first workflow coverage | Keep, retire/update obsolete folders |
| `task-assignment-llm` | JSON-only one-shot prototype | Keep provider/selection core, replace tools/data/prompt |

## 5. Gap matrix by domain

### 5.1 Site tenancy and roles

Current:

- roles are only `supervisor` and `cleaner`;
- every Supervisor has global access to all Supervisor routes;
- Supervisor profiles have no `siteId` or Root/Regular authority;
- `/api/sites` can list all Sites;
- no Superadmin identity, middleware, API or audit collection exists.

Required:

- roles: `superadmin`, `supervisor`, `cleaner`;
- Supervisor `authority`: `root` or `regular`;
- every Supervisor and Cleaner belongs to one Site;
- Site is the tenant boundary; no `clientId`;
- Root/Regular capability enforcement;
- separate Superadmin APIs/interface;
- Superadmin mutation audit;
- Site deactivation dismisses active Alert-linked operations, releases Cleaners and blocks Site accounts.

Disposition: major change. Existing Firebase token verification and `userAccounts` pattern are reusable; authorization and all Site-scoped queries must be rebuilt before new feature work.

### 5.2 Supervisor account management

Current:

- only a bootstrap script creates the initial Supervisor;
- no Supervisor CRUD API;
- no Root recovery or Site setup transaction.

Required:

- Superadmin creates Site plus first Root Supervisor in one workflow;
- Root creates Regular Supervisors with email/password;
- no invitation or forced first-password change;
- root protections and Superadmin recovery.

Disposition: build new service and routes. Reuse Firebase Admin account creation, email normalization, disable/reconcile patterns from Cleaner provisioning.

### 5.3 Site Map revisions

Current:

- Site has name, description, timezone and status only;
- Zone has `mapPolygon`/`mapCentroid` placeholders but APIs do not accept geometry;
- Camera has no Site Map point;
- no Site Map draft, immutable revision, background image, boundary validation, overlap detection, point-in-Zone assignment or historical map rendering exists.

Required:

- configurable 2D Site dimensions and optional background;
- Root-only draft/publish/delete workflow;
- non-overlapping Zone polygons;
- Camera and Cleaner Station points inside exactly one Zone;
- immutable history and atomic active-revision publication;
- dimension changes require complete reconfiguration.

Disposition: build new module. Keep stable `sites`, `zones`, `cameras`, and `cleaners` identities, but add revisioned geometry and active convenience fields.

### 5.4 Camera Creation and source lifecycle

Current:

- `POST /api/cameras` creates an active unregistered Camera immediately;
- Camera Registration is a later separate workflow;
- source is generic `upload|stream` with unused stream fields;
- no laptop-first rule, simulation video source, `monitoringEnabled`, composite draft, or atomic source/Registration switch exists.

Required:

- one composite Camera Creation draft;
- first Site Camera forced to laptop webcam;
- later Cameras use looped video;
- initial Registration mandatory before Camera creation commit;
- looped Cameras structurally active but `monitoringEnabled=false` by default;
- source replacement requires a new Registration and atomic switch.

Disposition: replace Camera creation contract. Reuse current Registration schemas, reference media service, validation, revisions, preview, and optimistic revision checks.

### 5.5 Monitoring Sessions and live samples

Current:

- test/operational media uses upload plus processing jobs;
- image/video jobs persist original media and extracted frames;
- no browser Monitoring Session, ownership lease, heartbeat, failover, live-sample endpoint, source error state, or temporal reset-on-enable exists.

Required:

- one browser owner per Site with lease and automatic same-laptop failover;
- one laptop webcam plus active looped videos;
- sequential two-second frame sampling;
- hidden Cameras continue sampling;
- ordinary frames discarded;
- lightweight in-memory state and highest-confidence Alert Evidence only;
- `isSimulation` propagated internally;
- Camera `online|offline` based on source activity.

Disposition: build new live-ingestion path. Keep upload/processing jobs only for API/model replay and sandbox tests; do not use them as the live monitoring implementation.

### 5.6 AI inference

Current strengths:

- private token-protected FastAPI boundary;
- people, floor litter/spill, bin localizer and bin-state models;
- registered floor and stable registered `binId` candidates;
- `normal|full|overflow|review|unknown` state handling;
- reference-image evidence and occlusion/review reasons;
- Node-owned video tracking and temporal confirmation;
- frame-dimension validation and model versions.

Required gaps:

- live sample caller with `binReviewEnabled=true`;
- explicit sample/Camera/Registration metadata recorded in Node summaries;
- test practical reliability of `full` on the finalized checkpoint;
- preserve configurable full-bin enablement.

Disposition: mostly keep. Do not move business state into FastAPI.

### 5.7 Observation, Flag and Alert policy

Current:

- Node groups detections into issue observations and Flags;
- temporal policy is tested and idempotent;
- active Alert uniqueness is `zone + issue`;
- issue types are floor litter, spill, and bin overflow;
- Alert states are `new|acknowledged|in_progress|awaiting_verification|resolved`;
- test runs are excluded from operational Alert buffers.

Required:

- one active Alert per `camera + issue`;
- combined `bin_service` issue with full warning and overflow critical escalation;
- spill single-observation rule;
- provisional 3-of-5 litter, 2-of-3 bin full/overflow;
- highest-confidence evidence buffer;
- `waiting_for_cleaner|assigned|in_progress|awaiting_review|resolved|dismissed`;
- priority score, age escalation after 15 minutes, severity history;
- simulation marker but normal prototype participation;
- Flags remain internal and leave the public Supervisor navigation.

Disposition: keep grouping/idempotency mechanics, replace keys, issue taxonomy, statuses, aging and evidence selection. Current public Flag list/detail routes can become internal/admin traceability or be retired from the product API.

### 5.8 Cleaner identity, Station Point and schedule

Current:

- Cleaner is assigned to one Zone and permitted Site/Zone arrays;
- capability restrictions exist;
- account provisioning generates a random password and password-reset invitation;
- Cleaner controls online/break/offline presence;
- GPS consent, heartbeat, location freshness and seven-day location history exist;
- FCM push tokens exist.

Required:

- direct email/password account creation;
- no invitation flow;
- no Zone or capability eligibility restrictions;
- fixed Station Point on active Site Map revision;
- recurring per-weekday start/end range, one range per day, overnight support;
- Supervisor Availability Override;
- availability derived from schedule, override, account and active Work;
- no GPS, location consent, heartbeat, location history or Cleaner-controlled presence;
- one active Work maximum.

Disposition: major schema/service replacement. Reuse identity linking, email reservation, Firebase disable/reconcile and active-work exclusivity patterns.

### 5.9 Work Orders

Current strengths:

- atomic Cleaner reservation and Work creation;
- one active Work per Alert key;
- idempotency, optimistic checks, assignment/history subcollections;
- Cleaner-specific authorization;
- reassign, review, notification and evidence foundations.

Current conflicts:

- states include unassigned, accepted, rejected, rework_required, completed and cancelled;
- Cleaner can accept and reject;
- every Work requires an Alert;
- eligibility depends on Zone, capability, online heartbeat and optional override;
- instructions can be supplied by Orchestrator;
- status `completed` conflicts with required `resolved`.

Required:

- `assigned|in_progress|awaiting_review|resolved|dismissed` only;
- assignment counts as acceptance;
- no reject/problem action;
- manual Work without Alert, Camera or coordinate target;
- coordinate completion photo requirement;
- Camera manual Verification advisory only;
- `origin=alert|manual`, `managementMode=orchestrated|manual`;
- deterministic Node-generated Alert instructions;
- no due date;
- Supervisor takeover disables all Orchestrator actions.

Disposition: retain transactional skeleton, replace schemas, transition graph, eligibility and presentation.

### 5.10 Verification

Current:

- review requests, evidence and review records exist;
- Cleaner can submit ready for review;
- review decisions support clean, rework, more evidence and Supervisor exception;
- review transitions Alert and Work atomically;
- current result uses `completed`/`rework_required` states and can rely on model/VLM-shaped payloads.

Required:

- deterministic fresh Camera samples;
- litter 3 clear, spill 2 clear, bin service 2 normal;
- `passed|failed|inconclusive`;
- Orchestrator automatically applies outcomes only for orchestrated Work;
- failed returns the same Work directly to `in_progress`;
- inconclusive stays awaiting review and notifies Supervisors;
- manual mode leaves final decision to Supervisor;
- coordinate manual Work uses one Cleaner photo and Supervisor review;
- VLM review deferred.

Disposition: keep review request/evidence/idempotency foundation; replace decision contract and state mutations.

### 5.11 Notifications

Current:

- durable notification documents;
- FCM delivery attempts and Cleaner push tokens;
- pending/sent/failed/read statuses;
- Cleaner list and mark-read APIs.

Required:

- Node creates immutable/durable recipient notifications;
- frontend uses recipient-scoped Firestore `onSnapshot` read;
- no FCM, push token, read/unread status, read receipts or mark-read API;
- Supervisor notifications for paused Alerts, escalation, LLM exhaustion and inconclusive review;
- Cleaner assignment/rework/resolution/dismissal notifications.

Disposition: keep notification identity/content/idempotency ideas; retire FCM, push-token and read-state machinery. Firestore rules must change from deny-all to recipient-only notification reads with no client writes.

### 5.12 Orchestrator

Current Node strengths:

- durable runs and outbox;
- claim token, worker lease, recovery and idempotent decision records;
- private worker authentication;
- eligible Cleaner and Work creation endpoints;
- review request/decision foundation.

Current conflicts:

- one deterministic run ID per Alert prevents distinct assignment/review episodes;
- broad nine-tool enum differs from approved five tools;
- context exposes old Zone/capability/GPS/presence model;
- Work instructions/rationale are supplied by Orchestrator;
- current eligible list can queue work onto busy Cleaners;
- no top-10 Node scheduler, priority aging, pause state per Site, candidate-exclusion loop, technical retry policy, manual-mode stop, raw local debug output or structured System-page view.

Required approved tools:

```text
get_assignment_context
assign_cleaner
get_review_context
resolve_verified_work
request_rework
```

Disposition: keep lease/outbox/idempotency architecture, rebuild contexts, tool schemas and scheduling semantics.

### 5.13 `task-assignment-llm`

Reusable:

- Ollama and optional Gemini provider adapters;
- strict structured selection schema;
- temperature-zero one-shot decision;
- eligible-ID validation;
- provider error handling and isolated tests;
- concise rationale summary.

Replace or retire:

- JSON simulation database as runtime source;
- `get_alert`, `list_cleaner_candidates`, and `assign_task` JSON tools;
- same-Zone and zone-distance ranking;
- workload ranking;
- assignment to busy Cleaners;
- permitted Zone and capability rules;
- proposed `zoneDistances` collection;
- proposed unassigned task/assignment-run database shape.

New integration:

- worker calls private Node tools only;
- prompt receives one Node-selected Alert and available candidates with Station Point distance;
- invalid/unavailable candidate exclusion loop;
- three technical retries with 1/2/4-second defaults;
- raw response written to private local debug file when enabled;
- result includes provider/model/summary for structured Orchestrator Run.

### 5.14 Dashboard

Current:

- Site dashboard already returns Camera summaries, current Alerts, recent detections and failures;
- uses bounded queries, indexes/fallbacks and presentation contracts.

Required:

- Site-scoped role enforcement;
- Zone/Camera/Cleaner/Alert/Work metrics;
- Orchestrator status;
- Top three unresolved Alerts by priority, resolved fallback excluding dismissed;
- top three Busy Zones using 50 percent 15-minute people pressure and 50 percent severity-weighted active Work;
- available Cleaners and assigned Work;
- new statuses and Camera cleanliness/connection separation.

Disposition: keep query/presentation architecture, replace contract and sources.

### 5.15 Analytics and Bin Placement

Current:

- hourly per-Zone analytics buckets;
- exactly-once sample and incident application;
- generation-safe reconciliation;
- priority reports, CSV and data sufficiency;
- separate short-window bin-replacement recommendation module;
- current priority weights use four unequal factors.

Required:

- two-second samples stay in memory;
- one Site-wide minute bucket with per-Zone values, retained 90 days;
- compact Site-wide daily summaries retained for prototype lifetime;
- Busy Zone 15-minute calculation;
- live Bin Placement leaderboard, not stored pending recommendations;
- arbitrary period `>=2` days;
- equal one-third people, resolved Work frequency and bin-service Alert frequency;
- daily rebuild plus manual refresh;
- implemented Intervention snapshot, two-day exclusion and history;
- partial before/after coverage for arbitrary requested days.

Disposition: retain aggregation/reconciliation patterns and report presentation ideas. Replace current bucket granularity, scoring policies and `binReplacementRecommendations` with minute/daily summaries and `binPlacementInterventions`.

### 5.16 Superadmin and audit

Current: absent.

Required:

- separate Superadmin role and API namespace;
- Site create plus Root account workflow;
- Site activation/deactivation and Root recovery;
- structural Site/Zone/Camera administration only, not daily Alert/Work actions;
- immutable Superadmin mutation audit visible to the Site Root;
- deactivation dismisses active Alerts/Work, releases Cleaners and stops automation;
- reactivation does not reopen dismissed work.

Disposition: build new module.

## 6. Component disposition summary

### 6.1 Keep substantially unchanged

- FastAPI model loaders and combined frame pipeline.
- Camera Registration geometry schemas and AI context.
- local media write/read/integrity primitives.
- Firebase Admin initialization.
- request context, safe errors, CORS, rate limiting and health endpoints.
- cursor pagination utilities.
- deterministic hashing/idempotency helpers.
- Serial queue pattern where sequential processing is required.
- dependency/system-event monitoring concepts.

### 6.2 Keep but refactor contracts

- `cameraRegistrationService` and reference storage.
- Alert grouping/temporal workflow.
- Work Order transaction/history service.
- review service.
- notification persistence.
- Dashboard query/presentation services.
- analytics aggregation/reconciliation.
- Orchestrator run/outbox/lease services.
- assignment LLM provider and selection adapters.
- Postman and emulator harnesses.

### 6.3 Retire from the product model

- Client Organization/clientId concept, if introduced elsewhere; use Site only.
- global Supervisor authorization.
- Cleaner assigned/permitted Zones and capabilities for assignment.
- Cleaner GPS presence, location consent/history and self-controlled availability.
- Cleaner invitation/reset-link provisioning.
- accept/reject/blocked Work actions.
- FCM push tokens, push delivery and notification read receipts.
- public Flag page/routes.
- active Alert key by Zone.
- separate `bin_overflow` Alert type without `bin_service` full escalation.
- pending recommendation documents and short-window bin-replacement policy.
- runtime JSON assignment tools and zone-distance ranks.
- product integration in current `frontend/`.

### 6.4 Build new

- role/capability and Site tenant enforcement;
- Superadmin APIs and audit;
- Supervisor CRUD/recovery;
- Site Map draft/revision/geometry module;
- Cleaner Station Point, schedule and Availability Override;
- composite Camera Creation drafts and source lifecycle;
- browser Monitoring Session lease and live-sample endpoint;
- in-memory temporal/evidence/analytics state and minute flush;
- simulation propagation and monitoring toggle;
- new Alert priority/aging/status engine;
- manual Work Order creation;
- simplified Work/Verification state machines;
- Firestore real-time notification rules;
- Node priority scheduler and approved Orchestrator tools;
- raw local Orchestrator debug output;
- new Dashboard/Busy Zone contract;
- daily summaries and Bin Placement Interventions;
- optional isolated API sandbox.

## 7. Recommended data model changes

This is a design target, not a migration already applied.

### 7.1 Identity

`userAccounts/{uid}`:

- `role`: `superadmin|supervisor|cleaner`;
- `profileId`;
- `siteId`: null for Superadmin, required otherwise;
- `authority`: `root|regular|null`;
- `status`.

`supervisors/{uid}` adds `siteId` and `authority`.

New `superadminAuditEvents/{eventId}` stores immutable mutation audit.

### 7.2 Site Map

- `sites/{siteId}`: tenant status, timezone, active map revision, map configuration summary.
- `siteMapRevisions/{revisionId}`: revision, draft/published/historical status, dimensions, background media, actor/timestamps.
- stable `zones/{zoneId}` plus active geometry convenience fields.
- revision geometry subcollections or top-level revision-linked records for Zone polygons, Camera placements and Cleaner Station Points.

Recommended publication approach:

1. validate the complete draft;
2. create immutable revision geometry;
3. atomically point Site to the new revision and update active convenience fields;
4. retain old revision records.

### 7.3 Cameras

`cameras/{cameraId}` adds:

- `sourceType`: `laptop_camera|looped_video`;
- `sourceMediaId` for simulation;
- `mapPosition`, `mapRevisionId`;
- `monitoringEnabled`;
- `connectionStatus`: `online|offline`;
- `cleanlinessState`;
- `isSimulation`;
- source error and last-frame timestamps.

New `cameraCreationDrafts` holds incomplete composite creation. Existing Registration collections remain.

### 7.4 Cleaners

`cleaners/{cleanerId}` removes assignment meaning from Zone/capability fields and adds:

- `siteId`;
- `stationPoint`, `stationZoneId`, `mapRevisionId`;
- `weeklySchedule` keyed by weekday with nullable `{startTime,endTime}`;
- `availabilityOverride`;
- `activeWorkOrderId` or equivalent atomic busy pointer;
- derived presentation availability.

`cleanerPresence`, GPS history and push-token collections are retired after migration.

### 7.5 Monitoring and analytics

- `monitoringSessions/{siteId}`: owner session, lease, heartbeat, sequence metadata.
- in-memory per-Camera runtime buffers; no ordinary frame documents.
- `analyticsMinuteBuckets/{siteMinute}`: one Site document with per-Zone map, TTL/cleanup after 90 days.
- `analyticsDailySummaries/{siteDate}`: compact per-Zone map retained.
- `binPlacementInterventions/{id}`: implemented snapshot and timestamp.

### 7.6 Alerts and Work

Alerts add:

- camera-scoped active key;
- `issueType=bin_service` plus `observedCondition`;
- `priorityScore`, severity history and aging timestamps;
- new status enum;
- `isSimulation` and evidence-selection metadata.

Work Orders add:

- nullable `alertId`;
- `origin=alert|manual`;
- `managementMode=orchestrated|manual`;
- Camera or coordinate target snapshot;
- simplified status;
- deterministic title/instructions;
- severity, optional creation evidence and completion evidence;
- map revision and `isSimulation`.

### 7.7 Orchestrator and notifications

Keep `orchestratorRuns`, `orchestratorOutbox`, and decision history but version the schema for assignment and review episodes. Add Site pause/config state and structured explanation fields.

Raw LLM output goes to `data/orchestrator-debug`, never Firestore.

Notifications remove status/read/push delivery fields. Retain recipient UID, Site, type, entity reference, title/body, createdAt and idempotency identity.

## 8. Recommended API changes

Names below are proposed contracts for the API-first build.

### 8.1 Identity and Superadmin

```text
GET    /api/me
GET    /api/supervisors
POST   /api/supervisors
PATCH  /api/supervisors/:id
DELETE /api/supervisors/:id

GET    /api/superadmin/sites
POST   /api/superadmin/sites
GET    /api/superadmin/sites/:siteId
PATCH  /api/superadmin/sites/:siteId/status
POST   /api/superadmin/sites/:siteId/root-recovery
GET    /api/superadmin/audit-events
```

### 8.2 Site Map

```text
GET    /api/site-map
GET    /api/site-map/revisions
POST   /api/site-map/draft
PUT    /api/site-map/draft
DELETE /api/site-map/draft
POST   /api/site-map/draft/validate
POST   /api/site-map/draft/publish
```

Zone and placement writes occur through the map draft rather than independent unversioned CRUD.

### 8.3 Camera Creation and monitoring

```text
POST   /api/camera-creation-drafts
GET    /api/camera-creation-drafts/:id
PUT    /api/camera-creation-drafts/:id
POST   /api/camera-creation-drafts/:id/reference
POST   /api/camera-creation-drafts/:id/validate
POST   /api/camera-creation-drafts/:id/publish
DELETE /api/camera-creation-drafts/:id

PATCH  /api/cameras/:id/monitoring
POST   /api/cameras/:id/reconfiguration-draft

POST   /api/monitoring-sessions/claim
POST   /api/monitoring-sessions/:id/heartbeat
POST   /api/monitoring-sessions/:id/release
POST   /api/cameras/:id/live-samples
```

Keep existing upload/processing-result APIs for model replay and sandbox tests.

### 8.4 Cleaners

```text
GET    /api/cleaners
POST   /api/cleaners
PATCH  /api/cleaners/:id
DELETE /api/cleaners/:id
PUT    /api/cleaners/:id/schedule
PUT    /api/cleaners/:id/availability-override

GET    /api/cleaner/me
GET    /api/cleaner/work-orders
GET    /api/cleaner/work-orders/:id
POST   /api/cleaner/work-orders/:id/start
POST   /api/cleaner/work-orders/:id/ready-for-review
```

Remove accept, reject, presence, location-history and push-token endpoints.

### 8.5 Alerts, Work and Verification

```text
GET    /api/alerts
GET    /api/alerts/:id
POST   /api/alerts/:id/dismiss
POST   /api/alerts/:id/manual-assignment

GET    /api/work-orders
POST   /api/work-orders/manual
POST   /api/work-orders/:id/reassign
POST   /api/work-orders/:id/dismiss
POST   /api/work-orders/:id/verification
POST   /api/work-orders/:id/verification/override
```

Status changes use action endpoints or strict transition schemas, not a generic arbitrary status patch.

### 8.6 Notifications

Frontend reads recipient notifications through Firestore `onSnapshot`. Node owns writes. A Node list endpoint may remain for Postman/debugging but read/unread mutations are removed.

### 8.7 Orchestrator

Private tools:

```text
GET  /internal/orchestrator/alerts/:alertId/assignment-context
POST /internal/orchestrator/alerts/:alertId/assign-cleaner
GET  /internal/orchestrator/work-orders/:id/review-context
POST /internal/orchestrator/work-orders/:id/resolve
POST /internal/orchestrator/work-orders/:id/rework
```

Supervisor controls:

```text
GET  /api/orchestrator/status
POST /api/orchestrator/pause
POST /api/orchestrator/resume
GET  /api/orchestrator/runs
GET  /api/orchestrator/runs/:id
```

### 8.8 Dashboard and Bin Placement

```text
GET  /api/dashboard
GET  /api/bin-placement/recommendations?days=N
POST /api/bin-placement/recommendations/refresh
POST /api/bin-placement/zones/:zoneId/implement
GET  /api/bin-placement/interventions
GET  /api/bin-placement/interventions/:id/comparison?days=N
```

## 9. Reset and bootstrap strategy

### 9.1 Approved clean restart

Existing Firestore prototype data does not need field-by-field migration. The approved target is a clean application-data restart with one Site named **Sunway Theme Park**.

The rebuild target is the isolated Firebase project `litterspot-dev-jeremy` using Firestore database `(default)`. The shared production project `litterspot/litterspot` must not be read, reset, seeded, or used by new backend development commands.

The development project was verified with zero Auth users and zero Firestore collections. Initial bootstrap therefore needs no deletion. Reset tooling remains useful for later repeatable development resets.

Do not run destructive commands as an incidental implementation step. Build a dedicated reset/bootstrap command with dry-run counts, exact Firebase project/database checks, and an allowlisted collection set. Execute it only after explicit approval.

### 9.2 Isolation from existing data

- shared-production Firebase Authentication users are not reused or deleted;
- the old Supervisor identity is not reused automatically;
- shared-production Firestore data remains untouched;
- old `data/media-store` files remain untouched but are not used by development-cloud configuration;
- development media uses `.local/dev-cloud-media`.

### 9.3 Reset safety

The reset tool must:

- refuse to run unless project ID is `litterspot-dev-jeremy` and database ID is `(default)`;
- show document counts in dry-run mode;
- delete only named LitterSpot collections and known subcollections;
- never use a broad filesystem target;
- clean local media through a separate explicit operation;
- bootstrap only after new Phase 1 schemas are deployed.

Because the database restarts cleanly, compatibility readers and legacy status migration are not required for new seeded records. Legacy collection code still needs removal or isolation so it cannot recreate old documents after reset.

## 10. API testing and isolated sandbox

### 10.1 Default verification

Each phase must deliver:

- unit tests for pure rules and state transitions;
- Firestore emulator tests for authorization, transactions, leases and idempotency;
- API integration tests for role/Site isolation;
- Postman YAML requests and response assertions;
- schema/contract tests between Node, FastAPI and the LLM worker;
- dry-run migration fixtures.

### 10.2 Sandbox boundary

Do not integrate the current `frontend/`.

Create a separate `api-sandbox/` only for flows that genuinely need browser interaction:

- Site grid and Zone polygon plotting;
- composite Camera Creation and Registration;
- laptop webcam permission/capture;
- looped-video playback and Monitoring Session lease;
- frame/video overlays;
- Firestore real-time notification subscription.

The sandbox must call real APIs and may use hardcoded controls. It is not a product frontend and should not define product component contracts.

### 10.3 Existing frontend working-tree changes

The current uncommitted `frontend/src/pages/PipelinePage.tsx`, `frontend/src/services/processingAPI.ts`, and related styles demonstrate API result visualization but must not become the product integration target. Before implementation, decide whether to move the useful tester into `api-sandbox/` or leave it untouched until the new sandbox phase.

## 11. Recommended implementation phases

### Phase 0 — Contract freeze and reset harness

- approve this gap analysis;
- freeze new enums, role claims, Site scope and collection names;
- create validated dry-run reset/bootstrap tooling and fixtures;
- version Postman folders;
- add role/Site-isolation test matrix.

Exit: no live deletion; approved reset scope and bootstrap preview.

### Phase 1 — Site tenancy, roles and Superadmin

- add Superadmin/Root/Regular roles;
- Site-scope every authenticated request;
- build Supervisor CRUD, Site creation, deactivation/reactivation, Root recovery and audit;
- remove global Supervisor access.

Exit: cross-Site access tests fail closed; Superadmin audit passes.

### Phase 2 — Site Map and Cleaner operations

- build map draft/revision geometry;
- add Station Points, schedules and Availability Override;
- replace Cleaner provisioning with direct password creation;
- remove GPS/Zone/capability/presence dependencies;
- preserve atomic busy pointer.

Exit: geometry and schedule emulator tests pass.

### Phase 3 — Composite Camera Creation and live monitoring

- create Camera Creation drafts;
- implement first-laptop and looped-video rules;
- implement `monitoringEnabled`, source replacement and simulation marker;
- add Monitoring Session lease/failover and live-sample endpoint;
- retain upload/processing APIs for replay tests.

Exit: webcam/video sandbox can create, register and sample a Camera without persisting ordinary frames.

### Phase 4 — Flags, Alerts and priority

- change to camera-scoped active keys;
- add `bin_service`, new thresholds and evidence buffer;
- add new statuses, priority score, aging/escalation and paused notifications;
- keep Flags internal;
- migrate old Alerts/Flags.

Exit: temporal and age-driven emulator workflows pass.

### Phase 5 — Work Orders, Verification and notifications

- simplify Work statuses/actions;
- add manual Work targets/evidence;
- deterministic titles/instructions;
- deterministic Camera Verification;
- add manual/orchestrated management mode;
- replace FCM/read-state with Firestore real-time recipient notifications and rules.

Exit: complete Cleaner and Supervisor Postman journeys pass; notification rules are verified.

### Phase 6 — Orchestrator integration

- adapt `task-assignment-llm` providers/prompts;
- expose five private Node tools;
- add top-10 sequential scheduler, candidate and technical retries;
- add pause/resume/backlog, one-run lease and manual takeover;
- store structured run history and local raw debug output.

Exit: isolated provider tests plus Node-emulator-worker end-to-end assignment/review pass.

### Phase 7 — Dashboard, analytics and Bin Placement

- add minute flush and 90-day cleanup;
- add lifetime daily summaries;
- rebuild Dashboard metrics, Top Alerts and Busy Zones;
- replace recommendation policies with equal-weight live leaderboard;
- add refresh, Intervention, exclusion and arbitrary comparison periods.

Exit: time-controlled analytics tests and API reports pass.

### Phase 8 — Hardening and frontend handoff

- run migration in reviewed steps;
- reconcile legacy records;
- finalize Postman and API reference;
- performance/rate/lease tests;
- provide frontend team contracts and example payloads;
- integrate only after their new frontend lands.

Exit: complete API-first acceptance workflow and handoff package.

## 12. Recommended first build decision

Do not begin with Camera UI or Orchestrator code.

Start with Phase 0 and Phase 1 because every new endpoint depends on correct Site isolation and Root/Regular/Superadmin authorization. Building map, Camera, Cleaner or Work APIs before tenancy would require rewriting their authorization and query boundaries afterward.

After Phase 1, build Site Map and Cleaner schedule/Station Point together. They establish the coordinates and availability context needed by Camera Creation, manual Work, Dashboard, and the LLM.

## 13. Decisions needed before implementation

1. Decide whether the useful current model-test UI is moved into `api-sandbox/` or left untouched until Phase 3.
2. Approve proposed API/collection naming or request naming changes.
3. Run the finalized checkpoint full-bin validation during Phase 0; configure full-bin Alerts off if it proves unreliable.
