# Bin-state mitigation: two-loop execution plan

Date: 2026-08-19

## Objective

Mitigate the two measured failures of the current prototype without using the
locked WhatsApp suite for training or threshold selection:

- partial occlusion: 79.2% safe same-or-unknown and 25% false overflow on
  normal/unknown rows;
- real-domain replay: 1/5 strict matches because normal bins/baskets are often
  classified as `full`.

The loop budget is two. A loop passes only when every gate for that loop passes.
If Loop 2 still fails, the model remains log-only and the report must name the
missing target data instead of tuning against the locked test.

Research basis:

- `docs/research/BIN_STATE_OCCLUSION_DOMAIN_MITIGATION_2026-08-19.md`
- OpenCV ECC/background-change registration and visibility diagnostics;
- deterministic ontology consistency (`overflow` implies sufficiently full);
- selective abstention (`unknown`) for invalid or conflicting evidence;
- outside-ring segmentation with reviewed target masks as the conditional
  second loop.

## Locked evaluation policy

- Train/validation source: the existing public/synthetic prototype manifest.
- Threshold selection: validation split only.
- Test source: reserved prototype test split, robustness transformations and
  locked WhatsApp stills.
- WhatsApp expectations, signals, and outcomes must never enter candidate
  selection.
- Every output identifies whether it is synthetic, weak-public, or locked
  target-domain diagnostic evidence.

## Loop 1 — hierarchical fail-closed calibration

### Implementation

1. Remove the unconditional `matches_normal_reference -> normal` decision.
   Reference matching remains geometry/scene evidence and cannot suppress a
   changed bin.
2. Add a policy invariant:

   ```text
   overflow score above threshold AND fullness below agreement floor
     -> unknown(reason=overflow_fullness_disagreement), never an alert
   ```

3. Add `overflowFullnessFloor` to checkpoint/profile threshold handling in both
   bin-state runtime adapters.
4. Add a validation-only calibration command. It jointly searches fullness,
   overflow and agreement-floor thresholds using clean validation rows plus
   generated occluded validation negatives. It writes a new immutable
   checkpoint and calibration report.
5. Make the angle and robustness evaluators use the same pure runtime decision
   function, including abstention/uncertainty.
6. Rerun the held-out angle suite, synthetic perturbations, runtime adapter,
   RTX 4050 latency and locked WhatsApp replay.

### Gates

| Metric | Required |
|---|---:|
| Partial-occlusion safe same-or-unknown | >= 95% |
| False overflow on occluded normal/unknown | <= 1% |
| Missing-bin blank returned unknown | >= 99% |
| Clean synthetic macro-F1 loss from 0.966 baseline | <= 0.05 |
| Clean per-angle macro-F1 | >= 0.75 each |
| Overflow precision / recall per angle | >= 0.75 / >= 0.85 |
| Locked WhatsApp strict matches | >= 4/5 |
| Locked normal/no-bin false overflow | 0 |
| Batch 4–8 classifier p95 | < 50 ms |
| Automated tests | all pass |

Passing these gates validates the safety mitigation on current fixtures. It
does not constitute production promotion because the state labels remain
synthetic/weak and no target-camera event sequence exists.

## Loop 2 — conditional visibility/outside-ring model

Run only when Loop 1 fails one or more gates.

### Implementation

1. Introduce explicit canonical sub-regions for the bin opening and surrounding
   outside ring in the camera profile.
2. Add person/foreground overlap as a visibility veto; invalid opening
   visibility returns `unknown`.
3. If reviewed target masks are available, train a small bin/opening/outside-
   waste segmenter and require persistent outside-ring evidence for overflow.
4. If target masks are unavailable, do not fabricate production evidence.
   Implement only the fail-closed visibility seam, run the diagnostic suite,
   and report the mask/data requirement as the blocking condition.
5. Rerun every Loop-1 evaluation plus alert-level 2-of-3 persistence tests.

### Gates

| Metric | Required |
|---|---:|
| Occluded/missing ROI returned unknown | >= 95% |
| False overflow on locked normal/occluded/no-bin cases | 0 alerts |
| Valid-state coverage after abstention | >= 85% |
| Overflow precision / recall at event level | >= 0.90 / >= 0.85 |
| Normal vs contained-full macro-F1 | >= 0.85 |
| Angle macro-F1 | >= 0.80 each represented angle |
| End-to-end RTX 4050 cycle | < 500 ms, no OOM/backlog |

## Outputs

Loop 1:

```text
runs/state_classifier/multi_angle_mobilenet_v3_small_loop1/
  best.pt
  calibration_report.json
  multi_angle_report.json
  robustness_report.json
  runtime_smoke.json
  whatsapp_replay.json
```

Loop 2, if required:

```text
runs/state_classifier/multi_angle_mobilenet_v3_small_loop2/
  ...
```

Final status must be one of:

- `loop1_passed_log_only`;
- `loop2_passed_log_only`;
- `blocked_target_masks_or_metrics`.

No status permits automatic cleaner-task dispatch until reviewed installed-
camera sequences pass production gates.

## Execution outcome

Loop 1 completed and passed every predeclared gate. Loop 2 was therefore not
run. Final status: **`loop1_passed_log_only`**.

Detailed results are in
`docs/reports/BIN_STATE_MITIGATION_LOOP1_RESULTS_2026-08-19.md`.
