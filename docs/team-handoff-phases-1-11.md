# Team handoff: LitterSpot backend through Phases 1–11

Last updated: 2026-08-18

## 1. Why this document exists

This is the pull/setup/migration handoff for the large backend checkpoint built
after repository commit `b2052a9` (`Merge pull request #2 from
Cstan0824/melissabranch`, 2026-08-11).

That commit was primarily a Python/SQLite operations-console prototype. The
new checkpoint changes the application authority to Node.js + Cloud Firestore,
keeps FastAPI private and inference-only, adds server-owned media processing,
redefines flags/alerts, and implements authenticated Cleaner/work-order backend
services.

Read this before extending old routes or frontend API types. Some old files and
screens remain useful as visual/model references, but several old runtime paths
are deliberately retired and must not be restored.

## 2. Current implementation status

Backend Phases 1–11 are implemented, with the Node-owned Phase 12 and backend
Phase 14 foundations now layered on top:

1. Firebase foundation and Supervisor authentication.
2. Site, zone, camera, Cleaner-directory, media, and local-storage foundation.
3. Node-owned image upload, processing job, analysis run, and detection slice.
4. Grouped issue observations, temporal confirmation, flags, and alerts.
5. Site dashboard backend and summary reconciliation.
6. Server-owned video upload, ffmpeg sampling, tracking, retry, and recovery.
7. Deterministic priority-zone analytics and CSV reports.
8. Python/SQLite business-state retirement.
9. Security, pagination, idempotency, system events, retention, and acceptance
   hardening.
10. Authenticated Cleaner identity, role dispatch, migration, and access.
11. Cleaner presence/location, work orders, notifications, and FCM effect.
12. Orchestrator outbox/runs, leases, typed context/assignment tools, and audit.
14. Backend review/rework foundation: cleaner evidence submission,
    `awaiting_verification`, durable review requests, immutable review attempts,
    and claimed clean/rework decision tools.

Not implemented yet:

- the Cleaner mobile PWA;
- React cutover for live dashboard/alerts/analytics/work orders;
- LangGraph, PostgreSQL checkpoints, or autonomous LLM assignment;
- LangGraph/LLM/VLM reasoning and fresh-camera evidence collection (Node review
  persistence and transitions are implemented; the model runtime is not);
- live CCTV/IP-camera streams;
- Option A Caddy/Compose/Ollama deployment packaging.

## 3. Architecture: old commit versus this checkpoint

### 3.1 Old commit `b2052a9`

```text
React
  -> public Node proxy routes
  -> FastAPI pipeline/business endpoints
  -> Python AnalysisStore
  -> SQLite + local evidence
```

The old implementation exposed Python routes for analysis history, placement,
operations dashboard/alerts/history, evidence, video-frame sessions, and a
legacy detector. Node mostly proxied those endpoints. Python generated business
flags and persisted application state. Browser-side video code sampled frames
and depended on a process-memory Python video session.

### 3.2 Current checkpoint

```text
Supervisor/Cleaner browser
  -> Firebase Authentication
  -> public Node.js/Express API
       -> Cloud Firestore (business authority)
       -> local media store (bytes)
       -> private FastAPI /analyze/frame (stateless inference)
```

Node now owns:

- role authentication and authorisation;
- sites, zones, cameras, and Cleaner records;
- media uploads and processing jobs;
- image/video orchestration and local evidence;
- analysis runs, detections, issue observations, flags, and alerts;
- alert status/history/occurrences;
- dashboard reads and summary reconciliation;
- analytics buckets/reports;
- Cleaner permissions, presence, location history, work orders, histories,
  notifications, and FCM delivery attempts;
- idempotency, system events, retention, and audit-safe errors.

FastAPI now owns only model loading, preprocessing, inference, model-specific
post-processing, and isolated model-test adapters.

## 4. Newly built workflows

### 4.1 Location and identity hierarchy

```text
site -> cleaning zone -> logical camera/source
```

There is no separate `area` layer.

Supervisor flow:

```text
Firebase sign-in
  -> Node verifies token
  -> userAccounts role dispatch
  -> active supervisors profile
  -> Supervisor-only API access
```

Cleaner flow:

```text
Supervisor creates Cleaner personnel record
  -> Supervisor provisions account through Node
  -> deterministic Firebase Auth UID + email reservation
  -> one-time password setup link
  -> Cleaner signs in
  -> userAccounts dispatches Cleaner role
  -> Cleaner-only profile/presence/work/notification access
```

Cleaner Firestore document IDs remain the business identity. Do not manually
create Cleaner Firebase Auth accounts or reinterpret the document ID as an Auth
UID.

### 4.2 Operational image workflow

```text
POST /api/media/images (defaults to isTest=true)
  -> validate signature/MIME/size/focus polygon
  -> deterministic idempotency fingerprint
  -> local media + Firestore processing job
  -> POST /api/processing-jobs/{jobId}/process
  -> private FastAPI /analyze/frame
  -> Node normalization and Firestore analysis/detection records
  -> Node grouped alert evaluation
  -> Node analytics application when eligible
```

An identical `clientRequestId`, file, and processing configuration returns the
existing records. Reusing the key with different content/options returns `409`.

### 4.3 Operational video workflow

```text
POST /api/media/videos
  -> streamed staging upload
  -> signature + ffprobe validation
  -> queued video job
  -> Node worker uses ffmpeg to sample frames
  -> sequential private FastAPI inference
  -> deterministic frame media/runs/detections
  -> persisted progress, retry/resume, and bin identity tracking
  -> grouped alerts and analytics per completed frame
```

Video processing belongs to the server. Closing Postman/browser does not stop a
started job. The queue is intentionally single-process/single-host for now.

### 4.4 Detection, observation, flag, and alert meaning

These are separate records:

```text
raw model detection
  -> one grouped positive/negative issue observation per run + issue type
  -> optional grouped flag when policy qualifies the observation
  -> temporal confirmation for that camera
  -> one active alert per zone + issue type
```

Current provisional policy:

- floor litter: detection confidence at least `0.50`, then 3 positive
  observations among the latest 5 within 30 minutes;
- bin overflow: 2 positives among the latest 3 within 15 minutes;
- floor spill: 2 consecutive positives within 10 minutes;
- people counting is analytics-only;
- active alert uniqueness is `zoneId + issueType`, while confirmation buffers
  remain camera-specific;
- resolving an alert resets the confirmation generation;
- an active Cleaner work order blocks premature alert resolution.

Python's lower `floorConfidence` upload option determines which raw detections
are returned for inspection. Node's operational policy decides whether those
detections qualify for flags/alerts.

### 4.5 Test data versus operational data

Uploads default to:

```json
{ "isTest": true }
```

Test uploads still persist media metadata, jobs, analysis runs, raw detections,
and grouped scoring details. They do not advance temporal confirmation, create
operational flags/alerts, or feed priority-zone analytics.

Set `isTest=false` only for intentional operational tests. Those runs can
create alerts and alter analytics.

### 4.6 Dashboard and priority-zone analytics

The stable dashboard is `GET /api/dashboard?siteId=...`. The existing React
operations dashboard has not been cut over to it.

Priority-zone analytics is deterministic Node logic, not another trained
model. It ranks zones using provisional weights:

- 35% litter incident burden;
- 30% average people pressure;
- 25% overflow incident burden;
- 10% issue persistence.

It requires at least 8 successful hourly buckets, 2 local calendar days, and an
80% successful-sample ratio before presenting a ranked score. Limited data
correctly returns `insufficient_data`.

### 4.7 Cleaner and work-order workflow

Assignment eligibility normally requires:

- linked and active Cleaner account;
- permitted site and zone;
- suitable capability (`general_cleaning`, `floor_litter`, `bin_overflow`, or
  `floor_spill`);
- fresh online heartbeat (currently five minutes);
- no other active work order.

Supervisor can explicitly record an availability override. The current domain
uses one primary Cleaner per work order and one active work order per alert.

```text
assigned -> accepted -> in_progress -> ready_for_review -> completed
    |                         ^                |
    -> rejected -> reassign  |                -> rework_required
                              +------------------------
active state -> cancelled (Supervisor override)
```

Cleaner submission does not resolve the cleanliness alert. The backend now
holds the alert in `awaiting_verification`; a claimed orchestrator review can
resolve it cleanly or return it to active work for rework. The LangGraph/VLM
runtime that supplies the reasoning is still a separate teammate deliverable.

Notifications are written durably in Firestore inside the business workflow.
FCM is a best-effort effect. Missing/failed push remains visible in the in-app
inbox.

## 5. Explicitly abandoned runtime paths

Do not restore these as compatibility routes.

### 5.1 Removed Python business modules

- `ai-service/app/analysis_store.py`
- `ai-service/app/placement_analysis.py`
- `ai-service/app/video_tracking.py`

### 5.2 Removed Python endpoints

- `POST /analyze/video-frame`
- `GET /analysis/recent`
- `/placement/recommendation/*`
- `/operations/*`
- `/analysis/evidence/*`
- legacy `POST /detect/image`

### 5.3 Removed Node proxy/runtime modules

- `backend/src/routes/operationsRoutes.ts`
- `backend/src/routes/pipelineRoutes.ts`
- `backend/src/services/operationsClient.ts`
- `backend/src/services/pipelineClient.ts`
- `backend/src/data/alertStore.ts`
- public `/api/operations/*`
- public `/api/detections/pipeline/*`

### 5.4 Abandoned concepts/contracts

- SQLite as application authority;
- Python-created business flags/alerts;
- Python persistence switches and analysis IDs in inference responses;
- browser-owned/process-memory operational video sessions;
- Python automatic alert resolution;
- old alert values such as `active`, `dismissed`, and SQLite-shaped uppercase
  frontend DTOs;
- camera-level binary placement recommendation as the final analytics output;
- direct browser access to Firestore application collections;
- permanent deletion of normal business records instead of soft deactivation;
- `site -> area -> zone -> camera` hierarchy.

The old ignored SQLite/evidence files are not migrated and are not required to
start the current application.

## 6. Work that is still reusable

### 6.1 AI/model teammates

Still used:

- `ai-service/app/bin_localizer.py`
- `ai-service/app/multi_state_classifier.py`
- `ai-service/app/floor_hazard.py`
- inference orchestration inside `ai-service/app/pipeline.py`
- floor focus-region processing and coordinate translation;
- people counting and bin/litter/spill model outputs;
- training/evaluation scripts and datasets under `ml-training/`;
- tracked production checkpoints:
  - `models/production/bin_localizer_yolo11n.pt`
  - `runs/state_classifier/multitask_gco_gbs_v2/production.pt`
  - `runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt`
  - `yolo26s.pt`

FastAPI still exposes `/health`, `/model/info`, `/classify/bin`,
`/classify/image-bins`, and the private `/analyze/frame` contract.

Model teammates can replace/evaluate weights without owning alerts, work
orders, dashboards, or persistence. Restart FastAPI after replacing a loaded
checkpoint.

### 6.2 Frontend teammates

Useful existing work:

- page shell, styling, navigation, overlays, ROI editor, result visualisation,
  video player/timeline, and general dashboard visual ideas;
- Firebase Supervisor login;
- current site/zone/camera and Cleaner-directory API integration.

Do not treat the old operations console's dummy alerts, history, placement, or
browser-video calls as the live backend contract. The current React build still
contains intentionally deferred/dummy sections and no Cleaner PWA. Integrate
against `docs/api-reference.md` and the canonical Postman YAML instead of
extending retired `/api/operations` or `/api/detections/pipeline` shapes.

### 6.3 Future orchestrator teammate

The implemented work-order and Cleaner context records are the foundation, but
The Node-owned Phase 12 foundation now provides durable alert outbox/run
records, lease claims, typed context and Cleaner-fact tools, decision audit
records, and validated orchestrator work-order creation. The LangGraph service
must still not write Firestore directly. It will call these authenticated Node
tools; PostgreSQL will own LangGraph checkpoints when the AI teammate builds
that runtime.

## 7. What each teammate can test now

### Backend/integration

```bash
npm run verify:phase11
```

This uses a demo Firebase project and temporary local media. It must not write
the shared cloud database. It runs:

- backend unit/contract tests and builds;
- frontend compatibility build;
- canonical Postman validation;
- 14 inference-only Python tests;
- Firebase Auth/Firestore HTTP integration;
- image idempotency and cursor integration;
- Cleaner login/role/presence/work-order/reassignment/rework/deactivation;
- media/location retention;
- alert, dashboard, analytics, and system-event smoke workflows.

### AI/model work

```bash
PYTHONDONTWRITEBYTECODE=1 ./.venv/bin/python -m unittest discover \
  -s ai-service/tests -p 'test_*.py'
```

Windows PowerShell:

```powershell
$env:PYTHONDONTWRITEBYTECODE="1"
.\.venv\Scripts\python.exe -m unittest discover -s ai-service\tests -p 'test_*.py'
Remove-Item Env:PYTHONDONTWRITEBYTECODE
```

Use Postman folder `05 - AI model test adapters` for isolated bin-state tests.
Use operational media jobs only when testing the full model-to-Firestore path.

### Frontend work

Use the canonical API folders under `postman/collections/` as executable
examples. Stable folders currently cover authentication, sites, zones,
cameras, Cleaners, media/jobs, analysis, flags/alerts, dashboard, video,
analytics, system events, Cleaner identity/presence, and work orders.

The default `isTest=true` upload flow is safe for inspecting inference and DTOs
without creating operational alerts.

## 8. Setup after pulling this checkpoint

### 8.1 Prerequisites

- Git
- Node.js 22 recommended (Node 20+ is supported by the repository)
- npm
- Python 3.12 recommended and used by CI
- FFmpeg and ffprobe on `PATH`
- Java 21+ recommended for current/future Firestore Emulator releases
- Firebase project access only when using the shared cloud project

GPU/CUDA is optional. CPU inference works but is slower. The committed model
weights listed above are sufficient for the current default paths.

Check tools:

```bash
node --version
npm --version
python3.12 --version
ffmpeg -version
ffprobe -version
java -version
```

Windows PowerShell:

```powershell
node --version
npm --version
py -3.12 --version
ffmpeg -version
ffprobe -version
java -version
```

### 8.2 Install JavaScript and Python dependencies

From the repository root:

```bash
npm ci
python3.12 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r ai-service/requirements.txt
./.venv/bin/python -m pip check
```

Windows PowerShell:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

Do not reuse a virtual environment created with another Python version. Delete
and recreate `.venv` locally when changing Python; `.venv` is ignored.

### 8.3 Run the isolated verification gate first

```bash
npm run verify:phase11
```

The emulator gate uses `demo-litterspot`, Auth port `9099`, Firestore port
`8080`, and UI port `4000`. It deliberately removes cloud credentials from the
test child process. The first run may download emulator binaries.

### 8.4 Configure the shared cloud project for manual application use

Copy examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Windows PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
```

In `backend/.env` set:

- `FIREBASE_PROJECT_ID=litterspot`
- `FIREBASE_DATABASE_ID=(default)`
- `GOOGLE_APPLICATION_CREDENTIALS` to an absolute Firebase Admin JSON path
  outside the repository;
- optional local media/ffmpeg paths when defaults are unsuitable.

In `frontend/.env.local`, set the Firebase Web App values from Firebase Project
Settings. These identify the Firebase web application; never put the Firebase
Admin private key in frontend configuration.

The service-account file must be distributed privately by an authorised team
member and stored outside this repository. 

On macOS/Linux:

```bash
chmod 600 /absolute/path/to/firebase-admin-service-account.json
```

On Windows PowerShell, store the file outside the repository and restrict its
NTFS permissions to the current Windows user:

```powershell
icacls "C:\absolute\path\to\firebase-admin-service-account.json" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Replace the example path with the actual location of the service-account file.

Email/Password Authentication, the named Firestore database `litterspot`,
Phase 1–11 indexes, two migrated Cleaner records, and one Supervisor role
dispatch already exist in the shared cloud project. No Cleaner Firebase Auth
account was automatically created by the migration.

Do not rerun Supervisor bootstrap or deploy indexes unless the responsible team
member asks you to. The Cleaner account endpoint is the only supported way to
create a Cleaner Auth identity.

### 8.5 Start locally

```bash
npm start
```

The launcher starts:

- FastAPI: `http://127.0.0.1:8000`
- Node API: `http://127.0.0.1:3000`
- React/Vite: `http://127.0.0.1:5173`

It supplies a matching local internal token between Node and FastAPI. Press
Ctrl+C or use `npm stop` to shut down the launched services.

Health checks:

```text
GET http://127.0.0.1:8000/health
GET http://127.0.0.1:3000/api/health/live
GET http://127.0.0.1:3000/api/health/ready
```

### 8.6 Postman setup

Use Postman Desktop Local View with the canonical YAML under:

```text
postman/collections/
postman/environments/LitterSpot Local.environment.yaml
```

Do not import or edit `postman/exports/`; those are stale local exports and are
ignored. File-upload requests intentionally commit no absolute file path. Each
developer selects a local JPEG/PNG/WebP/MP4/WebM in Postman.

Set local-only environment values:

- Firebase Web API key;
- Supervisor email/password;
- later, Cleaner email/password after a Supervisor creates the invitation.

Run `Firebase Login`, then `Current Supervisor`. Cleaner testing uses a
separate token through `Cleaner Firebase Login`; it never replaces the
Supervisor token.

### 8.7 Shared-cloud/local-media warning

Firestore is shared cloud state, but uploaded bytes are stored under each
Node host's local `MEDIA_STORAGE_ROOT`. A media document created on one laptop
does not copy the file to another laptop.

Therefore:

- prefer `npm run verify:phase11` and the emulator for automated tests;
- use unique client request IDs for intentional cloud smoke tests;
- do not assume another teammate's evidence file exists locally;
- do not request another host's media content through your local Node process,
  because a missing local file may be marked `missing` in shared Firestore;
- use one coordinated Node/media host for shared demonstrations until Phase 15
  replaces this constraint.

## 9. Database and retention operations

Already applied to shared cloud Firestore:

- Phase 1–11 composite indexes;
- migration of two Cleaner records;
- one Supervisor `userAccounts` role dispatch;
- a post-migration dry run with zero pending changes.

Administrative commands are dry-run-first:

```bash
npm --workspace=backend run migrate:cleaner-accounts -- --dry-run
npm --workspace=backend run media:retention -- --dry-run
npm --workspace=backend run location:retention -- --dry-run
```

Do not use an `--execute` retention command without the documented maintenance,
privacy, and backup procedure in `docs/operations-runbook.md`.

## 10. Known limitations at this checkpoint

- Current React dashboard/alerts/placement sections are not fully integrated
  with the stable backend DTOs.
- No Cleaner mobile UI exists yet; only the backend/Postman contract exists.
- No LangGraph service, VLM provider adapter, or PostgreSQL checkpoints exist
  yet; Node-owned private review tools and the Firestore outbox/run state are
  implemented.
- Model reasoning and fresh-camera evidence collection remain separate
  teammate deliverables; Node enforces review transitions and idempotency.
- No live camera stream ingestion or fresh-camera evidence request exists.
- Local media and the in-process video queue constrain Node to one host.
- FCM requires a real frontend web token/VAPID setup; without it the Firestore
  inbox remains the fallback.
- Model accuracy is not treated as a release gate yet.
- Managed Firestore backups require a billing decision; see the operations
  runbook.

## 11. Rules for new changes

- Browser and orchestrator clients call Node; they do not write Firestore.
- Business state belongs in Node/Firestore, not FastAPI.
- FastAPI response changes require matching Node schemas/tests.
- New list endpoints must be bounded and cursor-safe.
- New mutations need semantic idempotency and immutable history where relevant.
- API changes update `docs/api-reference.md`, canonical Postman YAML, schemas,
  tests, and Firestore indexes together.
- Use `isTest=true` unless an operational alert/analytics effect is intended.
- Never commit `.env`, Firebase Admin credentials, tokens, setup links, local
  media, `.DS_Store`, personal Postman metadata, or stale Postman exports.

## 12. Primary reference documents

- `README.md` — installation and current overview
- `docs/api-reference.md` — public Node API contract
- `docs/architecture.md` — ownership and technology boundaries
- `docs/backend-build-and-migration-plan.md` — phase status and team ownership
- `docs/firestore-data-model.md` — collections, transactions, and indexes
- `docs/requirements-baseline.md` — consolidated requirements and decisions
- `docs/autonomous-orchestrator-and-cleaner-plan.md` — Phases 12–15 direction
- `docs/operations-runbook.md` — backup, recovery, retention, and incidents

## 13. Verification result for this checkpoint

The final `npm run verify:phase11` gate passed before handoff:

- 166 backend unit/contract tests;
- backend TypeScript build;
- frontend production compatibility build;
- 106 canonical Postman YAML/script validations;
- 14 FastAPI inference-only tests;
- Firebase Auth/Firestore HTTP, pagination, image-idempotency, Cleaner/work
  order, media/location retention integration;
- alert, dashboard, analytics, and system-event smoke workflows.

The cloud Cleaner migration and index deployment also completed successfully.
