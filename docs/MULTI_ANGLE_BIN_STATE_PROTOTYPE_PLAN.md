# Multi-angle bin-state prototype plan

Date: 2026-08-19

## 1. Goal

Build and evaluate one complete local bin-state prototype that demonstrates the
fixed-camera methodology across three viewing-angle bands:

1. localise or register each physical bin;
2. crop the registered bin with 15% surrounding context;
3. classify `normal`, `full`, `overflow`, or `unknown` with a small shared
   MobileNetV3-Small model;
4. apply camera-specific ROI/profile information and temporal confirmation;
5. prove performance separately for top-down, oblique, and side views.

This is a feasibility prototype, not automatic production approval. The proof
is successful only if the held-out metrics pass for every angle band. An
average score that hides a failed side view is not acceptable.

## 2. What exists now

| Asset | Current status | Prototype use |
|---|---|---|
| University of Malaya bin-node dataset | 200 CC BY 4.0 images, predominantly top-down | Public top-down pretraining and test support |
| Training/validation localisation bootstrap | 61 accepted source images, 183 crops | Weak `normal` / `full` candidates |
| Reserved localisation test bootstrap | 42 accepted source images, 126 crops | Test-only top-down candidates |
| Contact-sheet workflow | Implemented, 24 crops per review page | Batch state labelling without manual cropping |
| InternVL3.5-1B state teacher | Rejected copied/template outputs in crop tests | Not trusted as a state-label authority |
| MobileNetV3-Small multi-head trainer | Implemented | Final prototype classifier |
| Fixed-camera profiles and runtime adapter | Implemented | Per-camera ROI, reference and thresholds |

The current public images do not contain defensible overflow examples and do
not cover real oblique/side views. They cannot prove the complete methodology
on their own.

## 3. Prototype dataset

### 3.1 Required angle bands

| Angle band | Camera position | Required evidence |
|---|---|---|
| `top_down` | roughly 60–90 degrees above the opening | rim, contents and nearby ground visible |
| `oblique` | roughly 30–60 degrees | front/side wall plus enough opening to judge the rim |
| `side` | roughly 10–30 degrees | rim silhouette and outside waste visible; use `unknown` when internal fullness cannot be seen |

Angle is recorded as metadata for evaluation and camera setup. Candidate v1 is
one shared model; angle is not supplied as a shortcut input. If one band fails,
the first remediation is an angle-specific threshold/profile, followed by a
small angle embedding only if thresholds are insufficient.

### 3.2 State definitions

| State | Labelling rule |
|---|---|
| `normal` | contents remain clearly below the rim |
| `full` | contents reach the rim but remain contained |
| `overflow` | waste protrudes above/beyond the container or lies outside it |
| `unknown` | rim/opening is occluded, crop is stale/misaligned, bin is missing, or the angle cannot support the judgement |

Closed lids, adjacent chairs, staged boxes beside a bin, and reflections are
hard negatives. They are not overflow.

### 3.3 Minimal controlled proof pack

Capture two independent sessions for each angle band. A session may use the
same phone/camera moved to a new fixed mount, but its background, lighting and
bin placement must be reset before the second session.

For each angle and state:

- eight independently arranged events;
- three frames per event with small natural movement/exposure variation;
- at least two bin/container styles across the complete pack;
- `unknown` events include partial occlusion, missing bin, shifted camera and
  a view where the opening cannot be judged.

Minimum controlled total:

```text
3 angles × 4 states × 8 events × 3 frames = 288 crops
```

Add at least 36 hard-negative crops across angles. The initial proof target is
therefore at least 324 controlled crops, supplemented by the Malaysia
top-down crops. Frames from the same event must never cross splits.

### 3.4 Split policy

- Train: first capture session for every angle, plus public top-down training
  crops.
- Validation: capture-event groups withheld from the first session; used only
  for thresholds and early stopping.
- Test: the complete second capture session for every angle, plus the reserved
  Malaysia test range.
- Locked WhatsApp images/videos: final replay only; never used for training,
  augmentation or threshold selection.
- Report both controlled-camera and public-source results. Do not merge them
  into one misleading score.

This is a session-held-out proof. A later production gate must hold out an
entire real installed camera/location.

## 4. Automated acquisition and labelling

### 4.1 Capture contract

Each event record contains:

```json
{
  "eventId": "angle-oblique-overflow-007",
  "cameraId": "prototype-oblique-session-b",
  "binId": "prototype-bin-01",
  "angleBand": "oblique",
  "state": "overflow",
  "frames": ["frame-001.jpg", "frame-002.jpg", "frame-003.jpg"]
}
```

### 4.2 Processing flow

1. Register the bin once for each fixed camera using YOLOE/YOLO and save the
   normalized ROI in the camera profile.
2. Extract every event frame automatically with 15% context. No manual crop is
   allowed.
3. Generate contact sheets with 24 numbered crops per page.
4. Label one representative tile per event; propagate that label only to the
   other frames belonging to the same event.
5. Review every `full`, `overflow`, and `unknown` event plus 10% of `normal`
   events.
6. Store source path, SHA-256, camera, event, angle, ROI, label method and
   reviewer in the specialist manifest.
7. Run leakage and locked-mock audits before training.

The VLM may suggest a label for review, but it cannot write an accepted state
row unless it passes the crop sanity checks and agrees with the event label.
The observed InternVL template output remains rejected.

## 5. Model and training configuration

### 5.1 Candidate model

- Architecture: MobileNetV3-Small with shared image features.
- Size in this implementation: 940,885 parameters (MobileNetV3-Small
  convolutional features plus three binary heads; the unused ImageNet
  classifier is removed).
- Heads: `presence`, `fullness`, `overflow`.
- Input: 224×224 RGB registered crop with 15% context.
- Initialisation: ImageNet weights.
- State decision:
  - presence below threshold → `unknown`;
  - overflow above threshold → `overflow`;
  - otherwise fullness above threshold → `full`;
  - otherwise → `normal`.

### 5.2 Training

- Optimiser: AdamW, learning rate `3e-4`, weight decay `1e-4`.
- Batch: 64 on RTX 4050; fall back to 32 if needed.
- Maximum epochs: 15; early stopping patience 3.
- Loss: masked binary cross-entropy per head. An unknown target contributes no
  loss to the corresponding unavailable state judgement.
- Sampling: balance state and angle in the training sampler only.
- Augmentation: mild brightness/contrast, compression, blur, small affine and
  perspective movement within the labelled angle band.
- Prohibited augmentation: vertical flips or extreme perspective warps that
  pretend a top-down image is a genuine side view.
- Thresholds: select on validation once and store in the checkpoint.

Expected output:

```text
runs/state_classifier/multi_angle_mobilenet_v3_small_v1/
  best.pt
  report.json
  predictions.csv
  confusion-matrix-<angle>.json
```

## 6. Prototype proof gates

### 6.1 Accuracy gates

| Metric | Prototype minimum | Reported separately by angle? |
|---|---:|:---:|
| Overflow precision | ≥ 0.75 | yes |
| Overflow recall | ≥ 0.85 | yes |
| Full recall | ≥ 0.80 | yes |
| Normal precision | ≥ 0.80 | yes |
| Unknown recall | ≥ 0.80 | yes |
| Four-state macro F1 | ≥ 0.75 | yes |
| False overflow on hard negatives | ≤ 10% | yes |

The candidate fails if any angle band misses an overflow-recall or macro-F1
gate. Prototype gates are intentionally lower than the production gates of
0.85 precision and 0.90 recall.

### 6.2 Fixed-camera robustness gates

- ±3% ROI translation: state unchanged or safely `unknown` in at least 90% of
  cases.
- ±5% scale change: state unchanged or `unknown` in at least 90%.
- Partial occlusion: `unknown` rather than false overflow in at least 90%.
- Missing bin: presence head returns absent/unknown in at least 95%.
- Two-of-three adjacent-frame confirmation suppresses one-frame state changes.

### 6.3 Hardware/runtime gates

- Batch of 4–8 registered bins on RTX 4050: mean <30 ms, p95 <50 ms for the
  classifier stage.
- Complete three-fact cycle at the configured ten-second interval: <500 ms.
- No CUDA OOM at the intended batch size.
- CPU fallback is measured but is not required to meet the GPU latency gate.

## 7. Complete pipeline test

For every locked image/video case, record expected and actual values for:

| Detection fact | Expected output | Model path |
|---|---|---|
| Bin state | one state per registered bin plus confidence/unknown reason | new multi-angle MobileNetV3-Small |
| Floor hazard | litter/spill masks or clean | current experimental YOLO11n-Seg; remains fail-closed for spill |
| Population | visible-person count and boxes | existing YOLO11n occupancy specialist |

Run three evaluations:

1. state-model held-out test, including per-angle confusion matrices;
2. locked WhatsApp still/video replay with expected-versus-actual table;
3. live/simulated ten-second cycle with temporal confirmation, persistence and
   task-alert suppression for `unknown`.

No cleaner task is dispatched from a raw single frame. Only temporally
confirmed `full` or `overflow` may become a task candidate; the prototype can
run in log-only mode until production gates are met.

## 8. Execution phases

### Phase 1 — finish data tooling

- add `angleBand`, `cameraId` and `eventId` to the bin manifest contract;
- add event-group split and leakage audits;
- merge per-page contact-sheet labels into one manifest;
- add per-angle coverage reporting.

Exit: every crop is traceable to an event and no group crosses splits.

### Phase 2 — capture and label the controlled proof pack

- capture ≥324 crops using the event matrix;
- auto-crop from registered ROIs;
- batch-label contact sheets;
- audit state/angle/hard-negative coverage.

Exit: each angle has train/validation/test support for all four states.

### Phase 3 — train the complete candidate

- run a one-epoch smoke train;
- run the 15-epoch candidate with early stopping;
- calibrate thresholds from validation;
- freeze `best.pt` and generate held-out predictions.

Exit: checkpoint loads through the production adapter and all outputs are
reproducible from the manifest and seed.

### Phase 4 — prove or falsify the methodology

- evaluate each state and angle;
- run camera-shift, occlusion, missing-bin and hard-negative suites;
- run the locked WhatsApp replay;
- measure batch and complete-cycle latency;
- produce an expected-versus-actual result table and failure analysis.

Exit: all prototype gates pass, or the report names the failed angle/state and
the next required data/remediation. A failed proof is not registered.

### Phase 5 — integration decision

- if all prototype gates pass, register the checkpoint as
  `prototype/log-only` and use it in the specialist backend;
- if only angle-specific thresholds are required, store them in camera
  profiles and rerun Phase 4;
- if an angle still fails, collect targeted examples for that angle rather
  than increasing model size first;
- promote task dispatch only after the stricter production gates pass on a
  wholly unseen installed camera.

## 9. Definition of done

The methodology is proven workable when all of the following exist:

- a reproducible, checksum-audited multi-angle manifest;
- a trained MobileNetV3-Small checkpoint containing thresholds and version;
- held-out per-angle/per-state metrics meeting every prototype gate;
- camera-shift, occlusion and hard-negative results;
- locked WhatsApp expected-versus-actual results;
- RTX 4050 latency measurements;
- a complete three-fact log-only pipeline replay;
- no training dependency on WhatsApp mocks or rejected VLM labels.

Anything less is an integration demonstration, not proof of multi-angle
bin-state detection.

## 10. Execution record — 2026-08-19

The executable prototype was completed, with the controlled-data limitation
called out explicitly:

| Step | Result |
|---|---|
| Public localization bootstrap | 61/100 source images accepted for train/validation (183 crops); 42/100 reserved images accepted for test (126 crops). The held-out range was not fine-tuned. |
| Contact-sheet review | Eight paginated sheets were generated for the 183 training/validation crops. The source is predominantly empty/contained and has no defensible overflow labels. |
| Prototype manifest | `ml-training/data/specialists/multi-angle-prototype/manifest.json`: 1,911 train / 468 validation / 1,638 test rows. It contains weak public base crops plus controlled synthetic state/angle variants. All 4,017 rows pass the smoke provenance audit with 4,017 intentional weak-label warnings. |
| Training | MobileNetV3-Small, three masked binary heads, ImageNet initialization, 12 epochs on the RTX 4050. Checkpoint: `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt`. |
| Held-out evaluation | Synthetic variant macro-F1: 0.966 (all angles combined). Per-angle macro-F1: top-down 0.853, oblique 0.984, side 0.980. Overflow recall is 1.00 for each angle; overflow precision is 0.913 / 0.977 / 0.984 respectively. |
| Weak public base evaluation | Only 126 unmodified reserved crops: four-state macro-F1 0.200, with `full` F1 0.185. This is why the source cannot be treated as a real state benchmark. |
| Runtime adapter | 48 balanced synthetic cases loaded through `ai-service.app.multi_state_classifier.MultiStateClassifier`: 45/48 (93.75%) matched; top-down 13/16, oblique 16/16, side 16/16. Mean single-crop runtime was 27.5 ms on CUDA. |
| Batch latency | Classifier-only mean/p95: batch 4 = 12.9/19.8 ms; batch 8 = 11.8/13.0 ms. Both satisfy the prototype latency gate. |
| Robustness replay | Synthetic ±3% ROI shift and ±5% scale were 95.8–97.9% same-or-unknown with 0% false overflow on normal/unknown rows; blank missing-bin crops were 100% unknown. Partial occlusion was only 79.2% safe and produced 25% false overflow on normal/unknown rows, so the occlusion gate **fails**. |

The checkpoint remains **prototype/log-only** and is not registered as a
production model. The synthetic score demonstrates that the crop → shared
classifier → angle report → runtime decision path is workable; it does not
demonstrate real-world state accuracy. The next blocking input is the reviewed
controlled pack in §3.3, especially real oblique/side views, contained-full
examples, overflow with surrounding waste, and unknown/occluded cases. The
synthetic occlusion failure also requires a quality/occlusion guard or more
reviewed occluded examples before registration.
