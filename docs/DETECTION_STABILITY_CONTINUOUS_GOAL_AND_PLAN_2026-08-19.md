# Detection stability: continuous goal and execution plan

Date: 2026-08-19

## 1. Goal

Make the three LitterSpot perception pipelines sufficiently accurate, stable,
fast, and fail-safe that their confirmed event output can be trusted by a
separate cleaner-task dispatcher.

This work is complete only when a frozen model bundle passes every module,
event, robustness, runtime, and shadow-mode gate in this document for three
consecutive candidate releases without changing the test data or lowering a
gate.

### In scope

1. Bin presence and bin state: `normal`, `full`, `overflow`, or `unknown` for
   every registered physical bin.
2. Floor hazard segmentation: `clean`, `floor_litter`, `floor_spill`, or
   `unknown` inside the configured floor region.
3. Human population: people boxes, tracked identities where useful, and an
   integer count inside the configured occupancy region.
4. Fixed-camera ROIs, temporal confirmation, confidence calibration, incident
   deduplication, degraded/unknown handling, monitoring, and evaluation.
5. A machine-readable `dispatch_eligible` decision and evidence record for
   downstream use.

### Explicitly out of scope

- Selecting or assigning a cleaner.
- Cleaner login, task state, or snapshot lifecycle.
- Calling the task-dispatch service.
- Using a VLM-generated statement as dispatch evidence without specialist or
  human confirmation.

## 2. Operational detection contract

Every sampled frame produces module observations. Temporal fusion may produce
an event, but no module creates a cleaner task.

| Fact | Required model output | Confirmed event rule | Fail-safe behavior |
|---|---|---|---|
| Bin overflow | One state per registered bin ROI with presence, fullness, overflow, visibility, confidence, and reason | At least 2 agreeing positive observations in the latest 3 valid 10-second samples; overflow and fullness heads must agree | Missing, occluded, shifted, contradictory, or low-quality evidence becomes `unknown`; never alert from `unknown` |
| Floor spill/litter | Class mask, area, confidence, floor overlap, and reason | At least 2 agreeing observations in the latest 3 valid samples, with spatial overlap across samples; allow a configurable urgent spill rule only after separate validation | Reflection, shadow, drain, old stain, wet-mop mark, uncertain floor membership, or low-quality input becomes clean/unknown rather than an alert |
| People count | Boxes/tracks inside `occupancyRegion` and integer count | Rolling tracked/median count; emit count facts, not cleaning alerts | Exclude people outside the region and return degraded status if detector or camera fails |

The event output must contain `camera_id`, `region_id` or `bin_id`, event type,
first/last evidence timestamps, confidence, model-bundle version, observation
IDs, `dispatch_eligible`, and an ineligibility reason. Repeated positive frames
for the same unresolved event must retain one stable incident ID.

## 3. Stability definition and acceptance gates

All accuracy gates are evaluated on untouched event-level holdouts grouped by
camera, location, capture session, and source video. Adjacent frames may never
cross train, validation, and test splits. Thresholds are selected using
validation data only.

### 3.1 Bin overflow

| Gate | Required result |
|---|---:|
| Overflow event precision | >= 0.95 |
| Overflow event recall | >= 0.90 |
| Contained-full recall | >= 0.85 |
| Normal-bin false overflow | <= 2% of evaluated events |
| Staged bags/object-on-lid false overflow | <= 3% |
| Missing/heavily occluded bin returned as `unknown` | >= 95% |
| Per-camera overflow recall | >= 0.85 |
| Median confirmation delay | <= 30 seconds at a 10-second interval |
| Duplicate incidents | <= 1% |
| Per-ROI inference p95 on target hardware | < 50 ms |

### 3.2 Floor litter and spills

Spill and litter are scored separately even when one segmentation model serves
both classes.

| Gate | Required result |
|---|---:|
| Spill event precision / recall | >= 0.90 / >= 0.95 |
| Litter event precision / recall | >= 0.90 / >= 0.90 |
| Clean hard-negative false event rate | <= 0.05 per camera-hour and <= 3% of reviewed negative events |
| Per-camera recall for each present positive class | >= 0.85 |
| Small actionable-object recall | >= 0.80 |
| Reflection/shadow/drain/stain/wet-mop false-positive rate per slice | <= 5% |
| Median confirmation delay | <= 30 seconds |
| Duplicate incidents | <= 1% |
| Per-frame inference p95 on target hardware | < 250 ms |

### 3.3 Human population

| Gate | Required result |
|---|---:|
| Frames within +/-1 person for counts 0-8 | >= 95% |
| Mean absolute count error | <= 0.50 |
| Empty-region false count | <= 2% of frames |
| Per-camera within-+/-1 rate | >= 90% |
| Count jitter while the scene is unchanged | <= 0.5 people standard deviation over 60 seconds |
| Detector/tracker inference p95 | < 100 ms |

### 3.4 Integrated runtime and safety

| Gate | Required result |
|---|---:|
| Complete three-pipeline cycle p95 on RTX 4050 | < 500 ms |
| Peak GPU memory | < 5 GiB |
| CUDA/model crashes during qualification | 0 |
| Schema-invalid observations | 0 |
| Alert from `unknown`, degraded, missing-camera, or stale evidence | 0 |
| Cross-camera/bin incident mixing | 0 |
| Shadow false dispatch-eligible rate | <= 0.05 per camera-hour |
| Frozen regression suite | 100% required safety tests; no statistically significant metric regression |

Point estimates alone are insufficient. Report sample counts and bootstrap 95%
confidence intervals. A gate passes only when its lower confidence bound meets
the required precision/recall target, except error-rate gates whose upper bound
must meet the target. During early development, insufficient evidence is
reported as `not_proven`, never `passed`.

## 4. Required evaluation evidence

### Development corpus

- Public licensed data may pretrain or bootstrap the specialist models.
- Synthetic transformations may cover camera shifts, scale, blur, compression,
  glare, and occlusion, but cannot prove real-domain readiness.
- Real deployment data supplies model fine-tuning and domain coverage.
- Locked WhatsApp mocks remain evaluation-only.

### Frozen qualification corpus

Build an immutable, checksum-versioned benchmark containing:

- every intended pilot camera and every registered bin;
- at least 100 independently captured positive events for bin overflow, 100
  spill events, and 100 litter events across the full benchmark;
- at least 300 clean/normal events and 150 hard-negative events per hazard
  family;
- at least 30 positive events of each applicable hazard per camera, using safe
  staged events when natural events are rare;
- people counts 0 through 8, with at least 50 reviewed frames per count band;
- day/night and lighting changes, three relevant viewing angles, partial and
  full occlusion, camera/ROI movement, blur, compression, reflections, shadows,
  drains, old stains, wet-mop marks, staged collection bags, object-on-lid,
  mixed litter/spill, and people interacting with bins.

If a target has fewer examples, its result remains `not_proven`. Frames from
one event count once for event metrics, preventing long videos from inflating
the score.

### Shadow qualification

After offline gates pass, run the frozen bundle with task dispatch disabled:

- all intended pilot cameras;
- at least 14 consecutive operating days;
- at least 100 reviewed camera-hours overall and at least 20 hours per camera;
- controlled safe positive trials when natural positive-event count is too
  low;
- review every `dispatch_eligible` event, every sampled `unknown`, and a random
  sample of negative periods.

The 14-day window restarts after any model, preprocessing, ROI, threshold, or
temporal-policy change.

## 5. Continuous improvement loop

The following loop repeats until all acceptance gates pass or progress is
genuinely blocked by missing real evidence.

### Step 1: Freeze and reproduce

1. Pin code, checkpoint hashes, thresholds, ROI configuration, dataset
   manifest, random seeds, and dependency versions.
2. Reproduce the current baseline on the unchanged qualification suite.
3. Reject the run if provenance, split isolation, or checksum audit fails.

### Step 2: Diagnose

1. Produce module and event confusion matrices.
2. Rank failures by dispatch risk: false positive, missed spill/overflow,
   unknown leakage, duplicate event, then count error.
3. Slice failures by camera, angle, distance, class, object size, lighting,
   occlusion, blur, and hard-negative category.
4. Select one dominant, evidence-backed failure class for the iteration.

### Step 3: Choose the smallest valid mitigation

Use this order unless the evidence contradicts it:

1. Fix labels, ROI registration, leakage, parsing, or preprocessing.
2. Add missing real examples and hard negatives for the failed slice.
3. Improve temporal tracking, spatial consistency, quality/visibility guards,
   calibration, or fail-closed thresholds.
4. Fine-tune the existing small specialist.
5. Add a compact localizer/segmenter or change architecture only when the
   earlier options cannot represent the needed evidence.
6. Keep a VLM asynchronous and review-only for ambiguous cases; never place it
   on the primary real-time path without independently passing these gates.

### Step 4: Implement and train

1. Change one principal factor per experiment so the effect is attributable.
2. Train at least three seeds for learned changes.
3. Tune thresholds on validation only.
4. Save all rejected and candidate artifacts with provenance; never overwrite
   the last accepted bundle.

### Step 5: Evaluate without moving the gates

1. Run module, robustness, temporal event, latency, memory, and API safety
   suites.
2. Compare the candidate to the last accepted baseline with paired cases.
3. A candidate is promotable only if it fixes the targeted failure, passes all
   hard gates, and introduces no material regression in another module or
   safety slice.
4. Publish expected-versus-actual rows for every locked mock and every failed
   event, including evidence images/masks and rejection reasons.

### Step 6: Decide and loop

- **Fail:** record the finding, retain the previous baseline, and return to
  diagnosis with the new evidence.
- **Offline pass:** freeze the candidate and run shadow qualification.
- **Shadow fail:** add the observed cases to development data only, create new
  unseen qualification cases, mitigate, and restart the 14-day window.
- **Shadow pass:** rerun the entire frozen suite on a clean environment.
- **Release pass:** require three consecutive candidate releases to pass all
  hard gates. Freeze the model bundle as detection-ready.

Two consecutive iterations with no improvement on the targeted validation
slice trigger a methodology review. Four consecutive non-improving iterations,
or inability to collect the required real evidence, is an explicit blocker to
report; it is not permission to weaken the gates or reuse the test set.

## 6. Execution phases

### Phase A: Benchmark and observability

1. Version dataset/event manifests and leakage audits.
2. Add per-event ground truth, camera/slice tags, checkpoint hashes, and
   expected-versus-actual reports.
3. Make all evaluators use the exact production preprocessing and decision
   code.
4. Establish the current three-module and fused-event baseline.

Exit: a single command can reproduce all metrics and generate a signed
readiness report.

### Phase B: Floor hazard recovery

1. Obtain licensed litter/spill masks and deployment-camera clean negatives.
2. Review automatic masks at event level rather than cropping every frame.
3. Train the nano segmentation specialist and calibrate each class separately.
4. Iterate on small hazards and reflective-floor false positives until its
   offline gates pass.

Exit: litter and spill independently satisfy Section 3.2 on untouched real
events.

### Phase C: Real-domain bin-state qualification

1. Capture all registered bins across angles, states, occlusions, and staged
   waste conditions.
2. Fine-tune the existing 940,885-parameter classifier first.
3. Retain hierarchical agreement and `unknown` guards.
4. Add explicit bin-opening/outside-waste segmentation only if state crops
   continue to fail the real holdout.

Exit: Section 3.1 passes on real event sequences, not synthetic variants alone.

### Phase D: Occupancy stabilization

1. Calibrate each occupancy ROI.
2. Add tracking/temporal smoothing and camera-specific hard negatives.
3. Evaluate counts 0-8 and crowd occlusion without requiring exact identity.

Exit: Section 3.3 passes on every pilot camera.

### Phase E: Integrated shadow qualification

1. Freeze all three checkpoints, policies, ROIs, and runtime dependencies.
2. Run 10-second sampling and temporal fusion with task dispatch disabled.
3. Review events, unknowns, negative periods, duplicates, latency, memory, and
   model/camera failures.
4. Repeat the improvement loop and restart qualification after every change.

Exit: all Section 3.4 gates pass for 14 consecutive days and three consecutive
candidate releases.

## 7. Final deliverables

1. Frozen model bundle and model cards for all three detection facts.
2. Versioned ROI/camera profiles and decision thresholds.
3. Immutable qualification manifest with provenance and checksums.
4. Per-module and integrated event metrics with confidence intervals.
5. Expected-versus-actual case table and visual evidence for every failure.
6. Latency, memory, crash, drift, and false-alert-per-camera-hour reports.
7. Machine-readable readiness record:

```json
{
  "status": "detection_ready",
  "dispatch_eligible_output_enabled": true,
  "task_dispatch_implemented": false,
  "model_bundle_version": "<version>",
  "qualification_manifest_hash": "<sha256>",
  "qualified_at": "<timestamp>"
}
```

Until every hard gate passes, the status remains `not_ready` or
`shadow_only`, and `dispatch_eligible_output_enabled` remains false.

## 8. Current starting point

- Bin-state Loop 1 is a strong methodology prototype: synthetic macro-F1
  0.985, partial-occlusion safety 95.8%, zero occluded-normal false overflow,
  and 5/5 strict WhatsApp cases. It remains shadow/log-only because weak-public
  real-domain macro-F1 is 0.207 and installed-camera event evidence is absent.
- The floor TACO bootstrap is not promotable: it lacks verified spill examples
  and its held-out litter recall is 0.244.
- Occupancy is the closest module, but its expanded still benchmark reached
  only 82.9% within the expected range and its sampled video result reached
  93.3% within +/-1, below the 95% stability gate.
- Therefore the immediate critical path is Phase A followed by Phase B, while
  real bin and occupancy footage is collected in parallel.
