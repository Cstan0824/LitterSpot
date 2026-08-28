# Camera registration and floor-hazard implementation report

Date: 2026-08-25

## Delivered

- Firestore-backed camera registration drafts, revisions, validation, and publish conflict checks.
- Production camera setup UI with a `Calibrate view` entry on active cameras.
- Registered geometry passed from backend image/video jobs and direct bin-state calls into the AI service.
- Fail-closed inference: a draft, stale, invalid, or below-threshold registration produces no bin or floor-hazard decision.
- Registered bin candidates are created from enrolled body polygons; the generic bin localizer is skipped for registered cameras.
- Registered detections now carry `binId` so downstream state and alert records can retain camera/bin identity.
- Controlled two-loop floor litter/spill dataset preparation, training, and held-out evaluation.

## Camera registration flow

1. Upload a reference image for the camera using the existing media upload flow and retain its media ID.
2. Open Operations → Registered cameras → Calibrate view.
3. Enter the reference media ID, draw the walkable floor, exclusions, alignment anchors, and each bin body/rim/ground polygon.
4. Run backend validation, then publish with the displayed revision. A stale revision is rejected instead of overwriting a newer operator edit.
5. The published document is stored at `cameraRegistrations/{cameraId}` and a historical copy is written to `cameraRegistrationRevisions`.

The current UI intentionally requires the media ID because it does not silently upload a local browser object URL. This keeps the reference asset auditable and associated with the correct camera.

## Verification

- Backend build: passed (`npm --workspace=backend run build`).
- Frontend build: passed (`npm --workspace=frontend run build`).
- Backend tests: 189 passed, 18 skipped (`npm --workspace=backend test`).
- Tracked AI contract/pipeline tests: 20 passed.
- AI application compile: passed (`python -m compileall -q ai-service/app`).
- Firestore/Auth emulators: started successfully.
- Three-service smoke: frontend `200`, backend `/api/health/live` `{"status":"ok"}`, AI `/health` reports all production model artifacts ready.

## Mock-image replay

Input: the supplied mock image `codex-clipboard-43406523-abe2-4a7d-b890-6841d897ac21.jpg`.

| Context | Bin decisions | Floor-hazard decisions | Result |
| --- | ---: | ---: | --- |
| Generic legacy inference | 2 | 5 | Shows the known false-positive exposure of an unrestricted localizer/segmenter. |
| Published-style registration (`bin-1`) | 1 (`bin-1`) | 2 | Only the enrolled bin region is classified; identity is retained. |
| Draft/invalid registration | 0 | 0 | Fail-closed safety behavior. |

The registered replay is an integration proof, not a claim that the existing generic model is accurate on arbitrary scenes. It demonstrates the intended mitigation: camera geometry decides where a bin may exist, while the state model only decides the enrolled crop.

## Remaining promotion gate

The floor-hazard model is still a bootstrap model. Spill data is from a public wet-surface source converted from boxes to rectangular masks and is not theme-park CCTV data. Do not promote it for automatic dispatch until fixed-camera litter/spill masks and clean-negative clips are collected and a locked site-held-out benchmark is passed.
