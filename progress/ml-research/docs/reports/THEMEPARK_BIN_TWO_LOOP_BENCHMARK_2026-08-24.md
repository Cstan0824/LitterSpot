# Theme-Park Bin Pipeline: Two-Loop Benchmark

Date: 2026-08-24

## Decision

Loop 2 is a successful research checkpoint but is **not production-promotable**. The localizer now finds every sampled bin in the locked WhatsApp clips and no longer mistakes the chair for a bin. A newly added wooden-box confuser still produces one false bin, however. The public fill-level pilot transfers moderately to real images, but real full-bin recall is only 42.1%. Public data found in this loop contains no valid overflow labels, so no honest Loop 2 overflow-recall improvement can be claimed.

## Dataset admitted

### Bin localization

- 498 Open Images V7 positive images with 910 waste-container boxes.
- 349 source-verified and visually reviewed no-bin images were available; 340 were admitted to training after author-overlap exclusions.
- Combined YOLO dataset: 838 images (746 train, 46 validation, 46 test).
- Exact cross-split duplicate count: 0; dHash cross-split pairs at Hamming distance <=3: 0.
- Important correction: Open Images `Waste container Confidence=0` was not trusted on its own. Visual review rejected 50 images that visibly contained bins.

### Fill-level state

- Official `akirsch1/waste-bin-dataset`, revision `b2a470de0d0c48ff56d714696db37339a6cc4e91`, CC BY-SA 4.0.
- Pilot subset: 300 simulated images plus all 74 real images.
- Grouped simulated split: 248 train and 52 validation; contiguous 50-ID proxy blocks never cross splits.
- Real split: all 74 images locked for one-time testing (22 empty, 33 half-full, 19 full).
- Every admitted file has SHA-256, pinned revision, source URL, attribution, and license metadata.
- Labels are fill level only. `full` is never mapped to `overflow`.

## Loop 1 baseline

| Metric | Loop 1 |
|---|---:|
| Public localizer mAP50 | 0.5842 |
| Locked positive-track recall | 35.5% |
| Locked false-bin frame rate | 44.4% |
| State accuracy, given localized | 40.0% |
| End-to-end state accuracy | 22.2% |
| End-to-end overflow recall | 0.0% |
| False-overflow frame rate | 0.0% |

Feedback: the generic localizer under-recalled real bins and confused chairs/large objects with bins. The state model also treated visual contents near a bin top as overflow without reliable rim/opening evidence.

## Loop 2 benchmark

### Localizer

YOLO11n, 15 epochs, selected on the public validation split. The deployment confidence of 0.321 was selected from the public validation F1 curve only.

| Metric | Loop 2 | Change vs Loop 1 |
|---|---:|---:|
| Public test precision | 0.8504 | n/a |
| Public test recall | 0.6809 | n/a |
| Public test mAP50 | 0.8318 | +0.2477 |
| Public test mAP50-95 | 0.5147 | +0.1537 vs V0 validation reference |
| Original locked-suite positive-track recall | 100.0% | +64.5 pp |
| Original locked-suite false-bin frame rate | 0.0% | -44.4 pp |
| Chair false detections | 0 | original failure removed |

The original locked suite had only two negative cases, below its required coverage of three. A reviewed, never-trained wooden-box image was therefore added as a third container-like negative. On this expanded suite:

- Positive-track recall: 31/31 = 100%.
- False-bin frames: 1/10 = 10%.
- Chair false detections: 0.
- Failure: the wooden shipping box was detected as a bin at confidence 0.508.

The general COCO blocker/veto did not fix this: it retained the wooden-box error and reduced positive recall to 96.8%.

### Fill-level classifier

MobileNetV3-Small, eight epochs; epoch 6 selected on grouped simulated validation.

| Metric | Simulated validation | Untouched real test |
|---|---:|---:|
| Accuracy | 80.77% | 72.97% |
| Macro-F1 | 0.8029 | 0.7067 |
| Empty recall | 88.89% | 100.00% |
| Half-full recall | 61.11% | 72.73% |
| Full recall | 93.75% | 42.11% |

Real-test confusion matrix (`actual x predicted`, order empty/half-full/full):

```text
[[22,  0, 0],
 [ 5, 24, 4],
 [ 0, 11, 8]]
```

Feedback: simulated-to-real transfer is adequate for a first visual prototype, but full bins are usually downgraded to half-full. This checkpoint is diagnostic and is not wired into production.

### Overflow state

No admitted public source labels trash crossing the rim/opening, objects resting on a closed lid, and contained-full as distinct states. Consequently:

- Loop 2 overflow model: not trained.
- Loop 2 overflow recall: not claimable.
- Production behavior should remain conservative (`unknown` or `full`) unless independent rim-crossing evidence persists over time.

## Required next mitigation

1. **Localizer verifier:** add at least 100 reviewed proposal crops for container-like non-bins (wooden/cardboard boxes, barrels, coolers, trolleys, tables) and train a bin-vs-confuser verifier behind YOLO. Keep the wooden-box fixture locked.
2. **Camera enrollment:** for fixed theme-park cameras, confirm each bin once and track its ROI. Use generic detection only for bootstrap/reacquisition. This avoids needing to label every frame and is more reliable than open-world bin discovery.
3. **Fullness domain adaptation:** add 30-50 local full-bin crops, sampled automatically from tracked clips and reviewed at event level. Oversample real full examples and select on a separate local validation group.
4. **Overflow evidence model:** annotate three regions per enrolled bin—body, opening/rim, and exterior-above-rim. Alert overflow only when segmented waste crosses the rim/exterior region for multiple frames. An object on a closed lid must map to `unknown/object_on_lid`, never overflow.
5. **Acceptance expansion:** add at least five independent no-bin theme-park clips covering boxes, carts, strollers, chairs, and advertising stands. Do not use them for training or threshold selection.

## Artifacts

- Localizer checkpoint: `runs/bin-localizer/bin_localizer_openimages_loop2_838/weights/best.pt`
- Public localizer test: `artifacts/loop2/bin-localizer-public-test.json`
- Expanded locked regression: `artifacts/loop2/bin-localizer-regression-production-val-selected.json`
- Threshold record: `artifacts/loop2/bin-localizer-threshold-calibration.json`
- Fill checkpoint/report: `runs/state_classifier/waste_bin_fill_loop2_v1/`
- Source research: `docs/research/THEMEPARK_BIN_LOOP2_DATA_SOURCES_2026-08-24.md`
- Fill-data acquisition audit: `docs/research/WASTE_BIN_DATASET_ACQUISITION_AUDIT_2026-08-24.md`

## Promotion verdict

**Do not replace the production checkpoints.** Preserve the Loop 2 artifacts for comparison and use them as the starting point for the verifier/camera-enrollment design. The localizer improvement is real, but the expanded negative test and absent overflow ground truth block safe promotion.
