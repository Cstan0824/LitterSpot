# Expanded mock regression evaluation — 2026-08-18

## Scope

This run evaluated the current **InternVL3.5-1B VLM backend** through the live
FastAPI `/analyze/frame` endpoint on the RTX 4050 (6 GiB). It is a regression
and integration evaluation, not a training set and not a specialist-model
evaluation; the specialist checkpoints remain intentionally unavailable.

| Suite | Samples | Purpose |
| --- | ---: | --- |
| Public-domain stills | 6 | overflow, clean/no-bin negatives, sparse/dense people |
| Project-owned stills | 5 | deployment-camera bin, floor-panel, staged-bag cases |
| Synthetic beverage-spill variants | 5 | execution-path recall check for floor spills |
| Project video frames | 3 | temporal consistency on sampled CCTV-like frames |
| **Total** | **19** | |

The raw request/outcome JSONL, responses, extracted frames, CSV and table are
kept in the corresponding `artifacts/mock-evaluations/20260818T...` folders.

## Endpoint and runtime result

| Metric | Result |
| --- | ---: |
| HTTP 200 | 19 / 19 |
| Structurally valid result | 19 / 19 |
| Placeholder-template responses | 0 / 19 |
| Mean end-to-end time | 8.36 s |
| P95 end-to-end time | 15.08 s |
| Bin-overflow flags | 4 / 19 |
| Floor-litter flags | 13 / 19 |
| Floor-spill flags | 1 / 19 |

The runtime is much better on the RTX 4050 than the CPU smoke test, but its
15.08 s P95 exceeds the current 10-second target. One worker would accumulate
backlog during busy periods.

## Labelled-slice findings

The expected values are provisional review labels where stated; the clear
positive/negative findings below do not depend on the ambiguous staged-bag
policy.

| Evaluation slice | Expected | Observed | Conclusion |
| --- | --- | --- | --- |
| Synthetic beverage spills | spill in 5 / 5 | spill in 0 / 5 | **0% spill recall** |
| Public clean-floor negatives | no hazard in 3 / 3 | hazard in 3 / 3 | **3 false positives** |
| Public no-bin negatives | no bin in 2 / 2 | normal bin in 2 / 2 | **2 false bin detections** |
| Public overflow scenes | overflow in 2 scenes | detected in 1 scene | **1 clear miss** |
| Public people-count ranges | correct range in 1 / 6 | undercounted dense/partial views | **poor occupancy accuracy** |

Concrete examples:

- The overflowing Hamburg bin was correctly marked overflow, but its expected
  three people were counted as one.
- The overflowing paper-bin scene was returned as a single normal bin rather
  than two overflowing plus one normal bin.
- A normal bin, crowded mall, and construction-mall thumbnail all produced a
  false floor-litter alert; the crowded mall additionally produced a false
  spill and a phantom normal bin.
- All five synthetic F&B-spill variants omitted `floor_spill`. Some instead
  generated `floor_litter`, which is operationally the wrong task type.
- The three sampled video frames produced the same `normal bin + floor litter`
  result. This is stable output, but without reviewed video labels it cannot
  be treated as correct temporal evidence.

## Conclusion

The current VLM pipeline is **transport-reliable but detection-unreliable**
for automatic cleaner assignment. It should not create spill or litter tasks,
and it should not be the primary occupancy counter. The failure is model
grounding/classification, not an HTTP, parser, or fusion failure:

1. requests, parsing, persistence and flags worked for all 19 samples;
2. the model still invents bins and floor hazards in visually complex scenes;
3. it completely missed the controlled spill signal;
4. the shared 10-second cadence is not met at P95 even on the GPU.

Keep InternVL only as an optional human-review/ambiguous-event verifier. Do
not attempt to solve these failures with prompt changes alone.

## Required next model work

1. **Bin state:** label fixed camera ROIs and train/calibrate the existing
   MobileNetV3 multi-head specialist. Its profile-only input prevents phantom
   bin identity.
2. **Floor hazards:** collect real beverage and food-spill masks plus clean
   reflections, floor panels and shadows; train a segmentation specialist.
   The five synthetic spills remain locked evaluation-only and must not enter
   training.
3. **Occupancy:** adopt a small pretrained person detector/tracker first and
   calibrate it on the 0, 1–3, 4–8 and dense count slices before fine-tuning.
4. Promote a specialist only after passing the training-data audit and its
   labelled holdout/locked-benchmark gates. The current specialist runtime
   already fails closed while those checkpoints are absent.
