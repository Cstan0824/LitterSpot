# Bin localization and chair false-positive remediation plan

## 1. Objective

Prevent chairs, tables, carts, signboards, bags, and other non-bin objects from
entering the bin-state pipeline, while preserving reliable localization of
normal, full, and overflowing bins in the target CCTV views.

The required operational invariant is:

> A region must be verified as a physical bin before fullness or overflow is
> classified. An unverified region is not returned as a bin and cannot create
> a bin alert.

## 2. Root cause and scope

The chair shown in the supplied video is not only a training-data problem. The
current pipeline can create a candidate from either:

1. the YOLO bin localizer; or
2. the configured fixed-camera ROI fallback.

The screenshot's blue region aligns with the `camera-1:bin-1` ROI. The uploaded
video is a different physical view but is also submitted as `camera-1`, so the
fallback labels whatever occupies that fixed rectangle as `bin-1`. This path
bypasses the localizer. The state classifier correctly abstains with `unknown`,
but the UI still renders the candidate as a bin.

Therefore, adding localized bin data is necessary but not sufficient. The work
must address four layers together:

- camera/profile identity;
- bin localization data and training;
- candidate verification before state classification;
- end-to-end evaluation and safe model promotion.

## 3. Target pipeline design

Use the following decision flow:

```text
Full frame
  -> candidate proposal
       - learned localizer candidate
       - calibrated fixed-camera ROI candidate
  -> bin candidate verification
       - camera/profile validity
       - bin-presence probability
       - hard-negative rejection
       - optional temporal consistency
  -> verified physical bin
  -> normal/full/overflow classification
  -> temporal alert confirmation
```

Introduce one deep module at the seam between candidate proposal and state
classification:

```python
BinCandidateValidator.verify(frame, candidate, camera_context) -> VerificationResult
```

`VerificationResult` should contain:

- `accepted: bool`;
- `physical_bin_id: str | None`;
- `candidate_source: "localizer" | "profile"`;
- `bin_presence_score: float`;
- `rejection_reasons: list[str]`;
- `bbox`.

All blocker checks, reference checks, profile matching, and presence gating
belong behind this interface. `AnalysisPipeline` should receive only accepted
bins from it. Rejected candidates may be returned in an optional diagnostics
field, but must not be included in `result.bins`.

## 4. Phase 0 - immediate containment

Complete this before retraining.

**Implementation status (2026-08-13): complete.** The UI and HTTP pipeline
now default to unregistered-upload mode, fixed ROIs require explicit calibrated
mode, and both proposal sources pass through `BinCandidateValidator`. The
supplied chair/crowd regression frame produces zero bins at the conservative
0.85 operating threshold; the calibrated green-bin mock still produces one
normal bin. The labeled localization dataset and retrained checkpoint remain
the next required work.

1. Stop treating the UI's default `camera-1` as a universal uploaded-video ID.
2. Add an explicit input mode:
   - **Calibrated camera**: requires a registered camera ID and may use its ROI.
   - **Unregistered upload**: detector-only; fixed ROI fallback is disabled.
3. Add a profile scene check. A fixed ROI may be proposed only when the current
   frame matches the calibrated camera scene or camera fingerprint.
4. Require the bin-presence head to pass before a profile ROI becomes a bin.
5. If presence fails, return `rejected_non_bin` for diagnostics and omit it from
   `result.bins`.
6. Show `candidateSource` and rejection reason in development overlays so model
   and profile failures can be distinguished.

Acceptance for containment:

- the supplied chair video produces zero displayed bins when used as an
  unregistered upload;
- a mismatched video cannot activate `camera-1:bin-1` merely because the user
  left the default camera ID unchanged;
- the calibrated green-bin view still produces `bin-1` when its profile is
  intentionally selected.

## 5. Phase 1 - build the localized-bin dataset

### 5.1 Dataset units

Create a versioned full-frame YOLO dataset for one class: `trash bin`. A
positive label covers the complete physical container, including its lid and
wheels where visible. Waste, bags, and litter are not separate bin boxes.

Negative images use an empty YOLO label file. Do not draw boxes around chairs
as a second class in the one-class localizer dataset; their value is as hard
negative context.

Maintain a manifest with:

```text
image,source_id,camera_id,split,has_bin,bin_style,state,view_angle,
lighting,occlusion,negative_category,review_status,notes
```

### 5.2 Bootstrap volume

Minimum first retraining set:

| Data group | Minimum | Notes |
| --- | ---: | --- |
| Positive full frames | 1,200 | At least 2,000 labeled bin instances preferred |
| Negative full frames | 1,500 | No bin anywhere in frame |
| Chair/table negatives | 400 | Include black plastic chairs and table-chair groupings |
| Other hard negatives | 600 | Carts, strollers, boxes, signs, bags, coolers, doors, displays |
| Target-camera positives | 100 per camera | Normal, full, overflow, occluded, day/night |
| Locked target test clips | At least 3 positive and 3 negative clips | Never used for training |

The current chair video should remain in the locked regression set. Collect
separate chair footage for training so the test is not leaked into training.

### 5.3 Sampling rules

- Sample CCTV/video at 0.5-1 frame per second initially.
- Remove near-duplicates using perceptual hashing; keep frames with meaningful
  changes in people, object position, lighting, or occlusion.
- Split by complete `source_id` or physical camera, never by adjacent frame.
- Keep at least one target camera and one bin style exclusively in the test
  split to measure generalization.
- Never copy frames from validation/test into training during hard-negative
  mining.
- Record license and provenance for every external dataset.

### 5.4 Required coverage

Positive coverage:

- wheeled, pedal, open-top, cylindrical, rectangular, indoor, and outdoor bins;
- green, black, grey, and partially transparent bins;
- frontal, oblique, elevated, and top-down views;
- small/distant bins, partial occlusion, motion blur, low light, and glare;
- normal, full, and genuine overflow states.

Negative coverage:

- plastic and office chairs, especially dark chairs with tall backs;
- tables with objects on top;
- strollers, trolleys, carts, coolers, storage boxes, signboards, pillars;
- black bags, litter piles, cups, bottles, people, and crowd scenes;
- objects occupying the exact configured bin ROI after a bin is moved;
- empty camera views and scenes from unrelated cameras.

## 6. Phase 2 - annotation and data-quality gate

**Implementation status (2026-08-20): complete.** Use
[`bin-localizer-cctv-manifest.template.csv`](bin-localizer-cctv-manifest.template.csv)
and run `ml-training/scripts/audit_cctv_bin_localizer_data.py` before creating
the training mix. The audit enforces reviewed samples, valid positive/negative
labels, normalized in-frame one-class boxes, byte-hash isolation, and
source/camera split isolation. `prepare_cctv_bin_localizer_dataset.py` merges
the audited rows with generic replay data, emits contact sheets and a data
card, and reports whether the minimum coverage gate is met.

1. Add a dataset preparation script that merges the existing GCO/GBS sources
   with reviewed deployment positives and negative frames.
2. Add a manifest audit that fails on:
   - missing or malformed boxes;
   - boxes outside image bounds;
   - a positive manifest row with no label;
   - a negative row with a non-empty label;
   - duplicate hashes across train/validation/test;
   - the same source or camera appearing in multiple splits;
   - unreviewed labels in validation/test.
3. Generate contact sheets for every split and manually review all target-camera
   boxes plus a random 10% of generic boxes.
4. Version the dataset definition and audit report together, for example
   `bin-localizer-cctv-v3`.

Deliverables:

- `ml-training/data/bin-localizer-cctv-v3/`;
- a source manifest;
- an audit JSON report;
- reviewed contact sheets;
- a data card describing coverage and limitations.

## 7. Phase 3 - two complementary training tracks

**Implementation status (2026-08-20): training entry is blocked by data
readiness.** The workspace does not currently contain the generic localizer
dataset or an operator-reviewed deployment localization manifest. The supplied
WhatsApp clips remain locked regression data and were not reused for training.

### Track A: improve the one-class localizer

Fine-tune from the best generic checkpoint rather than training from scratch.
Run controlled experiments over:

- YOLO11n and YOLO11s;
- image size 640 versus 960 for small/distant bins;
- conservative mosaic and scale augmentation;
- generic-to-target replay ratios of 1:1, 2:1, and 3:1;
- operating confidence selected on validation data, not the test set.

The training set must include empty-label negative frames. Run at least two
hard-negative-mining rounds:

1. run the candidate checkpoint over the training negative pool at a low
   confidence threshold;
2. save its highest-confidence false detections;
3. manually verify and add those full frames to the next training round;
4. keep the locked test pool untouched.

### Track B: strengthen candidate crop verification

Use false localizer crops as OOD negatives for the existing multi-head state
model's bin-presence head. Include chairs, tables, carts, boxes, and mismatched
profile ROIs under:

```text
ml-training/data/state-hard-negatives/{train,valid,test}/<source-id>/
```

Only the presence head receives supervision for these samples; fullness and
overflow losses remain masked. Calibrate a bin-presence threshold on the
validation split with a stronger penalty for non-bin false acceptance.

Do not promote either track independently. A candidate must pass the localizer
or calibrated-profile proposal and the presence verifier.

## 8. Phase 4 - runtime integration

Implement the following changes:

1. Add `BinCandidateValidator` and route both localizer and profile candidates
   through it.
2. Replace the unconditional configured-ROI fallback with a calibrated-profile
   proposal that requires:
   - exact camera/profile identity;
   - scene/reference compatibility;
   - bin-presence verification.
3. Deduplicate a detector candidate and profile candidate referring to the same
   physical bin using IoU/center matching.
4. Exclude rejected candidates from `PipelineAnalysisResponse.bins`.
5. Add diagnostic fields:
   - `candidateSource`;
   - `binPresenceScore`;
   - `profileMatched`;
   - `rejectionReasons` in debug output.
6. Run state classification only for verified bins.
7. Preserve temporal identity by physical profile ID where available; otherwise
   track verified detector boxes across adjacent samples.

The safety rule remains: uncertain or rejected regions can never create an
overflow alert.

## 9. Phase 5 - evaluation protocol

**Implementation status (2026-08-20): evaluator complete; current checkpoint
failed.** `evaluate_bin_localizer_regression.py` replays the locked videos at
one frame per second and reports false-bin frames, positive-track recall,
chair detections, and per-negative-category counts. The last committed
checkpoint achieved 0/9 false-bin frames after the runtime blocker veto, but
only 12/31 positive track samples (38.7%) and therefore remains blocked.

### 9.1 Offline localizer gates

Evaluate on generic and deployment-domain test sets separately. Required gates:

- generic precision >= 0.90;
- generic recall >= 0.90;
- generic mAP50 >= 0.90;
- deployment-domain precision >= 0.95;
- deployment-domain recall >= 0.90;
- chair false detections: 0 on the locked chair test set;
- false-bin frame rate on all negative clips <= 1%;
- per-camera bin track recall >= 90% at one sample per second.

Report per-category metrics for chairs, tables, carts, bags, people, and empty
scenes; an aggregate score can hide the exact production failure.

### 9.2 Candidate-verifier gates

- non-bin false acceptance rate <= 1%;
- true-bin acceptance recall >= 95%;
- zero accepted chairs on the locked chair clips;
- zero accepted mismatched profile ROIs;
- overflow/fullness heads are never evaluated for a rejected crop.

### 9.3 End-to-end video gates

Run the real `/analyze/video-frame` path and UI overlay against the mock suite:

| Scenario | Required result |
| --- | --- |
| Supplied chair/crowd video | 0 bins, 0 bin alerts |
| Supplied closed green-bin video | 1 verified bin, normal, 0 overflow alerts |
| Supplied overflowing black-bin media | 1 verified bin when using its matching camera/profile or detector-only mode; overflow remains detectable |
| No-bin people video | 0 bins, 0 bin alerts |
| Bin temporarily occluded by person | no false state transition; recover the same bin identity after occlusion |
| Camera/profile mismatch | profile fallback disabled or rejected |

Measure p95 end-to-end latency and keep it below the one-second sampling
interval on the deployment hardware.

## 10. Phase 6 - promotion and rollout

**Implementation status (2026-08-20): hard promotion gate complete; promotion
blocked.** `evaluate_bin_localizer_promotion.py` requires dataset readiness,
the generic 0.90/0.90/0.90 gates, locked-suite coverage, <=1% negative-frame
false bins, >=90% positive-track recall, and exactly zero chair detections.
It does not average failed safety gates into an aggregate score.

1. Store candidate checkpoints under versioned run directories with dataset and
   evaluation hashes.
2. Compare the new checkpoint with the production checkpoint on the same locked
   suite.
3. Promote only if every safety gate passes; do not average away a failed chair
   or no-bin gate.
4. Run shadow mode first: record proposed bins and rejections without creating
   alerts.
5. Review at least seven days of target-camera shadow results.
6. Enable alerts per camera, starting with calibrated views.
7. Keep the previous localizer path and profile configuration available for
   immediate rollback.
8. Add rejected high-confidence candidates to a review queue for the next
   hard-negative-mining cycle.

## 11. Test plan

Add tests at the candidate-validation interface and the end-to-end pipeline:

- detector chair candidate is rejected;
- profile ROI containing a chair is rejected;
- profile candidate from a mismatched camera scene is rejected;
- verified detector and profile candidates are deduplicated;
- rejected candidates do not appear in `result.bins`;
- rejected candidates cannot produce `bin_overflow` flags;
- valid normal and overflow bins remain accepted;
- exact chair, green-bin, black-bin, and no-bin media are replayed through the
  HTTP video-frame path;
- frontend overlay count equals the number of verified bins, not proposed
  candidates.

## 12. Recommended execution order

1. Implement Phase 0 containment and lock the supplied media as regression
   fixtures.
2. Add the `BinCandidateValidator` seam and tests.
3. Collect and audit target positive/negative localization data.
4. Train Track A and Track B candidates.
5. Select thresholds using validation data.
6. Run offline, HTTP, and UI video gates.
7. Shadow-deploy, review, and promote per camera.

## 13. Definition of done

The work is complete only when:

- the chair clip produces zero displayed bins;
- a calibrated real bin is found even when the learned localizer momentarily
  misses it;
- normal-reference matching does not suppress a genuine overflow;
- no profile is applied to an unrelated camera view;
- all generic, deployment, candidate-verifier, and end-to-end gates pass;
- dataset, checkpoint, thresholds, camera profiles, and evaluation reports are
  versioned and reproducible.
