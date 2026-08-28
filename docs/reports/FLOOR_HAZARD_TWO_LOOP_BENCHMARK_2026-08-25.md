# Floor-hazard two-loop benchmark

Date: 2026-08-25

## Dataset construction

The auditable datasets are in `dataset/floor_hazards/loop1` and `dataset/floor_hazards/loop2`.

- Local litter polygons: 67 train, 8 validation, 20 test images from the admitted specialist floor-rubbish set.
- Public wet-surface source: 1,400 train, 256 validation, 319 test images. Its box labels are converted to rectangular spill polygons for a bootstrap segmentation run.
- Loop 1 total: 2,070 images.
- Loop 2 total: 2,539 images; litter train images are repeated 8× only in training to reduce spill-source dominance. Validation and test sets are unchanged.

The generated manifests record source, split, class, and the limitation that the public spill source is not fixed-camera theme-park evidence.

## Controlled runs

Both runs intentionally use the same small demonstration budget: YOLO11n-seg, one epoch, 512px, 10% train fraction, batch 4. They are smoke benchmarks for the pipeline, not production training.

| Run | Box mAP50 | Box mAP50-95 | Mask mAP50 | Mask mAP50-95 | Litter mask mAP50 | Spill mask mAP50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Loop 1 | 0.0154 | 0.0060 | 0.0094 | 0.0040 | 0.0071 | 0.0009 |
| Loop 2 | 0.0398 | 0.0229 | 0.0383 | 0.0247 | 0.0487 | 0.0008 |

Loop 2 improves the aggregate and litter score, but spill remains effectively unlearned. This is expected from the domain mismatch and pseudo-mask construction, and it is the immediate mitigation priority.

## Artifacts

- Loop 1 weights: `runs/segment/ml-training/floor_hazards/runs/loop1_yolo11n_seg-3/weights/best.pt`
- Loop 2 weights: `runs/segment/ml-training/floor_hazards/runs/loop2_yolo11n_seg/weights/best.pt`
- Metrics: `artifacts/floor_hazards/loop1_test_metrics.json` and `artifacts/floor_hazards/loop2_test_metrics.json`

## Decision

Keep the model in prototype/evidence mode. The runtime ROI, exclusion polygons, temporal confirmation, and fail-closed registration gate are usable now. Before dispatch or automatic replacement recommendations, add real fixed-camera spill positives, clean floor negatives, and a site-held-out test set, then retrain for multiple epochs and recalibrate thresholds against false-dispatch cost.
