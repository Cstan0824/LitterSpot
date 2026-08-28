# Object-on-lid false-overflow mitigation plan

## Status and scope

- Status: Phase 1 implemented; model-training phases remain data-gated
- Scope: bin-state decisions, per-camera calibration, stable bin identity, training data, alert behavior, and optional spatial verification
- Primary failure: an object resting on a closed bin lid, a visible liner edge, or another top-of-bin feature is classified as overflow

## Implementation status (2026-08-12)

Completed:

- Extracted the pure decision-policy module and corrected uncertainty precedence
  under recall-first operation.
- Added non-overlapping, stable physical-bin ROI matching for both stored-frame
  and batch image analysis.
- Added the fixed-camera known-bin guard: when a camera has configured profiles,
  unmatched localizer output becomes `unknown` with `unregistered_bin` and is
  never an overflow candidate.
- Added multi-frame mocks from the supplied media plus a strict evaluator.
- Added a reviewed calibration-input template and a script that generates
  candidate per-camera/bin thresholds from validation-only scores.

Validation on supplied mocks:

- Five closed green-bin frames: zero overflow predictions (`unknown` or
  `normal`).
- One black-bin image and five video frames: overflow predictions throughout.
- Crowded no-bin video: the localizer falsely detects an object in one sampled
  frame, but the known-bin guard returns `unknown`, not overflow.

Data-gated:

- The fourth `lid_obstruction` model head must wait for reviewed CCTV labels;
  inventing negative labels from public datasets would degrade the model.
- Spatial rim-crossing segmentation remains conditional on the calibrated
  classifier failing the deployment gate.

## Problem statement

The pipeline localizes a bin and sends an expanded whole-bin crop to a multi-head
MobileNet classifier. The classifier returns presence, fullness, and overflow
probabilities. A recall-first policy converts those signals into `normal`,
`full`, `overflow`, or `unknown`.

The reported frame reproduces the issue with the active checkpoint:

| Signal | Value |
| --- | ---: |
| Bin presence | 0.931 |
| Fullness | 0.499 |
| Overflow | 0.328 |
| Active overflow threshold | 0.310 |
| Current result | `overflow` |

The prediction is marginal. Raising the test camera's overflow threshold to
`0.40` changes the same sample to `full`.

There is also a policy-ordering defect in
`ai-service/app/multi_state_classifier.py`: recall-first overflow is evaluated
before `uncertain_overflow`. A score of `0.328` is therefore accepted even
though it is inside the configured `0.310 +/- 0.030` uncertainty band.

Temporal confirmation cannot resolve this error class. A stationary object on a
lid produces a persistent false signal and eventually satisfies a frame-count
rule.

## Operational definitions

Use these definitions consistently in labeling, inference, and tests:

- `overflow`: waste visibly crosses the opening/rim, hangs down the exterior,
  or is continuously connected to material spilling outside.
- `full`: waste reaches the rim but remains contained.
- `normal`: the bin is present without full or overflow evidence.
- `unknown`: image quality or evidence is insufficient for a safe decision.
- `lid_obstructed`: an auxiliary condition, not a fill-level state. An object
  rests on or obscures the lid without demonstrated boundary crossing.

An object on a closed lid must not produce a critical `bin_overflow` alert. A
confirmed obstruction may optionally produce a warning-level
`bin_lid_obstructed` flag.

## Goals

1. Prevent marginal overflow signals from bypassing uncertainty handling.
2. Calibrate each camera/bin reproducibly instead of hardcoding one threshold
   from one image.
3. Teach the classifier about lid obstructions with correctly masked labels.
4. Add spatial verification only if classifier-only mitigation misses its gate.
5. Preserve overflow recall and measure false alerts by camera and failure mode.

## Non-goals

- Replacing the one-class bin localizer.
- Treating every item near a bin as overflow or obstruction.
- Automatically applying generated production thresholds.
- Alerting from one ambiguous still frame.
- Training on screenshots containing boxes, predictions, or other overlays.

## Architecture

### Bin-state decision module

Create `ai-service/app/bin_state_decision.py` as a pure in-process module. Its
interface is the common test seam for still-image and video decisions:

```python
decision = decide_bin_state(signals, thresholds, quality_reasons, evidence=None)
```

Return:

```text
state
confidence
reasons
alert_eligible
effective_thresholds
```

The module owns precedence, uncertainty bands, profile overrides, and the future
lid-obstruction/spatial guard. `MultiStateClassifier` retains model loading,
preprocessing, and raw-signal inference, then delegates the decision. The
pipeline and video tracker must not duplicate threshold rules.

Initial precedence:

```text
1. Failed image-quality gate                 -> unknown
2. Presence below effective threshold        -> unknown/bin_not_detected
3. Overflow inside uncertainty band          -> unknown/uncertain_overflow
4. Borderline overflow + lid obstruction     -> unknown/lid_obstructed
5. Overflow above uncertainty band           -> overflow candidate
6. Fullness inside uncertainty band          -> unknown/uncertain_fullness
7. Fullness above threshold                   -> full
8. Otherwise                                  -> normal
```

Recall-first operation may lower the presence floor, but it must not bypass the
uncertainty or obstruction checks.

### Keep obstruction separate from fill state

Do not initially add `object_on_lid` to all public state enums. It is a
condition affecting access to the bin, not its fill level. Add an optional
`lidObstruction` signal and the reason `lid_obstructed`; return `unknown`
when evidence remains ambiguous.

If an operations workflow is required, add a separate warning:

```text
kind: bin_lid_obstructed
severity: warning
```

This warning must not increment overflow episode or placement statistics.

### Stable physical-bin profiles

Per-bin thresholds require `cameraId:binId` to identify the same physical bin
across frames. The current pipeline uses `frame-bin-{index}`, and the index can
change when detector ordering changes.

Extend `ProfileStore` to resolve a detected box to a configured normalized ROI
using center containment or IoU. Return the stable profile key, such as
`camera-1:bin-1`, and pass that ID to the classifier and tracker. Unmatched
detections use global thresholds and dynamic tracking IDs.

Profile validation and matching remain inside `ProfileStore`; callers only ask
it to resolve a camera and candidate box.

### Lid-obstruction training head

The second model release adds a fourth sigmoid head:

```text
presence
fullness
overflow
lid_obstruction
```

Add `lid_obstruction` and `lid_obstruction_mask` to training samples. GCO and
GBS do not have reliable obstruction annotations, so their obstruction mask is
`0`; they must not be silently treated as negatives. Only reviewed CCTV
samples receive mask `1`.

Use a new architecture/checkpoint identifier so incompatible checkpoints cannot
load accidentally. During migration, an old checkpoint may emit
`lidObstruction: null`, preserving corrected three-head behavior.

### Conditional spatial verifier

If classifier-only mitigation fails its held-out gate, add an
`OverflowEvidenceVerifier` module:

```python
evidence = verifier.evaluate(image, bin_region)
```

Return rim-crossing confidence, exterior waste coverage, on-lid coverage, and a
validity reason. Provide:

- `DisabledOverflowEvidenceVerifier` for rollback and staged deployment.
- A segmentation-based production implementation.
- An in-memory fake for policy tests.

Run it only for borderline or overflow candidates. Invalid verifier evidence
must produce `unknown`, never silently force `normal` or `overflow`.

## Data and labeling

### Dataset layout

Create an ignored permissioned dataset:

```text
ml-training/data/bin-state-edge-cases/
  train/<camera>/<time-block>/
  valid/<camera>/<time-block>/
  test/<camera>/<time-block>/
  manifest.csv
```

Manifest fields:

```text
image,split,camera_id,bin_id,time_block,state,lid_obstruction,
overflow_boundary_crossing,failure_mode,reviewer,notes
```

Allowed failure modes include:

- `object_on_closed_lid`
- `liner_visible_below_lid`
- `shadow_at_rim`
- `lid_partially_open`
- `waste_at_rim_contained`
- `waste_hanging_outside`
- `ground_litter_not_connected`
- `occluded_or_ambiguous`

### Initial collection targets

For every deployed camera/bin pair:

- At least 100 temporally separated normal/full frames.
- At least 50 object-on-lid or visible-liner hard negatives.
- At least 50 genuine overflow frames when safe and practical.
- Coverage across day/night, glare, rain, shadows, cleaning, and occlusions.

These are starting targets, not substitutes for confidence intervals. If genuine
overflow is rare, use controlled scenes from the actual camera view while
keeping an untouched operational test split.

### Split and review rules

- Split by camera and time block; adjacent frames cannot cross splits.
- Keep the final test split untouched until model and threshold selection ends.
- Require a second reviewer for borderline rim-crossing cases.
- Train on original unannotated frames only.
- Preserve genuinely ambiguous samples as `unknown`.
- Track source consent and retention under the existing evidence policy.

## Delivery phases

### Phase 0: Reproduction and measurement

Deliverables:

- Obtain the original unannotated frame for the reported case.
- Add it to the local edge-case test set with a reviewed failure label.
- Add `ml-training/scripts/evaluate_bin_state_edge_cases.py`.
- Report per-camera confusion matrices, false-overflow rate by failure mode, raw
  signals, effective thresholds, selected profile, reasons, and alert eligibility.

Suggested command:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\evaluate_bin_state_edge_cases.py `
  --checkpoint runs\state_classifier\multitask_gco_gbs_v2\production.pt `
  --manifest ml-training\data\bin-state-edge-cases\manifest.csv
```

Acceptance:

- One deterministic command reproduces the false overflow from an unannotated
  frame.
- The report identifies the exact camera and profile.
- The same command can become the regression gate.

### Phase 1: Safe policy and calibrated profiles

Implementation:

- Add the pure decision module.
- Move state precedence out of `MultiStateClassifier.classify`.
- Evaluate the uncertainty band before accepting recall-first overflow.
- Add stable ROI-to-bin profile matching.
- Add `ml-training/scripts/calibrate_camera_bin_profiles.py`.
- Generate a candidate profile JSON and report; require review before updating
  `config/bin-profiles.json`.
- Surface effective thresholds, profile selection, and reasons in evaluation
  output.

Threshold selection:

- Select thresholds from validation data only.
- Enforce minimum overflow recall, then maximize precision/minimize false
  overflow.
- Evaluate once on the untouched test set.
- Do not hardcode `0.40`; it is only a demonstrated candidate for the provided
  screenshot.

Tests:

- Recall-first scores inside the uncertainty band return `unknown`.
- Scores above the band can return `overflow` when presence is sufficient.
- Scores below overflow but above fullness return `full`.
- A profile override affects only its matched physical bin.
- Detector reordering does not exchange profiles between physical bins.
- Invalid or overlapping profiles fail startup clearly.
- Still-image and video paths make the same decision from identical inputs.
- No critical alert is created for `unknown` or `lid_obstructed`.

Acceptance:

- The reported hard negative creates no critical overflow alert.
- Per-camera held-out overflow recall is at least 80%.
- Per-camera object-on-lid false-overflow rate is at most 5%.
- No regression in no-bin presence false-positive rate.
- Existing response schemas remain backward compatible.

Rollout:

- Shadow old and new decisions for a representative operating period.
- Review newly suppressed overflow cases.
- Enable per camera, with global rollback to the previous policy/checkpoint.

### Phase 2: Lid-obstruction classifier

Implementation:

- Add the fourth head and masked obstruction loss.
- Add reviewed hard negatives and genuine overflow samples from the same views.
- Jointly calibrate obstruction, overflow, and strong-overflow thresholds.
- Extend Python and Node schemas with optional
  `signals.lidObstruction: number | null`.
- Let obstruction suppress only borderline overflow; a strong overflow signal
  must not be vetoed solely by the obstruction head.
- Optionally create a temporally confirmed `bin_lid_obstructed` warning.
- Render lid obstruction as a warning, never as overflow.
- Register the new checkpoint and retain the old production checkpoint.

Tests:

- Checkpoint architecture mismatches have explicit errors.
- Public samples with no obstruction label contribute zero obstruction loss.
- Lid obstruction suppresses only borderline overflow.
- Strong genuine overflow remains alert-eligible.
- Obstruction warnings do not affect overflow placement metrics.
- Backend validation and frontend rendering accept the optional signal.

Acceptance:

- Object-on-lid false-overflow rate is at most 5% for every deployment camera and
  on the combined untouched test set.
- Deployment-test overflow precision is at least 85%.
- Deployment-test overflow recall is at least 80%.
- The report includes full-versus-overflow and
  obstruction-versus-overflow confusion matrices.

### Phase 3: Spatial rim-crossing verification (conditional)

Start only if Phase 2 fails its false-overflow or recall gate.

Implementation:

- Annotate lid/rim, exterior-bin, and waste masks on deployment images.
- Train or fine-tune a compact segmentation model.
- Implement the verifier interface and disabled adapter.
- Run verification only for candidate/ambiguous cases to limit latency.
- Add validity gates for a missing rim, excessive occlusion, tiny crops, and
  low-confidence masks.
- Feed evidence into the decision module; keep downstream alert code unchanged.

Geometry rules:

- Waste confined to the lid region: obstruction, not overflow.
- Waste crossing the rim/opening into the exterior: overflow evidence.
- Ground litter disconnected from the bin: floor litter, not bin overflow.
- Invalid geometry: `unknown`.

Acceptance:

- Meets the Phase 2 precision and recall gates.
- Stays inside an agreed p95 inference budget, selected after measuring the
  existing p95 baseline.
- Invalid/occluded cases fail closed as `unknown` without critical alerts.

## Expected file changes

### Phase 0-1

- `ai-service/app/bin_state_decision.py`: new pure policy module.
- `ai-service/app/multi_state_classifier.py`: delegate policy and resolve
  effective profiles.
- `ai-service/app/pipeline.py`: use stable physical-bin identity.
- `ai-service/app/schemas.py`: add optional decision diagnostics if exposed.
- `config/bin-profiles.json`: reviewed camera/bin overrides.
- `ai-service/tests/test_bin_state_decision.py`: policy-interface tests.
- `ai-service/tests/test_multi_state_classifier.py`: profile/integration tests.
- `ai-service/tests/test_pipeline.py`: alert regressions.
- `ai-service/tests/test_video_tracking.py`: temporal regressions.
- `ml-training/scripts/evaluate_bin_state_edge_cases.py`: repro/report command.
- `ml-training/scripts/calibrate_camera_bin_profiles.py`: calibration output.
- `docs/data-collection-protocol.md`: labeling and split rules.
- `docs/cctv-label-manifest.template.csv`: new metadata columns.

### Phase 2

- `ml-training/scripts/train_multitask_bin_state.py`: fourth head and masked
  loss.
- `ml-training/scripts/calibrate_multitask_state.py`: joint calibration.
- `ai-service/app/multi_state_classifier.py`: load/emit optional signal.
- `backend/src/schemas/detection.ts`: schema propagation.
- Frontend result and operations views: obstruction warning rendering.
- `models/model-registry.json` and README: promotion/rollback metadata.

### Phase 3

- `ai-service/app/overflow_evidence.py`: verifier interface and implementations.
- A conditional segmentation training/evaluation script.
- Pipeline construction and tests: inject and exercise the verifier.

## Verification matrix

| Scenario | Expected state | Critical overflow alert |
| --- | --- | --- |
| Closed empty lid | normal | No |
| Item entirely on closed lid | unknown/lid obstructed | No |
| Liner edge visible below lid | normal or unknown | No |
| Waste reaches rim but stays inside | full | No |
| Waste crosses rim and hangs outside | overflow | Yes, after confirmation |
| Ground litter disconnected from bin | bin state unchanged | No bin alert |
| Rim fully occluded | unknown | No |
| Strong overflow with partial obstruction | overflow | Yes, after confirmation |

Minimum verification commands:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s ai-service\tests -p "test_*.py"
npm test
npm run build
```

Run the edge-case evaluator against the untouched manifest before promoting any
threshold or checkpoint.

## Observability

For every classified bin, retain enough structured data to audit decisions:

- Model and policy version.
- Camera ID and stable bin ID.
- Raw signals and effective thresholds.
- Profile selection.
- State, reasons, and alert eligibility.
- Temporal confirmation count.
- Spatial verifier status when enabled.

Dashboard or evaluation metrics should include:

- Candidate overflows, confirmed alerts, dismissed alerts, and confirmed false
  positives by camera.
- Counts of `uncertain_overflow` and `lid_obstructed`.
- Score distributions for true overflow and lid-obstruction hard negatives.
- Precision, recall, and object-on-lid false-overflow rate per model version.

Do not retain additional imagery beyond the approved evidence policy.

## Rollback

- Keep the previous checkpoint and policy registered.
- Treat profile configuration and model promotion as separate changes.
- Reject invalid profile files at startup rather than partially applying them.
- Shadow new decisions before enforcing alerts.
- If recall falls below the gate, disable the new profile/model for the affected
  camera while retaining the evaluation report.

## Recommended order

1. Obtain the original unannotated frame and build the edge-case evaluator.
2. Extract and test the decision module; make uncertainty effective in
   recall-first mode.
3. Implement stable profile matching and camera/bin calibration.
4. Shadow, validate, and deploy Phase 1.
5. Collect and review lid-obstruction labels.
6. Train and shadow the fourth-head model.
7. Add spatial verification only if measured classifier performance still misses
   the deployment gate.

This sequence provides a fast, reversible mitigation while preserving a measured
path to a reliable geometric solution.
