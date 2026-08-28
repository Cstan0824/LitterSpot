# Bin-state occlusion and camera-domain mitigation

Date: 2026-08-19
Scope: the failed multi-angle prototype and its next two remediation loops
Hardware target: Windows 11, RTX 4050 Laptop GPU (6 GiB)

## Decision in one paragraph

The next model should not be a larger VLM and should not be promoted by
lowering the overflow threshold. The dominant fix is a fail-closed,
camera-registered two-stage pipeline: align and validate the fixed ROI, estimate
whether the bin opening and outside-waste ring are visible, abstain as
`unknown` when visibility or alignment is poor, then classify state only on a
canonical crop. A true overflow alert requires independent evidence of waste
outside the bin boundary and temporal persistence. Keep MobileNetV3-Small for
Loop 1. If Loop 1 does not pass on reviewed target-camera captures, train a
small bin/ring segmentation model and a target-domain state classifier in Loop
2. A backbone swap alone cannot correct the present domain and label mismatch.

This is a mitigation plan, not a claim that the current synthetic checkpoint
is accurate.

## Evidence from the current repository

The prototype reports three different failures, so they must not be treated as
one “model accuracy” problem:

| Failure | Measured result | What it says |
|---|---:|---|
| Synthetic partial occlusion | 79.2% same-or-unknown; 25% false overflow on normal/unknown rows | The classifier interprets an occluder as state evidence. It has no explicit visibility/occlusion signal. |
| Unmodified public holdout | Four-state macro-F1 0.200; `full` F1 0.185 | Weak public localization crops are not reliable state labels and do not represent the target camera. |
| Locked WhatsApp manual-ROI replay | 1/5 strict matches (20%); normal recycling bins and a basket were called `full` | Crop geometry, context, lighting, bin design and label distribution differ from training. |
| Synthetic angle replay | Top-down macro-F1 0.853; oblique 0.984; side 0.980 | Mild PIL rotations/shears prove the plumbing, not real viewpoint generalization. |
| Missing-bin blank replay | 48/48 returned `unknown` | The presence guard works for a very easy negative, but not for hard domain negatives. |

The current runtime already has useful seams: fixed camera profiles,
`BinCandidateValidator`, a presence head, quality checks, a normal reference,
and temporal tracking. However, `decide_bin_state` currently allows a
`matches_normal_reference` result to return `normal` before overflow evidence
is considered. That reference must be used for scene/geometry validation, not
as a hard state override; otherwise a genuine changed/overflowing bin can be
suppressed.

Evidence files:

- [`multi_angle_report.json`](../../runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/multi_angle_report.json)
- [`robustness_report.json`](../../runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/robustness_report.json)
- [`whatsapp_replay.json`](../../runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/whatsapp_replay.json)
- [`COMPLETE_PIPELINE_EXECUTION_2026-08-19.md`](../reports/COMPLETE_PIPELINE_EXECUTION_2026-08-19.md)
- [`MULTI_ANGLE_BIN_STATE_PROTOTYPE_PLAN.md`](../MULTI_ANGLE_BIN_STATE_PROTOTYPE_PLAN.md)

## Why the errors happen

1. **State evidence is mixed with scene context.** The 15% padded crop is
   resized to a square. A person, floor, basket, bags, or a different amount
   of floor can change the fullness score even when the bin is normal.
2. **Overflow is not a single visual attribute.** In this project, overflow
   means waste crosses the bin boundary and/or is on the surrounding floor.
   A scalar crop classifier has no explicit outside-boundary geometry.
3. **Occlusion is not a state.** A person, bag, or reflection may hide the
   rim. Treating the hidden rim as “full” or “overflow” is unsafe; it should
   become `unknown` until the evidence is visible again.
4. **The synthetic data is too clean and too causal.** The generated overflow
   overlay adds a dark bag and surrounding marks in a consistent pattern. The
   model can learn the overlay texture rather than the rim/outside relationship.
5. **The WhatsApp images are a domain shift.** They are still images with
   different scale, camera height, lens, backgrounds and bin designs. The
   public Malaysia set has no reviewed state annotations, so its weak labels
   cannot calibrate target-domain fullness thresholds.

## Ranked mitigation options

### 1. Visibility gate + camera registration + fail-closed state machine

**Rank:** first and highest expected safety value.
**Can start with current code/data:** yes, but final thresholds require reviewed
target captures.

For each registered bin, keep a calibrated ROI, rim/opening sub-ROI and an
outside-waste ring. Before state classification:

1. verify the camera/profile identity;
2. align the current frame to the normal scene reference with a small affine
   transform and report an alignment score;
3. reject the frame if the alignment score, blur/exposure quality, or ROI
   geometry is invalid;
4. estimate visibility from person overlap, foreground change, rim/opening
   evidence and (when available) a bin mask;
5. return `unknown` and mask fullness/overflow losses when visibility is below
   the calibrated threshold;
6. only then run the state classifier on a canonical crop.

OpenCV documents `findTransformECC` for estimating a geometric transform
between a template and current image, which is appropriate for the small
camera/bin movements described by the user. Its background-subtraction APIs
provide a cheap foreground-change signal. Neither signal should be treated as
the overflow detector: they are registration/occlusion evidence only.

- [OpenCV `findTransformECC`](https://docs.opencv.org/4.0.0/dc/d6b/group__video__track.html)
- [OpenCV background subtraction tutorial](https://docs.opencv.org/doc/doxygen/html/d1/dc5/tutorial_background_subtraction.html)

Required policy:

```text
alignment/visibility invalid -> unknown
person overlaps rim/opening -> unknown
outside-waste evidence absent -> normal or full, never overflow
outside-waste evidence present and persistent -> overflow candidate
```

The reference image is a geometry/scene check. It must not unconditionally
force `normal`, because waste accumulation is precisely the change that the
system needs to detect.

Add one deterministic ontology rule in this first loop:

```text
overflow_candidate :=
    p_overflow >= tau_overflow
    AND p_fullness >= tau_fullness
    AND (outside_ring_evidence OR p_overflow >= tau_overflow + margin)
```

If `p_overflow` is high while `p_fullness` is below its calibrated threshold,
return `unknown` with `overflow_fullness_disagreement`; do not downgrade that
row to `normal`. In this product ontology, overflow necessarily implies at
least contained-full. This gate is a safety invariant, not a claim that the
two heads are statistically independent. Calibrate `tau_fullness` and
`tau_overflow` together on target validation rows, with a penalty for false
full/overflow; the current synthetic fullness threshold is visibly too low for
the WhatsApp normals (0.283–0.460), which explains their `full` calls even
though their overflow scores are low.

### 2. Explicit bin-mask and outside-ring segmentation

**Rank:** second; the strongest semantic fix for true overflow.
**Requires:** reviewed masks from the target cameras.

Add a small segmentation stage that returns:

- visible physical-bin mask;
- rim/opening or lid visibility (a coarse mask is sufficient initially);
- `outside_waste` mask inside the ring around that bin.

Compute geometry features such as visible-bin fraction, opening visibility,
outside-ring occupied area, and outside-ring connected components. Use these
features with the classifier, not instead of it. The operational overflow rule
should require both a state score and outside-ring evidence. A full but
contained bin therefore remains `full`.

Ultralytics documents YOLO11 nano instance-segmentation checkpoints and
training/export support. A `yolo11n-seg` prototype is small enough to benchmark
on the RTX 4050, but the repository's AGPL/commercial licensing must be
reviewed before production. A heavier amodal model is research material, not
the first local option; recent work shows that amodal masks can explicitly
reason about visible and occluded object parts, but it also introduces a much
larger annotation and model problem.

- [Ultralytics YOLO11 official model documentation](https://docs.ultralytics.com/models/yolo11)
- [Segment Anything, Even Occluded (CVPR 2025)](https://openaccess.thecvf.com/content/CVPR2025/html/Tai_Segment_Anything_Even_Occluded_CVPR_2025_paper.html)

The segmentation model should not be trained from the synthetic PIL overlays
alone. At minimum, review real target-camera masks for the bin silhouette,
opening visibility and outside waste.

### 3. Temporal evidence and stable physical-bin identity

**Rank:** third; immediate safety improvement and low compute cost.
**Can start with current code/data:** mostly yes; video review is still needed.

Evaluate every bin at the existing 5–10 second cadence, but alert only when the
same physical bin has valid evidence in at least two of the last three distinct
samples (or an equivalent 10-second persistence rule). Do not carry a positive
overflow state across a visibility-invalid observation. Keep an incident open
until a clear window is observed, rather than creating a new task per frame.

Use a simple IoU/ROI identity for the 4–8 registered bins. If a learned
localizer is needed, tracking-by-detection can bridge low-confidence or
temporarily occluded boxes; ByteTrack specifically addresses the loss and
fragmentation caused by dropping low-score occluded detections.

- [ByteTrack, official paper](https://arxiv.org/abs/2110.06864)
- [ByteTrack reference implementation](https://github.com/FoundationVision/ByteTrack)

Temporal persistence reduces transient false alerts; it cannot recover a state
that is never visible. Therefore it must be combined with the visibility and
outside-ring gates.

### 4. Target-domain hard negatives, calibration and realistic augmentation

**Rank:** fourth; necessary for the WhatsApp error, but not a substitute for
geometry/visibility gates.
**Requires:** reviewed target-camera captures for promotion.

Build the next dataset around sessions/events, not isolated images. Include
normal bins, contained-full bins, true outside-waste overflow, objects on lids,
bags beside bins, people in front of bins, baskets/chairs, missing bins, stale
ROIs and camera/profile mismatches. Keep complete sessions in one split.

Use real target negatives to calibrate presence, fullness and overflow
thresholds. Use augmentation only to widen the distribution: modest exposure,
blur, JPEG, scale, perspective, shadows and copy-pasted *reviewed* occluder
masks. Do not count synthetic rows as production test evidence.

Domain randomization has primary evidence that randomized appearance can help
transfer localization to real images and partial occlusions, but that result
does not remove the need for target-domain validation here. The current
overlay generator should randomize the occluder geometry and scene lighting,
and should be reported as augmentation—not ground truth.

- [Domain Randomization for Transferring Deep Neural Networks from Simulation to the Real World](https://arxiv.org/abs/1703.06907)

### 5. Explicit abstention/OOD score

**Rank:** fifth; useful as a guard, not the primary fix.

Add a visibility/reject output or a small calibrated gate over features. Keep
the existing presence head, but train it with hard non-bin crops and target
profile-mismatch crops. For a diagnostic, compute an energy score from the
classifier logits and calibrate it on target-domain in-distribution and
hard-OOD crops. Energy-based OOD detection was proposed because softmax-style
confidence can be overconfident on OOD inputs; the paper reports better OOD
separation than the softmax baseline on its benchmarks.

For a simpler first implementation, use a supervised reject/visibility head
and validation-selected thresholds. SelectiveNet provides the relevant
principle: optimize prediction and rejection together and measure the
risk/coverage trade-off, rather than silently converting every input into a
state.

- [Energy-based Out-of-distribution Detection (NeurIPS 2020)](https://proceedings.neurips.cc/paper/2020/hash/f5496252609c43eb8a3d147ab9b9c006-Abstract.html)
- [SelectiveNet: A Deep Neural Network with an Integrated Reject Option](https://proceedings.mlr.press/v97/geifman19a.html)

Do not claim OOD performance from a synthetic unknown row alone. A gate that
rejects everything may look safe but has zero useful coverage.

### 6. Larger backbone or a VLM replacement

**Rank:** last, after the preceding gates and target data.

MobileNetV3-Small was designed for low-resource use, and its larger variant is
a valid capacity challenger. Benchmark MobileNetV3-Large only after the
canonical crop, labels and gates are correct. A bigger backbone may improve
fine/full boundary recognition, but it cannot learn real overflow semantics
from weak labels or fix a stale ROI. The MobileNetV3 paper explicitly presents
small and large resource tiers; it is not evidence that a larger model solves
this dataset.

- [Searching for MobileNetV3 (paper)](https://arxiv.org/abs/1905.02244)

An open-vocabulary detector or InternVL/vLLM pass can assist annotation or
review, but should not authorize overflow from one frame. The repository's
NVIDIA assessment already concludes that open-vocabulary detection addresses
object boxes, not the relationship “waste is outside this bin,” and should be
kept out of the primary alert path.

## Recommended pipeline after mitigation

```text
frame
  -> camera/profile identity
  -> ECC/affine registration + ROI quality
  -> calibrated bin ROI + outside-waste ring
  -> bin/visibility verifier
       -> invalid or occluded: unknown, no alert
       -> valid: canonical crop
  -> MobileNet state heads (presence, fullness, overflow)
  -> outside-waste segmentation/objectness in ring
  -> per-bin temporal state machine (2 of 3 samples)
  -> alert only for persistent overflow evidence
```

The classifier can remain batched for 4–8 bins. The outside-ring segmentation
can run only when the state head is full/overflow-like or when a change trigger
fires, keeping the RTX 4050 latency budget practical. A scheduled scan is still
needed so a static spill/overflow is not missed.

## What can be done immediately with existing data

These actions improve safety and diagnostics without pretending that the public
or WhatsApp data is a production state benchmark:

| Action | Existing support | Expected effect |
|---|---|---|
| Remove the hard `normal-reference -> normal` decision override | Runtime code and profile reference already exist | Prevents reference matching from suppressing a genuine state change. |
| Add `alignment_invalid`, `rim_occluded`, `person_overlap`, and `outside_ring_unverified` reasons | Existing schemas/validator/quality path can carry reasons | Converts unsafe state guesses into auditable `unknown`. |
| Reuse person detections and ROI geometry as an occlusion veto | People/ROI modules already exist | Suppresses the known person-in-front false overflow path. |
| Require a persistent, distinct-frame overflow candidate | `SaferStateTracker` already exists | Removes single-frame transient alerts. |
| Canonicalize the registered ROI before the 224px transform | Fixed profiles already exist | Reduces crop aspect/context variation between cameras. |
| Use MOG2/ECC as diagnostics and registration checks | OpenCV is already a dependency | Detects scene movement/temporary foreground; does not label overflow. |
| Expand hard-negative diagnostics | Existing WhatsApp, edge and rejected-crop suites exist | Measures non-bin/normal false acceptance without training leakage. |
| Rebuild synthetic occlusion variants with varied masks | Existing prototype generator exists | Tests whether the guard improves safety; remains surrogate only. |
| Compare MobileNetV3-Small against Large only as a shadow experiment | Existing trainer supports the same multi-head contract with a small adapter | Quantifies capacity/latency trade-off without changing the production checkpoint. |

No current-data action can prove true overflow recall on a new camera because
there are no reviewed target-camera overflow masks/state sequences.

## Data that must be newly reviewed

For each installed camera, collect a session-separated pack covering all
registered bins. The existing project target of at least 324 crops is a useful
minimum proof pack; add hard negatives so the safety denominator is not tiny.

Every reviewed frame/crop should carry:

- `cameraId`, `binId`, session/event ID and angle band;
- bin box or visible mask;
- visible-bin fraction and rim/opening visibility;
- state: `normal`, `full`, `overflow`, or `unknown`;
- outside-waste mask/box for `overflow` and a confirmed empty ring for
  `normal`/contained `full`;
- occluder type: person, bag, cart, reflection, glare, blur, or other;
- lighting/weather and camera movement flags.

The train/validation/test split must be by complete capture session and camera
where possible. WhatsApp images remain locked diagnostic data unless the user
reviews them as target-domain labels; they must not be silently moved into
training.

## Two-loop execution and acceptance plan

The parent implementation may run at most the two loops below. Each loop has a
measurable exit; if the exit fails, the next loop is executed. If Loop 2 fails,
stop and keep the model log-only/blocked rather than tuning indefinitely.

### Loop 1 — guard, canonical crop and temporal evidence

**Plan**

1. Add the fail-closed visibility/alignment gate at the existing candidate
   validator seam.
2. Use the profile reference only to validate scene/geometry. Do not force the
   state to `normal` from reference similarity.
3. Add a canonical ROI transform and record alignment confidence, visible
   fraction, person overlap and occlusion reason.
4. Return `unknown` whenever alignment or opening visibility is below the
   validation threshold; mask fullness/overflow for that row.
5. Add the hierarchical overflow⇒fullness agreement gate. A classifier-only
   overflow score that disagrees with fullness may be logged, but cannot open a
   cleaner task.
6. Require outside-waste evidence plus 2-of-3 distinct-frame persistence before
   an overflow alert. A classifier-only overflow score may be logged but cannot
   open a cleaner task.
7. Calibrate thresholds on validation data only. Keep the existing synthetic
   and WhatsApp sets diagnostic and report coverage separately from accuracy.

**Loop 1 gates**

| Metric | Required |
|---|---:|
| Synthetic partial-occlusion safe same-or-unknown | >= 95% |
| Synthetic false overflow on normal/unknown occlusion rows | <= 1% |
| Blank/missing-bin unknown or absent rate | >= 99% |
| Unoccluded valid-state coverage | >= 85% |
| Unoccluded state macro-F1 loss versus current checkpoint | <= 0.05 absolute |
| Locked no-bin/normal negative clips | 0 false overflow alerts |
| Persistent true overflow in a reviewed target sequence | recall >= 85% once such sequences exist |
| Batched 4–8 crop classifier p95 on RTX 4050 | < 50 ms |

Passing the synthetic gates alone does not promote the checkpoint. It only
proves that the guard behaves safely on the controlled surrogate.

**Evaluation output**

Record per-row expected/actual state, `unknownReasons`, alignment score,
visibility score, outside-ring score, frame persistence and whether an alert
would have opened. Report both coverage and selective accuracy; do not hide
abstentions in a single accuracy number.

### Loop 2 — real target masks + explicit outside-waste segmentation

Run this only if Loop 1 fails, or if the first reviewed target-camera pack
shows that normal/full/overflow remains confused after the guard.

**Plan**

1. Review at least the 324 target-camera state crops already specified in the
   project plan, plus at least 100 occluded/hard-negative crops and 50
   no-bin/mismatched-profile crops.
2. Annotate bin/visible masks, opening/rim visibility and outside-waste masks.
3. Train a `yolo11n-seg`-class small segmenter for bin and outside waste (or a
   permissively licensed equivalent if AGPL is unacceptable).
4. Train MobileNetV3-Small with visibility and state heads; benchmark
   MobileNetV3-Large as the capacity challenger. Use target-domain hard
   negatives and session-separated splits.
5. Fuse classifier probabilities with geometry: overflow requires outside-ring
   mask evidence and persistence; occluded rows are `unknown`.
6. Add energy/reject scoring only if hard OOD crops still enter as high-
   confidence bins; calibrate its threshold on validation data.
7. Run the full locked replay, per-angle/per-camera metrics, 30-minute GPU
   stability and end-to-end alert tests.

**Loop 2 promotion gates**

| Metric | Required |
|---|---:|
| Bin presence recall on target camera | >= 95% |
| Non-bin/hard-negative acceptance | <= 1% |
| Normal vs contained-full macro-F1 | >= 0.85 |
| Overflow precision / recall (event-level) | >= 0.90 / >= 0.85 |
| Occluded/missing ROI returned `unknown` | >= 95% |
| False overflow on occluded/normal/no-bin locked clips | 0 alerts |
| Valid-state coverage after abstention | >= 85% |
| All three angle bands, if present | macro-F1 >= 0.80 each |
| End-to-end cycle on RTX 4050 | < 500 ms; no OOM/backlog |

The production task-assignment LLM remains downstream of these confirmed
events. It must not convert `unknown`, alignment failure or a single raw
overflow score into a cleaner task.

## Final recommendation

Implement Loop 1 first. It is the cheapest path that directly addresses the
measured 25% occlusion false-overflow failure and the unsafe manual-ROI
behavior. If it passes safety but target normal/full accuracy remains poor,
execute Loop 2 with real masks and explicit outside-waste segmentation. Do not
spend the two-loop budget on a VLM swap or a larger backbone before collecting
the target-camera labels that define the state.
