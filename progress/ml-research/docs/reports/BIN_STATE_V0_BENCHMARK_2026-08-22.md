# Trash-bin state V0 benchmark — 2026-08-22

## Tested version

- Localizer: `bin_localizer_openimages_v0_76/weights/best.pt`
- State model: `multi_angle_mobilenet_v3_small_loop1/best.pt`
- States: `normal`, `full`, `overflow`, `unknown`
- State thresholds: presence 0.10, fullness 0.56, overflow 0.10,
  overflow-fullness floor 0.72
- The WhatsApp fixtures are locked diagnostics and were not used for training
  or threshold selection.

## Benchmark summary

| Benchmark | Scope | Result |
| --- | --- | ---: |
| Synthetic surrogate macro-F1 | 1,512 controlled variants | 98.5% |
| Weak real-public macro-F1 | 126 weakly labelled crops | 20.7% |
| Manual-ROI WhatsApp still accuracy | 5 comparable stills | 100% (5/5) |
| Fixed-ROI WhatsApp video frame accuracy | 9 positive frames | 33.3% (3/9) |
| Fixed-ROI WhatsApp event accuracy | 3 bin events | 33.3% (1/3) |
| Fixed-ROI overflow event recall | 2 overflow events | 0% (0/2) |
| Learned end-to-end state accuracy | localizer then state model, 9 positive frames | 22.2% (2/9) |
| Learned end-to-end overflow recall | 6 overflow frames | 0% (0/6) |

The manual-ROI still score is not representative of the deployed pipeline.
It removes localization errors and contains only five comparable cases.

## Learned localizer → state classifier

| Metric | Result |
| --- | ---: |
| Expected positive frame-bins | 9 |
| Successfully localized | 5 |
| Localizer recall | 55.6% |
| Correct state among localized bins | 2/5 |
| State accuracy given localization | 40.0% |
| End-to-end correct states | 2/9 |
| End-to-end state accuracy | 22.2% |
| End-to-end overflow recall | 0/6 (0%) |
| No-bin negative frames | 6 |
| Frames containing a false bin | 4/6 (66.7%) |
| False-overflow frames | 0/6 (0%) |

## Case trace

| Event | Expected | Localization | State outcome |
| --- | --- | --- | --- |
| Basket with waste above rim | overflow | missed in 3/3 frames | no state result |
| Green closed-lid bin | normal | found in 3/3 frames | normal, unknown, normal |
| Black open bin with topped waste | overflow | found in 2/3 frames | unknown, unknown, missed |
| People-only negative | no bin | false candidates in 2/3 frames | both rejected as unknown |
| Chair/crowd negative | no bin | false candidates in 2/3 frames | both rejected as unknown |

The state presence/rejection head prevented the false localizer candidates
from becoming false overflow alerts. It did not recognize either real overflow
event. The basket event was primarily a localization failure; the black-bin
event was localized but rejected as uncertain state.

## Robustness and latency

- ROI shift ±3% and scale ±5%: 100% same-or-unknown safety.
- Partial occlusion: 95.8% same-or-unknown safety.
- False overflow on controlled normal/unknown occlusions: 0%.
- Runtime adapter synthetic smoke: 144/144 correct.
- Mean state-classifier runtime in the smoke replay: 10.5 ms per crop.

## Decision

This V0 is useful in shadow mode because it fails safely to `unknown`, but it
is not ready to detect operational overflow. The next data work should target
real overflowing basket and black/open-bin sequences, including rim-crossing
waste and object-on-lid negatives. Additional synthetic accuracy or a larger
network would not resolve the measured domain gap by itself.

## Machine-readable artifacts

- `artifacts/state-benchmark-v0-20260822/multi-angle.json`
- `artifacts/state-benchmark-v0-20260822/robustness.json`
- `artifacts/state-benchmark-v0-20260822/whatsapp-stills.json`
- `artifacts/state-benchmark-v0-20260822/whatsapp-video.json`
- `artifacts/state-benchmark-v0-20260822/runtime-smoke.json`
- `artifacts/state-benchmark-v0-20260822/end-to-end.json`
