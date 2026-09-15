# LitterSpot YOLOE-26 Bin Overflow Detection — Final Implementation Plan

## 1. Goal

Build a bin-status detection component for theme-park CCTV footage. The completed component must:

1. Receive an image, uploaded video, or sampled CCTV frame.
2. Locate each visible rubbish bin.
3. Classify it as `normal trash bin`, `full trash bin`, or `overflowing trash bin`.
4. Confirm the result across multiple frames to reduce false alerts.
5. Return bounding boxes, confidence scores, and the confirmed state through a private Python inference API.
6. Pass application requests and confirmed detections through the Node.js backend.
7. Display the result in the React application.
8. Store only confirmed detections through the Node.js data layer.

The model will not be trained from scratch. It will be fine-tuned from pretrained YOLOE-26 weights.

---

## 2. Final technical decisions

| Area | Decision |
|---|---|
| Main model | YOLOE-26S |
| Starting checkpoint | `yoloe-26s-seg.pt` |
| Training task | Object detection |
| Dataset format | YOLO26 Object Detection |
| Final classes | Normal, full, overflowing |
| Training method | Transfer learning/fine-tuning |
| Frontend | React + TypeScript |
| Application backend | Node.js + TypeScript + Express |
| AI runtime | Local Python worker |
| AI service | FastAPI, accessible by Node.js only |
| Continuous input | Python reads video/CCTV frames |
| Alert protection | Multi-frame temporal confirmation |
| Persistence | Database accessed only through Node.js |

Runtime request flow:

```text
React frontend
→ Node.js backend
→ Python FastAPI AI service
→ YOLOE-26 model
→ Python result
→ Node.js validation/business logic
→ React response
```

React must not call Python directly. Node.js is the public application API and Python is an internal specialised service.

YOLOE-26S is selected instead of Nano because bins may appear small and distant in CCTV footage. If YOLOE-26S is still insufficient and the available GPU permits it, YOLOE-26M can be tested later without changing the dataset structure.

---

## 3. Detection classes and annotation policy

Use readable semantic class names because YOLOE uses language-aligned representations.

```yaml
names:
  0: normal trash bin
  1: full trash bin
  2: overflowing trash bin
```

### Class definitions

| Class | Annotation definition |
|---|---|
| `normal trash bin` | Rubbish is clearly below the rim and the bin does not require collection. |
| `full trash bin` | Rubbish reaches the rim but remains contained inside the bin. |
| `overflowing trash bin` | Rubbish extends above the rim, hangs outside, falls around the bin, or is visibly spilling from it. |

### Bounding-box rules

- Draw one box around the complete physical bin.
- Include attached or directly spilling rubbish in the same box.
- Do not create multiple state boxes for the same bin.
- If rubbish is nearby but not clearly connected to the bin, do not automatically label the bin as overflowing.
- Partially hidden bins should be labelled only when their state remains visually identifiable.
- Extremely uncertain images should be excluded rather than labelled by guessing.
- Images with no relevant bin remain valid negative images with empty label files.

### Original dataset remapping

Use the Garbage Can Overflow dataset as the initial public source:

https://universe.roboflow.com/m-cofjr/garbage-can-overflow-utofm

Tentative mapping:

| Original label | Final label |
|---|---|
| `empty` | `normal trash bin` |
| `Close_empty` | `normal trash bin` |
| `Open_empty` | `normal trash bin` |
| `Healthy trash can` | `normal trash bin` after review |
| `full` | `full trash bin` |
| `Close_full` | `full trash bin` |
| `Open_full` | `full trash bin` |
| `Trash flow` | `overflowing trash bin` |
| `Broken trash can` | Exclude |
| `closed` | Manually review before mapping |

These mappings must be confirmed by inspecting the corresponding images. Class names alone are not sufficient evidence.

When overlapping boxes describe the same bin, apply this priority:

```text
overflowing trash bin > full trash bin > normal trash bin
```

Boxes with an Intersection over Union of at least 0.85 should be reviewed as possible duplicates.

---

## 4. Repository structure

```text
litterspot/
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ImageUploader.tsx
│       │   ├── DetectionOverlay.tsx
│       │   ├── DetectionSummary.tsx
│       │   └── CameraBinStatus.tsx
│       ├── pages/
│       │   └── DetectionTestPage.tsx
│       └── services/
│           └── detectionApi.ts
├── backend/                         # Public Node.js application backend
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   ├── controllers/
│   │   │   └── detectionController.ts
│   │   ├── routes/
│   │   │   └── detectionRoutes.ts
│   │   ├── services/
│   │   │   ├── aiServiceClient.ts
│   │   │   ├── detectionService.ts
│   │   │   └── flagService.ts
│   │   ├── middleware/
│   │   ├── repositories/
│   │   └── schemas/
│   ├── tests/
│   ├── package.json
│   └── tsconfig.json
├── ai-service/                      # Private Python inference service
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── schemas.py
│   │   ├── detector.py
│   │   ├── image_utils.py
│   │   ├── camera_config.py
│   │   └── temporal_filter.py
│   ├── tests/
│   └── requirements.txt
├── ml-training/                     # Offline model development only
│   ├── configs/
│   │   └── bin_overflow.yaml
│   ├── scripts/
│   │   ├── inspect_dataset.py
│   │   ├── remap_labels.py
│   │   ├── remove_duplicates.py
│   │   ├── visualize_labels.py
│   │   ├── extract_cctv_frames.py
│   │   ├── train.py
│   │   ├── validate.py
│   │   ├── predict.py
│   │   └── export.py
│   ├── requirements.txt
│   └── data/
│       ├── raw/
│       ├── processed/
│       ├── cctv-unlabelled/
│       ├── cctv-labelled/
│       └── cctv-test/
├── models/
│   ├── production/
│   └── model-registry.json
├── shared/
│   └── detection-schema.json
├── samples/
├── docker-compose.yml
├── package.json
├── .gitignore
└── README.md
```

The four folders are independently runnable components inside one repository. `ml-training` produces a model checkpoint; `ai-service` loads that checkpoint; `backend` controls the application workflow; and `frontend` displays the result.

Do not commit datasets, training runs, secrets, virtual environments, or large checkpoints directly to Git.

---

## 5. Stage 1 — Initialise the monorepo

```bash
mkdir litterspot
cd litterspot
git init

npm init -y

mkdir ai-service ml-training models shared samples

# React frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
cd ..

# Node.js backend
mkdir backend
cd backend
npm init -y
npm install express cors multer axios zod dotenv
npm install -D typescript tsx vitest supertest \
  @types/node @types/express @types/cors @types/multer @types/supertest
npx tsc --init
cd ..

# Python AI and training environment
python -m venv .venv
```

Activate the environment on Windows:

```powershell
.venv\Scripts\activate
```

Install the Python inference dependencies and save them separately:

```bash
pip install -U ultralytics fastapi uvicorn python-multipart pillow opencv-python pytest
pip freeze > ai-service/requirements.txt
pip freeze > ml-training/requirements.txt
```

The root `package.json` should define the JavaScript workspaces:

```json
{
  "name": "litterspot",
  "private": true,
  "workspaces": ["frontend", "backend"]
}
```

Add development scripts after both applications exist:

```json
{
  "scripts": {
    "dev:frontend": "npm run dev --workspace=frontend",
    "dev:backend": "npm run dev --workspace=backend",
    "test:backend": "npm run test --workspace=backend"
  }
}
```

The Node backend should use a script similar to:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  }
}
```

Minimum `.gitignore` entries:

```gitignore
.venv/
__pycache__/
*.pyc
.env

ml-training/data/raw/
ml-training/data/processed/
ml-training/data/cctv-unlabelled/
ml-training/data/cctv-labelled/
ml-training/data/cctv-test/

runs/
models/production/*.pt
models/production/*.onnx

frontend/node_modules/
frontend/dist/
backend/node_modules/
backend/dist/
```

Local startup commands after the initial source files are implemented:

```bash
# Terminal 1
npm run dev:frontend

# Terminal 2
npm run dev:backend

# Terminal 3
uvicorn app.main:app --reload --app-dir ai-service --port 8000
```

### Completion condition

- React development server starts successfully.
- Node.js backend starts successfully.
- Python inference service starts successfully.
- `import ultralytics` works.
- Node can call the Python `/health` endpoint.
- The repository contains no dataset or model binaries in Git.

---

## 6. Stage 2 — Export and inspect the public dataset

Export the Roboflow dataset as **YOLO26 Object Detection** and extract it into:

```text
ml-training/data/raw/garbage-can-overflow/
```

YOLO detection labels use:

```text
class_id x_center y_center width height
```

All four coordinates are normalized from 0 to 1.

Create `inspect_dataset.py` to report:

- Total image count.
- Total label count.
- Objects per class.
- Images without label files.
- Label files without images.
- Invalid class IDs.
- Coordinates outside the 0-to-1 range.
- Zero-area bounding boxes.
- Duplicate images using file hashes.
- Strongly overlapping boxes.
- Image-size distribution.
- Object-size distribution.

Manually inspect at least:

- 50 normal-bin examples.
- 50 full-bin examples.
- Every available `Trash flow` example.
- 30 images with overlapping labels.
- 30 negative or difficult images.

### Completion condition

- Every original label has a confirmed meaning.
- Incorrect and ambiguous mappings are documented.
- The dataset can be converted without silently guessing class meanings.

---

## 7. Stage 3 — Clean and prepare the dataset

Create `remap_labels.py` to:

1. Read the exported class list.
2. Remap accepted original classes.
3. Remove excluded classes.
4. Resolve duplicate boxes using the severity priority.
5. Copy cleaned images and labels into `ml-training/data/processed`.
6. Produce a conversion report with before-and-after counts.

Create the dataset split after duplicate removal:

```text
Training:   70%
Validation: 20%
Testing:    10%
```

Near-identical images from the same source or video sequence must remain in the same split.

Create `ml-training/configs/bin_overflow.yaml`:

```yaml
path: ../data/processed

train: train/images
val: valid/images
test: test/images

names:
  0: normal trash bin
  1: full trash bin
  2: overflowing trash bin
```

Create `visualize_labels.py` and inspect at least 100 random processed images with their final labels and bounding boxes drawn.

### Completion condition

- No contradictory state labels remain on one bin.
- No invalid coordinates remain.
- The final YAML class order matches every label file.
- Random visual inspection confirms that boxes and classes are correct.

---

## 8. Stage 4 — Train the public-dataset baseline

YOLOE-26 pretrained checkpoints are segmentation checkpoints. For object-detection fine-tuning, initialise the matching detection configuration, load weights from the pretrained segmentation checkpoint, and use `YOLOEPETrainer`.

Create `ml-training/scripts/train.py`:

```python
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe import YOLOEPETrainer

model = YOLOE("yoloe-26s.yaml")
model.load("yoloe-26s-seg.pt")

model.train(
    data="ml-training/configs/bin_overflow.yaml",
    trainer=YOLOEPETrainer,

    epochs=100,
    patience=20,
    imgsz=960,
    batch=8,
    device=0,
    workers=4,

    optimizer="AdamW",
    lr0=0.001,
    weight_decay=0.0005,

    degrees=5.0,
    translate=0.10,
    scale=0.30,
    perspective=0.0005,
    fliplr=0.5,
    mosaic=0.5,
    close_mosaic=10,

    amp=True,
    seed=42,
    deterministic=True,
    plots=True,
    save=True,

    project="runs/bin_overflow",
    name="yoloe26s_public_v1",
)
```

If CUDA runs out of memory:

1. Reduce `batch` from 8 to 4 or 2.
2. Keep `imgsz=960` if bins are small.
3. Reduce `imgsz` to 768 only if batch reduction is insufficient.
4. Use YOLOE-26N only when the hardware cannot reasonably train YOLOE-26S.

Expected checkpoint:

```text
runs/bin_overflow/yoloe26s_public_v1/weights/best.pt
```

### Completion condition

- Training finishes without invalid-label warnings.
- Training and validation losses converge.
- The best checkpoint is retained.
- Training plots and the confusion matrix are generated.

---

## 9. Stage 5 — Validate the baseline

Create `ml-training/scripts/validate.py`:

```python
from ultralytics import YOLOE

model = YOLOE(
    "runs/bin_overflow/yoloe26s_public_v1/weights/best.pt"
)

metrics = model.val(
    data="ml-training/configs/bin_overflow.yaml",
    imgsz=960,
    batch=8,
    device=0,
    plots=True,
)

print("mAP50:", metrics.box.map50)
print("mAP50-95:", metrics.box.map)
print("Precision:", metrics.box.mp)
print("Recall:", metrics.box.mr)
```

Evaluate each class separately. Overall mAP alone is insufficient.

Review at least:

- 30 false positives.
- 30 false negatives.
- Normal bins incorrectly classified as full or overflowing.
- Full bins incorrectly classified as overflowing.
- Overflowing bins missed due to distance or obstruction.

The public model is a baseline, not the final theme-park model.

---

## 10. Stage 6 — Collect theme-park CCTV data

Public images cannot fully reproduce the deployment camera angle, resolution, lighting, bin design, and visitor obstruction.

Collect CCTV-style frames containing:

- Actual theme-park bin designs.
- Normal bins.
- Full bins.
- Clearly overflowing bins.
- Rubbish extending over the rim.
- Rubbish spilling around the bin.
- Visitors partially blocking the bin.
- Day, night, rain, shadow, glare, and motion blur.
- Empty scenes without relevant bins.
- Visually similar objects that may cause false detection.

Initial target:

| Category | Target images |
|---|---:|
| Normal | 300 |
| Full | 200 |
| Overflowing | 200 |
| Negative/difficult scenes | 100 |

Extract frames at intervals rather than labelling consecutive near-identical frames.

If genuine overflow samples are unavailable, create controlled scenarios, record them from the intended CCTV position, and clean the area immediately afterward.

Reserve complete camera sequences for `ml-training/data/cctv-test`. Never use these sequences during training.

### Completion condition

- All three states are represented from CCTV viewpoints.
- The theme-park test set remains untouched.
- Multiple bin styles and difficult conditions are included.

---

## 11. Stage 7 — Fine-tune for the theme-park environment

Use the public checkpoint as the starting point and fine-tune it with the cleaned CCTV dataset.

Recommended model versions:

```text
V1: Public dataset baseline
Revision 2: Public checkpoint fine-tuned on theme-park CCTV data
Revision 3: Revision 2 fine-tuned with observed false positives and missed detections
```

Output names:

```text
models/production/bin_overflow_public_v1.pt
models/production/bin_overflow_themepark_revision_2.pt
models/production/bin_overflow_themepark_v3.pt
```

During each iteration:

1. Run the model on the untouched CCTV test set.
2. Save false positives and false negatives.
3. Add new examples of those failure patterns to the training set.
4. Do not move test images into training.
5. Train a new version.
6. Compare it against the previous version using exactly the same test set.

Initial acceptance targets:

| Metric | Target |
|---|---:|
| Overflow precision | At least 85% |
| Overflow recall | At least 80% |
| Normal-bin false-alert rate | Below 5% |
| Confirmed response time | Below 15 seconds |

These targets are prototype acceptance criteria and must be reported together with dataset size and test conditions.

---

## 12. Stage 8 — Use fixed bin regions when available

Theme-park bins are normally installed at known locations. Store a region of interest for each bin:

```json
{
  "cameraId": "CAMERA_01",
  "binRegions": [
    {
      "binId": "BIN_01",
      "x1": 1020,
      "y1": 430,
      "x2": 1450,
      "y2": 980
    }
  ]
}
```

For a fixed camera:

```text
CCTV frame
→ Crop configured bin region
→ Run YOLOE-26 on the crop
→ Convert coordinates back to the full frame
→ Apply temporal confirmation
```

This increases the number of pixels occupied by the bin and reduces unrelated false detections.

Use full-frame detection when bin locations are unknown, camera positions change, or automatic discovery is required.

---

## 13. Stage 9 — Add temporal confirmation

Do not create an alert from one frame.

Recommended initial rule:

```text
Sample interval: one frame every 2 seconds
History window: latest 5 processed frames
Confirmation: matching state in at least 3 of 5 frames
```

Initial state thresholds:

```text
Full bin:
confidence >= 0.60 and detected in 3 of 5 frames

Overflowing bin:
confidence >= 0.65 and detected in 3 of 5 frames
```

These thresholds must be adjusted using validation data.

State severity:

```text
overflowing > full > normal
```

A higher-severity state should replace a lower state only after satisfying confirmation. A confirmed overflow should return to normal only after several consecutive normal predictions.

---

## 14. Stage 10 — Build the private Python inference service

The Python FastAPI service owns model loading, image preprocessing, YOLOE inference, coordinate conversion, camera-region cropping, and temporal confirmation. It does not own users, roles, application flags, or general database access.

Load the model once during application startup. Do not reload it for every request. Configure the checkpoint through an environment variable:

```env
MODEL_PATH=../models/production/bin_overflow_themepark_v3.pt
MODEL_VERSION=bin-overflow-themepark-v3
INTERNAL_API_TOKEN=replace-in-local-env
```

Private Python endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Confirm API and model readiness |
| `GET` | `/model/info` | Return model version and class names |
| `POST` | `/detect/image` | Detect bin states in an uploaded image |
| `POST` | `/detect/frame` | Process a frame with camera/bin metadata |

The service should accept requests only from the Node backend or local development tools. Require an internal service token outside isolated local development.

Example response:

```json
{
  "modelVersion": "bin-overflow-themepark-v3",
  "cameraId": "CAMERA_01",
  "image": {
    "width": 1920,
    "height": 1080
  },
  "detections": [
    {
      "binId": "BIN_01",
      "className": "overflowing trash bin",
      "confidence": 0.89,
      "confirmed": true,
      "confirmationFrames": 4,
      "bbox": {
        "x1": 1020,
        "y1": 430,
        "x2": 1450,
        "y2": 980
      }
    }
  ],
  "processingTimeMs": 210
}
```

Validate file type, file size, image dimensions, missing model files, and malformed camera configuration.

### Completion condition

- Node.js can call Python `/health`.
- An uploaded image produces structured JSON.
- Bounding boxes use coordinates from the original image.
- Concurrent requests do not reload the model.
- Python contains no user authentication, flag-management, or general database logic.

---

## 15. Stage 11 — Build the Node.js application backend

The Node.js backend is the only public API used by React. It owns authentication, request validation, business rules, persistence, flag creation, deduplication, and communication with Python.

Public Node endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Return combined Node and AI-service health |
| `POST` | `/api/detections/image` | Accept an image and request Python inference |
| `GET` | `/api/detections/:id` | Return a stored detection |
| `GET` | `/api/cameras/:cameraId/bins` | Return the current confirmed bin states |
| `GET` | `/api/flags` | Return application flags |

Internal event endpoint:

```text
POST /api/internal/detections/confirmed
```

This endpoint receives confirmed events produced by the continuous Python CCTV worker. Protect it with an internal service token.

### Image-upload request flow

```text
React multipart upload
→ Node validates user, type, and file size
→ Node forwards the file to Python /detect/image
→ Python returns raw model detections
→ Node validates the response schema
→ Node applies application rules
→ Node stores the detection when required
→ Node returns the application response to React
```

Create `backend/src/services/aiServiceClient.ts` as the only Node module that knows the Python service URL. Configure it through environment variables:

```env
PORT=3000
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_TOKEN=replace-in-local-env
```

Use a shared schema for:

- Image dimensions.
- Bounding-box coordinates.
- Class names.
- Confidence values.
- Model version.
- Camera and bin IDs.
- Confirmation state.

The Node backend must reject malformed Python responses instead of sending them directly to React.

### Completion condition

- Node `/api/health` reports both services correctly.
- Node can forward an image to Python and receive detections.
- React never needs the Python URL.
- Python failures become controlled Node error responses.
- Confirmed detections can be persisted through a repository interface.

---

## 16. Stage 12 — Integrate the React application

The first React page should provide:

- Image upload.
- Image preview.
- Detect button.
- Loading and error states.
- Bounding-box overlay.
- Class name and confidence.
- Detection summary.
- Model version and processing time.

Recommended colours:

| State | Colour |
|---|---|
| Normal | Green |
| Full | Yellow |
| Overflowing | Red |
| Uncertain/unconfirmed | Grey |

Scale bounding boxes using:

```text
scaleX = displayedImageWidth / originalImageWidth
scaleY = displayedImageHeight / originalImageHeight
```

React calls only the Node.js API. It displays results but does not run training, call Python directly, or perform continuous CCTV processing.

Example public request target:

```text
POST http://localhost:3000/api/detections/image
```

### Completion condition

- A user can upload an image.
- Node validates and forwards the request.
- Python performs inference through the internal service connection.
- React renders correctly aligned boxes.
- Summary counts match the API result.
- Errors are displayed clearly.

---

## 17. Stage 13 — Export and register the final model

Keep the original `.pt` model for further fine-tuning.

Before exporting, configure the production classes:

```python
from ultralytics import YOLOE

model = YOLOE("models/production/bin_overflow_themepark_v3.pt")

model.set_classes([
    "normal trash bin",
    "full trash bin",
    "overflowing trash bin",
])

model.export(
    format="onnx",
    imgsz=960,
    simplify=True,
)
```

The exported model has static classes. Changing prompts later requires re-exporting from the `.pt` checkpoint.

Production artifacts:

```text
bin_overflow_themepark_v3.pt
bin_overflow_themepark_v3.onnx
bin_overflow_themepark_v3_metrics.json
bin_overflow_themepark_v3_data.yaml
bin_overflow_themepark_v3_test_report.md
```

Register the approved model in `models/model-registry.json`:

```json
{
  "activeModel": "bin-overflow-themepark-v3",
  "models": [
    {
      "version": "bin-overflow-themepark-v3",
      "checkpoint": "production/bin_overflow_themepark_v3.pt",
      "onnx": "production/bin_overflow_themepark_v3.onnx",
      "classes": [
        "normal trash bin",
        "full trash bin",
        "overflowing trash bin"
      ],
      "inputSize": 960,
      "status": "approved"
    }
  ]
}
```

The Python service reads the active checkpoint at startup. Node.js reads only public metadata such as model version and supported classes; it never loads the model itself.

---

## 18. Stage 14 — Add video, CCTV, and persistence

Only begin this stage after image upload works end to end.

### Video/CCTV sequence

1. Python opens the video or RTSP stream.
2. FFmpeg/OpenCV samples frames.
3. Camera-specific bin regions are cropped.
4. YOLOE-26 predicts bin states.
5. Temporal filtering confirms the state.
6. A snapshot is saved only for confirmed full or overflow events.
7. Python posts the confirmed event to the internal Node endpoint.
8. Node validates, deduplicates, and stores the event through its data layer.
9. Node creates or updates the related application flag.
10. React receives the latest state through the Node API, polling, Server-Sent Events, or WebSocket.

Suggested database record shape:

```json
{
  "cameraId": "CAMERA_01",
  "binId": "BIN_01",
  "zone": "Food Court",
  "issueType": "overflowing_bin",
  "confidence": 0.89,
  "modelVersion": "bin-overflow-themepark-v3",
  "confirmed": true,
  "timestamp": "server timestamp",
  "snapshotUrl": "application-managed evidence URL"
}
```

Replace the example `snapshotUrl` with the storage system selected by the Node backend. The database technology can change without changing the Python inference contract.

Do not save every processed frame. Store confirmed events, evidence snapshots, and the latest aggregated bin state.

---

## 19. Testing checklist

### Dataset

- [ ] No invalid coordinates.
- [ ] No contradictory boxes on one bin.
- [ ] All class IDs match YAML order.
- [ ] Duplicates do not cross dataset splits.
- [ ] Actual CCTV views exist in validation and testing.

### Model

- [ ] Normal bins are not frequently flagged.
- [ ] Full bins are distinguishable from overflow.
- [ ] Overflow remains detectable under obstruction.
- [ ] Small and distant bins are tested.
- [ ] Night and poor-light scenes are tested.
- [ ] Each model version is compared on the same test set.

### Backend

- [ ] Node rejects invalid uploads before forwarding them.
- [ ] Node is the only public application API.
- [ ] Node-to-Python requests use a stable validated schema.
- [ ] Python loads the model once.
- [ ] Temporal state is separated by camera and bin ID.
- [ ] Python processing failures become controlled Node errors.
- [ ] Stream failures do not crash the worker permanently.
- [ ] Confirmed events are deduplicated before persistence.

### Frontend

- [ ] Bounding boxes align after resizing.
- [ ] Loading and failure states work.
- [ ] Confirmed and unconfirmed states look different.
- [ ] Current model version is visible for debugging.

---

## 20. Final development order

Follow this order:

1. Initialise the monorepo, React frontend, Node backend, and Python environment.
2. Export the public dataset in YOLO26 detection format.
3. Inspect original classes and images.
4. Remap and clean labels.
5. Visualize and verify processed annotations.
6. Fine-tune YOLOE-26S as the public baseline.
7. Validate and document its failures.
8. Collect and label theme-park CCTV frames.
9. Fine-tune the theme-park model.
10. Test against untouched CCTV sequences.
11. Add fixed bin regions.
12. Add temporal confirmation.
13. Build the private FastAPI inference endpoint.
14. Build the Node AI-service client and public detection endpoint.
15. Build the React detection page against Node.
16. Export the final `.pt` model to ONNX and register its metadata.
17. Add uploaded-video processing.
18. Add RTSP/CCTV processing.
19. Post confirmed events from Python to Node.
20. Store confirmed events through the Node data layer.
21. Integrate Node with the LitterSpot Flagging Module.

---

## 21. Final acceptance scenario

The implementation is complete when this scenario works:

1. A theme-park CCTV frame contains a visible overflowing bin.
2. The Python worker crops the configured bin region.
3. YOLOE-26S predicts `overflowing trash bin` with sufficient confidence.
4. The same state is detected in at least three of five sampled frames.
5. Python marks the model result as temporally confirmed.
6. Python sends the confirmed event to Node.js.
7. Node validates, deduplicates, and stores one detection with its evidence snapshot.
8. Node creates a high-severity overflow flag.
9. React receives the result from Node and displays the bin region in red with its confidence and timestamp.
10. Repeated frames do not create duplicate flags during the configured deduplication period.

---

## Official technical reference

Ultralytics YOLOE documentation:

https://docs.ultralytics.com/models/yoloe/

YOLO26 and YOLOE-26 documentation:

https://docs.ultralytics.com/models/yolo26/
