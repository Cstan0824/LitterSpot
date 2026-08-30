# LitterSpot backend build and Python-to-Node migration plan

> This is the historical V1 phase plan. The clarified V2 database and migration plan is in [`data-model-v2/06-migration-plan.md`](data-model-v2/06-migration-plan.md).

## 1. Purpose and status

This document plans the work needed to move LitterSpot from its current demonstration implementation to the agreed prototype architecture.

It answers four questions:

1. What are we building?
2. What existing work should be reused?
3. Which Python-owned responsibilities must move to Node.js/Express?
4. In what order should the migration happen without breaking the working inference pipeline?

Related documents:

- [requirements-baseline.md](./requirements-baseline.md)
- [architecture.md](./architecture.md)
- [firestore-data-model.md](./firestore-data-model.md)
- [autonomous-orchestrator-and-cleaner-plan.md](./autonomous-orchestrator-and-cleaner-plan.md)

**Plan status:** active implementation plan, aligned through the combined
Phase 10 Cleaner identity and Phase 11 Cleaner operations backend on
2026-08-18. React/mobile UI cutover remains intentionally deferred.
The authenticated Cleaner and autonomous AI Supervisor programme is approved as
the next extension but is not part of the completed Phase 1-8 claim.

## 2. Target outcome

The target request path is:

```text
React
  -> Firebase Authentication for sign-in
  -> Node.js/Express for every LitterSpot application operation
  -> Firestore for authoritative business data
  -> local storage abstraction for uploads and evidence
  -> private FastAPI only when inference is required
```

Node.js becomes the owner of Supervisor/Cleaner role profiles, Cleaner
permissions/presence, work orders, notifications, locations, media jobs,
detections, flags, alerts, status histories, dashboard queries, and
priority-zone analytics. FastAPI remains responsible for model loading,
preprocessing, inference, and model-specific post-processing.

The Firestore database in this target path is hosted in the selected Firebase cloud project. A local emulator may be used for tests, but it is not the shared or deployed application database.

The first completed prototype must support:

- one all-powerful Supervisor role;
- Supervisor login and authenticated profile/session handling, beginning with one bootstrapped account;
- Cleaner personnel CRUD, explicit Firebase login provisioning, role-isolated
  self access, site/zone permissions, capability assignment, and deactivation;
- consented mobile availability/location, one-primary-Cleaner work orders,
  immutable history, durable inbox notifications, and best-effort FCM;
- site, cleaning-zone, and logical camera/source management;
- authenticated image uploads;
- authenticated video uploads with observable processing status;
- floor-litter, bin-overflow, and people-count inference;
- optional liquid-spill inference;
- separate raw detection, grouped issue-observation, flag, and alert records;
- one active alert per cleaning zone and issue type;
- New, Acknowledged, In Progress, and Resolved statuses;
- forward status skipping with immutable history;
- dashboard, alert list/details, evidence, and detection history;
- zone-level heatmaps and priority-zone ranking;
- local media/evidence storage behind a replaceable interface.

The implemented backend now includes the Cleaner/mobile/work-order portion.
The approved next target adds an autonomous LangGraph/LLM Supervisor. The LLM
makes assignment and verification decisions without routine human approval;
Node.js continues to validate typed commands, enforce invariants, and commit
Firestore state.

### 2.1 Team implementation ownership for the approved extension

The application-backend owner for this plan is responsible for the **Cleaner
backend and the Node.js integration boundary**. They are not responsible for
implementing LangGraph, selecting or hosting the local LLM/VLM, writing agent
prompts, or building the agent's reasoning graph.

#### Application-backend owner scope

- Firebase Authentication provisioning/linking for Cleaner accounts;
- Firestore Cleaner profiles, site/zone permissions, activation, and safe
  migration of the existing personnel records;
- role-aware Node.js authentication and authorisation;
- Cleaner availability and consented location-heartbeat APIs;
- work-order records, state transitions, assignment attempts, rework,
  cancellation, and immutable histories;
- persisted notification records and FCM delivery integration;
- alert-to-orchestrator outbox/run events and retry/idempotency behaviour;
- typed, authenticated Node.js tool endpoints that expose context and accept
  assignment, reassignment, review, rework, and resolution commands;
- validation of hard invariants before every write, including active account,
  permitted site/zone, legal state transition, and duplicate prevention;
- Firestore audit records for agent decisions and tool executions received
  through the integration contract;
- backend tests, API documentation, Postman resources, and deployment
  configuration needed to expose those backend services safely.

The backend may calculate factual inputs such as distance, location freshness,
eligibility, and current workload. It does not choose the Cleaner on behalf of
the LLM or implement a hidden ranking algorithm.

#### Orchestrator/AI teammate scope

- Python/LangGraph service implementation and graph design;
- agent prompts, reasoning flow, memory, checkpoints, and retry strategy inside
  the graph;
- local LLM/VLM selection, installation, hosting, quantisation, and model
  evaluation;
- Ollama/vLLM/online-provider adapters;
- deciding which eligible Cleaner to assign, the instructions, reassignment,
  and the outcome of verification;
- consuming the backend's typed context/tools and returning schema-valid tool
  commands;
- AI-specific tests and evaluation scenarios for assignment and review quality.

#### Frontend teammate scope

- Cleaner mobile-web/PWA screens;
- permission-aware Supervisor and Cleaner navigation;
- availability/location consent UI;
- work-order inbox, notification, accept/reject, progress, and ready-for-review
  interactions;
- frontend integration against the documented Node.js APIs.

#### Shared integration contract

The backend owner and orchestrator teammate must jointly freeze:

- alert/run event payloads and correlation IDs;
- tool names, request/response schemas, authentication, and permissions;
- idempotency keys, timeouts, retryable versus terminal errors, and rate limits;
- work-order and review status vocabulary;
- context size/redaction rules and audit fields;
- health/readiness endpoints and local deployment addresses.

This boundary allows the Cleaner backend to be developed and tested using a
deterministic fake orchestrator before the real LangGraph/LLM service is ready.
The real service can then replace the fake without changing Firestore business
rules or Cleaner-facing APIs.

## 3. Current repository assessment

### 3.1 Current runtime flow

The repository now has one application backend path:

```text
React/API client/Postman -> authenticated Node API
                         -> Firestore + Node-owned local media
                         -> private FastAPI for stateless frame inference
```

Node owns authentication, locations, cleaners, image/video jobs, analysis,
grouped flags and alerts, dashboard queries, and priority-zone analytics. Some
React screens still display dummy frontend data until the coordinated cutover,
but there is no Python/SQLite application-state path behind them.

### 3.2 Current Node.js backend

Useful existing work:

- Express 5 and TypeScript setup;
- central environment configuration;
- Multer upload handling;
- MIME and size validation for images;
- Zod request and AI-response validation;
- internal FastAPI token support;
- health endpoint through Node to FastAPI;
- inference rate-limit concept;
- Axios/FormData clients for private inference calls;
- route groupings for stable application services and isolated bin-model test
  adapters;
- Firebase Admin SDK configured for cloud project/database `litterspot`;
- Firebase ID-token verification and active-Supervisor profile checks;
- first-Supervisor bootstrap command and current-Supervisor endpoint;
- Firestore-backed cleaner CRUD with transactional staff-code uniqueness;
- Firestore-backed site, zone, and camera management;
- Node-owned local media storage, image processing jobs, analysis runs, and raw
  detection persistence;
- deterministic positive/negative issue observations and the
  `grouped-temporal-v2` workflow;
- grouped flags, per-camera temporal confirmation, zone-and-issue alert
  deduplication, occurrences, status transitions, and append-only history;
- authenticated `site-dashboard-v1` queries, current-workflow alert filtering,
  versioned summary reconciliation, and missing-index fallback diagnostics;
- streamed MP4/WebM upload, ffprobe/ffmpeg validation and extraction,
  server-owned video jobs, deterministic frame runs, progress, retry/resume,
  startup recovery, and per-video bin identity tracking;
- active-generation hourly zone analytics, exactly-once sample/incident
  application, safe bounded reconciliation, provisional deterministic scoring,
  stored reports, and CSV export;
- authenticated active-zone lookup and protected application routes;
- unit/contract coverage for schemas, normalization, policies, transitions,
  presentation, and job state.

What is missing:

- React dashboard and priority-zone ranking/heatmap cutover;
- React cutover to the stable image, observation, flag, and alert contracts;
- Cleaner mobile PWA integration against the implemented Phase 10-11 APIs;
- a billing-backed coordinated backup destination when the team leaves the
  Spark plan;
- Phase 12 autonomous orchestrator foundation.

The obsolete process-memory `/api/alerts` implementation has been removed. The
stable authenticated route now reads and writes the Firestore workflow; the
existing React alert screens still require a later DTO/integration cutover.

### 3.3 Current FastAPI service

The inference-only implementation includes:

- bin localisation;
- bin-state classification;
- floor-litter and optional spill segmentation;
- people detection/counting;
- quality checks and uncertainty reasons;
- focus-region cropping and coordinate translation;
- suppression of floor-litter false positives overlapping common objects;
- suppression of bin candidates substantially covered by people or foreground objects;
- model readiness and version reporting;
- a narrow, stateless combined-frame schema;
- tests for classifier safety, focus regions, false-positive filters, contract
  shape, and startup without SQLite.

Phase 8 removed `AnalysisStore`, SQLite startup/persistence, demo seeding,
evidence serving, Python video-session tracking, placement analytics, business
flags, and all operations/history routes. FastAPI retains only `/health`,
`/model/info`, `/classify/bin`, `/classify/image-bins`, and `/analyze/frame`.
The combined frame response is model data only; Node supplies trusted
application context and owns every query, mutation, ID, and business rule.

### 3.4 Current React frontend

Reusable work:

- application shell and operations navigation;
- dashboard, alert, history, and placement screen concepts;
- image upload and multi-image test interfaces;
- video playback and frame overlay components;
- bounding-box and polygon rendering;
- people, bin, litter, and spill overlays;
- focus-region editor;
- loading, empty, unavailable, and error-state patterns;
- periodic dashboard refresh;
- types that describe the existing inference result.
- a new cleaner-directory UI with staff ID, name, phone, assigned zone, and active/inactive state;
- a Supervisor-profile form and login-page visual design;
- a second alert-center layout using the confirmed four-stage vocabulary.

Work that must still change:

- add cleaner edit controls for the current directory; current create/list/status
  APIs are non-login personnel CRUD until the approved account migration;
- add site/zone/camera selection and management;
- replace hard-coded camera IDs and seeded six-camera assumptions;
- change alert statuses from `active/resolved/dismissed` to the confirmed workflow;
- display separate alert status history;
- connect currently dummy screens to the stable Node-owned APIs;
- replace camera-level binary placement recommendations with zone priority ranking;
- change video from browser-owned one-frame-per-second sampling to a real upload/processing-job workflow;
- distinguish test/demo uploads from analytics-eligible operational uploads.

The latest branch currently has two competing alert UIs/contracts: `OperationsConsole` still uses `active/resolved/dismissed`, while `AlertsPage` and `/api/alerts` use `NEW/ACKNOWLEDGED/IN_PROGRESS/RESOLVED`. Only one Node-owned contract should survive the migration. The standalone `AlertsPage` also computes a zone match but currently omits it from the filter result, so its zone filter has no effect.

The previously deleted `scripts/start-local.mjs` launcher has been restored. It again provides the root `npm start`/`npm run start:local` workflow on macOS/Linux.

### 3.5 Retired SQLite demo data

The old local SQLite artifact, if still present in a developer's ignored data
directory, contained:

- six seeded cameras;
- six demo analysis rows;
- zero alerts;
- zero alert-status events;
- six default placement-state rows.

This is demo data, not production history. FastAPI no longer opens the file, so
moving or deleting it does not affect startup or inference. It should not be
imported into Firestore as operational evidence; equivalent fixtures should be
created explicitly through Node-owned development tooling.

## 4. Reuse, port, replace, and retire decisions

### 4.1 Keep in FastAPI

| Current code | Decision | Reason |
| --- | --- | --- |
| `bin_localizer.py` | Keep | Model inference and bounding-box generation |
| `multi_state_classifier.py` | Keep | Model loading, quality checks, state signals, and model-level interpretation |
| `floor_hazard.py` | Keep | Litter/spill segmentation, people detection, and model-specific filtering |
| Focus-region transformations in `pipeline.py` | Keep | Image preprocessing and coordinate mapping belong beside inference |
| Bin/object overlap filtering in `pipeline.py` | Keep | Model-specific false-positive post-processing |
| Pydantic inference schemas | Keep and narrow | Preserve a typed private contract while removing business records |
| `/health` and `/model/info` | Keep | Private service health and model diagnostics |
| Model configuration and registry concepts | Keep | Model paths, versions, thresholds, and runtime readiness |
| Existing AI-service unit tests | Keep and adapt | They protect valuable inference and post-processing behaviour |

FastAPI returns observations and detections. It does not create business flags,
write application records, serve dashboard data, or decide alert status. Its
internal `POST /analyze/frame` multipart contract is `file` plus optional
`floor_confidence`, `localizer_confidence`, and JSON `focus_region`. The exact
response fields are `image`, `focusRegion`, `peopleCount`, `people`, `bins`,
`floorHazards`, `modelVersions`, and `processingTimeMs`; see
[api-reference.md](./api-reference.md#private-fastapi-post-analyzeframe).

### 4.2 Reused or ported into Node.js

| Python behaviour | Node target | Reuse strategy |
| --- | --- | --- |
| SQLite camera concept | Location/camera service | Redesign for site/zone/camera in Firestore |
| `AnalysisStore.save` orchestration | Analysis persistence service | Rewrite in TypeScript using Firestore transactions/batches and media references |
| Active-alert lookup by camera and kind | Alert service | Preserve deduplication intent but replace the legacy scope with transaction-safe zone-and-issue active-alert keys |
| Alert status-event concept | Alert history repository | Preserve previous/new status, actor, timestamp, and note |
| Evidence path validation | Media storage service | Preserve safe relative keys and authenticated serving |
| Placement episode deduplication | Analytics service | Port the testable idea, redesign scoring for zones and include litter burden |
| Data-coverage gate | Analytics service | Preserve and make configurable |
| Video semantic confirmation | Video processing service | Reuse the implemented Node grouped-temporal policy for sampled frames; port only useful session-lifecycle behaviour |
| IoU/proximity video identity matching | Video processing service | Implemented as a small pure TypeScript tracker with a persisted resume checkpoint |
| Existing Python placement/video tests | Vitest tests | Translate business-rule cases into Node tests before deleting Python ownership |

These behaviours were redesigned around the Node status vocabulary, location
hierarchy, Firestore integrity model, grouped temporal policy, and zone-level
analytics rather than translated line by line. The obsolete Python business
implementations and their tests were deleted after equivalent Node ownership
was established.

### 4.3 Keep and extend in Node.js

- `app.ts` composition and central error handling;
- `env.ts`, expanded for Firebase and local storage;
- Multer validation patterns;
- FastAPI token and timeout handling;
- Zod request and response schemas;
- private AI client boundary;
- current health path;
- sequential inference as the safe default when local GPU memory is limited.

### 4.4 Reuse selectively in React

- operations shell and navigation;
- annotated image/video views;
- focus-region editor;
- upload controls;
- alert table/detail layout;
- cleaner registration/directory layout and validation rules;
- Supervisor login/profile layouts, after replacing their demo behavior;
- detection-history layout;
- placement/analytics cards as a visual starting point;
- shared concepts from current TypeScript response types.

The frontend team should reuse visual and interaction work, but replace current API types with the new Node contracts rather than extending the SQLite-shaped contract indefinitely.

### 4.5 Retired after parity in Phase 8

- `AnalysisStore` and SQLite application persistence;
- Python `/operations/*` routes;
- Python `/analysis/recent` and evidence-serving routes;
- Python placement routes and `placement_state` ownership;
- Node `operationsClient.ts` proxy;
- Node recent/placement proxy methods in `pipelineClient.ts`;
- Python-generated business `flags` in inference responses;
- SQLite as an application runtime dependency.

The Python modules, endpoints, Node proxy clients/routes, and canonical Postman
requests above are retired and must not be restored as compatibility paths.
Deferred React screens should remain on dummy frontend data until they are
integrated with the stable Node contracts.

The following old design behaviours also remain rejected for the Node-owned
workflow:

- `active/resolved/dismissed` alert status vocabulary;
- `people_present` cleanliness alerts;
- automatic resolution merely because an issue is absent in one confirmed later sample;
- seeded `camera-1` through `camera-6` as permanent application data;
- camera-level yes/no placement output;
- browser-only video sampling as the operational video ingestion path.

## 5. Target Node.js module structure

The exact filenames may change, but Node should be organised around business capabilities rather than one large route layer.

```text
backend/src/
  app.ts
  server.ts
  config/
    env.ts
    firebase.ts
  middleware/
    authenticate.ts
    requireActiveSupervisor.ts
    errorHandler.ts
  modules/
    supervisors/
    cleaners/
    locations/
    media/
    processing/
    inference/
    detections/
    flags/
    alerts/
    dashboard/
    analytics/
    systemHealth/
  infrastructure/
    firestore/
    firebaseAuth/
    localStorage/
  shared/
    schemas/
    errors/
    pagination/
```

Each module should separate HTTP routes, validation schemas, application services, and persistence repositories. Application services depend on repository/storage interfaces so Firestore and local files are not scattered through route handlers.

## 6. Planned backend capabilities

### 6.1 Supervisor authentication and cleaner management

- Firebase ID-token verification middleware;
- active-Supervisor check on every protected request;
- current-Supervisor endpoint and permitted self-profile updates;
- one-time first-Supervisor bootstrap command;
- Firebase Auth and Firestore partial-failure reconciliation for Supervisor bootstrap/profile operations;
- list, view, create, edit, assign, and deactivate cleaner personnel records in Firestore;
- no Firebase Authentication identity, password, token, or role for a cleaner;
- cleaner soft deactivation so historical assignments remain identifiable;
- actor snapshots in histories so the responsible Supervisor remains identifiable.

### 6.2 Location and camera management

- site CRUD with soft deactivation;
- cleaning-zone CRUD within a site;
- logical camera/source CRUD within a zone;
- optional focus-region configuration;
- upload-only source mode now;
- reserved stream fields for later CCTV integration;
- camera/service availability status.

The confirmed prototype hierarchy is `site -> cleaning zone -> camera`. No separate area collection or `areaId` is planned.

### 6.3 Media and processing jobs

- authenticated image and video upload endpoints;
- storage of original media through a local-storage interface;
- metadata, checksum, size, MIME, capture time, and location validation;
- explicit test/demo mode versus analytics-eligible mode;
- queued/processing/completed/failed job state;
- progress for video frames;
- idempotent retry behaviour;
- authenticated evidence retrieval;
- cleanup/retention policy left configurable.

An operational upload should be assigned to a logical camera. An unassigned ad-hoc model test may run inference, but it should not create alerts or influence analytics.

### 6.4 Private inference integration

- one stable private inference contract for a complete frame;
- FastAPI health/model-version diagnostics;
- Zod validation of every FastAPI response;
- explicit timeouts and mapped service-unavailable errors;
- persistence of model versions and processing latency;
- no trusted site/user/business data accepted back from FastAPI;
- optional spill results handled without making spills mandatory.

### 6.5 Detection persistence

- one analysis-run record per image or sampled video frame;
- one detection document per cleanliness issue result;
- people count stored as an observation, not a cleanliness alert;
- compact bin/person output retained for overlays;
- confidence, coordinates, model version, capture time, and evidence links;
- low-confidence detections retained for review;
- an analytics-eligibility flag to keep demo/test data out of reports.

### 6.6 Flags and alerts

- retain raw detection documents independently of workflow decisions;
- create one deterministic issue observation for every analysis run and issue
  type, including negative observations;
- create at most one grouped flag for each positive run-and-issue observation;
- evaluate provisional, configurable temporal rules per camera: floor litter
  requires 3 positive observations in the latest 5 within 30 minutes, bin
  overflow requires 2 in the latest 3 within 15 minutes, and floor spill
  requires 2 consecutive positives within 10 minutes;
- use floor-litter magnitude as an additional policy input while retaining the
  raw detections that produced it;
- create or attach to one active alert per cleaning zone and issue type after a
  temporal rule confirms;
- attach confirmed positive flags as alert occurrences/evidence;
- transaction-safe alert creation and deduplication;
- default New -> Acknowledged -> In Progress -> Resolved progression;
- forward stage skipping;
- no backward transitions or reopening in version one;
- immutable status history with Supervisor identity snapshot;
- resolved alerts remain searchable;
- start a fresh temporal sequence after an alert is resolved;
- calculate policy inputs for test uploads while excluding them from flags,
  alerts, and confirmation state;
- no automatic people-count alert; people counts are analytics input only.

A negative issue observation contributes to its camera's rolling temporal
window, but it does not create a flag, attach to an alert, or silently mark a
human workflow alert Resolved. Resolution remains a Supervisor action for the
current requirements.

### 6.7 Dashboard and history (backend implemented)

- active-alert summary;
- configured/available camera counts;
- latest result per camera and zone;
- recent detections and processing failures;
- alert list, filters, details, evidence, and status history;
- resolved alert history;
- data-unavailable states;
- response shapes designed for the dashboard instead of exposing raw Firestore documents.

The stable backend DTO, summary reconciliation, alert/history APIs, evidence
URLs, and bounded-query diagnostics are implemented. React consumption of this
contract is intentionally deferred.

### 6.8 Priority-zone analytics (backend implemented)

- hourly zone buckets;
- people-pressure metrics;
- deduplicated litter and overflow incident metrics;
- issue persistence and data-coverage metrics;
- configurable deterministic scoring;
- high/medium/low/insufficient-data bands;
- ranked zones with factor breakdown and plain-language reasons;
- filterable heatmap input;
- report record and CSV-ready data;
- no additional trained analytics model.

The implemented backend uses immutable analytics generations. Incremental
image/video completion writes an eligible run once through a deterministic
sample marker. A separate alert/first-observation marker applies an incident to
the first buffered observation's hour, avoiding both duplicate incidents and a
shift to the later confirmation frame. Reconciliation stages a bounded
replacement generation under a lock and atomically publishes its pointer only
after a complete rebuild.

The provisional policy is `priority-zone-v1-provisional`: 35% litter incidents,
30% average people per successful sample, 25% overflow incidents, and 10%
approximate issue persistence. Scoring requires 8 successful hourly buckets,
2 local calendar days, and an 80% success ratio; high begins at 70 and medium
at 40. This produces a zone priority, not an exact point, and uses no new
trained model. React consumption is deferred.

## 7. Migration strategy

Use a strangler-style migration: introduce Node-owned capabilities beside the working path, move one vertical slice at a time, and remove Python business endpoints only after parity.

### Phase 0 - Contract and safety baseline

Work:

- preserve the current passing build and AI tests;
- define a versioned private FastAPI frame response;
- separate inference fields from business flags and database IDs;
- add Node contract tests using captured representative FastAPI responses;
- document test/demo versus operational upload behaviour;
- inventory model artifacts and required environment variables.

Acceptance:

- current image inference still works;
- Node rejects malformed AI responses;
- the private contract contains litter, overflow, people, optional spill, geometry, confidence, model versions, and processing time;
- no new persistence dependency is introduced into FastAPI.

### Phase 1 - Firebase foundation and Supervisor authentication

Work:

- create/configure the prototype Firebase project and local emulator configuration;
- add Firebase Admin SDK to Node;
- add Firebase client authentication to React;
- implement ID-token and active-profile middleware;
- implement first-Supervisor bootstrap;
- implement current-Supervisor profile APIs;
- implement cleaner list/view/create/edit/deactivate APIs backed by Firestore;
- add Firestore repository tests against the emulator.

Acceptance:

- protected APIs reject missing/invalid tokens;
- an active Supervisor can use protected APIs;
- an inactive Supervisor profile immediately blocks Node access even if an old Firebase token has not expired;
- no password is stored in Firestore.
- creating a cleaner writes no Firebase Authentication identity;
- deactivating a cleaner removes the person from active assignment choices while preserving the record.

### Phase 2 - Location, media, and storage foundation

Work:

- implement site, zone, and logical-camera collections/APIs;
- implement the local storage adapter;
- implement media metadata and processing-job records;
- implement authenticated media/evidence streaming;
- add dev seed data for a sample attraction without importing SQLite demo rows.

Acceptance:

- a Supervisor can configure a location hierarchy and logical upload camera;
- uploads use generated storage keys and cannot escape the configured storage root;
- Firestore contains metadata, not media bytes or absolute local paths;
- test uploads can be excluded from alerts and analytics.

### Phase 3 - Node-owned image-analysis vertical slice

Work:

- accept an authenticated operational image upload;
- persist the media and processing job;
- call the private FastAPI frame endpoint;
- validate and persist the analysis run, people observation, and detections;
- save evidence references;
- expose job, run, and detection retrieval APIs;
- keep a compatibility adapter for the existing frontend image route if needed.

Acceptance:

- the complete image result is stored in Firestore by Node;
- FastAPI performs no SQLite write for the new endpoint;
- people count is persisted without creating an alert;
- a failed inference leaves a visible failed job and does not create partial business records.

### Phase 4 - Node-owned flag and alert workflow (Implemented)

Work:

- group raw detections into one positive or negative issue observation per
  analysis run and issue type;
- apply the versioned `grouped-temporal-v2` Node workflow and provisional,
  configurable issue-specific policy;
- create at most one flag per positive observation;
- maintain per-camera temporal confirmation state;
- implement the zone-and-issue active-alert-key transaction;
- implement confirmed occurrences and evidence updates;
- implement status transitions and history;
- translate relevant Python alert/deduplication tests to Vitest.

Acceptance:

- floor litter confirms at 3-of-5 observations within 30 minutes, overflow at
  2-of-3 within 15 minutes, and spill at 2 consecutive observations within 10
  minutes, independently for each camera;
- repeated confirmed observations from cameras in the same zone produce one
  active zone-and-issue alert;
- test uploads expose computed policy results but do not mutate flags, alerts,
  or temporal confirmation state;
- resolving an alert releases the active key and advances the reset generation,
  so a later incident must satisfy a fresh temporal sequence;
- status skipping works only in the forward direction;
- alert and status-history updates are atomic;
- people count never generates a cleanliness alert.

### Phase 5 - Dashboard backend service (Backend implemented; React cutover deferred)

Completed backend work:

- implemented authenticated, site-scoped `GET /api/dashboard` with the stable
  `site-dashboard-v1` DTO;
- included configured cameras and their latest runs, current-workflow active
  alerts, recent raw detections, recent failed jobs, evidence URLs, summary
  counts, completeness markers, and query-mode diagnostics;
- implemented `GET /api/dashboard/summary` and authenticated
  `POST /api/dashboard/reconcile` for versioned
  `site-dashboard-summary-v1` snapshots;
- kept alert filters/details/history and local evidence behind stable Node APIs;
- made alert and flag lists default to `workflow=current`, with explicit
  `legacy` and `all` audit scopes;
- committed the required Firestore composite-index definitions; the active
  alert list requires its index, while recent detections/failures retain a
  bounded 500-candidate `fallback_bounded_scan` path until their indexes are
  deployed;
- added unit/schema coverage for dashboard presentation, bounds, workflow
  filtering, and summary reconciliation.

Backend acceptance:

- the dashboard API reads Firestore and Node-owned evidence rather than Python
  dashboard state;
- current active-alert counts exclude resolved and pre-v2 alerts;
- summary reconciliation is rebuildable from authoritative site records and
  records the authenticated Supervisor UID;
- bounded-source and missing-index behavior is visible in the response instead
  of silently overstating completeness;
- the DTO is documented for a later frontend integration pass.

Deliberately deferred frontend work:

- the existing React operations dashboard remains on dummy frontend data;
- no component was partially migrated in this backend phase;
- the later coordinated cutover will replace the dummy data and old alert DTO
  usage together while retaining useful overlays and layouts. Retired Python
  routes are not a compatibility option.

### Phase 6 - Server-owned video upload and processing (Backend implemented; React cutover deferred)

Completed backend work:

- added streamed, authenticated MP4/WebM uploads linked to an active Camera;
- validated file signatures, MIME/container metadata, dimensions, and duration
  with ffprobe before moving the file under a Node-generated local storage key;
- established configurable defaults of 250 MiB, 600 seconds, a 2-second sample
  interval, and at most 300 frames (`frameIntervalSeconds` accepts 1–10);
- created explicit queued video jobs and `202` process/retry endpoints with
  observable frame progress and failure state;
- sampled and processed frames sequentially in a concurrency-one Node worker,
  using ffmpeg for extraction and private FastAPI only for frame inference;
- reused the Node-owned grouped temporal policy for each sampled frame and
  added small, pure IoU/proximity bin identity tracking across frames;
- persisted extracted-frame media, deterministic frame analysis runs,
  detections, observations, flags/occurrences, tracking checkpoints, and
  idempotent job-summary application markers;
- made jobs resumable at frame boundaries through claim leases, deterministic
  IDs, saved progress, retry, and startup recovery;
- kept test-video outputs inspectable while excluding them from confirmation,
  flags, alerts, and analytics.

The implemented worker is intentionally process-local and supports one Node
instance. A persistent external worker/queue is still required before live
streams or multi-instance deployment.

Backend acceptance:

- closing the browser does not stop the video job;
- repeated/resumed frame processing uses deterministic records and application
  markers so it does not intentionally duplicate runs, flags, occurrences,
  alerts, or job counts;
- job progress and failure are visible;
- one persistent issue is filtered through the same temporal confirmation and
  active zone-alert deduplication instead of becoming one alert per frame;
- `isTest=true` remains the safe default and cannot mutate business workflow or
  analytics state.

Deliberately deferred frontend work:

- the React operations console still uses dummy browser-side video data;
- browser-owned sampling can be removed in the later coordinated frontend
  cutover after the stable polling and result DTOs are adopted.

### Phase 7 - Priority-zone analytics (Backend implemented; React cutover deferred)

Completed backend work:

- built hourly, active-generation site/zone buckets from eligible operational
  runs with people, positive-sample, qualifying-detection, model-version,
  incident, and approximate persistence metrics;
- added deterministic generation-scoped sample markers and separate
  alert/first-observation incident markers for exactly-once retry behavior;
- excluded `isTest=true` and `analyticsEligible=false` runs;
- added same-camera persistence state, with out-of-order incremental samples
  contributing zero until chronological reconciliation;
- added a bounded, locked reconciliation path that stages and atomically
  publishes a new generation without exposing partial rebuilds;
- implemented and tested the provisional four-factor, max-relative site score,
  explicit sufficiency gate, bands, ranks, factor breakdown, and plain-language
  reasons;
- persisted report records and zone-result subcollections and exposed
  authenticated list, generate, detail, and CSV contracts;
- added required Firestore indexes plus explicit, bounded missing-index
  fallback diagnostics;
- verified rebuild, test exclusion, exactly-once samples/incidents,
  persistence, ranking, report reads, and CSV against cloud Firestore with
  isolated records that were cleaned afterward.

Backend acceptance:

- test/demo uploads are excluded from bucket metrics;
- insufficient coverage produces `insufficient_data`, never a confident score;
- the same generation, source data, and policy produce deterministic rankings;
- incidents attach to the first supporting observation's hour exactly once;
- each zone result explains its factors, coverage, evidence, and reasons;
- the output is a priority zone rather than an exact coordinate;
- no trained analytics model is involved.

Known prototype limitations:

- reconciliation is bounded to 5,000 runs, 5,000 alerts, and 15,001
  observations per site; report generation is bounded to 100,000 selected
  buckets;
- the missing-index bucket fallback scans at most 10,000 site buckets and
  report-history fallback scans at most 1,000 reports;
- persistence is an approximate positive-to-positive same-camera duration;
- failed inference attempts that never create an `analysisRun` do not yet
  increment analytics `failedSampleCount`;
- superseded generations are retained until a later cleanup/retention command.

Deliberately deferred frontend work:

- the current React placement UI remains on dummy camera-oriented
  contract;
- the coordinated cutover will replace it with zone ranks, factor explanations,
  coverage states, and a zone heatmap using `/api/analytics`.

### Phase 8 - Python business-state retirement (Implemented)

Completed work:

- remove FastAPI `AnalysisStore` dependency from the inference pipeline;
- remove Python operations/history/evidence/placement routes;
- remove SQLite initialisation from service startup;
- remove Node proxy clients that target those routes;
- archive or delete obsolete Python business tests after equivalent Node tests pass;
- retire obsolete canonical Postman requests and document the private stateless
  inference contract.

Verified acceptance:

- FastAPI lifespan starts with SQLite deliberately unavailable;
- `/analyze/frame` accepts only model inputs and returns only inference fields;
- Python exposes no operations, history, evidence, placement, video-session, or
  legacy detector endpoint;
- Node/Firestore owns every application query and mutation;
- the AI-service inference/contract suite passes. Broader end-to-end acceptance
  remains part of Phase 9.

### Phase 9 - Hardening and handoff (Implemented)

Completed work:

- opaque timestamp/document-ID cursor pagination and bounded query limits for
  operational history, including analysis runs;
- authenticated-user general, upload, inference, and processing-mutation rate
  limits with standard response headers;
- configured browser-origin CORS, Helmet headers, hidden Express identity,
  request IDs, structured request logs, and generic safe error responses;
- image/video request fingerprints, transaction-safe upload publication,
  processing leases/recovery, and idempotent replay/conflict behaviour;
- dry-run-first local media retention with active-alert/in-flight protection,
  owned-path validation, fail-closed state handling, metadata preservation, and
  an explicit offline `--execute` mode;
- generation-safe, deduplicated AI/video/analytics system events with safe
  detail allowlisting and authenticated read APIs;
- graceful video-queue shutdown and startup recovery;
- a coordinated Firestore/local-media backup, restore, index, incident, and
  retention runbook that explicitly records the Spark-plan backup limitation;
- canonical Postman health/system-event/hardening coverage and updated public
  API/frontend integration documentation;
- one `npm run verify:phase9` gate covering backend/frontend builds, Python
  inference contracts, Firebase Auth HTTP behaviour, Firestore cursor and
  retention integration, plus alert/dashboard/analytics/system-event smokes.

Verified acceptance:

- public liveness/readiness exposes no model internals and all error paths carry
  a traceable request ID;
- an emulator-issued Firebase token reaches protected HTTP routes, while an
  inactive profile and malformed token are denied;
- cursor continuation is stable across equal timestamps and rejects reuse with
  different filters;
- identical image requests reuse one media/job record while file or option
  drift returns `409`;
- retention dry run mutates nothing and execution removes only an eligible
  expired file while preserving protected evidence and Firestore history;
- grouped alerts, dashboard reconciliation, analytics reports, and system-event
  recovery pass against the named Firestore emulator database;
- all in-repository Phase 9 gates pass and the checked-in indexes are deployed
  to the cloud `litterspot` named database. Managed cloud backup/restore remains
  intentionally unavailable on the selected Spark plan until billing is
  approved.

### Phase 10 - Cleaner identity and role access (Backend implemented)

**Primary owner:** application-backend owner. Cleaner UI is integrated by the
frontend teammates.

Completed backend work:

- added a role-dispatch record and Cleaner-auth link without changing existing
  personnel document IDs;
- added controlled Supervisor provisioning/invitation and disable/reconciliation
  flows across Firebase Auth and Firestore;
- added role-aware middleware and Cleaner self-profile/session endpoints;
- restricted Cleaners to their own work, notifications, and presence data;
- added a dry-run-first idempotent migration for existing Cleaner and
  Supervisor role-dispatch records.

Verified acceptance:

- an active linked Cleaner can sign in; an unlinked/inactive Cleaner cannot;
- Supervisor and Cleaner permissions are mutually enforced by HTTP tests;
- partial Auth/Firestore failures can be retried without duplicate accounts;
- historical records still reference the original Cleaner business ID.

### Phase 11 - Cleaner mobile operations and work orders (Backend implemented; PWA deferred)

**Primary owner:** application-backend owner for APIs, Firestore, state
machines, and notifications; frontend teammates for the mobile PWA.

Completed backend work:

- added availability and consented location heartbeats with five-minute
  freshness and seven-day dry-run-first history retention;
- implemented the mobile-facing Cleaner work queue APIs; frontend teammates
  still own the mobile PWA;
- implemented work orders, assignment attempts, rejection, reassignment,
  rework, cancellation,
  and immutable histories;
- added durable Firestore notifications and best-effort FCM delivery attempts;
- retained Supervisor manual assign/reassign/rework/complete/cancel override
  paths until the orchestrator is connected.

Verified acceptance:

- a Cleaner sees only their work and can accept/reject/start/submit review;
- retries cannot duplicate transitions or notifications;
- stale location is labelled and never represented as live;
- push failure still leaves a visible in-app notification.

The combined Firebase Auth/Firestore HTTP acceptance test also verifies fresh
heartbeat eligibility, semantic idempotency conflicts, immutable rework and
completion history, rejection/reassignment to a second Cleaner, presence
release, notification read state, account deactivation, and mutual
Supervisor/Cleaner route denial.

### Phase 12 - Autonomous orchestrator foundation (Node foundation implemented; LangGraph runtime not implemented)

**Ownership split:** the application-backend owner builds the durable trigger,
typed Node.js tools, validation, and audit persistence. The orchestrator/AI
teammate builds LangGraph, PostgreSQL checkpoint use, provider adapters, and
agent execution.

Completed Node-owned work:

- added deterministic alert-triggered `orchestratorRuns` and
  `orchestratorOutbox` records in the alert creation transaction;
- added Supervisor run inspection, idempotent run seeding, and expired-lease
  recovery;
- added private token-authenticated worker polling, claim leases, typed alert
  context, Cleaner eligibility facts, decision audit records, and completion;
- routed orchestrator work-order creation through the existing Node invariants
  with `actorType: "orchestrator"`;
- added Postman requests, Firestore indexes, schemas, and emulator acceptance
  coverage.

Remaining teammate-owned work:

- add a private Python/LangGraph service and one durable thread per alert;
- add PostgreSQL checkpointing and startup recovery;
- integrate the already-authenticated Node tools into the runtime's tool loop;
- add Ollama/vLLM/online-provider abstraction and bounded audit records.

Node foundation acceptance:

- duplicate alert/run triggers create one run and one outbox event;
- a run claim is exclusive and lease-bound;
- a mismatched worker cannot complete a claim;
- decision retries are idempotent;
- expired leases requeue through startup recovery or the Supervisor recovery
  endpoint;
- the orchestrator cannot write Firestore directly and all work-order commands
  pass through Node validation.

Remaining full Phase 12 acceptance:

- a restarted orchestrator resumes from its checkpoint;
- duplicate alert events create one run and one active work order;
- the orchestrator cannot write Firestore or bypass Node state validation;
- model, prompt/policy, context, decision rationale, and tool calls are
  traceable without storing credentials or unrestricted prompts.

### Phase 13 - Autonomous assignment (Approved; not implemented)

**Ownership split:** the application-backend owner supplies validated facts and
executes typed decisions. The orchestrator/AI teammate owns LLM reasoning,
Cleaner selection, instructions, reassignment policy, and agent evaluation.

Work:

- supply eligible Cleaners, permissions, availability, workload, location
  freshness, calculated distance, and issue evidence as typed LLM context;
- let the LLM choose the Cleaner, instructions, timing, and reassignment;
- handle rejection, timeout, Cleaner deactivation, and service failure;
- keep human approval out of the normal path while retaining pause/override.

Acceptance:

- representative assignment scenarios are evaluated against expected safe and
  useful outcomes;
- application code computes facts but does not secretly replace the LLM choice
  with a ranking formula;
- invalid LLM commands are rejected and returned to the agent for replanning;
- every successful decision creates exactly one auditable work-order mutation.

### Phase 14 - Autonomous review and rework (Backend foundation implemented)

**Ownership split:** the application-backend owner owns evidence/review APIs,
state transitions, persistence, and idempotency. The orchestrator/AI teammate
owns LLM/VLM review reasoning and model integration.

Backend-owned work completed:

- add `awaiting_verification` to the target alert workflow;
- request fresh visual evidence after Cleaner submission;
- durable `reviewRequests` and immutable `reviews` subcollections;
- Cleaner evidence submission and `awaiting_verification` transition;
- private claimed-run request/decision routes with semantic idempotency;
- clean/rework/more-evidence/exception persistence and notification effects;
- dashboard counts and active-alert reads include `awaiting_verification`.

Still owned by the orchestrator/model teammate:

- use current trained models behind a future-compatible VLM adapter;
- let the LLM decide clean, rework, more evidence, or visible exception;
- provide fresh-camera evidence collection and model reasoning.

Acceptance:

- Cleaner submission alone never resolves an alert;
- rework returns the same issue to active work with immutable review/history;
- uncertain evidence cannot silently produce resolution;
- review retries cannot duplicate state changes.

### Phase 15 - Option A packaging and field handoff (Approved; not implemented)

**Shared ownership:** each teammate packages and documents their service. The
application-backend owner integrates the Node-facing environment variables,
private service authentication, health checks, and Compose/Caddy wiring; the
orchestrator/AI teammate supplies and validates the LangGraph/Ollama/VLM
runtime requirements.

Work:

- package React, Node, LangGraph, PostgreSQL, and FastAPI with Docker Compose;
- configure Caddy HTTPS and host-native Ollama where appropriate on macOS;
- keep FastAPI, LangGraph, PostgreSQL, and Ollama private;
- configure persistent volumes, health/readiness, restart recovery,
  backpressure, resource limits, monitoring, and coordinated backups;
- validate a tunnel for demos and a stable hostname/TLS plan for longer use.

Acceptance:

- Supervisor and Cleaner phones can use the system through trusted HTTPS;
- geolocation, service worker, and supported web-push flows work on target
  devices;
- restarting the host preserves Firestore business state, PostgreSQL agent
  checkpoints, and local evidence;
- the full alert-to-assignment-to-review workflow runs without human approval.

## 8. SQLite migration policy

### 8.1 Retired repository database

FastAPI no longer reads, creates, or writes the old database. Do not migrate the
six demo analyses or seeded cameras as production data. Recreate intentional
development fixtures through Node-owned scripts.

### 8.2 Optional importer

If a teammate later provides meaningful SQLite records, build a one-time, dry-run-capable importer after the Firestore schema is stable.

Suggested mapping:

| SQLite | Firestore target |
| --- | --- |
| `cameras` | sites/zones/cameras after explicit location mapping |
| `analysis_runs` | media assets, processing jobs, analysis runs, and detections |
| `payload_json` | parsed inference fields, never copied as an opaque authority |
| `evidence_path` | media asset with copied local storage key |
| `alerts` | alerts plus active-alert keys when still active |
| `alert_status_events` | alert status-history subcollections |
| `placement_state` | do not migrate; regenerate reports from Firestore observations |

Legacy status mapping, if ever needed:

- `active` -> `new` plus a migration note;
- `resolved` -> `resolved`;
- `dismissed` -> `resolved` with a legacy-dismissal note, unless a later requirement adds dismissal.

The importer must be idempotent, record legacy IDs, validate evidence files, and produce counts before writing.

## 9. Testing strategy

### 9.1 Keep

- current AI-service model/post-processing unit tests;
- backend and frontend TypeScript builds;
- model health diagnostics.

### 9.2 Add in Node

- Zod schema and normalisation tests;
- Firebase token/profile middleware tests;
- Supervisor token/profile and bootstrap reconciliation tests;
- cleaner CRUD, assignment validation, and soft-deactivation tests;
- storage path and upload validation tests;
- processing-job transition tests;
- AI-client contract tests;
- detection persistence and idempotency tests;
- flag threshold and severity tests;
- active-alert concurrency/deduplication tests;
- status-transition and immutable-history tests;
- dashboard query tests;
- video confirmation/resume tests;
- analytics bucket and zone-ranking tests;
- Firebase Emulator integration tests.

### 9.3 End-to-end acceptance path

1. Bootstrap and sign in as Supervisor.
2. Create a site, zone, and logical upload camera.
3. Create a cleaner, assign the cleaner to the zone, edit the record, and verify that no login identity was created.
4. Deactivate the cleaner and confirm the historical record remains while active assignments exclude it.
5. Upload an image containing people and floor litter.
6. Confirm the completed job, analysis, raw detections, and one issue
   observation per evaluated issue; verify that a single positive sample does
   not necessarily create an alert.
7. Upload the issue-specific confirmation sequence and confirm that positive
   groups produce at most one flag each and one zone-and-issue alert.
8. Upload another confirmed occurrence and confirm the same active alert is
   updated, including when it comes from another camera in the same zone.
9. Move the alert directly from New to In Progress, then to Resolved.
10. Confirm immutable history, actor identity, and a fresh temporal sequence
    before a later alert can be created.
11. Process a short video and confirm server-owned progress and deduplication.
12. Generate a priority-zone report and inspect its data-coverage explanation.
13. Mark the Supervisor profile inactive in a controlled test and confirm all protected access is denied.

### 9.4 Future autonomous end-to-end acceptance path

1. Provision and sign in an active Cleaner assigned to a test site/zone.
2. Go online, grant location permission, and verify location freshness.
3. Trigger a Phase 4 alert without a human assignment action.
4. Verify one durable orchestrator run gathers context and the LLM chooses an
   eligible Cleaner.
5. Verify Node accepts the typed decision, creates one work order, and writes a
   durable notification/FCM attempt.
6. Accept, start, and mark the work ready for review from the Cleaner PWA.
7. Supply fresh evidence and verify the orchestrator chooses clean, rework, or
   more evidence with an audit record.
8. Verify clean completes the work order and resolves the alert; rework returns
   it to active work without losing history.
9. Repeat events, requests, and process restarts to prove idempotency and
   checkpoint recovery.
10. Exercise Supervisor pause and manual override as exception paths.

## 10. Risks and controls

| Risk | Control |
| --- | --- |
| Big-bang migration breaks the working model path | Move one vertical slice at a time and retain compatibility routes temporarily |
| Firebase Auth and Firestore Supervisor bootstrap/profile writes partially succeed | Idempotent commands, compensation, reconciliation status, and tests |
| Duplicate alerts under concurrent detections | Transactional active-alert key per cleaning zone and issue type |
| Video processing stops with browser or Node restart | Server-owned job state and resumable frame IDs |
| Firestore reads grow from dashboard polling | Bounded queries, denormalised summary docs, and sensible refresh intervals |
| Firestore documents exceed limits | Store media locally, avoid base64/raw payloads, and split detections from runs |
| Local storage blocks multi-instance deployment | Storage interface and single-host prototype constraint |
| Model and business thresholds become mixed | FastAPI reports model confidence; Node owns configurable business criteria |
| Demo uploads pollute analytics | Explicit `isTest` and `analyticsEligible` fields enforced by Node |
| One persistent video issue is overcounted | Temporal confirmation, active-alert deduplication, and incident-based analytics |
| Existing frontend types lock in old statuses | Introduce new API DTOs and update components during dashboard cutover |
| LLM produces an impossible or unauthorised action | Expose only typed Node tools and validate role, site, state, and idempotency invariants before every write |
| Agent restart duplicates assignment or notification | Durable alert outbox, PostgreSQL checkpoints, deterministic keys, and transactional active-work guards |
| Browser background location stops updating | Timestamp every heartbeat, expose staleness, and fall back to last zone/manual check-in rather than claiming live tracking |
| Web push is unavailable or delayed | Persist every notification and provide an authenticated in-app inbox |
| Local LLM/VLM and vision models exceed host capacity | Benchmark together, quantise, limit concurrency, load VLM on demand, or move one private service to a second host |
| Local evidence and cloud records diverge | Coordinated backup/reconciliation and an explicit single-host storage constraint |

## 11. Decisions still needed during implementation

- Final calibration of the provisional alert magnitude, confidence, temporal,
  and severity rules.
- Field calibration of the configurable video defaults (2-second sampling,
  300 frames, 600 seconds, and 250 MiB).
- Background worker/queue choice after the single-process prototype.
- Field calibration of the implemented provisional analytics sufficiency gate
  (8 successful hours, 2 local days, 80% success), 35/30/25/10 weights, and
  70/40 priority bands.
- How to represent inference failures without an `analysisRun` in analytics
  coverage, and when to garbage-collect superseded analytics generations.
- Retention duration for uploads, frames, and evidence.
- Whether an alert may be reopened in a later version.
- Whether a full/near-full bin should be stored only as an observation or become a future warning type.
- Cleaner location heartbeat, staleness, consent, and retention settings.
- Assignment acceptance timeout and whether one work order can contain multiple
  Cleaners.
- Initial Ollama LLM, optional VLM, prompt policy, and agent evaluation dataset.
- Exact evidence/uncertainty thresholds for autonomous review.
- Option A hardware, stable hostname/TLS/tunnel, and backup destination.

These are configuration or later-scope decisions and do not block the initial Firebase/authentication/location foundation.

## 12. Current verification baseline

At the time of this plan:

- the repository was rechecked at merge commit `b2052a9` after the latest pull;
- the Node TypeScript backend builds successfully;
- the React TypeScript/Vite frontend builds successfully;
- all 14 remaining inference-only AI-service unit/contract tests pass after the
  obsolete Python business suites were retired;
- the bin-state classifier, bin localizer, floor-hazard model, and people model artifacts are present locally;
- cloud Firestore and Firebase Authentication connectivity is verified for project/database `litterspot`;
- Firebase Supervisor authentication and Firestore cleaner persistence are implemented as the first migrated vertical slice;
- the backend validation suite passes and now includes dashboard schema,
  presentation, current-workflow filtering, summary reconciliation, video
  upload validation, frame extraction planning, bin tracking, analytics API
  schemas, deterministic aggregation, scoring, and sufficiency tests;
- the backend TypeScript build passes and 147 non-emulator unit/contract tests
  pass at the Phase 7 checkpoint; later Phase 8/9 verification supersedes this
  historical count;
- isolated cloud Firestore analytics smoke testing passed for generation-safe
  reconciliation, test exclusion, sample/incident idempotency, persistence,
  reports, ranking, listing/detail, and CSV, then removed its test records;
- the root local launcher has been restored and passes JavaScript syntax validation.

## 13. Change log

### 2026-08-18 - Combined Phase 10-11 Cleaner backend completed

- Added deterministic Cleaner Firebase Auth provisioning, email reservation,
  role dispatch, first-sign-in activation, reconciliation, disable/reactivate
  handling, and a dry-run-first migration for existing records.
- Added strict Supervisor/Cleaner route isolation and actor-aware rate/log
  identity while preserving the current Supervisor `/api/me` response.
- Added consented presence/location heartbeats, five-minute freshness, seven-day
  privacy retention, permissions/capabilities, and active-work eligibility.
- Added one-primary-Cleaner work orders, active-alert keys, assignment attempts,
  rejection/reassignment, rework/completion/cancellation, immutable semantic
  idempotency history, durable notifications, and best-effort FCM delivery.
- Added a full Firebase Auth/Firestore HTTP journey covering two Cleaners,
  role denial, replay conflicts, rework, rejection/reassignment, notification
  fallback/read state, retention, completion, and Auth deactivation.
- Migrated the two existing cloud Cleaner records and one Supervisor role
  record idempotently; the post-migration dry run reported zero pending changes.
- Deployed the Phase 10-11 work-order, notification, and push-token indexes to
  the cloud `litterspot` named database.
- Kept the Cleaner PWA with the frontend team and automatic assignment/review
  with the Phase 12-14 orchestrator teammate.

### 2026-08-17 - Phase 9 hardening gate completed

- Added full cursor pagination for analysis history, request/security headers,
  configured CORS, authenticated-user rate limits, and safe structured errors.
- Hardened image idempotency and upload publication to match the server-owned
  video workflow.
- Added executable dry-run-first media retention, system-event APIs, graceful
  shutdown, Firebase Auth/Firestore integration tests, and one repeatable Phase
  9 verification command.
- Added the operational runbook for index deployment, coordinated backup and
  recovery, retention, and incident response; documented that managed
  Firestore backup/export requires a later billing decision.
- Deployed the Phase 9 cursor and system-event indexes successfully to the
  cloud `litterspot` named database.
- Kept Phase 10 Cleaner authentication entirely unstarted until this gate
  passed.

### 2026-08-17 - Autonomous Cleaner programme and Option A selected

- Added planned Phases 10-15 for Cleaner identity, mobile operations, work
  orders, LangGraph orchestration, autonomous assignment/review, and deployment.
- Kept current Phase 1-8 completion separate from the not-yet-implemented
  target.
- Confirmed the LLM makes routine assignment and verification decisions while
  Node.js owns typed execution, validation, idempotency, and Firestore writes.
- Selected one self-hosted Caddy/Compose machine with PostgreSQL, Ollama,
  FastAPI, and local media while Firebase Auth, Firestore, and FCM remain cloud
  services.

### 2026-08-17 - Team ownership clarified

- Scoped the application-backend owner's work to Cleaner identity, presence,
  work orders, notifications, Firestore workflows, typed orchestrator tools,
  validation, audit, and backend integration.
- Assigned LangGraph graphs, LLM/VLM hosting, prompts, provider adapters,
  reasoning, and AI evaluation to the orchestrator/AI teammate.
- Kept Cleaner PWA implementation with the frontend teammates and defined the
  event/tool contract as shared integration work.
- Required a deterministic fake orchestrator so backend development and testing
  do not wait for the real agent implementation.

### 2026-08-13 - Python business-state retirement completed

- Removed SQLite, `AnalysisStore`, demo seeding, evidence serving, placement,
  operations/history, video-session tracking, and Python-generated business
  flags from the FastAPI runtime.
- Narrowed `/analyze/frame` to a stateless model-input/model-output contract;
  Node now supplies trusted application context and owns all persistence,
  temporal tracking, flags, alerts, dashboard queries, and analytics.
- Removed the retired Node proxy routes/clients and their canonical Postman
  requests while retaining the two isolated bin-model test adapters.
- Verified the AI-service contract suite and startup with SQLite unavailable.

### 2026-08-13 - Phase 7 priority-zone analytics backend completed

- Added active-generation hourly Firestore buckets, same-camera persistence
  state, exactly-once sample markers, and separate alert/first-observation
  incident markers.
- Added a bounded site reconciliation lock/staging/publication workflow so a
  replacement generation is never exposed partially.
- Added the versioned provisional 35/30/25/10 scorer, 8-hour/2-day/80%
  sufficiency gate, high/medium/low/insufficient-data outputs, explanations,
  persisted report/zone-result records, and CSV export.
- Added authenticated reconcile, report generation/list/detail/CSV APIs,
  Firestore indexes, Postman resources, unit coverage, and a passing cloud
  Firestore smoke workflow with cleanup.
- Kept output scoped to priority zones, not exact placement points or a newly
  trained model, and deferred the React ranking/heatmap cutover.

### 2026-08-13 - Phase 6 server-owned video backend completed

- Added streamed MP4/WebM intake, ffprobe validation, generated local storage,
  and strict Supervisor/request/file idempotency.
- Added video job plans, a sequential Node worker, explicit `202` enqueue/retry
  requests, progress polling, per-frame failures, leases, and startup recovery.
- Added deterministic ffmpeg-extracted frame media/runs, resumable bin identity
  checkpoints, and idempotent frame-to-job summary application.
- Reused the authoritative Node grouped temporal workflow for sampled frames;
  FastAPI remains inference-only and test videos remain excluded from business
  state and analytics.
- Added the stable backend/Postman contract while intentionally deferring the
  React cutover and persistent multi-instance queue.

### 2026-08-13 - Phase 5 dashboard backend completed

- Added authenticated site dashboard, summary-read, and summary-reconciliation
  APIs with stable versioned DTOs.
- Added cameras/latest runs, current active alerts, recent detections, failed
  jobs, evidence links, completeness markers, and indexed/fallback query modes.
- Added exact active-alert aggregate counts, `complete | more_available` list
  completeness, and bounded 500-candidate recent-feed index fallbacks.
- Added current-by-default workflow filters to alert and flag listings while
  retaining explicit legacy/all audit access.
- Added versioned `dashboardSummaries` reconciliation from authoritative
  Firestore records and recorded the authenticated reconciliation actor.
- Kept the React dashboard on its existing dummy contract by decision;
  frontend cutover remains deferred; Phase 6 now provides its server-owned
  video backend, and the later Phase 7 backend now provides priority-zone
  analytics without changing that frontend-cutover decision.

### 2026-08-13 - Grouped temporal flags and alerts implemented

- Replaced the initial per-detection policy with the versioned
  `grouped-temporal-v2` workflow.
- Added one deterministic positive or negative issue observation per analysis
  run and issue type while retaining the underlying raw detections.
- Added at most one grouped flag per positive observation and per-camera
  confirmation rules: floor litter 3-of-5 within 30 minutes, overflow 2-of-3
  within 15 minutes, and spill 2 consecutive within 10 minutes.
- Added transactional one-active-alert enforcement per cleaning zone and issue
  type, idempotent occurrences, severity/evidence aggregation, and automatic
  evaluation during operational image processing.
- Added forward-only, stage-skippable status updates with append-only Supervisor
  history, active-key release, and a reset generation that requires a fresh
  confirmation sequence after resolution.
- Added stable issue-observation, flag, alert, policy, and replay APIs. Test
  uploads expose computed policy results but remain excluded from workflow
  mutations and analytics.
- Removed the obsolete process-local backend alert store. The existing React
  alert screen still uses its old DTO and is intentionally deferred to the
  later frontend integration/cutover milestone.
- Passed authenticated cloud verification for grouped observations, temporal
  confirmation, one active zone alert, status skipping, backward-transition
  rejection, resolution/reset, and idempotent replay; temporary records and
  media were removed.

### 2026-08-12 - Node-owned image analysis implemented

- Implemented transactional image-job claiming, retry, failure state, and
  idempotent completed-result retrieval.
- Configured the private FastAPI frame call as inference-only so the operational
  path makes no SQLite write.
- Added Node validation/normalization and atomic Firestore persistence for
  analysis runs, people observations, bin observations, and issue detections.
- Added stable analysis-run and detection query APIs plus Native Git Postman
  requests.
- Expanded the backend suite to thirty-four passing tests; all twenty-seven
  AI-service tests continue to pass.
- Added Node-owned API presentation rules: compact process responses, no dense
  polygons in detection lists, a 128-point stored/detail cap, authenticated
  evidence URLs, and no exposure of Python's duplicate inference messages as
  business flags.
- Passed an authenticated cloud smoke test covering image upload, private
  inference, atomic Firestore result persistence, completed-job idempotency,
  result retrieval, and unchanged SQLite history. Temporary test records and
  the uploaded file were removed afterward.

### 2026-08-12 - Media and processing-job foundation implemented

- Added authenticated, idempotent image upload linked to an active Camera.
- Added Node-generated storage keys, atomic local writes, image-signature
  validation, SHA-256 metadata, and protected content delivery.
- Added Firestore `mediaAssets` and queued `processingJobs` records with test
  uploads excluded from analytics by default.
- Added metadata/job list and detail APIs plus Native Git Postman requests.
- Expanded the backend suite to twenty-three passing validation and storage tests.
- Passed an authenticated cloud smoke test covering upload creation,
  idempotency, test exclusion, metadata/content access, and job queries; its
  temporary Firestore records and local file were removed afterward.

### 2026-08-12 - API-first integration workflow adopted

- Kept the existing Firebase login and location/cleaner React integration, but
  moved upcoming modules to backend-first development while React is changing.
- Added a versioned Node API reference and a secret-free Postman collection and
  environment template.
- At that checkpoint, classified Firestore routes as stable, AI proxy routes as
  test adapters, and in-memory/SQLite operations routes as transitional. Phase
  8 later retired the latter two route groups except the bin-model adapters.
- Established that each new backend service requires automated tests, Postman
  coverage, and documented request/response contracts before later React work.

### 2026-08-12 - Site, zone, and camera foundation implemented

- Added authenticated Node CRUD APIs and Firestore services for the complete
  `site -> zone -> camera` hierarchy.
- Added transactional camera-code reservation and active-parent validation.
- Added guarded soft deactivation so active cameras/cleaners prevent zone
  deactivation and active zones prevent site deactivation.
- Connected React location setup, camera dashboard counts, and cleaner zone
  choices to the cloud records.
- Added four location validation tests; the backend now has eight passing tests.

### 2026-08-12 - Firebase foundation implemented

- Connected Node to the named cloud Firestore database and Firebase Authentication using Application Default Credentials.
- Added first-Supervisor bootstrap, token/profile middleware, current-Supervisor endpoint, and protected business routes.
- Added transactional Firestore cleaner CRUD plus authenticated zone lookup.
- Replaced the React demo session with Firebase sign-in and connected cleaner create/list/status controls.
- Restored the missing local launcher and added environment/setup documentation.

### 2026-08-11 - Location hierarchy simplified

- Confirmed `site -> cleaning zone -> camera` and removed the area module/collection from the build plan.

### 2026-08-11 - Latest-branch and cleaner-management revision

- Re-inspected merge commit `b2052a9` and recorded the new local cleaner, alert, camera, and login UI work.
- Defined Supervisor as the only Firebase-authenticated role and cleaners as non-login Firestore personnel records.
- Replaced application-user CRUD with cleaner CRUD in Phase 1 and the acceptance path.
- Recorded the in-memory alert implementation, competing alert contracts, and missing root start script as current migration concerns.

### 2026-08-11 - Initial plan

- Audited the current React, Node, FastAPI, SQLite, inference, analytics, and test paths.
- Classified current work as keep, port, replace, or retire.
- Defined an incremental Node/Firestore cutover sequence.
- Recorded the current SQLite database as demo-only and not requiring production migration.
