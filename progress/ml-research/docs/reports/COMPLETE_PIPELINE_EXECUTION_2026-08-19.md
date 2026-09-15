# Complete pipeline execution report

Date: 2026-08-19

## Execution status

| Fact/module | Expected gate | Actual result | Status |
|---|---|---|---|
| Bin state/overflow | Overflow precision >=0.85, recall >=0.90; unknown on missing/occluded ROI | No state checkpoint; manifest has 0 bin rows because public sources do not provide valid indoor state labels | **Blocked, correctly fail-closed** |
| Floor litter | Precision/recall >=0.85; mask mAP/IoU gate | Clean revision 2 100-epoch follow-up: test box P=0.6729, R=0.2436, mAP50=0.2549; mask P=0.6729, R=0.2436, mAP50=0.2501. Five-epoch smoke was lower (box P=0.0073, R=0.2308). | **Failed promotion gate** |
| Floor spill | Precision >=0.80, recall >=0.90 | No spill training examples; metric unavailable | **Blocked** |
| Human population | >=95% within +/-1 in normal operating band | 41 still cases: 34/41 within expected range (82.9%); 14/15 sampled video cases within +/-1 (93.3%). Existing targeted baseline remains 35/35 still and 14/15 video within +/-1. | **Diagnostic only; not retrained** |
| API/fusion contract | Three-module schema, persistence and fail-closed degraded mode | 72 AI-service tests and 21 ML tests passed | **Passed** |
| Service/build verification | Backend schema tests/build and frontend production build | 2 backend tests passed; TypeScript backend build passed; Vite frontend build passed | **Passed** |
| Hardware smoke | No CUDA failure; cycle target <500ms | YOLO11n-Seg trained on RTX 4050 at 640px/batch 2; inference reported about 16.9ms/image on test replay | **Smoke passed** |

## Data executed

- Official TACO repository cloned for reviewed `annotations.json`.
- 150 deterministic image IDs selected; 96 downloaded/reused successfully.
- Exact-path conversion produced 95 valid specialist floor rows after one
  truncated JPEG was skipped. The clean specialist split is 67 train / 8
  validation / 20 test; all rows are `floor_litter` only.
- Specialist split: 67 train / 8 validation / 20 test.
- University of Malaya CC BY 4.0 bin dataset: 200 images downloaded and
  checksum-verified. It has no machine-readable state labels, so it was not
  used to fabricate a bin-state checkpoint.
- Locked WhatsApp images/videos were not used for training.
- The expanded occupancy replay was rerun after data import: 34/41 still cases
  were within the reviewed expected range (82.9%) and 14/15 sampled video
  frames were within +/-1 person (93.3%).

## Automatic-label execution

- YOLOE text-prompt bootstrap accepted all five public Malaysia images as
  three-bin candidates (15 crops).
- InternVL3.5-1B crop labeling was run on all 15 crops. The conservative gate
  rejected the repeated tiny/template boxes and any response that also
  hallucinated people or floor hazards; the final safe acceptance rate was
  **0/3 on the verification image (0%)**. The earlier exploratory pass showed
  2/15 apparent accepts, but both were rejected on the stronger cross-class
  hallucination rule. No VLM-derived state row was merged into the training
  manifest.
- The floor YOLO11n-Seg bootstrap was replayed on 10 locked edge-case images in
  evaluation-only mode: 4/10 produced a litter mask (40%), 6/10 returned
  unknown, and **0 spill masks** were accepted. The checkpoint declares a
  `floor_spill` class in its data YAML but has no verified spill training
  examples, so it is not treated as a spill teacher.
- A numbered 15-tile contact sheet with source sidecar and label template was
  generated at `artifacts/contact-sheet/20260819-bin-crops-v1/`. Labels can be
  entered once per tile; the companion script restores original-resolution
  crops and verifies checksums.

## Checkpoints

The floor checkpoint is retained only as a bootstrap smoke artifact:

`ml-training/floor_rubbish/runs/theme_park_hazards/yolo11n_seg_floor_taco_smoke_revision_2/weights/best.pt`

The longer unregistered experiment is:

`ml-training/floor_rubbish/runs/theme_park_hazards/yolo11n_seg_floor_taco_full_revision_2/weights/best.pt`

Neither is registered in production because the dataset contains solid litter
only, no spills, no clean hard-negative set, and both held-out metrics fail the
promotion gate.

## Conclusion

The conversion and GPU training path works end-to-end. The public data is not
enough to produce deployable bin-state or spill detection. The next required
input is licensed spill/clean-floor data plus operational event snapshots for
bin state; these can be ingested with the new weak-label tooling without
manual per-frame cropping. Until those gates pass, the complete specialist
backend must remain `not_ready` and must not dispatch cleaner tasks from the
bootstrap floor checkpoint.

## Multi-angle bin-state prototype execution

The follow-up prototype plan was executed without treating public images as
ground-truth state labels. YOLOE localization accepted 61/100 public Malaysia
images for train/validation (183 crops) and 42/100 reserved images for test
(126 crops). A reproducible generator then created three metadata view bands
(`top_down`, `oblique`, `side`) and controlled `normal`, `full`, `overflow`,
and `unknown` surrogates. The resulting manifest has 1,911 train, 468
validation, and 1,638 test rows; every row is marked `weak_label`, and the
smoke provenance audit passed with no locked-mock reuse.

The trained MobileNetV3-Small checkpoint has 940,885 parameters (the unused
ImageNet classifier is removed) and is:

`runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/best.pt`

On the synthetic holdout, four-state macro-F1 was 0.853 top-down, 0.984
oblique, and 0.980 side; overflow recall was 1.00 in every angle band. On the
126 unmodified public test crops, four-state macro-F1 was only 0.200 and full
state F1 was 0.185, confirming that the source data is not sufficient to prove
real bin-state detection. The runtime adapter smoke replay loaded the same
checkpoint and matched 45/48 balanced synthetic cases (93.75%), with mean
single-crop CUDA processing of 27.5 ms. Batch-4/8 classifier latency remained
below the prototype 30 ms mean / 50 ms p95 target.

Artifacts:

- `ml-training/data/specialists/multi-angle-prototype/manifest.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/multi_angle_report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/runtime_smoke.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/predictions.csv`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/robustness_report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_v1_presence_fix/whatsapp_replay.json`

The controlled robustness replay passed the ±3% ROI shift and ±5% scale checks
(95.8–97.9% same-or-unknown, 0% false overflow on normal/unknown rows) and
returned `unknown` for 48/48 blank missing-bin crops. It failed the synthetic
partial-occlusion check: only 79.2% were safe and 25% of normal/unknown rows
became false overflow. This identifies the next engineering mitigation:
add an explicit occlusion/ROI-quality guard and prefer `unknown` over state
classification when the opening is blocked.

The locked WhatsApp still replay was run with documented manual diagnostic ROIs
and excluded from training/calibration. Only 1/5 strict comparable cases
matched (20%): the green overflow case was detected, while normal recycling
bins and the small basket were called `full`; the staged-bags case remains
review-only. This is a domain-transfer diagnostic, not a production metric.

The result is therefore a methodology proof only. The checkpoint stays out of
production and cannot dispatch cleaner work until the real 324-crop,
session-separated pack is captured and reviewed across all three angles, and
the occlusion failure is fixed.

## Loop-1 safety mitigation follow-up

The occlusion failure was mitigated with a validation-only hierarchical policy
calibration rather than a larger model. Overflow now requires fullness-head
agreement; conflicting evidence becomes `unknown` and cannot alert. The
normal-reference shortcut was also removed so reference similarity cannot
suppress a changed bin.

On the unchanged evaluation suites, partial-occlusion safety improved from
79.2% to 95.8%, false overflow on occluded normal/unknown rows fell from 25%
to 0%, the locked WhatsApp strict result improved from 1/5 to 5/5, and all
angle overflow precision/recall values were 1.00. All 102 automated tests
passed and batch-8 p95 was 6.5 ms on the RTX 4050.

Loop 1 passed, so the conditional segmentation loop was not executed without
real target masks. The result remains log-only because the unmodified weak-
public state slice is still poor (macro-F1 0.207) and no reviewed installed-
camera event sequence exists. See
`docs/reports/BIN_STATE_MITIGATION_LOOP1_RESULTS_2026-08-19.md`.
