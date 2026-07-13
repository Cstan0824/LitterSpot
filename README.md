# LitterSpot

Bin overflow detection for CCTV images. The repository is currently scaffolded
for an image-upload workflow: React calls the public Node API, which validates
the upload and forwards it to the private FastAPI inference service.

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
dataset is only the baseline; collect separate, permissioned frames from your
actual theme-park cameras for the final model.

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

The dashboard runs even without a checkpoint. For the detection playground, a
team member must provide a model file outside Git, then start with:

```powershell
$env:MODEL_PATH = "C:\path\to\bin-overflow.pt"
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

## Detection playground

The playground tests the same production request path used by the application:
React calls Node, Node validates and forwards the upload, and only the private
Python service loads the trained checkpoint. The service automatically selects
the validated Tune20 checkpoint when it exists. To pin a specific
checkpoint, set `MODEL_PATH` explicitly.

Install the Python API runtime once:

```powershell
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

For debugging, you can also start the services separately, but the normal
workflow is the single `npm start` command above:

```powershell
# Windows PowerShell: pin a local checkpoint before npm start
$env:MODEL_PATH = (Resolve-Path "runs\bin_overflow\yoloe26s_fused_tune20_v1\weights\best.pt").Path
npm start

# macOS: pin a local checkpoint before npm start
export MODEL_PATH="$PWD/runs/bin_overflow/yoloe26s_fused_tune20_v1/weights/best.pt"
npm start
```

Open the Vite URL shown in Terminal 3. The default dashboard proves the React
to Node to FastAPI connection through live service status. Select **Open
detection playground** (or use `#/playground`) to upload a JPEG/PNG/WebP CCTV
frame and select **Detect bins**. The boxes and confidence values are returned
through Node; React never calls Python directly. Check Python readiness at
`http://127.0.0.1:8000/health` and Node readiness at
`http://127.0.0.1:3000/api/health`.

When training produces a newer `best.pt`, restart only the Python terminal so
the worker loads the new checkpoint. Do not point the playground at `last.pt`
while training is active; use the controlled `best.pt` because it is selected
only after a completed validation epoch.

Until a trained checkpoint is placed at the configured `MODEL_PATH`, the AI
service correctly reports itself as degraded and refuses inference requests.

## Alert policy and deployment gate

An overflow is marked **confirmed** only after it matches across three
consecutive requests from the same `cameraId`. The playground exposes both
settings; use a stable camera ID for a sequential feed. Change the default with
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
