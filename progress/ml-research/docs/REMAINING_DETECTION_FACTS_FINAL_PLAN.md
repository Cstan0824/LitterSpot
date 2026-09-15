# Remaining detection facts — reviewed final plan

## Decision

The final prototype uses three independent specialist pipelines. Occupancy is
runnable now. Bin state and floor hazards are implemented at the runtime seam
but remain deliberately `not_ready` until reviewed training data produces
gate-passing checkpoints. The service must keep `PERCEPTION_BACKEND=vlm` or run
specialists only in an explicit offline test until all three are ready; it must
not mix fabricated or random results into one response.

## Detection contracts and current evidence

| Detection fact | Exact expected result | Current actual result | Readiness |
|---|---|---|---|
| Human population | Integer people count and boxes inside `occupancyRegion`; ±1 person is operationally acceptable | YOLO11n works; 35/35 WhatsApp still/edge cases and 14/15 sampled video frames were within ±1 | Baseline ready; ROI/tracking still recommended |
| Bin state / overflow | Exactly one result per registered physical bin: `normal`, `full`, `overflow`, or `unknown` | Runtime adapter and one example camera/bin ROI exist; reviewed training rows = 0; approved checkpoint absent | Not ready |
| Floor litter / spill | `clean`, or one/more mask polygons classified as `floor_litter` or `floor_spill` inside `focusRegion` | Runtime segmentation adapter exists; reviewed training rows = 0; prepared dataset and approved checkpoint absent | Not ready |

The locked WhatsApp mocks remain evaluation-only. Their expected bin/floor
facts are useful for final replay, but their pixels cannot be copied into the
training manifest.

## Operational definitions to label

### Bin state

- `normal`: bin is present and waste is below the contained-full condition.
- `full`: waste is contained at/near capacity but has not risen above the rim
  and has not fallen around the bin.
- `overflow`: waste is visibly above/on top of the rim, or waste attributable
  to that bin has fallen around it.
- `unknown`: bin is missing, substantially occluded, image quality is
  insufficient, or staged collection bags cannot be distinguished from a real
  overflow event.

Every row also records `binPresent`. Known states require `true`; an unknown
row may be `true` for occlusion or `false` for a missing bin.

### Floor hazard

- `floor_litter`: solid unwanted material resting on the monitored floor.
- `floor_spill`: visible liquid, drink, sauce, food residue, or wet F&B
  contamination requiring cleaning.
- `clean`: no actionable litter/spill. Reflections, shadows, grout, drains,
  open panels, old stains and ordinary wet-mop marks are negatives unless the
  operator explicitly labels an active hazard.

Positive floor labels use a same-size class-index PNG mask:
`0=background`, `1=floor_litter`, `2=floor_spill`.

## Execution plan

### 1. Calibrate the fixed cameras

For every deployed view, approve:

- one normalized ROI for each physical bin plus a 4% movement margin;
- one floor `focusRegion` polygon;
- one separate `occupancyRegion` polygon.

The current `camera-1:bin-1` profile is an example, not sufficient evidence for
all real cameras.

### 2. Collect independent training data

Do not use `mock-data/`.

Bin pilot gate (300 independent crops):

| Requirement | Minimum |
|---|---:|
| Normal | 100 |
| Contained-full | 75 |
| Overflow | 75 |
| Unknown/missing/occluded | 50 |
| `surrounding_waste` tag | 50, may overlap |
| `hard_negative_*` tag | 50, may overlap |

Floor pilot gate (at least 300 independent frames):

| Requirement | Minimum |
|---|---:|
| Litter positive | 100 |
| Spill positive | 100 |
| Clean hard negative | 100 |
| Food/sauce tag | 50, may overlap |
| Mixed litter and spill | 30, may overlap |

Split by camera/location/session/source video before frame extraction. Target
70/15/15 train/validation/test groups; adjacent frames never cross splits.

### 3. Pass the data contract

Populate `ml-training/data/specialists/manifest.json`, then run each module gate
independently:

```powershell
.\.venv\Scripts\python.exe scripts\audit-specialist-training-data.py `
  --manifest ml-training\data\specialists\manifest.json `
  --pipeline bin_state --profile pilot

.\.venv\Scripts\python.exe scripts\audit-specialist-training-data.py `
  --manifest ml-training\data\specialists\manifest.json `
  --pipeline floor_hazard --profile pilot
```

The audit rejects locked-mock duplicates, bad provenance, cross-split capture
groups, malformed bin labels, mismatched masks and mask values outside 0/1/2.

### 4. Train bin state first

Use the implemented manifest-backed multi-head MobileNetV3-Small trainer. It maps reviewed crops to
presence/fullness/overflow targets, masks unknown state heads, calibrates all
thresholds on validation only, and writes the checkpoint contract already
consumed by `BinStateSpecialistAdapter`.

Target configuration: ImageNet initialization, 224px crops, 15% context, AMP,
batch 32–128 as VRAM allows, balanced sampling, 3–15 epochs and early stopping.

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\train_specialist_bin_state.py `
  --manifest ml-training\data\specialists\manifest.json --device cuda:0
```

Promotion gates:

- overflow recall ≥ 90% and precision ≥ 85%;
- contained-full recall ≥ 85%;
- staged-bag/object-on-lid false-positive rate ≤ 5%;
- missing/occluded returns `unknown` ≥ 90%;
- inference < 50ms per ROI on the RTX 4050.

### 5. Train floor segmentation

Convert reviewed masks into the existing two-class YOLO segmentation dataset,
validate polygon overlays, then run:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\prepare_specialist_floor_dataset.py `
  --manifest ml-training\data\specialists\manifest.json `
  --output dataset\floor_rubbish\prepared_dataset
```

Then train:

```powershell
.\.venv\Scripts\python.exe ml-training\floor_rubbish\train.py `
  --model yolo11n-seg.pt --imgsz 640 --batch 2 --device 0
```

The corrected default is YOLO11n-Seg at 640px/batch 2 for 6GB VRAM. Review the
Ultralytics license before commercial deployment.

Promotion gates:

- spill recall ≥ 95% and precision ≥ 80%;
- litter recall and precision ≥ 85%;
- clean hard-negative false-positive rate ≤ 5%;
- report mask IoU by reflection/shadow/drain/small-object slice;
- inference < 250ms per sampled frame.

### 6. Replay and integrate

After both checkpoints pass their untouched module tests:

1. register them under `models/model-registry.json`;
2. enable `PERCEPTION_BACKEND=specialists` in offline/shadow mode;
3. run all three modules every 10 seconds initially;
4. require two consecutive positive bin/floor samples;
5. fuse expected versus actual into one row per sample;
6. verify one incident creates at most one task;
7. keep the VLM asynchronous and crop-only for `unknown` review.

Runtime gate: complete sequential specialist cycle < 500ms, peak VRAM < 5GB,
and zero CUDA failures during locked replay.

## Current stop point

Implementation and review tooling are ready. GPU training is correctly blocked
because the specialist manifest has zero reviewed rows. The next legitimate
work is camera ROI approval and collection/labeling—not threshold tuning or
training on the WhatsApp evaluation mocks.
