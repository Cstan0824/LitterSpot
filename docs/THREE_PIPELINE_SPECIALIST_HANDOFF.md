# Three-pipeline specialist handoff

## Why this handoff exists

InternVL3.5-1B can now produce structurally valid observations after prompt,
parser, and image-preparation fixes. It is still unsuitable as the primary
real-time detector on the target 6 GiB GPU: five dynamic image tiles took about
40 seconds for one supplied overflow image and emitted duplicate/contradictory
bin candidates. Keep it as an optional ambiguous-event verifier only.

## Current implementation slice

`ai-service/app/specialist_perception.py` owns the replaceable source
interface. The existing InternVL path is a compatibility adapter, and
`ai-service/app/specialist_adapters.py` contains checkpoint-backed adapters for
fixed-ROI bin state, floor-hazard segmentation, and occupancy. The occupancy
adapter also filters detections through the configured monitored-zone polygon,
which removes people and reflections outside the operational area. The full
specialist source is deliberately not selected by the HTTP service until all
three checkpoints are ready. Missing weights leave the adapter degraded
instead of silently falling back to InternVL.

Training data is admitted through
`scripts/audit-specialist-training-data.py`; the locked `mock-data/` benchmark
is rejected by path and checksum. This keeps evaluation evidence independent
from future fine-tuning.

## Replacement map

| Existing seam | Specialist replacement | Input | Required validation |
| --- | --- | --- | --- |
| `BinStateModule` | fixed ROI crop + compact bin-state classifier | one registered bin ROI plus 10-15% context | normal/full/overflow/unknown confusion matrix per camera |
| `FloorHazardModule` | floor-ROI segmentation model | configured floor polygon | litter/spill masks, reflections and glossy-floor negatives |
| `OccupancyModule` | compact person detector + tracker | full camera frame | people-count MAE and count-change accuracy |

For fixed cameras, a bin detector is optional at runtime: the calibrated ROI is
already the physical bin identity. A small model only decides the state inside
that ROI. This is the highest-value first specialist because it removes the
duplicate-bin problem shown by the VLM.

## Implementation order

1. Label 100-200 frames from the real deployment cameras for each registered
   bin state; include bags beside bins, waste above the rim, closed lids, staged
   bags, people blocking bins, and lighting changes.
2. Train/evaluate the bin-state classifier on those ROI crops. Do not promote it
   until overflow recall is at least 90% and precision at least 85%.
3. The off-the-shelf YOLO11n person baseline is installed and measured. Review
   `OCCUPANCY_SPECIALIST_BASELINE_2026-08-18.md`, calibrate a monitored-zone
   polygon per camera, and add tracking for video-level count stability.
4. Label floor masks for litter and food/beverage spills, including reflective
   floors and shadow negatives; train a segmentation model and prioritize spill
   recall >= 95%.
5. Keep the existing fusion contract. Replace one module at a time and replay
   the same mock plus camera-specific evaluation set after each replacement.

## Runtime rule

The modules may run at different intervals after validation. At the current
prototype stage they share one-second configuration, but a real deployment
should schedule the fast occupancy model more often and the expensive verifier
only after a specialist raises an ambiguous event. No module may create a task
directly: fusion creates the confirmed alert, then the task workflow consumes it.
