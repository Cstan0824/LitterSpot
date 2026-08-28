# Bin and occupancy mitigation results

Date: 2026-08-20
Status: **shadow-only; not dispatch-qualified**

## Bin state / overflow

The selected candidate keeps the 940,885-parameter MobileNetV3-Small model and
adds the pinned InternVL3.5-1B model as an optional one-word verifier over each
exact registered bin ROI. MobileNet continues to use its trained 15% padded
crop. A physical bin becomes confirmed overflow after at least two overflow
votes in the latest three samples.

| Diagnostic | Result |
|---|---:|
| Locked overflow video events confirmed | 2/2 |
| Locked strict still bins correct | 5/5 |
| False overflow on locked normal stills | 0/4 |
| Video frame state matches | 7/9 |
| Semantic mean / p95 per ROI | 174.0 / 189.7 ms |
| Occluded-full jitter vote | 1/3 overflow; not confirmed |
| Synthetic normal/unknown false overflow under partial occlusion | 0/24 |

The semantic verifier recovers topped-waste events that the synthetic state
classifier misses, while the fast model retains the green-bin overflow that
InternVL misses. The VLM path is disabled by default and cannot be promoted
until reviewed installed-camera event sequences establish precision, recall,
confirmation delay, and false alerts per camera-hour.

An 8-bin contact-sheet batch was tested and rejected: it took 2.08 seconds and
returned `normal` for every tile, giving 4/8 accuracy. Keep exact-ROI calls;
their measured mean/p95 was 174.0/189.7 ms per bin. For eight bins this is
about 1.4 seconds serially, so the verifier must remain a low-frequency
10-second shadow stage rather than part of the sub-500-ms fast cycle.

## Occupancy

The YOLO11n checkpoint is unchanged. Post-processing now rejects short, wide
top-edge fragments and collapses nested duplicates only when the larger person
box is attached to a side edge. It deliberately keeps tall partial people.

| Diagnostic | Before | Selected candidate |
|---|---:|---:|
| Video frames within +/-1 | 14/15 (93.3%) | 15/15 (100%) |
| Mean range error | 0.33 | 0.20 |
| Video p95 | 64.7 ms | 36.9 ms |
| Frames inside provisional expected range | 12/15 | 12/15 |

The two nominal empty-frame false counts are both one person and come from a
partial edge body/hand scene. This is accepted under the user's +/-1 tolerance,
but the empty-region false-count qualification gate is not proven because the
fixture has only six empty frames and provisional labels.

## Qualification decision

These changes improve the mock and synthetic diagnostics but do not enable
cleaner dispatch. The qualification manifest still lacks reviewed real-camera
events, and spill/litter work is intentionally paused. Keep
`dispatchEligibleOutputEnabled=false`.
