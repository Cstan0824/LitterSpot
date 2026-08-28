# Bin-state mitigation Loop 1 results

Date: 2026-08-19
Final status: **`loop1_passed_log_only`**

## Mitigation executed

The existing 940,885-parameter MobileNetV3-Small model was retained. Loop 1
changed the safety policy and calibration rather than increasing model size:

1. removed the unconditional normal-reference state override so a similar
   reference cannot suppress a genuine overflow change;
2. enforced the ontology invariant `overflow => sufficiently full`;
3. made conflicting overflow/fullness evidence return `unknown` with
   `overflow_fullness_disagreement` and no alert eligibility;
4. jointly calibrated `fullness`, `overflow`, and
   `overflowFullnessFloor` on validation rows and generated validation
   occlusion negatives only;
5. replayed all reserved synthetic/public tests and locked WhatsApp stills
   after freezing the candidate.

The selected thresholds are:

```json
{
  "presence": 0.10,
  "fullness": 0.56,
  "overflow": 0.10,
  "overflowFullnessFloor": 0.72
}
```

The locked WhatsApp rows and test split were never loaded by the calibration
command.

## Before and after

| Metric | Before | Loop 1 | Gate | Result |
|---|---:|---:|---:|---|
| Synthetic variant macro-F1 | 0.966 | 0.985 | >= 0.916 | pass |
| Top-down macro-F1 | 0.853 | 0.894 | >= 0.75 | pass |
| Oblique macro-F1 | 0.984 | 0.984 | >= 0.75 | pass |
| Side macro-F1 | 0.980 | 0.996 | >= 0.75 | pass |
| Overflow precision/recall, every angle | >=0.913 / 1.000 | 1.000 / 1.000 | >=0.75 / >=0.85 | pass |
| Partial-occlusion safe same-or-unknown | 79.2% | 95.8% | >=95% | pass |
| False overflow on occluded normal/unknown | 25.0% | 0.0% | <=1% | pass |
| Missing-bin blank unknown | 100% | 100% | >=99% | pass |
| ROI shift/scale safe same-or-unknown | 95.8–97.9% | 100% | >=90% | pass |
| Runtime balanced synthetic replay | 45/48 | 48/48 | diagnostic | pass |
| Locked WhatsApp strict match | 1/5 | 5/5 | >=4/5 | pass |
| Locked normal/no-bin false overflow | 0 | 0 | 0 | pass |
| RTX 4050 batch-8 p95 | 13.0 ms | 6.5 ms | <50 ms | pass |
| Automated tests | 100 | 102 | all pass | pass |

The unmodified weak-public state slice remains poor: macro-F1 is 0.207. This
is expected because the Malaysia source does not provide reviewed state labels
and demonstrates why the candidate cannot be called production-ready.

## Locked WhatsApp expected versus actual

| Case | Expected | Actual | Fullness | Overflow |
|---|---|---|---:|---:|
| Recycling bin 1 | normal | normal | 0.460 | 0.033 |
| Recycling bin 2 | normal | normal | 0.366 | 0.018 |
| Recycling bin 3 | normal | normal | 0.283 | 0.018 |
| Office basket | normal | normal | 0.284 | 0.035 |
| Black bin with staged bags | review overflow vs staged | normal | 0.167 | 0.015 |
| Green bin | overflow | overflow | 0.870 | 0.278 |
| Bags/foam with no bin | no bin | no candidate evaluated | — | — |

The staged-bag row remains excluded from strict accuracy because its expected
state still requires operator policy review.

## Loop decision

Loop 1 passed every predeclared gate, so Loop 2 was not executed. Training an
outside-ring segmenter without reviewed target masks would create another
synthetic proof rather than a better real detector.

This result validates the mitigation logic on the available fixtures. It does
not authorize cleaner-task dispatch. Production remains blocked until reviewed
installed-camera sequences provide real normal/full/overflow/unknown events,
outside-waste evidence, and event-level persistence metrics.

## Artifacts

- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/best.pt`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/calibration_report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/multi_angle_report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/robustness_report.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/runtime_smoke.json`
- `runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/whatsapp_replay.json`
- `docs/research/BIN_STATE_OCCLUSION_DOMAIN_MITIGATION_2026-08-19.md`
- `docs/BIN_STATE_MITIGATION_TWO_LOOP_EXECUTION_PLAN_2026-08-19.md`
