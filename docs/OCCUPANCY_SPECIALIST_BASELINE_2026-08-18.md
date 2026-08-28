# Occupancy specialist baseline — 2026-08-18

## Outcome

The compact occupancy specialist is immediately viable for the prototype. On
41 locked mock cases it produced a count inside the provisional reviewed range
for **34/41 cases (82.9%)**, with no complete miss in the 24 cases that require
at least one person. Steady-state RTX 4050 latency was **36.3 ms mean, 31.2 ms
median, and 68.2 ms p95** after a one-time 2.24-second CUDA/model warm-up.

The prior Qwen2.5-VL-3B evaluation averaged 18.77 seconds per frame. The compact
detector is therefore about **517 times faster by mean latency** for the closed
person-counting task. This is why the smaller model is better here: it solves a
single trained detection problem and emits boxes directly, instead of decoding
an open-ended textual scene description.

Full per-case evidence and input/output logs are under
`artifacts/specialist-evaluations/20260818Toccupancy-yolo11n-baseline-v3/`:

- `cases.jsonl`: one durable record per input, including SHA-256, expected
  range, predicted boxes/confidences, latency, and pass/fail;
- `results.json`: machine-readable aggregate and per-case results;
- `report.md`: review table;
- `run.log`: chronological execution log.

The checkpoint is local-only at
`models/production/occupancy_yolo11n.pt` (5,613,764 bytes, SHA-256
`0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`).
It is registered as an **evaluation** baseline, not a promoted production
model. Ultralytics licensing must be reviewed before commercial deployment.

## Failure analysis

| Failure family | Cases | Finding | Mitigation |
|---|---:|---|---|
| Outside-zone/reflection overcount | 5 variants of the green-bin scene | The detector sees two person-shaped appearances while the operational label counts one person in the monitored zone. | Calibrate one normalized occupancy polygon per fixed camera. Zone filtering is now implemented in the occupancy adapter. |
| Motion-blur false positive | 1 black-bin-bags variant | A blurred object was classified as a person at 0.419 confidence. | Require track persistence across 2–3 frames; reject one-frame detections. Tune confidence only on a separate validation set, never on this locked test set. |
| Distant/occluded undercount | 1 Hamburg image | Two of three reviewed people were detected. | Add temporal tracking and validate a small/occluded-person challenger on a separate occupancy validation set. |

The threshold was intentionally left at 0.25. Raising it after examining these
locked failures would leak test evidence into configuration selection. Use
camera-owned validation frames to select the confidence and zone polygon, then
rerun this locked suite once for final comparison.

## WhatsApp case trace with operational tolerance

The evaluator now records both the unchanged reviewed range and a separate
operational acceptance result. With an allowed error of ±1 person:

- five original stills plus 30 derived edge variants: **29/35 exact or in
  range, 35/35 accepted**;
- fifteen sampled video frames: **12/15 exact or in range, 14/15 accepted**.

The one rejected video frame expected zero people but produced three
low-confidence detections (0.300, 0.286, and 0.270) from partial body parts and
person-like background context. Do not expand the tolerance to ±3. Use an
occupancy ROI and temporal track persistence to reject this case.

Detailed tables and JSONL traces are in:

- `artifacts/specialist-evaluations/20260818Toccupancy-yolo11n-whatsapp-trace/`;
- `artifacts/specialist-evaluations/20260818Toccupancy-yolo11n-whatsapp-video-evaluation-v2/`.

The provisional video review labels are versioned in
`mock-data/internvl-evaluation/provisional-expected-video-frames.json` and must
be approved or corrected by the operator before becoming promotion evidence.

## What localization changes

Localization does not make the neural network intrinsically smarter. It adds
known camera geometry after detection:

1. YOLO11n proposes every person-shaped box in the frame.
2. The separately calibrated `occupancyRegion` polygon defines where people
   count operationally; it does not reuse the floor `focusRegion` polygon.
3. Boxes whose center lies outside that polygon are discarded.
4. A tracker confirms that remaining boxes persist across frames.

For bin state, localization happens before inference instead: the fixed bin ROI
is cropped and enlarged to 224×224, so the classifier receives mostly the bin
and its immediate surroundings. For spills/litter, the floor polygon removes
walls, glass, tables, and other irrelevant regions before/after segmentation.
The same word—localization—therefore describes a camera calibration rule, not a
second VLM call.

## Readiness by module

| Module | Runnable now | Training needed | Current decision |
|---|:---:|:---:|---|
| Occupancy | Yes | No for baseline | Use YOLO11n + monitored-zone filtering; add temporal tracking. |
| Bin state | Adapter only | Yes | Collect reviewed crops from each registered fixed bin and train the existing MobileNetV3-Small multi-head classifier. |
| Floor spills/litter | Adapter only | Yes | Label real floor polygons/masks, including clean glossy-floor and shadow negatives, then train a nano segmenter. |
| VLM reviewer | Yes | No | Keep asynchronous and crop-only for uncertain events; never use it as the primary real-time detector. |

The complete specialist backend remains fail-closed because the bin-state and
floor-hazard checkpoints do not yet exist. Enabling a partially random or
untrained backend would make the integrated result look complete while making
its alerts untrustworthy.

## Next implementation gate

1. Draw the occupancy polygon and fixed bin ROI for each real camera.
2. Collect independent, reviewed camera frames outside `mock-data/`.
3. Train bin state first; its ROI crop needs only state labels, not object boxes.
4. Label real spill/litter masks and train the floor segmenter.
5. Add ByteTrack-style persistence, fuse the three results, and replay the
   locked overall suite without adjusting thresholds from its failures.
