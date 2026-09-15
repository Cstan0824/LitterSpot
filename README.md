# LitterSpot

## Final cloud configuration

The final application uses Firebase project `litterspot`, Firestore `(default)`,
and cloud Email/Password Authentication. Node and FastAPI remain local. Media
bytes stay in `data/media-store`, or the explicit `MEDIA_STORAGE_ROOT`; Firebase
Storage is not used and the project remains on Spark.

```bash
npm start
npm stop
```

`npm start` is the default final-app command. It starts the frontend, Node API,
and FastAPI against the production Firebase configuration. `npm run
start:cloud` is retained as an explicit alias for the same launcher.

Set backend `APP_ENV=production-cloud`, both project settings to `litterspot`,
and `FIREBASE_DATABASE_ID=(default)`. Keep the Admin credential outside the
repository. Frontend web settings must use the same project, with no emulator
connection variables. Existing emulator login sessions do not transfer; sign
in again with the preserved account credentials.

`npm run start:emulator` remains an independent local development option and
is the only complete-app command that starts Firebase emulators.
The clean/dirty scene shortcuts use cloud Auth when the Auth emulator is not
running. Set `LITTERSPOT_AUTH_MODE=cloud` or `emulator` explicitly if both stacks
are present. Cloud scene access requires Root authority and the explicit
`CAMERA_DEMO_SCENES_ENABLED=true` prototype setting.

The sections below still contain older implementation history. Legacy cleanup
is a separate follow-up after cloud cutover verification.

LitterSpot is a cleanliness-monitoring prototype for tourist attractions. Its
public application path is React -> authenticated Node/Express API -> cloud
Firestore, with a private FastAPI service used only for computer-vision
inference. Node owns sites, zones, cameras, cleaners, Camera monitoring
samples, evidence, Alerts, Work, the dashboard read model, and priority-zone
analytics.

The repository implements Supervisor and Cleaner applications with role
isolation, current Work, durable in-app notifications, and automatic assignment
and review. Current orchestration uses the Site-scoped V2 services and local
provider runtime.
The current product rules are documented in
[the clarified requirements](./docs/current-clarified-requirements.md) and
[their continuation](./docs/current-clarified-requirements-continuation.md).

For stored field meanings and their workflow use, see the
[database field dictionary](./docs/database-field-dictionary.md). It separates
implemented fields, initialized placeholders, and API-only values.

Option A will run Caddy, the React production build, Node, LangGraph,
PostgreSQL, FastAPI, and local Ollama/media on one self-hosted machine, with
host-native Ollama preferred on macOS. Firebase Authentication and Cloud
Firestore remain cloud services.

## Unified pipeline code map

The operational backend follows one public flow: React/API client -> Node API ->
cloud Firestore, while Node calls private FastAPI for each inference frame.
Extend each concern at its owning seam:

- `ai-service/app/pipeline.py`: model orchestration, focus-region transforms,
  coordinate mapping, and inference-only frame output.
- `backend/src/services/v2LiveMonitoringService.ts` and
  `frameInferenceClient.ts`: Camera sampling, delayed analyzed footage, and
  private inference calls.
- `backend/src/services/v2AlertService.ts`: current Camera-scoped Alert
  confirmation and evidence persistence.
- `backend/src/services/phase11Service.ts`: current dashboard, daily analytics,
  and bin-placement reads.
- `frontend/src/features/operations/`: current Supervisor dashboards, Camera
  monitoring, Site Map, Alert, Work, and administration workflows.

The Python/SQLite business path and its Node proxy routes have been retired.
New frontend integration must use the current Node-owned Camera, monitoring,
Alert, Work, dashboard, and analytics APIs. The focus polygon applies only to
floor-hazard inference. People and bin models receive the same full frame that
the dashboard presents.

Phase 9 hardening adds opaque cursor pagination, configured CORS and security
headers, authenticated-user rate limits, request IDs/structured logs,
generation-safe system events, emulator-backed Auth/Firestore acceptance
tests, and a dry-run-first media-retention command. Operational backup,
recovery, index, retention, and incident procedures are in
[docs/operations-runbook.md](docs/operations-runbook.md).

## Research progress

Historical acquisition, training, calibration, dataset preparation, and model
evaluation work is preserved in
[progress/ml-research](progress/ml-research/README.md). Archived scripts keep
their original paths and are not supported application commands. Production
models remain at their runtime paths; the archive records their checksums.

## Start development locally

### Install once

Every developer needs the following installed before working on the project:

- [Git](https://git-scm.com/downloads)
- **Node.js 20 LTS or newer**. It includes `npm`; this is the standard package
  manager used by the project.
- **Python 3.12** (add it to PATH).
- **ffprobe** (available on PATH) to validate uploaded looped-Camera sources.
  You can instead set `FFPROBE_PATH` in `backend/.env` to its executable path.
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

The application uses Firebase project `litterspot`, Firestore
database `(default)`, and Email/Password Authentication.
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

### Current application APIs

The product uses the Site Map, composite Camera creation/registration,
monitoring, Alerts, Work, Cleaner, Superadmin, and current dashboard/analytics
APIs. See [the API reference](docs/api-reference.md).

Standalone media intake, processing jobs, raw analysis/detection inspection,
unversioned dashboard/analytics, and the old public System-event ledger are
retired. Their persisted history remains available to current historical and
retention readers.

Protected media metadata, content, and exact evidence overlays remain served
by Node. Camera source/reference uploads, Cleaner completion evidence, and
Site background uploads use their respective operational workflows. No media
files or Firestore documents were removed.

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
and 71.9%/96.0% on GBS. This produces more false alerts by design. Node applies
the current temporal qualification policy across Camera samples. FastAPI
expands every registered bin region by the checkpoint's training context, 15%
for the active checkpoint, so the live crop matches training.

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

Open the Vite URL shown by the launcher. React sends Camera analysis through
Node; it never calls Python directly. Check Python readiness at
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

FastAPI exposes `/health` and the internal `/analyze/frame` contract only.
Operational monitoring submits Camera frames through `/api/monitoring`, not a
direct Python request or standalone processing job. Camera configuration
uploads use `/api/camera-creation`.

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

### Historical model validation

Research-only validation commands are preserved in
[the research progress archive](progress/ml-research/README.md). Public Node
bin-state testing adapters are retired; private FastAPI inference remains.

The preserved gate records overflow precision >= 0.85, overflow recall >= 0.80,
and overall mAP50 >= 0.65. Archived scripts retain their original paths and are
not supported commands from the new layout. The capture and labeling protocol
is in the
[research documentation archive](progress/ml-research/docs/data-collection-protocol.md).
