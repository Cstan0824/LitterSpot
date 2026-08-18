# LitterSpot

LitterSpot is a cleanliness-monitoring prototype for tourist attractions. Its
public application path is React -> authenticated Node/Express API -> cloud
Firestore, with a private FastAPI service used only for computer-vision
inference. Node owns sites, zones, cameras, cleaners, media jobs, detections,
grouped flags and alerts, the dashboard read model, and priority-zone
analytics.

The repository now implements the Supervisor backend plus authenticated Cleaner
identity, role isolation, mobile presence/location APIs, work orders, durable
notifications, best-effort FCM delivery, the Node-owned orchestrator foundation,
and the backend-owned review/rework foundation: durable review requests,
immutable review attempts, `awaiting_verification`, and idempotent clean/rework
state transitions. The Cleaner PWA and LangGraph/LLM autonomous execution
runtime are still future integration work and must not be assumed to exist.
The agreed workflow and selected **Option A** deployment are documented in
[the autonomous orchestrator and Cleaner plan](./docs/autonomous-orchestrator-and-cleaner-plan.md).

Teammates upgrading from commit `b2052a9` should read the detailed
[Phases 1–11 team handoff](./docs/team-handoff-phases-1-11.md) before restoring
old routes or integrating frontend/model work.

Option A will run Caddy, the React production build, Node, LangGraph,
PostgreSQL, FastAPI, and local Ollama/media on one self-hosted machine (with
host-native Ollama preferred on macOS), while Firebase Authentication, Cloud
Firestore, and FCM remain cloud services.

## Unified pipeline code map

The operational backend follows one public flow: React/API client -> Node API ->
cloud Firestore, while Node calls private FastAPI for each inference frame.
Extend each concern at its owning seam:

- `ai-service/app/pipeline.py`: model orchestration, focus-region transforms,
  coordinate mapping, and inference-only frame output.
- `backend/src/services/jobProcessingService.ts` and
  `videoJobProcessingService.ts`: authoritative image/video processing and
  Firestore persistence.
- `backend/src/services/alertWorkflowService.ts`: grouped temporal flags,
  alert deduplication, occurrences, and workflow state.
- `backend/src/services/analyticsService.ts`: hourly aggregation,
  reconciliation, report persistence, and CSV export.
- `backend/src/services/priorityZoneAnalytics.ts`: pure, deterministic,
  provisional priority-zone scoring.
- `frontend/src/features/pipeline/`: reusable ROI, annotated-result, placement,
  history, and shared contract components. `PipelinePage.tsx` only coordinates
  page state and requests.

The Python/SQLite business path and its Node proxy routes have been retired.
New frontend integration must use the stable Node-owned media, analysis, alert,
dashboard, and analytics APIs. The focus polygon is applied only to
floor-hazard inference; people and bin models always receive the same full
frame that the dashboard presents.

Phase 9 hardening adds opaque cursor pagination, configured CORS and security
headers, authenticated-user rate limits, request IDs/structured logs,
generation-safe system events, image/video idempotency fingerprints, graceful
video-queue shutdown, emulator-backed Auth/Firestore acceptance tests, and a
dry-run-first media-retention command. Operational backup, recovery, index,
retention, and incident procedures are in
[docs/operations-runbook.md](docs/operations-runbook.md).

## Dataset: where to get it

Start with the public **Garbage Can Overflow** dataset on Roboflow Universe:
[Garbage Can Overflow](https://universe.roboflow.com/m-cofjr/garbage-can-overflow-utofm).

1. Create/sign in to a Roboflow account and open that project.
2. Export the current dataset in **YOLO26 Object Detection** format.
3. Extract the download to `ml-training/data/raw/garbage-can-overflow/`.
4. Do not commit it: this path is ignored by Git.
5. Inspect it before remapping classes:

```powershell
python ml-training/scripts/inspect_dataset.py ml-training/data/raw/garbage-can-overflow --class-count 9
```

The `9` is provisional: first check the exported `data.yaml` and replace it
with its actual number of classes. Confirm the meaning of the original labels
visually before applying the mapping in the implementation plan. The public
dataset is only the baseline. The one-class bin localizer now combines it with
the annotated [GBS dataset](https://zenodo.org/records/14711706); run
`ml-training/scripts/prepare_bin_localizer_dataset.py` to rebuild the composite
data. A reproducible downloader and count-based diagnostic for the CC BY 4.0
University of Malaya three-bin dataset are documented in
`docs/bin-localizer.md`. That Malaysian set covers one fixed, top-down disposal
site. The production localizer uses its first 100 images only for weak
replay-based adaptation and reserves the final 100 for a count diagnostic, so
collect separate permissioned frames from the actual deployment cameras before
treating the model as locally validated.

## Start development locally

### Install once

Every developer needs the following installed before working on the project:

- [Git](https://git-scm.com/downloads)
- **Node.js 20 LTS or newer**. It includes `npm`; this is the standard package
  manager used by the project.
- **Python 3.12** (add it to PATH).
- **FFmpeg and ffprobe** (available on PATH) for server-owned video probing and
  frame extraction. You can instead set `FFMPEG_PATH` and `FFPROBE_PATH` in
  `backend/.env` to their executable paths.
- An NVIDIA GPU and matching CUDA-capable PyTorch build are optional for model
  inference/training. The React dashboard and Node API work without them.

Then clone the repository and install dependencies. On Windows use `py -3` if
`python` is not on PATH; on macOS use `python3`:

```powershell
git clone <your-repository-url>
cd LitterSpot
npm install
# Windows
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
# macOS
python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r ai-service/requirements.txt
```

### Configure Firebase once

The application uses Firebase project `litterspot`, the named Firestore
database `litterspot` in `asia-southeast1`, and Email/Password Authentication.
React uses Firebase only to authenticate a Supervisor. Node.js verifies the ID
token and is the only application service that reads or writes Firestore.

Create local configuration from the tracked examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill `frontend/.env.local` with the public web-app configuration from Firebase
Project Settings. Set `GOOGLE_APPLICATION_CREDENTIALS` in `backend/.env` to the
absolute path of the downloaded Firebase Admin service-account JSON. Keep that
JSON outside the repository and restrict it to the current user on macOS/Linux:

```bash
chmod 600 /absolute/path/to/firebase-admin-service-account.json
```

Never commit or share the service-account JSON. The repository ignores local
environment files and Firebase Admin key filenames as a second line of defence.

Bootstrap the initial Supervisor once. Supply the password through the current
shell rather than writing it into a file:

```bash
SUPERVISOR_EMAIL="supervisor@example.com" \
SUPERVISOR_DISPLAY_NAME="Site Supervisor" \
SUPERVISOR_PASSWORD="choose-a-strong-password" \
npm --workspace=backend run bootstrap:supervisor
```

The command creates the Firebase Authentication identity and matching
`supervisors/{uid}` Firestore profile. It is safe to rerun for the same email.
Cleaners begin as Firestore personnel records. A Supervisor later provisions
their linked Firebase identity through `POST /api/cleaners/{id}/account`; do
not create Cleaner Auth users manually because the backend owns the
deterministic UID, email reservation, role dispatch, and reconciliation state.

### Start everything

```powershell
npm start
```

This single command starts React, Node, and FastAPI in the current terminal,
then opens the dashboard. Service output stays visible there; press **Ctrl+C**
to stop all three services. `npm stop` remains available if the terminal is
closed unexpectedly.

The launcher checks ports 8000, 3000, and 5173 first. If it reports that a port
is already in use, close the previous development terminal and run `npm start`
again.

After signing in as the bootstrapped Supervisor, open **Sites & cameras** and
configure records in this order: site, zone, then camera. The hierarchy is
`site -> zone -> camera`; there is no area level. **Cleaner management** then
uses the active zones from Firestore for cleaner assignments. These records are
stored in the cloud Firestore database, while uploaded media remains local for
the current prototype.

Location and cleaner deletion is soft deactivation. A parent cannot be
deactivated while it has active children: deactivate or reassign cleaners,
then deactivate cameras, zones, and finally the site. React never accesses
Firestore directly; the authenticated Node API owns all application data.

### Test the backend with Postman

The backend is developed API-first while the React frontend is still changing.
Postman Desktop v12 can open the repository through Native Git and read the v3
collection and local environment under [`postman/`](./postman/); follow
[`docs/api-reference.md`](./docs/api-reference.md). Enter the Firebase Web API
key and Supervisor credentials only as local Postman values; never commit real
credentials.

The Phase 10-11 folders use two independent Firebase sessions. The Supervisor
provisions a selected Cleaner account and privately shares the one-time setup
link. After the Cleaner chooses a password, **Cleaner Firebase Login** stores a
separate Cleaner token. Run the Cleaner presence heartbeat before creating a
work order; the work-order folder then covers accept/reject, start,
ready-for-review, rework, reassignment, completion/cancellation, history, and
the durable notification inbox. The React Cleaner PWA is intentionally not part
of this backend phase.

The `16 - Review and rework foundation` folder adds Cleaner evidence submission,
Supervisor review context, and private orchestrator fresh-evidence/decision
requests. These can be run after the Phase 10-12 setup has produced a valid
`workOrderId`, alert, Cleaner token, and claimed orchestrator run.

The collection separates stable Node/Firestore services from the two isolated
bin-model test adapters. Retired Python/SQLite and pipeline-proxy requests are
not part of the canonical collection. New backend modules must update the API
reference and Postman collection before later frontend integration.

Image uploads accepted by `/api/media/images` are stored beneath
`MEDIA_STORAGE_ROOT` (default: `data/media-store/`, ignored by Git). Firestore
stores `mediaAssets` and `processingJobs` metadata only. Uploads default to test
mode. Test jobs still calculate inspectable detection and grouped policy
metrics, but they remain ineligible for flags, alerts, temporal confirmation,
and analytics unless the caller explicitly sends `isTest=false`.

Process an uploaded image with
`POST /api/processing-jobs/{jobId}/process`. Node calls private FastAPI in
inference-only mode, then owns the authoritative `analysisRuns` and `detections`
records in cloud Firestore. Use the Postman **Analysis results** folder to read
them. Image processing is synchronous in this prototype.

Server-owned video processing is also available. Upload a complete MP4 or WebM
as multipart field `video` to `POST /api/media/videos`, then call
`POST /api/processing-jobs/{jobId}/process`. The second request returns `202`
after adding the job to the single-process, concurrency-one Node worker. Poll
`GET /api/processing-jobs/{jobId}` until `status` is `completed` or `failed`;
progress reports planned, processed, successful, and failed sampled frames.
Closing Postman or the browser does not stop a started job, and Node recovers
queued or expired processing jobs when it restarts.

Video defaults are a 250 MiB upload limit, 600-second duration limit, one frame
every 2 seconds, and no more than 300 sampled frames. The upload accepts a
configurable 1–10 second interval. Node validates the file signature and
container with ffprobe, extracts bounded JPEG frames with ffmpeg, sends frames
sequentially to private FastAPI inference, and owns all Firestore writes and
grouped alert-policy evaluation. Deterministic frame/run IDs and saved progress
make retries resume at frame boundaries instead of creating duplicate logical
results. The current in-process queue is for one Node instance; a persistent
external queue remains a later deployment concern.

Video uploads, like images, default to `isTest=true`. Test frames retain model
results and scored grouped observations for inspection but do not feed temporal
confirmation, flags, alerts, or analytics. Send `isTest=false` only for an
intentional operational run. The React operations console still uses dummy
frontend data; the backend contract and Postman workflow are ready for a later
coordinated frontend cutover.

Operational uploads (`isTest=false`) continue through Node's
`grouped-temporal-v2` workflow. Raw detections are retained, Node writes one
positive or negative issue observation per run and issue type, and each
positive group creates at most one flag. Independent per-camera sequences
confirm floor litter at 3-of-5 observations within 30 minutes, bin overflow at
2-of-3 within 15 minutes, and floor spill at 2 consecutive observations within
10 minutes. A confirmed sequence creates or attaches to the single active
Firestore alert for its cleaning zone and issue type.

The Supervisor can move alerts forward through New, Acknowledged, In Progress,
and Resolved with history. Resolving an alert starts a fresh confirmation
sequence for the later incident. The thresholds are provisional business-policy
settings and are intended to remain configurable as field data is collected.
Use the Postman **Analysis results** and **Flags and alerts** folders, or the
`/api/issue-observations` endpoints, to inspect the workflow.

Flag and alert list APIs default to `workflow=current`, which returns only the
current `grouped-temporal-v2` records. Use `workflow=legacy` for older or
unversioned records and `workflow=all` only when intentionally auditing both.

The Phase 5 Node dashboard backend is also available now:

- `GET /api/dashboard?siteId={siteId}` returns the live site dashboard DTO;
- `GET /api/dashboard/summary?siteId={siteId}` reads its last reconciled compact
  summary;
- `POST /api/dashboard/reconcile` with `{ "siteId": "..." }` rebuilds that
  summary from authoritative Firestore data.

All three routes require the Firebase Supervisor bearer token. The live DTO
uses contract `site-dashboard-v1` and contains the site, headline camera/alert
counts, camera/latest-run cards, current active alerts, recent raw detections,
recent failed jobs, authenticated evidence URLs, completeness markers, and
query-mode diagnostics. The reconciled `site-dashboard-summary-v1` document
contains current and resolved alert counts, configured/active camera and
availability counts, latest detection/failure times, plus reconciliation actor
and timestamps.

The active-alert list requires the tracked alert composite index. If the recent
detection or failed-job indexes have not yet been deployed, those two feeds can
report `fallback_bounded_scan`; Node scans at most 500 site candidates, reports
that the source was bounded, and avoids an unbounded fallback read. All three
feeds should normally report `indexed` after `firestore.indexes.json` is
deployed.

Deploy the named-database indexes from the repository root when ready:

```bash
firebase deploy --only firestore:indexes
```

The default React operations dashboard still uses dummy frontend data and has
not been wired to `/api/dashboard`; that integration is deferred so the
frontend team can switch the stable DTO in one coordinated pass. See
[`docs/api-reference.md`](./docs/api-reference.md#11-site-dashboard) for every
request and response field.

### Priority-zone analytics

Phase 7 adds the authenticated Node-owned analytics backend. It aggregates
eligible operational analysis runs into hourly site-and-zone buckets, applies
confirmed alert incidents exactly once, and produces explainable priority-zone
reports:

- `POST /api/analytics/reconcile` safely rebuilds one site's analytics into a
  new staging generation and publishes it only after the complete rebuild;
- `POST /api/analytics/reports` generates and persists a report for a selected
  site and ISO 8601 time range;
- `GET /api/analytics/reports` lists saved reports with bounded pagination;
- `GET /api/analytics/reports/{reportId}` returns the report and its zone
  results;
- `GET /api/analytics/reports/{reportId}/csv` exports those results.

Run reconciliation after upgrading existing operational data so its analysis
runs and alert incidents enter the active analytics generation. Normal image
and video completion then applies new successful runs incrementally. Each
generation uses deterministic sample markers, and alert incidents use a
separate marker based on the alert plus its first observation, so retries do
not double-count either contribution. When temporal confirmation creates an
alert from buffered observations, its incident is assigned to the hour of that
alert's first supporting observation.

Test/demo runs and runs with `analyticsEligible=false` are excluded. Current
failed inference attempts have no `analysisRun`, so they are visible as failed
jobs but do not yet increment hourly `failedSampleCount`; coverage ratios must
be interpreted with that prototype limitation.

The report is a **zone ranking**, not an exact bin-placement coordinate and not
the output of another trained model. The provisional
`priority-zone-v1-provisional`
heuristic uses 35% litter incidents, 30% average people per successful sample,
25% overflow incidents, and 10% approximate issue-persistence time. A zone is
scored only after at least 8 successful hourly buckets across at least 2 local
calendar days with an 80% sample-success ratio. Otherwise it is explicitly
`insufficient_data`. High starts at 70 and medium at 40; all values are
versioned prototype policy for later field calibration.

The tracked indexes support active-generation bucket-window reads and report
history. Until the bucket index is deployed, report generation can use a
clearly labelled `fallback_bounded_scan` of at most 10,000 site buckets. The
reconciliation prototype accepts at most 5,000 runs, 5,000 alerts, and 15,001
observations for a site; a report accepts at most 100,000 selected buckets.
See [the analytics API contract](./docs/api-reference.md#13-priority-zone-analytics)
and [Firestore analytics model](./docs/firestore-data-model.md#11-analytics-collections).

The approved production checkpoints are tracked at the default paths. To test
an alternative state classifier without changing the repository, start with:

```powershell
$env:STATE_CLASSIFIER_PATH = "C:\path\to\bin-state-classifier.pt"
npm start
```

Experimental checkpoints and training outputs remain ignored. Do not replace
or add large model artifacts without team agreement and a matching evaluation.

### Do we need Bun?

No. **Use Node.js + npm** for this project; it is installed together with Node,
is the most widely supported option, and is the path documented above. Bun is
an optional JavaScript runtime/package manager that can install dependencies
and run scripts faster in some projects, which is why an older `bun.lock` file
exists here. It is not required to develop or start LitterSpot. For consistency,
the team should use `npm install`, `npm start`, and `npm stop`.

If both Bun and npm have been used in the same working folder, remove only the
generated `node_modules` folders and reinstall with `npm install` before
troubleshooting dependency issues. Do not remove source files or model files.

## Bin-state playground

The playground is an isolated model-test adapter, not the operational
media/job workflow. React calls Node, Node validates and forwards the upload,
and only the private Python service loads the trained checkpoint. The input
must contain one known bin region: either crop a fixed camera ROI before sending
it or upload a tightly framed bin image. To pin a classifier, set
`STATE_CLASSIFIER_PATH` explicitly.

The default checkpoint uses separate bin-presence, fullness, and overflow heads
and returns `normal`, `full`, `overflow`, or `unknown`. Its held-out gates pass:
The active decision policy is intentionally recall-first: overflow signals at
or above `0.31` can override the normal presence threshold when bin presence is
also at least `0.31`. Held-out overflow precision/recall is 63.0%/91.3% on GCO
and 71.9%/96.0% on GBS. This produces more false alerts by design. Three-frame
confirmation counts only distinct, time-separated, visually different frames.
The service expands every supplied ROI by the checkpoint's training context
(15% for the active checkpoint), so the live crop now matches training.

For full CCTV frames, register a normalized ROI and optional per-bin thresholds
in `config/bin-profiles.json`. Profile keys use `cameraId:binId`:

```json
{
  "profiles": {
    "camera-1:bin-1": {
      "regionNormalized": {"x1": 0.12, "y1": 0.18, "x2": 0.46, "y2": 0.92},
      "thresholds": {"presence": 0.60, "fullness": 0.36, "overflow": 0.40, "overflowPresenceFloor": 0.35}
    }
  }
}
```

Install the Python API runtime once:

```powershell
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

For debugging, you can also start the services separately, but the normal
workflow is the single `npm start` command above:

```powershell
# Windows PowerShell: pin the tested classifier before npm start
$env:STATE_CLASSIFIER_PATH = (Resolve-Path "runs\state_classifier\multitask_gco_gbs_v2\production.pt").Path
npm start

# macOS: pin the tested classifier before npm start
export STATE_CLASSIFIER_PATH="$PWD/runs/state_classifier/multitask_gco_gbs_v2/production.pt"
npm start
```

Open the Vite URL shown in Terminal 3. The default dashboard proves the React
to Node to FastAPI connection through live service status. Select **Open state
playground** (or use `#/playground`) to upload a JPEG/PNG/WebP crop and select
**Classify bin state**. State probabilities are returned through Node; React
never calls Python directly. Check Python readiness at
`http://127.0.0.1:8000/health` and Node readiness at
`http://127.0.0.1:3000/api/health`.

When training produces a newer `best.pt`, restart only the Python terminal so
the worker loads the new checkpoint. Use a held-out evaluation report before
changing the active classifier.

Until a trained checkpoint is placed at `STATE_CLASSIFIER_PATH`, the AI
service correctly reports itself as degraded and refuses inference requests.

## Private FastAPI inference service

FastAPI is a private model service, and its operational `/analyze/frame` path
is stateless. It does not open SQLite, store evidence, create flags or alerts,
serve dashboards, track operational video sessions, or run placement
analytics. React and API clients call Node only; Node supplies frames to
FastAPI and owns media, jobs, application state, and every Firestore write.

The current approved production files are committed at the defaults below.
Environment variables may point to an alternative local checkpoint for an
isolated experiment without changing the tracked artifact.

| Capability | Default local path | Override |
| --- | --- | --- |
| Bin state (normal/full/overflow) | `runs/state_classifier/multitask_gco_gbs_v2/production.pt` | `STATE_CLASSIFIER_PATH` |
| Bin localizer | `models/production/bin_localizer_yolo11n.pt` | `BIN_LOCALIZER_PATH` |
| Floor litter/spill segmentation | `runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt` | `FLOOR_HAZARD_PATH` |
| People detector | `yolo26s.pt` | `PEOPLE_COUNT_PATH` |

The internal combined endpoint is `POST /analyze/frame`. Its multipart fields
are `file`, optional `floor_confidence`, optional `localizer_confidence`, and
optional `focus_region` as a JSON array of normalized polygon points. Node also
sends `x-internal-token` when configured. The response contains only `image`,
`focusRegion`, `peopleCount`, `people`, `bins`, `floorHazards`, `modelVersions`,
and `processingTimeMs`. It has no database ID, camera/session field, temporal
tracking state, flag, or persistence switch.

FastAPI also retains `/health`, `/model/info`, `/classify/bin`, and
`/classify/image-bins`. The two classify endpoints are exposed through Node as
authenticated model-test adapters; they may exercise classifier-local
confirmation state but never own application persistence or alert policy.
Operational image and video processing must use `/api/media` and
`/api/processing-jobs`, not a direct Python request.

## Alert policy and deployment gate

### Node-owned operational alert policy

The authoritative application workflow is `grouped-temporal-v2`: floor litter
requires 3 positive observations in the latest 5 within 30 minutes, bin
overflow requires 2 in the latest 3 within 15 minutes, and floor spill requires
2 consecutive positives within 10 minutes. These sequences are maintained per
camera, while active-alert deduplication is per cleaning zone and issue type.
People counts are analytics-only. Negative observations contribute to temporal
windows but do not create flags, attach to alerts, or resolve a Supervisor's
workflow alert. Resolution resets the sequence for the next incident.

The magnitude, confidence, temporal, and severity values are provisional and
must remain configurable calibration parameters. `GET /api/alerts/policy`
returns the currently deployed values.

### Direct AI playground and model validation

The isolated Node bin-state adapter can separately mark an overflow as model
**confirmed** after matching requests from the same `cameraId` and `binId`.
Its `ALERT_CONFIRMATION_FRAMES` setting (1--20) is test-adapter/model state and
is not the Node business alert policy above. Keep the adapter's camera/bin
identifiers stable when using it for a sequential model experiment.

Before unattended alerts are enabled, run the held-out validation gate:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\validate_model.py
```

It requires overflow precision >= 0.85, overflow recall >= 0.80, and overall
mAP50 >= 0.65. A failed run exits non-zero and records the gate result in the
JSON report. The real-camera capture and labeling protocol is in
[`docs/data-collection-protocol.md`](docs/data-collection-protocol.md).
