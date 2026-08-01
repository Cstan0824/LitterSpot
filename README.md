# LitterSpot

Bin overflow classification for fixed CCTV views. React calls the public Node
API, which validates a cropped bin region and forwards it to the private
FastAPI inference service. A lightweight MobileNetV3 classifier is the default;
the earlier full-frame YOLOE detector remains an optional legacy fallback.

## Unified pipeline code map

The MVP follows one public flow: React -> Node API -> private FastAPI service ->
SQLite. Extend each concern at its owning seam:

- `ai-service/app/pipeline.py`: model orchestration, focus-region transforms,
  coordinate mapping, flags, and persistence of one analyzed frame.
- `ai-service/app/placement_analysis.py`: configurable overflow/popularity
  ranking and recommendation hysteresis, with no database dependency.
- `ai-service/app/analysis_store.py`: SQLite schema, history, and scheduled
  policy evaluation. A custom database path or placement policy can be injected.
- `backend/src/routes/pipelineRoutes.ts`: stable public pipeline HTTP routes.
- `backend/src/services/pipelineClient.ts`: the only Node adapter to pipeline
  endpoints in the Python service.
- `frontend/src/features/pipeline/`: reusable ROI, annotated-result, placement,
  history, and shared contract components. `PipelinePage.tsx` only coordinates
  page state and requests.

The current public URLs remain under `/api/detections/pipeline/*`. The focus
polygon is applied only to floor-hazard inference; people and bin models always
receive the same full frame that the dashboard presents.

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

The dashboard runs even without a checkpoint. For the state playground, a team
member must provide the classifier file outside Git, then start with:

```powershell
$env:STATE_CLASSIFIER_PATH = "C:\path\to\bin-state-classifier.pt"
npm start
```

Model files and training outputs are intentionally ignored; never add them to
Git. Each developer keeps them locally or obtains them through the team’s
approved storage.

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

The playground tests the same production request path used by the application:
React calls Node, Node validates and forwards the upload, and only the private
Python service loads the trained checkpoint. The input must contain one known
bin region: either crop a fixed camera ROI before sending it or upload a tightly
framed bin image. To pin a classifier, set `STATE_CLASSIFIER_PATH` explicitly.

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

## Operations-console MVP

The Figma-inspired operations console is the default screen at `#/`. It has a
six-camera dashboard, active-alert workflow, resolved-only history, and bin
placement reports. It is deliberately an image-snapshot MVP: a camera becomes
"live" after a frame is analyzed, and the dashboard refreshes its latest saved
snapshot every 30 seconds. It is not an RTSP or video-streaming system yet.

The full request path is:

```text
Browser upload -> Node API -> FastAPI model pipeline -> SQLite + evidence image
                     ^                                      |
                     +---------- dashboard / alerts --------+
```

Every analyzed upload is saved as evidence under `data/evidence/` and is shown
back on the dashboard through the Node API. This keeps the presented image
identical to the image supplied to inference. Those images and the temporal
SQLite database are ignored by Git.

### Required detection models

These trained files are intentionally **not** committed. Obtain them through
your team's approved shared storage and put them in the following default
locations, or set the matching environment variable before starting services.

| Capability | Default local path | Override |
| --- | --- | --- |
| Bin state (normal/full/overflow) | `runs/state_classifier/multitask_gco_gbs_v2/production.pt` | `STATE_CLASSIFIER_PATH` |
| Bin localizer | `models/production/bin_localizer_yolo11n.pt` | `BIN_LOCALIZER_PATH` |
| Floor litter/spill segmentation | `runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt` | `FLOOR_HAZARD_PATH` |
| People detector | `yolo26s.pt` | Ultralytics downloads it on first use if network access is available |

For a friend receiving the project, send the three `.pt` artifacts separately
from Git. Never add them back to the repository.

### Set up the complete detection pipeline

From the repository root on Windows PowerShell:

```powershell
# 1. Install JavaScript packages
npm install

# 2. Create the Python environment and install inference dependencies
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt

# 3. Point to model artifacts if they are outside the default locations
$env:STATE_CLASSIFIER_PATH = "C:\models\production.pt"
$env:BIN_LOCALIZER_PATH = "C:\models\bin_localizer_yolo11n.pt"
$env:FLOOR_HAZARD_PATH = "C:\models\floor_hazards_best.pt"

# 4. Start FastAPI, Node, and React together
npm start
```

For macOS/Linux, activate `.venv` with `source .venv/bin/activate`, use
`python3` in place of `py -3`, and export the same environment variables.

Open the Vite URL shown by `npm start`. The Node health endpoint is
`http://127.0.0.1:3000/api/health`; confirm that the state classifier, bin
localizer, and floor analyzer are ready before running an analysis.

If the dashboard shows a 404 or 502 for `/api/operations/*` after upgrading,
an older local service is still running. Run `npm stop`, close any previous
development terminals, then run `npm start` again. The local stack uses ports
8000 (FastAPI), 3000 (Node), and 5173 (Vite).

### Run a camera-frame detection

1. Open **Analyze frame** in the top-right menu, or go to `#/pipeline`.
2. Upload a JPEG, PNG, or WebP camera frame (maximum 10 MB).
3. Set the camera ID, for example `camera-1` through `camera-6`.
4. Optionally click **Plot floor area** and draw a polygon. Only the
   floor-litter/spill model receives this polygon; person and bin models always
   receive the full original frame.
5. Select **Run unified analysis**.

The pipeline runs, in order:

1. Bin localizer on the full frame.
2. Bin-state classifier for every localized bin.
3. COCO people detector on the full frame.
4. Floor litter/spill segmentation on the full frame or plotted floor polygon.
5. Alert creation for confirmed bin overflow, floor litter, or floor spill.
6. Evidence, result JSON, alert state, and placement observations saved in
   `data/litterspot_mvp.sqlite3`.

The dashboard then displays the original evidence image with bin, floor-hazard,
and people overlays. The alert center lets an MVP operator mark alerts as
active, resolved, or dismissed; history shows resolved alerts only.

### Seeded camera mock images

For a usable first-run dashboard, the service copies the checked-in files under
`samples/cctv-demo/` into the ignored `data/evidence/` folder and attaches one
to each of `camera-1` through `camera-6`. When all three pipeline models are
ready, each seed image is then analysed once through the same pipeline used by
`/analyze/frame`; its people, bin, and floor-hazard overlays are therefore real
model output for that exact image. These cards remain visibly labelled **DEMO**
and do not create operator alerts. A real frame replaces the demo result for
that camera as soon as it is analyzed.

If a demo card is blank after startup, check `/health`: `modelReady`,
`binLocalizerReady`, and `floorAnalyzerReady` must all be `true`, then restart
the service. The demo analysis only runs after the model checkpoints load.

Demo seeding is enabled by default for this temporal MVP. Disable it when
running with real cameras:

```powershell
$env:SEED_DEMO_CAMERAS = "false"
npm start
```

## Alert policy and deployment gate

An overflow is marked **confirmed** only after it matches across three
consecutive requests from the same `cameraId` and `binId`. The playground
exposes both settings; keep them stable for a sequential feed. Change the default with
`ALERT_CONFIRMATION_FRAMES` (1--20). Single-image uploads are not confirmed
alerts by themselves.

Before unattended alerts are enabled, run the held-out validation gate:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\validate_model.py
```

It requires overflow precision >= 0.85, overflow recall >= 0.80, and overall
mAP50 >= 0.65. A failed run exits non-zero and records the gate result in the
JSON report. The real-camera capture and labeling protocol is in
[`docs/data-collection-protocol.md`](docs/data-collection-protocol.md).
