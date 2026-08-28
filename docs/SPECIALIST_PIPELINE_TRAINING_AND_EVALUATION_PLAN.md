# Specialist pipeline training and evaluation plan

## Outcome

Replace InternVL3.5-1B as the primary detector with three independently
measurable specialist modules while preserving the existing response and fusion
contract:

1. fixed-ROI bin-state classification;
2. floor-ROI litter and spill segmentation;
3. person detection, tracking and occupancy counting.

InternVL remains optional for reviewing an already-ambiguous event. It must not
create a cleaning task, supply confidence to fusion, or be fine-tuned in this
phase. The current evaluation demonstrated a grounding failure, not merely a
domain-adaptation problem.

## Rules before any training

- The existing files under `mock-data/` are a locked evaluation benchmark.
  Never place them in a training or calibration split.
- Keep real scenes, transformed variants and synthetic examples distinguishable.
  Derived variants do not count as independent scenes.
- Split by camera, physical location, capture session and source video before
  extracting frames. Adjacent frames may not cross splits.
- Every sample needs source, license, checksum, capture group, label reviewer,
  expected outcome and edge-case tags.
- Public pixels with restricted or unclear redistribution terms stay in an
  ignored local cache. Only manifests and acquisition instructions belong in
  the repository.
- Do not begin a training run until its module passes the data-readiness gate.

## Module seams

Each specialist is a deep module. Callers learn one interface; preprocessing,
model loading, thresholds, ROI filtering and post-processing remain inside its
implementation.

```python
BinStateAnalyzer.analyze(image, context) -> BinModuleResult
FloorHazardAnalyzer.analyze(image, context) -> FloorModuleResult
OccupancyAnalyzer.analyze(image, context) -> OccupancyModuleResult
```

`PerceptionFusion` remains the only module that confirms events and creates
flags. The production specialist adapter and an in-memory fixture adapter sit
at each seam, so tests exercise the same interface used by the pipeline. Do not
expose model tensors, Ultralytics results or tracker internals through the
interface.

The current VLM-backed adapters should be replaced, not layered beneath the
specialists. An ambiguity verifier may later be an internal seam invoked only
when a specialist returns `unknown` or a calibrated uncertainty band.

## Phase 0 — freeze and complete evaluation coverage

### Existing baseline

- 11 independent real scenes.
- 35 deterministic robustness variants.
- Public Domain/CC0 provenance and checksums recorded.
- 13 required semantic cases are still below the three-scene smoke target.

### Collect before model promotion

Close the smoke gaps with at least three independent scenes each:

- contained-full bin without overflow;
- staged bags beside a normal bin;
- temporarily occluded bin;
- small floor litter;
- real beverage spill and real food spill;
- reflections, shadows and floor drains/panels with no hazard;
- exactly one person and 4–8 people;
- person occlusion and reflection-only people negatives.

Real F&B spills and 4–8-person scenes are mandatory. Synthetic stains test the
execution path but are not valid accuracy evidence.

### Deliverables

- updated `mock-data/coverage/base-scenarios.json`;
- zero-integrity-error coverage audit;
- human-approved labels for every locked evaluation scene;
- boxes for people/bins and polygons for floor hazards where applicable.

### Gate

No training dependency, duplicate scene, unreviewed label or ambiguous
operations definition may remain in the locked benchmark.

## Phase 1 — collect training data

Training data lives outside `mock-data/` under separate ignored roots. Start
with project-owned camera images, then add properly licensed public data for
shape and lighting diversity.

### A. Bin-state training set

Crop each registered bin ROI with 10–15% surrounding context. The label applies
to the physical bin, not every waste object visible in the crop.

Pilot minimum: 300 independent crops. Preferred promotion set: 800–1,200.

The automated pilot gate requires 100 normal, 75 contained-full, 75 overflow,
and 50 unknown crops. At least 50 samples must carry the
`surrounding_waste` tag and 50 must carry a `hard_negative_*` tag; these tagged
samples may overlap the state counts. The larger figures below are promotion
collection targets, not prerequisites for the first controlled training run.

| Class / case | Preferred minimum |
|---|---:|
| Normal or empty | 250 |
| Contained-full, not overflowing | 200 |
| Overflow above rim/on top | 200 |
| Waste surrounding bin that operationally means overflow | 150 |
| Unknown/occluded/missing bin | 100 |
| Hard negatives: staged bags, object on lid, chair/container lookalikes | 150 |

Capture each class under daylight, low light, glare, shadows, small camera/bin
movement and person occlusion. Record the calibrated ROI and physical `binId`.

### B. Floor-hazard training set

Use polygon masks, not image-level labels. Keep `floor_litter` and
`floor_spill` separate.

Pilot minimum: 300 independently reviewed frames. Preferred promotion set:
1,000 or more.

The automated pilot gate requires 100 litter positives, 100 spill positives,
100 clean negatives, 50 food/sauce-tagged cases, and 30 mixed litter-plus-spill
cases. Tagged and mixed samples overlap the class counts. The larger figures
below remain promotion collection targets.

| Class / case | Preferred minimum |
|---|---:|
| Solid litter masks | 250 |
| Beverage/clear-liquid spill masks | 200 |
| Food/sauce/residue masks | 150 |
| Clean floor hard negatives | 300 |
| Mixed litter plus spill | 100 |

Hard negatives must include reflections, wet mop marks, grout, old stains,
shadows, drains, open floor panels, transparent plastic and objects under feet.
Stage project-owned water/coffee-like cases safely on the actual floors. Public
data improves diversity but does not replace deployment-floor examples.

### C. Occupancy calibration/training set

Do not fine-tune initially. First evaluate a pretrained nano person detector
inside the configured camera ROI and add a tracker.

Collect at least 200 reviewed frames for calibration/evaluation:

- 40 with zero people;
- 40 with 1–3 people;
- 80 with 4–8 people;
- 40 with more than 8 people.

Cross-tag partial bodies, seated/crouched people, occlusion, near/far scale,
reflections, posters/mannequins, entry/exit and motion blur. Fine-tune only if
the pretrained detector fails the occupancy gate. A fine-tuning set should then
contain at least 500–1,000 reviewed person boxes from project cameras.

## Phase 2 — dataset preparation and leakage checks

For every module:

1. Deduplicate exact hashes and near-duplicates.
2. Group samples by camera/location/session/video.
3. Create train/validation/test splits by group, approximately 70/15/15.
4. Keep the locked `mock-data/` benchmark completely external to those splits.
5. Apply augmentation only to training data.
6. Produce class counts, edge-tag counts and source/license reports.
7. Render a random overlay/contact-sheet sample for human label review.

Required automated failures:

- missing or unreadable image;
- missing box/mask/count;
- invalid or empty polygon;
- class not in the module taxonomy;
- source group appearing in multiple splits;
- mock benchmark hash found in training;
- insufficient samples for a mandatory class;
- license/provenance field missing.

## Phase 3 — train and calibrate specialists

### A. Bin state first

Reuse the existing multi-head MobileNetV3-Small approach at 224 px. It already
models presence, fullness and overflow independently and fits the 6 GB GPU.

Training sequence:

1. initialize from ImageNet or the last approved compatible checkpoint;
2. train heads, then lightly unfreeze the feature extractor;
3. use balanced sampling and hard-negative oversampling;
4. calibrate presence/fullness/overflow thresholds on validation only;
5. select the checkpoint by the minimum of the three validation task scores;
6. evaluate once on the untouched test split and locked benchmark.

Expected hardware profile: 224 px, AMP, batch 32–128 depending on observed
VRAM, short 3–15 epoch experiments with early stopping.

### B. Occupancy second

Use a pretrained nano person detector plus a tracker. Count track centres only
inside the configured occupancy polygon. Identity or re-identification is out
of scope.

Calibrate detection confidence, NMS, ROI rule and tracker age on validation
clips. Fine-tune the detector only after error analysis demonstrates a visual
detection problem rather than an ROI/tracking/counting problem.

### C. Floor hazards third

Train a nano/small segmentation model at 640 px first. The current 960 px,
batch-8 configuration is too aggressive as the default for a 6 GB GPU.

Training sequence:

1. start at 640 px, AMP, batch 2–4 and gradient accumulation if necessary;
2. balance litter, spill and clean-negative sources by capture group;
3. keep floor-ROI clipping and ignore-object filtering in the module
   implementation;
4. calibrate separate thresholds for litter and spill;
5. increase resolution only if the small/distant-object error slice proves it
   is needed and peak VRAM stays below the deployment budget.

### Experiment discipline

Every run writes:

- immutable configuration and random seed;
- dataset manifest/checksums and split groups;
- base checkpoint and code revision;
- epoch history and selected checkpoint;
- calibrated thresholds;
- confusion matrices and per-edge-tag metrics;
- inference latency and peak VRAM;
- rejection reason when a gate fails.

Do not overwrite checkpoints. Only a gate-passing model is copied into
`models/production/` and registered in `models/model-registry.json`.

## Phase 4 — replace adapters one module at a time

Integration order:

1. add specialist result interfaces and in-memory fixture adapters;
2. replace `BinStateModule` implementation and replay all bin tests;
3. replace `OccupancyModule` and replay all occupancy tests;
4. replace `FloorHazardModule` and replay all floor tests;
5. preserve `PipelineAnalysisResponse`, flags and downstream business contract;
6. keep model version, threshold set and processing time visible in diagnostics;
7. remove the shared VLM inference from the normal request path.

Run specialists sequentially at first to stay within 6 GB. Measure memory
before considering parallel inference.

## Phase 5 — module evaluation gates

### Bin state

- overflow recall at least 90%;
- overflow precision at least 85%;
- contained-full recall at least 85%;
- staged-bag/object-on-lid false-positive rate at most 5%;
- occluded/missing bin returns `unknown` at least 90% of the time;
- no duplicate output for one registered physical bin.

### Floor hazards

- spill recall at least 95% and precision at least 80%;
- litter recall and precision at least 85%;
- clean hard-negative false-positive rate at most 5%;
- report mask IoU and results by reflection/shadow/drain/small-object tags;
- zero spill promotion if there are no real spill positives in the test set.

### Occupancy

- MAE no worse than 1 overall and within the 4–8-person band;
- within-one accuracy at least 90%;
- exact-count accuracy at least 70% in the 4–8 band;
- reflections/posters/mannequins contribute zero people;
- count does not duplicate the same tracked person across adjacent frames.

### Runtime on RTX 4050 6 GB

- peak VRAM below 5 GB with sequential scheduling;
- bin-state inference target below 50 ms per ROI;
- occupancy target below 100 ms per sampled frame;
- floor-hazard target below 250 ms per sampled frame;
- complete specialist cycle below 500 ms, excluding image acquisition;
- zero CUDA crashes/timeouts during the locked replay.

Failing a gate returns the work to data/error review. It does not trigger
threshold tuning on the locked test set.

## Phase 6 — fusion and temporal testing

Use at least 60 project-owned fusion/temporal cases after all three module gates
pass independently:

- clean scene;
- overflow only;
- litter/spill only;
- occupancy only;
- overflow plus surrounding litter;
- spill with people nearby;
- all three signals;
- cleaner/passers-by occluding an incident;
- repeated 10-second samples of one unchanged incident.

Initial temporal rule:

- run all three specialists every 10 seconds for comparable prototype results;
- require two consecutive positive samples for overflow/litter/spill flags;
- occupancy is reported every sample but does not create a cleaning task;
- one active incident creates at most one task until completion or explicit
  incident reset;
- a missing/unknown observation does not silently clear an active incident.

Evaluate event-start delay, missed-event duration, state flicker, duplicate
alerts and false task creation. The first shadow-mode run must not call the task
assignment workflow.

## Phase 7 — review and iteration

For each replay, generate:

- one row per sample with expected and actual results;
- confusion matrices and precision/recall/F1 per class;
- occupancy MAE/exact/within-one by count stratum;
- latency and VRAM summaries;
- false-positive and false-negative galleries with overlays;
- results grouped by camera, source, lighting and edge tag;
- a go/no-go decision for each module and for fusion.

Review every failure into exactly one primary cause:

1. wrong or ambiguous label;
2. missing training scenario;
3. ROI/calibration issue;
4. detector/classifier/segmenter issue;
5. threshold/post-processing issue;
6. tracker/temporal/fusion issue.

Fix training data and implementation using train/validation evidence. Keep the
locked test and mock benchmark untouched, retrain under a new experiment ID,
then run one fresh final evaluation.

## Execution order and stop points

| Order | Work | Stop point |
|---:|---|---|
| 1 | Close locked mock smoke gaps and approve labels | No unreviewed required scenario |
| 2 | Collect/split bin-state training data | Data-readiness checks pass |
| 3 | Train, calibrate, integrate and evaluate bin module | Bin gates pass |
| 4 | Calibrate pretrained occupancy detector/tracker; fine-tune only if needed | Occupancy gates pass |
| 5 | Collect/mask floor hazards and train segmentation module | Floor gates pass |
| 6 | Run separated full benchmark | All module gates pass |
| 7 | Run shadow-mode fusion/temporal replay | No false task creation or duplicates |
| 8 | Review results and issue final go/no-go report | Prototype decision recorded |

## Immediate next action

Do not start a GPU training run yet. First collect the missing real training and
evaluation cases from the installed camera views, beginning with:

1. contained-full versus genuine overflow for every registered bin;
2. staged bags and temporary bin occlusion negatives;
3. safely staged water/coffee and food-residue spills with masks;
4. reviewed 4–8-person frames and reflection-only negatives.

Once those pass the data-readiness audit, train the bin-state specialist first.
