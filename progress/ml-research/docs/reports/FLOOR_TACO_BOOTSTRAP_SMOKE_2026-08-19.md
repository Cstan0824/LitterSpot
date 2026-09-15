# Floor specialist bootstrap smoke run

Date: 2026-08-19

## Run

- Source: 95 exact-path TACO reviewed images (solid litter only)
- Split: 67 train / 8 validation / 20 test in the specialist manifest
- Model: YOLO11n-Seg, 2,842,998 parameters, 640px, batch 2, RTX 4050
- Training: 5 epochs, AMP enabled, smoke configuration
- Checkpoint: `ml-training/floor_rubbish/runs/theme_park_hazards/yolo11n_seg_floor_taco_smoke_v2/weights/best.pt`
- Dataset preparation report: `dataset/floor_rubbish/prepared_specialist_dataset/preparation-report.json`

## Validation result

The short run completed without CUDA or data-loader failure. The clean v2
specialist split was used (the earlier legacy conversion is not the reported
benchmark). The best validation checkpoint stopped early after four epochs;
its held-out test metrics were:

| Class | Box precision | Box recall | Box mAP50 | Mask precision | Mask recall | Mask mAP50 |
|---|---:|---:|---:|---:|---:|---:|
| floor_litter | 0.007 | 0.231 | 0.048 | 0.009 | 0.295 | 0.068 |

There were no spill examples, so spill metrics are not meaningful and the
checkpoint is **not promoted**. Recall is far below the 0.85 litter gate; this
is an integration/smoke artifact only, not a production detector.

On the untouched 20-image TACO test split, the same checkpoint reached box
precision 0.0073, recall 0.2308, mAP50 0.0480 and mask mAP50 0.0676 (mask
recall 0.2949). The machine-readable result is
`artifacts/specialist-evaluations/20260819-floor-taco-test-v2/report.json`.

As a follow-up, the same split was trained for up to 100 epochs with patience
20. It stopped after 60 epochs without an infrastructure failure (best
validation epoch 42). The best checkpoint improved test precision but still had low recall: box P=0.6729,
R=0.2436, mAP50=0.2549; mask P=0.6729, R=0.2436, mAP50=0.2501. The result is
`artifacts/specialist-evaluations/20260819-floor-taco-test-full-v2/report.json`.
This confirms that more epochs alone do not close the promotion gap.

One truncated Flickr image was excluded during manifest import. The earlier
converter basename fallback was disabled for this run so annotation/image
identity cannot silently leak across TACO batches.

## Next training gate

Add a licensed spill source and clean/hard-negative floor examples, expand the
TACO sample, then run the full 100-epoch configuration. Evaluate on the
untouched source-separated test split and the locked WhatsApp replay before
registering any checkpoint.
