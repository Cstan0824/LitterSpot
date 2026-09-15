# ML research progress archive

This directory preserves acquisition, dataset preparation, training,
calibration, and evaluation work completed before the final application.
It is historical progress material, not an application dependency.
Files were moved without changing their contents. Old scripts contain their
original paths and are not supported commands from this new location.
Restore their original layout in a separate checkout before resuming a study.

## Original paths

| Original location | Archive location | Purpose |
| --- | --- | --- |
| `ml-training/` | `ml-training/` | Model training, calibration, datasets, and research tests |
| `dataset/` | `dataset/` | Floor-dataset configuration and inspection reports |
| Root `scripts/*.py` | `scripts/` | Research acquisition, evaluation, and data auditing tools |
| `scripts/floor_rubbish_script/` | `scripts/floor_rubbish_script/` | Floor-dataset conversion and validation |
| `mock-data/bin-localizer-regression-v1/` | `mock-data/bin-localizer-regression-v1/` | Earlier localizer regression manifest |
| `mock-data/bin-localizer-regression-production/` | `mock-data/bin-localizer-regression-production/` | Later localizer regression manifest |
| `mock-data/coverage/` | `mock-data/coverage/` | Evaluation coverage planning |
| `mock-data/edge-cases/` | `mock-data/edge-cases/` | Derived edge-case benchmark metadata |
| `mock-data/internvl-evaluation/` | `mock-data/internvl-evaluation/` | VLM comparison and replay expectations |
| `mock-data/public-domain/` | `mock-data/public-domain/` | Evaluation source attribution and manifests |
| `models/internvl3_5_1b.lock.json` | `models/internvl3_5_1b.lock.json` | Historical VLM download identity |
| `runs/floor_rubbish_person_filter/` | `results/floor_rubbish_person_filter/` | Floor/person-filter experiment outputs |
| `config/detection-stability-gates.json` | `config/detection-stability-gates.json` | Historical model and integrated release gates |
| Top-level ML documents and templates under `docs/` | `docs/` | Research plans, evaluations, handoffs, manifests, and labeling templates |
| `docs/research/` | `docs/research/` | Dataset discovery, licensing, and model research notes |
| `docs/reports/` | `docs/reports/` | Historical training and evaluation results |

## Production boundary

Bin-state, bin-localizer, and floor-hazard studies are preserved here. Their
current production artifacts remain at their original runtime paths.
The people detector is a separate COCO model used by the floor pipeline.
The following hashes identify the artifacts protected during this move:

| Production path | SHA-256 |
| --- | --- |
| `runs/state_classifier/multitask_bin_state/production.pt` | `dd2df0022eaa72f6c4f6210d4922e842cf24fa34829518aa89d9f680a5e81553` |
| `models/production/bin_localizer_yolo11n.pt` | `c9ea1568c4c5c5db3220161021c9d7884589ce870c5f550d50336b509f6f62b4` |
| `runs/segment/ml-training/floor_rubbish/runs/theme_park_hazards/yolo26s_seg_v1/weights/best.pt` | `05e94d25e50d05d3aa121102b037f3efa1cccae9cbe9644ce25a91daafcbda56` |
| `yolo26s.pt` | `646f8bc3fe0a656803d95c294f7852321748cb29d13466a1af8862e2db384a1b` |

Root `mock-data/bin-placement-prototype/` remains an automated backend test
fixture. `task-assignment-llm/` remains the production assignment provider.
Neither belongs in this archive. Firebase exports, credentials, operational
media, and migration backups are also outside the archive.
