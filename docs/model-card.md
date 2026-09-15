# LitterSpot model card

## 1. Purpose

The production inference pipeline uses four local model artifacts. They detect people and contextual objects, localize bins, classify registered-bin state, and segment floor hazards.

## 2. Production artifacts

| Function | Identity | Path | SHA-256 |
| --- | --- | --- | --- |
| People and scene objects | `yolo26s-coco` | `yolo26s.pt` | `646f8bc3fe0a656803d95c294f7852321748cb29d13466a1af8862e2db384a1b` |
| Bin localization | `bin-localizer-yolo11n` | `models/production/bin_localizer_yolo11n.pt` | `c9ea1568c4c5c5db3220161021c9d7884589ce870c5f550d50336b509f6f62b4` |
| Registered-bin state | `multitask-mobilenet-bin-state` | `runs/state_classifier/multitask_bin_state/production.pt` | `dd2df0022eaa72f6c4f6210d4922e842cf24fa34829518aa89d9f680a5e81553` |
| Floor hazards | `floor-hazard-yolo26s-seg-v1` | `runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt` | `05e94d25e50d05d3aa121102b037f3efa1cccae9cbe9644ce25a91daafcbda56` |

## 3. Bin-state classifier

- Architecture: multitask MobileNet classifier.
- Outputs: presence, fullness, and overflow signals normalized to normal, full, overflow, or unknown.
- Thresholds: presence 0.563, fullness 0.34, overflow 0.31.
- Overflow policy: recall-first with a 0.31 presence floor.
- Runtime use: classify registered-bin crops or generic localizer candidates.
- Primary safeguard: a registered Camera uses stable physical-bin polygons and reference comparison rather than trusting full-frame class labels.

## 4. Bin localizer

- Architecture: one-class YOLO11n localizer.
- Class: trash bin.
- Runtime confidence: 0.80.
- Training sources recorded in the registry: Garbage Can Overflow, GBS, and University of Malaya weak-label fine-tuning.
- Generic evaluation recorded in the registry: precision 0.6299, recall 0.5551, mAP50 0.5756, and mAP50–95 0.3642 on 3,035 images.
- Malaysian holdout diagnostic at confidence 0.85: 76% exactly-three, 96% at-least-three, 0.9867 count coverage proxy, and 3.27 mean detections on 100 images.
- Registry status: production-guarded; replacement promotion is blocked.

For registered Cameras, this model runs in shadow mode. It cannot replace registered physical bins or create a stable bin identity.

## 5. Floor-hazard model

- Architecture: YOLO segmentation model.
- Outputs: floor litter and floor spill boxes and polygons.
- Runtime confidence supplied by Node: 0.25.
- Runtime safeguards: walkable-floor crop, centroid containment, minimum floor-mask overlap, and overlap filtering against registered bins and common objects.

The research archive records that historical promotion gates were not uniformly met. The application therefore combines model confidence with spatial and temporal rules rather than presenting raw model output as ground truth.

## 6. People and contextual objects

The COCO detector supplies people count and boxes plus contextual object boxes used to veto likely bin or floor false positives. People observations also contribute to Site analytics and Busy Zone calculations.

## 7. Operational limitations

- Results depend on Camera angle, lighting, occlusion, registration accuracy, and domain similarity.
- Registered-bin classification can return unknown when evidence is blocked or unsafe.
- Generic bin detections are not reliable stable identities.
- Floor hazards outside the configured walkable floor are intentionally ignored.
- Inference occurs on samples, not every source frame.
- Stored confidence is model evidence, not a calibrated probability of required cleanup.

## 8. Hardware

CPU operation is supported and is the default. CUDA may be selected with a numeric `DEVICE` on a Windows or Linux machine with compatible NVIDIA drivers, CUDA-enabled PyTorch, and an available discrete GPU. The launcher falls back to CPU when CUDA is unavailable.

## 9. Reproducibility

The four artifact hashes above are checked during repository verification. Model identity and thresholds also live in `models/model-registry.json`. Experimental training, data, evaluation, and source-rights records remain under `progress/ml-research`.
