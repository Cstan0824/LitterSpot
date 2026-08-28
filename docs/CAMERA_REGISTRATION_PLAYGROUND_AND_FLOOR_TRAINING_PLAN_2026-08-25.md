# Camera registration playground and floor litter/spill training plan

## Implementation status — 2026-08-25

All planned stages are implemented and smoke-tested. The local geometry draft remains in memory until the operator presses **Publish revision**, while the production publish path validates against Firestore, writes an immutable revision, and supplies the active registration to inference. Results are recorded in [the implementation report](reports/CAMERA_REGISTRATION_AND_FLOOR_HAZARD_IMPLEMENTATION_2026-08-25.md) and [the floor benchmark](reports/FLOOR_HAZARD_TWO_LOOP_BENCHMARK_2026-08-25.md).

## Outcome

Deliver two connected improvements in this order:

1. validate a low-effort camera-registration workflow in a throwaway frontend playground;
2. use the approved registration geometry during floor litter/spill inference and train a two-class floor-hazard segmentation model.

This plan interprets "litter and split" as **floor litter and floor spill**. The first floor model remains one two-class segmentation model (`floor_litter`, `floor_spill`) because both classes share the same floor ROI, exclusions, image preprocessing, and temporal confirmation. Split them into separate models only if measured error analysis shows destructive class interference.

## Design decisions

- Registration is per fixed camera and per physical bin, not per uploaded test image.
- Operators draw geometry once; runtime frames are aligned back to that registered reference.
- The registration artifact is shared: bin inference consumes bin/rim geometry, while floor inference consumes walkable-floor and exclusion geometry.
- Registration fails closed. A moved camera, hidden rim, invalid alignment, or badly exposed frame returns `unknown`; it never enables whole-frame bin guessing.
- The canvas draft is deliberately local and in-memory until backend validation/publish; this keeps incomplete geometry from becoming active while still providing a production mutation path.
- Public datasets add visual diversity. A compact project-camera set supplies the deployment-floor reflections, spills, litter scale, and viewing angle that public data cannot represent.

## Stage 1 — camera-registration entry playground

### 1.1 Product question

Answer this question before implementing persistence:

> Can a supervisor register one camera and its visible bins correctly in under five minutes, without understanding computer-vision terminology?

The playground is mounted inside the existing `#/cameras` location page in `frontend/src/features/operations/OperationsConsole.tsx`. It uses the real registered-camera list but keeps calibration state in memory. The active design is shareable through `?registrationVariant=A|B|C` before the hash route.

Example:

```text
http://127.0.0.1:5173/?registrationVariant=A#/cameras
```

The prototype switcher is development-only and supports buttons plus left/right keyboard navigation.

### 1.2 Three structurally different variants

| Variant | Structure | What it tests |
| --- | --- | --- |
| A — Guided enrollment | A five-step wizard with one required action at a time | Whether non-technical users can finish reliably; recommended default |
| B — Canvas studio | Large image canvas, drawing toolbar, and live object/quality inspector | Whether experienced operators need faster direct editing |
| C — QA checklist | Left-side task checklist, centre canvas, right-side live readiness report | Whether explicit validation evidence prevents incomplete registration |

All variants manipulate the same in-memory `CameraRegistrationDraft` and expose its complete JSON/state summary. The production bar outside the variants calls the backend validate/publish endpoints; the development-only switcher is only for comparing layouts.

### 1.3 Recommended user entry flow

1. From a registered camera row, select **Calibrate view**.
2. Confirm camera identity, zone, resolution, source mode, and that the camera mount is final.
3. Upload or capture a clean reference frame with no cleaner blocking the floor or bin.
4. Draw the walkable-floor polygon and mark exclusions such as glass, posters, counters, tables, reflective walls, and areas outside the cleaning zone.
5. Add each physical bin by drawing:
   - outer bin-body polygon;
   - rim/opening polygon or line;
   - lid/deposit-slot polygon when present;
   - surrounding ground ring, initially auto-generated and manually adjustable;
   - stable `binId` and bin type.
6. Accept four to eight suggested background anchors or place them manually on permanent structures.
7. Upload three to ten additional frames from the same camera. Run registration QA and show pass/fail evidence.
8. Review the resulting floor ROI, bin count, bin IDs, runtime crops, and simulated `normal/full/overflow/unknown` output.
9. Run **Validate backend**, resolve any failed check, then select **Publish revision**. The active revision is used by the next frame/video job.

The UI should use plain task language. For example, display “Outline the bin opening” instead of “Draw rim polygon,” with the technical term confined to diagnostics.

### 1.4 Playground state model

```ts
type NormalizedPoint = { x: number; y: number };
type Polygon = NormalizedPoint[];

type RegisteredBinDraft = {
  binId: string;
  displayName: string;
  binType: "open_top" | "lid" | "slot" | "unknown";
  bodyPolygon: Polygon;
  rimPolygon: Polygon;
  lidPolygon: Polygon | null;
  groundRingPolygon: Polygon;
};

type CameraRegistrationDraft = {
  schemaVersion: 1;
  cameraId: string;
  reference: {
    objectUrl: string;              // prototype only
    width: number;
    height: number;
    capturedAt: string | null;
  } | null;
  walkableFloorPolygon: Polygon;
  exclusionPolygons: Polygon[];
  alignmentAnchors: NormalizedPoint[];
  bins: RegisteredBinDraft[];
  quality: {
    alignmentScore: number | null;
    blurScore: number | null;
    exposureStatus: "unknown" | "pass" | "fail";
    rimVisibilityByBin: Record<string, number>;
  };
  readiness: "not_started" | "incomplete" | "ready" | "invalid";
};
```

Keep polygon coordinates normalised to `0..1`, matching the repository's Firestore coordinate convention. Do not store pixels, base64 frames, absolute paths, model outputs, or canvas coordinates in the draft schema.

### 1.5 Playground validation rules

The **Finish preview** action is enabled only when:

- reference resolution is known;
- the walkable-floor polygon is valid and has at least three points;
- exclusions are inside or intersect the camera frame;
- at least four non-collinear stable anchors are present;
- every registered bin has a unique ID, valid body geometry, valid rim geometry, and non-empty surrounding ring;
- body/rim polygons do not fall entirely outside the frame;
- the rim is inside or plausibly adjacent to its bin body;
- each validation frame meets minimum alignment, blur, and exposure checks;
- the preview returns `unknown`, rather than a positive state, when alignment or rim visibility is deliberately failed.

Prototype acceptance test:

- a first-time user completes one camera with two bins in five minutes or less;
- no required geometry is omitted;
- the user can explain the body, opening, ground-ring, floor, and exclusion overlays after completion;
- a chair outside registered bin polygons never becomes a bin candidate;
- moving the validation image beyond the allowed alignment tolerance visibly produces `unknown`.

### 1.6 Prototype file plan

```text
frontend/src/features/operations/camera-registration-prototype/
  CameraRegistrationPrototype.tsx
  CameraRegistrationCanvas.tsx
  CameraRegistrationState.ts
  VariantA.tsx
  VariantB.tsx
  VariantC.tsx
  PrototypeSwitcher.tsx
```

Add a single development script/URL note to the frontend README or this plan. Do not add backend routes, Firestore writes, or production-level abstractions during this stage.

### 1.7 Decision checkpoint

The user chooses a winning variant or a specific combination, such as “wizard sequence from A, canvas controls from B, readiness panel from C.” Record that verdict. Rewrite the winning flow as production code; keep the three-way prototype only on a throwaway branch, as primary design evidence.

## Stage 2 — production camera-registration module

### 2.1 Deep module and seam

Introduce one deep `CameraRegistrationModule`. Its interface hides canvas conversions, geometry validation, reference-frame comparison, Firestore transactions, revisioning, and inference-format export.

```ts
get(cameraId): Promise<CameraRegistration | null>
validate(cameraId, draft, validationMediaIds): Promise<RegistrationValidation>
publish(cameraId, validatedDraft, expectedRevision): Promise<CameraRegistration>
```

The frontend and tests cross this same seam. Do not expose Firestore document structure to React, and do not let the AI Python process read Firestore directly. Node remains the application data owner and supplies a versioned inference context to the AI service.

### 2.2 Firestore representation

Use an active record plus immutable revisions:

```text
cameraRegistrations/{cameraId}
cameraRegistrationRevisions/{revisionId}
```

The active document contains:

- `cameraId`, `revision`, `schemaVersion`, `status`;
- source width/height and safe reference-media ID;
- normalised walkable-floor, exclusion, anchor, bin-body, rim, lid, and ground-ring geometry;
- alignment/visibility quality thresholds;
- reference fingerprint and model-independent QA summary;
- `createdAt/By`, `validatedAt/By`, `publishedAt/By`.

The reference frame remains in the existing local media system; Firestore stores only its media ID and checksum. Publishing uses an expected revision to prevent two supervisors silently overwriting each other.

### 2.3 Backend interface

```text
GET  /api/cameras/:cameraId/registration
POST /api/cameras/:cameraId/registration/validate
PUT  /api/cameras/:cameraId/registration
GET  /api/cameras/:cameraId/registration/revisions
```

All mutation routes remain Supervisor-only, use strict Zod schemas, record system events, and reject geometry outside the normalised coordinate invariant.

### 2.4 AI inference integration

At frame analysis time, Node resolves the active registration and passes a compact context:

```text
cameraId + registrationRevision
walkableFloorPolygon + exclusions
registered bins: binId + body + rim + lid + ground ring
reference fingerprint + alignment thresholds
```

Runtime order:

```text
frame quality
  -> align frame to registered reference
  -> fail to unknown if invalid
  -> clip floor-hazard inference to walkable floor minus exclusions
  -> analyze only registered bin crops
  -> require rim/ground-ring evidence for overflow
  -> temporal confirmation
```

Retire `config/bin-profiles.json` after Firestore registration reaches parity and replay tests prove identical or safer behaviour. Do not maintain Firestore and JSON as two writable sources of truth.

## Stage 3 — floor litter/spill dataset preparation

### 3.1 Dataset roles

| Data | Role | Label treatment |
| --- | --- | --- |
| Existing TACO/UAVVaste material | General litter diversity | Retain verified polygons and `floor_litter` mapping |
| PlastOPol | Additional small/outdoor litter shapes | Use only after license/provenance admission; derive masks only with automated assistance plus review |
| Existing wet-surface/spill sources | Generic wet appearance | Retain verified masks or conservative wet-region labels |
| Hazards&Robots | Indoor clean floors, reflections, debris, puddle-like anomalies | Use source-separated clean/hard-negative frames; do not invent pixel masks from event labels |
| Local project-camera clips | Deployment truth | One representative frame per event; polygon-mask positive hazards and retain clean hard negatives |
| Existing `mock-data/` suites | Locked evaluation only | Never train, calibrate thresholds, or select checkpoints on these files |

### 3.2 Minimal local capture target

Start with 50 event clips rather than frame-by-frame uploads:

- 15 normal/clean clips;
- 10 litter events;
- 10 spill or food-residue events;
- 15 hard-negative clips containing reflections, grout, stains, mop marks, furniture, carried objects, visible bin liners, or floor graphics.

Extract one primary frame per event and optionally a second frame only when it represents a materially different occlusion or scale. Record `cameraId`, registration revision, location/session/video group, source/license, class, polygon, and edge tags.

### 3.3 Preparation changes

Extend the current floor scripts instead of creating a second disconnected training pipeline:

1. add admitted-source converters under `scripts/floor_rubbish_script/`;
2. extend `dataset_manifest.csv` with `captureGroup`, `cameraId`, `registrationRevision`, `license`, `reviewStatus`, and edge tags;
3. split by source/camera/location/session/video **before** frame extraction;
4. deduplicate exact hashes and near-duplicates;
5. exclude locked mock hashes and all unreviewed/quarantined data;
6. render mask overlays and source/class/edge summaries;
7. fail validation on split leakage, invalid polygons, missing rights metadata, or missing clean-negative coverage.

For public video datasets, adjacent frames and frames from the same capture sequence must remain in one split. Synthetic transformations inherit the source sample's split and do not count as independent scenes.

## Stage 4 — two-loop floor model training

### 4.1 Model configuration

Continue with the existing YOLO segmentation adapter and two classes:

```text
0 floor_litter
1 floor_spill
```

Initial hardware-safe configuration for the RTX 4050 6 GB target:

- 640 px input;
- AMP enabled;
- batch 2–4, with gradient accumulation if required;
- deterministic seed and group-aware manifest;
- early stopping;
- separate calibrated confidence thresholds for litter and spill;
- inference clipped to registered walkable floor minus exclusion polygons.

Do not increase resolution until the error sheet shows that small/distant litter—not label quality, ROI error, or insufficient local data—is the main remaining limitation.

### 4.2 Loop 1 — establish an honest baseline

Train on admitted existing/public training sources plus the training portion of local events. Select the checkpoint and thresholds using validation groups only.

Report:

- box and mask precision, recall, F1, mAP50, and mAP50-95 per class;
- mask IoU;
- clean-floor hard-negative false-positive rate;
- results by camera/source and edge tags: reflection, shadow, stain, grout, small object, occlusion, clear liquid, dark liquid, food residue;
- inference latency and peak VRAM;
- a false-positive/false-negative overlay gallery.

Loop 1 is diagnostic. It must not be promoted merely because aggregate mAP improves.

### 4.3 Loop 1 feedback decision

Assign every error one primary cause:

1. wrong/ambiguous label;
2. missing scenario;
3. camera registration or floor-ROI error;
4. model representation error;
5. threshold/post-processing error;
6. temporal/fusion error.

Mitigate causes 1, 2, and 3 before changing model size. Build Loop 2 data from the top two failure slices, not from more random public images.

### 4.4 Loop 2 — targeted mitigation

- add or correct local examples for the dominant failure slices;
- oversample by independent event/capture group, not adjacent frames;
- add clean negatives that visually resemble each false positive;
- preserve the original validation/test groups and locked mock benchmark;
- retrain under a new run ID and calibrate thresholds on validation only;
- evaluate once on untouched test groups and then on locked mocks.

Promotion target:

- litter precision and recall at least 85%;
- spill recall at least 90% for the prototype and precision at least 80%;
- clean/hard-negative false-positive rate at most 5%;
- no regression greater than 3 percentage points on any approved camera group;
- peak VRAM below 5 GB and floor inference below 250 ms per sampled frame;
- spill is not promoted without real local spill positives in the untouched test set.

The longer-term spill-recall target remains 95%; the 90% Loop 2 target is a prototype admission threshold, not a production safety claim.

## Stage 5 — integrated validation

Run frontend, backend, Firestore emulator/cloud-development configuration, and AI inference together.

Required tests:

- frontend build and interaction tests for polygon editing, undo, reset, duplicate IDs, and readiness states;
- backend schema/unit tests and Firestore emulator tests for validation, publishing, revision conflicts, authorization, and audit events;
- AI tests for coordinate transforms, frame alignment, floor clipping, exclusions, registered-bin crop export, and fail-closed unknown responses;
- replay tests proving a chair outside registered bin geometry cannot become a bin;
- floor replay tests proving hazards outside the walkable polygon or inside exclusions are suppressed;
- camera-shift, blur, exposure, person occlusion, hidden-rim, reflection, litter, and spill mock cases;
- three-process smoke test through the frontend-visible response.

Record the active camera-registration revision, floor-model version, threshold set, processing time, and unknown reason in diagnostics. These fields make later false positives traceable to configuration versus training.

## Delivery sequence and approval points

| Order | Deliverable | Gate |
| ---: | --- | --- |
| 1 | Three-variant registration playground on `#/cameras` | User selects the winning workflow |
| 2 | Production registration schema, module, Firestore revisions, and backend routes | Emulator tests and revision conflict tests pass |
| 3 | AI registration alignment, registered-bin cropping, and floor ROI/exclusion integration | Fail-closed and chair regression tests pass |
| 4 | Admitted floor dataset manifest and local 50-event set | Rights, masks, leakage, and coverage audit pass |
| 5 | Floor model Loop 1 | Metrics and failure slices reviewed; no promotion |
| 6 | Targeted Loop 2 | Prototype promotion targets pass on untouched data |
| 7 | Full three-process replay | UI-visible output matches recorded benchmark |

## Immediate next action

Implement Stage 1 only: the in-memory three-variant registration playground inside the existing camera page. Use one supplied camera frame and the current registered-camera records as mock inputs. Stop after the user chooses the workflow; do not commit Firestore geometry or start GPU training before that decision.
