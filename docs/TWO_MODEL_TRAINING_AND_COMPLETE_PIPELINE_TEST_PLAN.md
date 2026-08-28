# Two-model training and complete-pipeline test plan

Date: 2026-08-19

## 1. Outcome and scope

Train and promote the two missing visual specialists while retaining the
already-validated person detector:

| Detection fact | Production path | Output |
|---|---|---|
| Bin state / overflow | Fixed registered bin ROI -> MobileNetV3-Small multi-head classifier | `normal`, `full`, `overflow`, or `unknown`, with presence/fullness/overflow probabilities |
| Floor litter / spill | Floor ROI -> YOLO11n-Seg | zero or more `floor_litter` / `floor_spill` masks |
| Human population | Existing YOLO11n person detector -> occupancy ROI | count and person boxes |

The two models to train are the bin-state classifier and floor-hazard
segmenter. Occupancy is included in the complete-pipeline test but is not
retrained unless it regresses.

Public data is used for initialisation and broad visual coverage. The WhatsApp
mock set remains a locked, evaluation-only dataset. It must never enter model
training, threshold selection, or augmentation.

## 2. Important capability boundary

Public data can bootstrap overflow and solid-litter recognition, but it does
not completely represent the installed indoor cameras:

- StreetView-Waste provides container boxes and surrounding-waste/overflow
  masks, but not a reliable indoor `normal` versus `full` label.
- TACO provides useful solid-litter masks, but mostly in outdoor scenes.
- The available public spill data is small or strongly domain-shifted from an
  indoor F&B floor.

Therefore the first promotion is an **overflow/litter prototype**. `full` and
`floor_spill` remain conservative outputs until operational before/after clips
provide camera-specific weak labels. The API must return `unknown` or
`possible_spill`; it must not manufacture confident labels when evidence is
insufficient.

## 3. Dataset acquisition and governance

### 3.1 Sources

| Source | Use | Repository policy |
|---|---|---|
| StreetView-Waste | Bin presence, bin crops, surrounding overflow masks | Apply for its separate dataset licence. Download to ignored local cache; do not commit pixels. |
| TACO, CC BY 4.0 | Solid floor litter masks | Keep attribution, source ID, licence and checksum for every selected image. |
| pLitterStreet | Supplemental small ground litter | Do not train commercially until its dataset licence is confirmed. |
| Roboflow Liquid Spill, 49 images, CC BY 4.0 | Low-weight spill experiment only | Preserve attribution/provenance; never use as the sole spill evidence. |
| Exylos spill data, Apache-2.0 | Mask-format and segmentation warm-up only | Sample by episode; do not mix adjacent frames across splits. |
| Project task snapshots | Camera-specific weak positives, clean negatives and hard negatives | Project-owned; store event and camera IDs so all frames from an event stay in one split. |

The source assessment is recorded in
`docs/research/PUBLIC_DATASET_AND_LOW_LABEL_ALTERNATIVES_2026-08-19.md`.

### 3.2 Required acquisition/import implementation

Add one source adapter per accepted dataset under
`ml-training/scripts/importers/`. Each adapter must:

1. download or read a local cache without committing source pixels;
2. verify an expected checksum or record the observed checksum;
3. retain the source URL, licence, attribution and source annotation ID;
4. convert annotations into the specialist manifest contract;
5. group rows by original video, capture sequence, location or source image;
6. reject any path or checksum matching `mock-data/`;
7. produce a conversion report containing accepted, skipped and malformed rows.

The first executable import path is now available for TACO:

```powershell
.\.venv\Scripts\python.exe scripts\acquire_taco_subset.py --limit 150 --seed 42
.\.venv\Scripts\python.exe scripts\import_taco_specialist_manifest.py
```

For operational bin events, use
`scripts/generate_weak_bin_manifest.py --events <event-export.json>`. It creates
fixed-ROI crops and weak labels while preserving an event-level capture group;
run the audit with `--allow-weak-labels` only for bootstrap smoke work.

Do not silently turn an unlabelled condition into a negative. For example, a
StreetView image without a `full` annotation is `fullnessKnown=false`, not
`full=false`.

### 3.3 Split policy

Create train/validation/test groups before extracting frames:

- 70% training groups;
- 15% validation groups for threshold selection and early stopping;
- 15% untouched public-source test groups;
- zero duplicate perceptual hashes across splits;
- zero source video/event/camera session IDs across splits;
- report results per source as well as combined.

Class balancing may oversample rare classes in the training loader only. It
must not duplicate samples in validation or test metrics.

### 3.4 Automatic labelling workflow

The bootstrap no longer depends on manually cropping and labelling every
frame. Automatic labels remain separate from reviewed ground truth and carry
`review.status=weak_label` plus the teacher model, confidence and rule trace.

| Fact | Automatic teacher path | Weak-label output |
|---|---|---|
| Bin state | Existing bin localiser -> 15% context crop -> InternVL3.5-1B state prompt plus rim/outside-waste rules | `normal`, `full`, `overflow`, or `unknown`; independent known masks for presence/fullness/overflow |
| Floor litter | TACO-initialised YOLO11n-Seg proposes solid-litter masks inside the configured floor ROI | `floor_litter` polygons/masks |
| Floor spill | Licensed spill seed model proposes liquid/wet-area masks; InternVL3.5-1B rejects obvious reflections, shadows and drains | `floor_spill` masks or `unknown` |

Automatic acceptance rules:

1. require the same class in at least two of three nearby frames when video is
   available;
2. accept only proposals above the per-class validation threshold;
3. return `unknown` for occlusion, teacher disagreement or an invalid ROI;
4. keep all low-confidence proposals out of training until reviewed;
5. review one representative thumbnail per event, all uncertain events and a
   10% random sample of accepted labels;
6. never auto-label or train on the locked WhatsApp evaluation set.

The labelling implementation will write:

- `ml-training/data/specialists/auto-manifest.json` for weak labels;
- cropped bin images and floor masks in ignored local data directories;
- `artifacts/specialist-auto-label/<run-id>/labels.csv` for minimal review;
- `artifacts/specialist-auto-label/<run-id>/report.json` containing accepted,
  unknown, rejected, reviewed and per-teacher agreement counts.

The training loop is teacher-student, limited to two bootstrap rounds:

1. seed from verified public annotations;
2. generate weak labels on public/project-owned inputs;
3. train the small specialist models;
4. relabel once using the improved specialists;
5. train again and evaluate on reviewed, source-separated holdouts.

Weak labels may be used for prototype training, but promotion metrics are
calculated only on reviewed validation/test rows.

### 3.5 Batch annotation without manual per-image cropping

When event-level review is needed, use a numbered contact sheet rather than
opening and cropping images one by one:

```powershell
.\.venv\Scripts\python.exe scripts/build_bin_contact_sheet.py `
  --input artifacts/specialist-auto-label/<run-id>/bin-crops `
  --output artifacts/contact-sheet/<run-id> `
  --columns 4 --tile-width 448 --tile-height 448 `
  --source-id malaysia-bin-node `
  --source-url https://figshare.com/articles/figure/Solid_waste_bin_images_with_3_bin_per_node/6269042 `
  --license "CC BY 4.0"
```

The command writes `contact-sheet.jpg`, `sidecar.json` and a compact
`labels.template.json`. A reviewer or a batch-capable model fills one JSON
object per `tileId`; the same script then copies the original-resolution source
crop (never the downscaled sheet), verifies its SHA-256, and writes a specialist
manifest plus `labels.csv`:

```powershell
.\.venv\Scripts\python.exe scripts/build_bin_contact_sheet.py `
  --input artifacts/specialist-auto-label/<run-id>/bin-crops `
  --output artifacts/contact-sheet/<run-id> `
  --labels labels.json --min-confidence .80
```

This reduces review operations without hiding uncertainty. It is not a reason
to run the current InternVL scene prompt over a giant mosaic: the model has
already demonstrated copied grid boxes, and a downscaled mosaic loses the rim
and surrounding-waste evidence needed for `full` versus `overflow`. Contact
sheets are therefore a review/label transport format; inference and training
still use individual original-resolution crops.

## 4. Model 1 — bin state and overflow

### 4.1 Data contract change

Extend the bin manifest and trainer to support independently known targets:

```json
{
  "label": {
    "binPresent": true,
    "presenceKnown": true,
    "fullness": null,
    "fullnessKnown": false,
    "overflow": true,
    "overflowKnown": true,
    "state": "overflow"
  }
}
```

This is required because public overflow data does not reliably label internal
fullness. Loss and metrics for an unknown head must be masked.

### 4.2 Training samples

Build the first bootstrap set from:

- StreetView-Waste positive overflow crops and its negative container crops;
- background/object crops as `binPresent=false` hard negatives;
- source-verified fill-level images only as a small supplemental experiment;
- automatically collected project snapshots once real tasks occur.

For project snapshots, create event-level weak labels:

- persistent frames before an accepted overflow task -> weak overflow positive;
- stable, unoccluded frames after completion -> likely normal negative;
- rejected or disappearing alerts -> hard negative;
- missing/occluded/stale ROI -> unknown, not normal.

No manual crop is required: fixed registered bin ROIs plus 15% context generate
the crops automatically. If minimal feedback is available, confirm one
representative thumbnail per event, not every frame.

For public bin photographs without state annotations, the auto-label teacher
may create prototype rows, but must use `unknown` whenever the bin opening,
rim or surrounding floor is not visible. Such rows do not count toward the
reviewed promotion set.

### 4.3 Training configuration

- Architecture: MobileNetV3-Small multi-head classifier, approximately 2.6M
  parameters with the project heads.
- Input: 224x224 RGB crop with 15% surrounding context.
- Heads: presence, fullness and overflow sigmoid logits.
- Initialisation: ImageNet weights.
- Optimiser: AdamW, learning rate `3e-4`, weight decay `1e-4`.
- Batch: 64 initially; reduce to 32 if memory pressure occurs.
- Epochs: maximum 15, early stopping patience 3 on the minimum per-head F1.
- Augmentation: moderate brightness/contrast, blur, compression, small affine
  camera/bin drift and occlusion; no vertical flip.
- Thresholds: selected once from validation data and saved inside the checkpoint.

Training command after the independent pilot gate passes:

```powershell
.\.venv\Scripts\python.exe scripts\audit-specialist-training-data.py `
  --manifest ml-training\data\specialists\manifest.json `
  --pipeline bin_state --profile pilot

.\.venv\Scripts\python.exe ml-training\scripts\train_specialist_bin_state.py `
  --manifest ml-training\data\specialists\manifest.json `
  --epochs 15 --batch 64 --device cuda:0
```

### 4.4 Bin-state promotion metrics

| Metric | Minimum promotion gate | Target |
|---|---:|---:|
| Overflow precision | 0.85 | >= 0.90 |
| Overflow recall | 0.90 | >= 0.95 |
| Contained-full recall | 0.85, only after enough true full labels exist | >= 0.90 |
| Missing/occluded ROI returned as `unknown` | 0.90 | >= 0.95 |
| False overflow on adjacent bags, chairs and objects on lid | <= 5% | <= 2% |
| Per-bin ROI inference, batch of 4-8 bins on RTX 4050 | < 50 ms | < 30 ms |

If the public bootstrap does not meet the contained-full gate, promote only the
overflow path and map uncertain fullness to `unknown`. Do not create cleaner
tasks from the `full` output until the gate is passed on camera-domain data.

## 5. Model 2 — floor litter and spill

### 5.1 Label mapping

Convert source annotations into the existing same-size class-index mask:

- `0`: background/ignore;
- `1`: `floor_litter`;
- `2`: `floor_spill`.

Map verified TACO waste categories to `floor_litter`. Preserve ambiguous,
non-floor or heavily occluded objects as ignore regions instead of negatives.
Map liquid datasets to `floor_spill` only when the original annotation actually
describes a spill/wet area. Clean images create empty YOLO label files.

For unlabelled public or project-owned floor images, seed models may propose
masks. A proposal becomes a weak label only when the mask is within the floor
ROI, passes confidence/area checks and is not rejected by the VLM context
check. Litter and spill remain separate classes even when both appear in one
scene.

### 5.2 Training configuration

- Architecture: YOLO11n-Seg.
- Input: 640x640 floor-ROI image.
- Batch: 2 on the 6GB RTX 4050 Laptop GPU.
- Epochs: maximum 100, patience 20.
- Initialisation: official `yolo11n-seg.pt` weights.
- Augmentation: brightness/contrast, compression, mild perspective, blur and
  scale; include reflections, grout, drains, shadows, old stains and mop marks
  as explicit clean hard negatives.
- Sampling: give spill positives higher training probability without copying
  them into validation/test.

Preparation and training commands:

```powershell
.\.venv\Scripts\python.exe scripts\audit-specialist-training-data.py `
  --manifest ml-training\data\specialists\manifest.json `
  --pipeline floor_hazard --profile pilot

.\.venv\Scripts\python.exe ml-training\scripts\prepare_specialist_floor_dataset.py `
  --manifest ml-training\data\specialists\manifest.json `
  --output dataset\floor_rubbish\prepared_dataset

.\.venv\Scripts\python.exe ml-training\floor_rubbish\train.py `
  --data dataset\floor_rubbish\prepared_dataset\data.yaml `
  --model yolo11n-seg.pt --imgsz 640 --batch 2 --device 0
```

### 5.3 Floor-hazard promotion metrics

| Metric | Minimum promotion gate | Target |
|---|---:|---:|
| Floor-litter precision | 0.85 | >= 0.90 |
| Floor-litter recall | 0.85 | >= 0.90 |
| Spill precision | 0.80 | >= 0.90 |
| Spill recall | 0.90 | >= 0.95 |
| Mask IoU, litter | 0.50 | >= 0.60 |
| Mask IoU, spill | 0.40 | >= 0.55 |
| False positive on clean hard negatives | <= 5% | <= 2% |
| Floor inference on RTX 4050 | < 250 ms | < 150 ms |

The small public spill seed is unlikely to satisfy these gates on local F&B
floors by itself. Until it does, expose the output as diagnostic
`possible_spill` and do not automatically dispatch a cleaner from that signal.

## 6. Checkpoint registration and shadow deployment

For each passing model:

1. copy only the selected checkpoint to the ignored production model location;
2. record SHA-256, architecture, dataset-manifest checksum, source commit,
   thresholds and evaluation report in `models/model-registry.json`;
3. verify the runtime adapter loads the checkpoint and reports `ready=true`;
4. enable the specialist backend in offline/shadow mode first;
5. keep fail-closed behaviour if either checkpoint is missing or invalid.

Run all three modules at the same 10-second interval initially. Require the
same bin/floor event in at least two consecutive samples before creating an
alert. Occupancy remains an instantaneous count but may use tracking between
samples when video processing is enabled.

## 7. Complete-pipeline locked test

### 7.1 Test layers

| Layer | Data | Purpose |
|---|---|---|
| Unit/contract | Synthetic tensors and temporary images/masks | Check target masking, annotation conversion, checkpoint loading, ROI clipping and fail-closed errors |
| Public holdout | Source-separated untouched public groups | Measure general visual learning without train leakage |
| Locked WhatsApp stills/videos | Existing `mock-data/` inputs | Measure local domain shift and produce expected-versus-actual rows |
| Edge suite | Existing hard negatives plus public/source-held edges | Reflections, bags beside bins, occlusion, clean floor, people near ROI boundary |
| Temporal replay | Sample videos at 10-second cadence | Persistence, alert delay, state flicker and duplicate suppression |
| API integration | AI service -> backend event/task schema | Validate all three facts, logs, evidence IDs and error propagation |

Every test row must record source, sample ID, camera/profile, expected result,
actual result, per-module confidence, latency, final pass/fail and evidence path.
Report each detection fact independently before reporting fused success.

### 7.2 Expected metric report

| Detection fact | Expected/acceptance result | Existing actual baseline |
|---|---|---|
| Bin overflow | Precision >= 0.85, recall >= 0.90; <=5% hard-negative false overflow; unknown >=0.90 | Pending trained checkpoint |
| Floor litter | Precision and recall >=0.85; mask IoU >=0.50 | Pending trained checkpoint |
| Floor spill | Precision >=0.80, recall >=0.90; mask IoU >=0.40 | Pending trained checkpoint; expected to be the highest-risk gate |
| Human population | MAE <=1 in the 4-8-person range; >=95% of cases within +/-1 | 35/35 WhatsApp still/edge cases and 14/15 sampled video frames were within +/-1 |
| Clean scenes | No cleaner task in >=95% of clean events | Pending fused replay |
| Temporal confirmation | Alert after two consecutive positives; no duplicate task for one unchanged event | Pending video replay |
| Complete cycle latency | <500 ms compute time per 10-second sample | Pending all-three specialist run |
| Reliability | No CUDA errors/timeouts and no fabricated output when a module is unavailable | Fail-closed contract already implemented; full soak pending |

### 7.3 Fusion acceptance

The complete pipeline passes only if:

1. each detection fact passes its own module gate;
2. a clean scene produces no cleaning task;
3. one persistent incident produces at most one active task;
4. bin overflow and surrounding floor litter may both be true without one
   suppressing the other;
5. occupancy count does not change the hazard label;
6. a missing/not-ready module is returned as a visible degraded state;
7. input and output logs contain the sample/event ID but no unbounded image data;
8. peak VRAM remains below 5GB and a sequential cycle remains below 500ms.

If spill alone fails its gate, the overall system may be demonstrated as
`overflow + litter + occupancy ready, spill experimental`, but it must not be
reported as a complete three-fact production pass.

## 8. Execution milestones

| Milestone | Deliverable | Exit condition |
|---|---|---|
| M1 — importers | Licensed source acquisition, conversion reports and provenance manifest | No mock/train leakage; all accepted samples decode and have valid annotations |
| M2 — auto-labeller | Bin-state and floor-mask proposal pipeline plus review CSV | Unknown/reject paths work; weak-label provenance is complete; review is event-level |
| M3 — label QA | Review all uncertain events and 10% of accepted proposals | Sampled weak-label precision >=0.90; no split leakage |
| M4 — bin bootstrap | Multi-head checkpoint and per-source report | Overflow gate passes; unsupported fullness stays unknown |
| M5 — floor bootstrap | YOLO11n-Seg checkpoint and per-class report | Litter gate passes; spill state explicitly reported |
| M6 — runtime registration | Registry entries and specialist readiness report | All promoted adapters load and return schema-valid results |
| M7 — locked replay | Expected-versus-actual CSV/Markdown with evidence | Independent and fusion metrics calculated without threshold changes |
| M8 — soak | Repeated video/camera replay | Zero crashes, duplicates within policy, latency/VRAM gates pass |

## 9. Stop and rollback rules

- Stop a run on dataset leakage, malformed masks, non-finite loss, CUDA OOM or
  a changed evaluation manifest checksum.
- Never lower a threshold after looking at the locked WhatsApp results; create
  a new experiment and evaluate it on a separate validation set.
- Do not register a checkpoint whose report fails its promotion gate.
- Preserve the last passing registry entry and keep the runtime fail-closed if
  a new model fails to load.
