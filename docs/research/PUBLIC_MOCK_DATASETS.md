# Public mock datasets for the three LitterSpot detection pipelines

Research date: 2026-08-18

## Decision summary

No single public dataset is a valid end-to-end benchmark for this fixed indoor-camera system. The most defensible next evaluation is three source-separated benchmarks plus a smaller project-owned fusion set:

1. **Bin and overflow:** use StreetView-Waste as the strongest external overflow benchmark, subject to its data agreement, and add TACO/MJU-Waste for litter shape diversity. It cannot replace images from the installed indoor cameras.
2. **Floor litter and spills:** use the CC BY 4.0 stagnant-water/wet-surface set immediately; request terms for the PIAP tea/coffee data because it is the closest match to F&B spills. Use TACO/MJU-Waste for solid litter and clean project-owned floors for false-positive control.
3. **People count:** use QUT SAIVT-BuildingMonitoring and CAVIAR first. Both are fixed indoor-camera data with redistribution-friendly share-alike terms. Do not use IndoorCrowd: its license explicitly prohibits surveillance.

The recommended first expansion is **300 independently labelled stills: 100 per pipeline**, followed by 60 project-owned multi-event frames for fusion and alert-debouncing tests. Public pixels should normally live in an ignored local cache; the repository should hold source manifests, checksums, attribution, expected labels, and download instructions.

## Source comparison

| Pipeline | Dataset | What it contributes | Approximate scale and annotations | Access / license conclusion | RTX 4050 6 GB practicality |
|---|---|---|---|---|---|
| Bin / overflow | [StreetView-Waste](https://streetview-waste.di.ubi.pt/) ([official repository](https://github.com/DiogoJPaulo/StreetView-Waste)) | Best direct external match: container detection plus litter/overflow around containers | 36,478 fisheye images; 71,170 container boxes over seven types; overflow subset has 7,230 images and 5,149 instance masks | Access is managed through a GDPR-oriented data-license agreement. **Download locally only; do not redistribute.** The repository's MIT license does not override the dataset agreement. | Evaluate a 100–500-image sample. Nano/small YOLO detection or segmentation at 640 px with AMP and batch 1–4 is realistic; full-dataset training is unnecessary and domain-shifted. |
| Bin / floor litter | [TACO](https://github.com/pedropro/TACO) ([paper](https://arxiv.org/abs/2003.06975)) | Tiny, deformable, transparent and camouflaged litter; useful solid-litter positives and hard backgrounds | 1,500 images, 4,784 manual instance segmentations, 60 categories in COCO format | Toolkit is MIT; images are retrieved from Flickr/OpenLitterMap and have source-specific free licenses. **Keep downloader/source IDs; redistribute only after per-image license and attribution verification.** | Small and easy to sample or fine-tune. It is not an overflow-state or liquid-spill dataset. |
| Bin / floor litter | [MJU-Waste](https://github.com/realwecan/mju-waste) | Indoor/outdoor waste instances and scale diversity | 2,475 RGB-D image pairs; train/val/test splits; VOC and COCO instance annotations | Official repository is MIT-labelled and links the image bundle. The safest default is downloader/hash only until the license scope over the hosted pixel bundle is confirmed. | Very practical; use RGB alone. It is not labelled for bin fullness or liquids. |
| Bin / overflow | [waste-bin-fill-level-detect2](https://universe.roboflow.com/charuka-edirisinghe/waste-bin-fill-level-detect2-lxsf4-mple9) | Quick state-classification sanity checks | 469 images; empty, half-full, full and overflowing detection classes | Publisher page declares CC BY 4.0 but gives no provenance or collection description. Treat as **secondary evaluation only**, and audit source provenance before redistribution or training. | Trivial to run; too small and opaque to be the primary benchmark. |
| Floor spill | [Dataset of Stagnant Water and Wet Surface](https://data.mendeley.com/datasets/y6zyrnxbfm/4) | Best clearly licensed wet-floor surrogate; reflections and muddy/wet confusion | 1,976 RGB images at 256×256; YOLO labels for `water` and `wet surface`; top/side views and varied daylight | **CC BY 4.0. Redistributable with attribution.** It still lacks coffee, sauce and food residue. | Trivial for evaluation and lightweight detector training. Resolution/domain are weaker than the project's CCTV frames. |
| Floor spill | [PIAP liquid-spill dataset paper](https://mgv.sggw.edu.pl/article/download/9817/8722/14851) ([official data bundle](https://cloud.piap.pl/index.php/s/ApiXNzt4ZUUSRks)) | Closest public source to the requested F&B case: tea and coffee on floors | 29 roughly 10-second Full-HD, 30 fps videos; every tenth frame retained; boxes, polygon masks, area, substance and floor-surface attributes; epoxy and terracotta floors under natural/artificial light | The paper provides a public bundle but no explicit dataset license. **Local evaluation only after requesting/confirming terms; do not commit or use commercially yet.** | Sampling is easy. The paper's Mask R-CNN R50 setup used a 12 GB RTX 4090 and found a 4 GB RTX 3050 limiting; use a smaller segmenter, 640 px, AMP, and batch 1–2 on 6 GB. |
| Floor spill | [SynSpill](https://github.com/eternal-f1ame/SynSpill) ([project page](https://synspill.vercel.app/)) | Synthetic industrial spills with automatically generated masks; useful for rare shapes and domain augmentation | 2,000 generated images in the paper/project; repository release describes generated images, binary masks, boxes and scene metadata | Repository says MIT, but the generated data depends on generative-model/source-asset terms. Retain the license and audit provenance before redistributing a material subset. Use as augmentation, not ground truth for real CCTV accuracy. | Lightweight detector training is feasible. Synthetic-to-real shift must be measured on project-owned frames. |
| Floor spill | [Exylos table-spill cleanup](https://huggingface.co/datasets/ExylosAi/table_spill_cleanup_bimanual_rgbd_segmentation_poses) | Temporal partial-cleaning, occlusion by cup/sponge, multiple views and exact `liquid_spill` masks | 5 synthetic episodes, 6,736 frames, seven RGB streams and four segmentation/depth streams | **Apache 2.0. Redistributable with required notice.** Synthetic tabletop data is a strong domain mismatch; sample sparsely to prevent adjacent-frame leakage. | Easy to sample; useful for state-transition tests, not as a floor-spill accuracy benchmark. |
| Floor hard negatives | [MVTec AD](https://www.mvtec.com/research-teaching/datasets/mvtec-ad) | Texture anomaly and look-alike negatives on carpet, tile and wood | More than 5,000 high-resolution images in 15 categories, with pixel-precise anomaly masks | CC BY-NC-SA 4.0 and explicitly non-commercial. **Do not use for a business/commercial prototype without permission.** | Small subsets are easy, but its defects are not F&B spills. |
| People count | [QUT SAIVT-BuildingMonitoring](https://research.qut.edu.au/saivt/databases/saivt-buildingmonitoring/) | Best legally usable fixed-building source: multiple cameras, ROI, perspective and day variation | 12 fixed cameras over a workday; annotated two-hour section for each; 120 one-minute samples per camera; person centres, polygon ROI and perspective maps; some gate/direction labels | CC BY-SA 3.0 Australia. **Redistributable with attribution and share-alike compliance.** Prefer a small attributed derived subset plus a manifest. | Inference is easy; downloads (about 8.6 GB annotated / 29.6 GB full day) are the constraint. Nano-detector fine-tuning is realistic. |
| People count | [CAVIAR](https://homepages.inf.ed.ac.uk/rbf/CAVIARDATA1/) | Compact indoor CCTV clips for sparse occupancy, entry/exit, crossing, groups and occlusion | Public 384×288, 25 fps lobby and shopping-centre clips; hand-labelled person/group boxes, identities and activities | Official page states CC BY-SA and requests CAVIAR attribution. **Redistributable with attribution/share-alike.** Important caveat: the official page says some stationary people are not boxed; manually recount occupancy mocks. | Very easy and small. Particularly useful for temporal stability tests. |
| People count | [CUHK Mall](https://staff.ie.cuhk.edu.hk/~ccloy/downloads_mall_dataset.html) | Fixed indoor webcam, perspective and dense occlusion | 2,000 frames at 640×480 and under 2 Hz; over 60,000 exhaustive head-position labels; perspective map/features | Explicitly research-only and non-commercial. **Download locally only; do not redistribute.** | Easy evaluation; denser than the project's expected 4–8 people. |
| People count | [MICC People Counting](https://www.micc.unifi.it/resources/datasets/micc-people-counting/) | Relevant queue/groups sequences around the target count | FLOW: 1,260 frames / 2.8 people average; QUEUE: 918 / 5.48; GROUPS: 1,180 / 7.68; RGB-D and count annotations | Official page gives download/citation but no explicit redistribution license. **Local use only after terms are confirmed.** | Easy and a strong 4–8-person edge set if permission is clarified. |
| People stress | [CrowdHuman](https://www.crowdhuman.org/) | Occlusion and partial-person stress testing | 15,000 train, 4,370 validation and 5,000 test images; about 470,000 train/validation persons with head, visible-body and full-body boxes | Official page provides download/citation but no explicit redistribution grant. **Download-script/manifest only.** It is not fixed-CCTV data. | Sample only; full training is unnecessary. |
| People stress | [JHU-CROWD++](https://www.crowd-counting.com/) | Weather, illumination, blur and extreme density stress tests | 4,372 images, 1.51 million dot/approximate-box annotations, image/head-level attributes | Terms must be accepted from the official site; no broad redistribution permission is stated on the public page. **Download locally only.** Density is far beyond the normal target. | Sample only for robustness. |
| People hard negatives | [Open Images V7](https://storage.googleapis.com/openimages/web/factsfigures_v7.html) | Partial people and adversarial backgrounds such as reflections, posters and mannequins | Core release has about 9 million images; dense annotations on 1.9 million; annotations include boxes, masks, points and labels | Google annotations are CC BY 4.0. Image copyrights/licenses are per-image and must be verified. **Commit manifests and attribution metadata by default, not pixels.** | Filter a small indoor subset; do not download or train on the full release. |
| People count | [IndoorCrowd](https://huggingface.co/datasets/sebnae/IndoorCrowd) | Technically an excellent fixed-indoor 4–17-person match | 31 videos, 9,913 frames, boxes and human-corrected masks; 2,552 tracking frames; 5.9 GB | Fair non-commercial research license **explicitly prohibits surveillance and re-identification**. **Reject for this camera-monitoring product unless the owner grants separate permission.** | Its published nano-model results support hardware feasibility, but do not change the usage prohibition. |

## Recommended 300-still expansion

### 1. Bin presence and overflow: 100 stills

| Allocation | Count | Purpose |
|---|---:|---|
| StreetView-Waste, after agreement | 35 | 15 normal containers, 10 contained-full, 10 genuine surrounding overflow; include fisheye, shadows, occlusion and multiple bins |
| TACO / MJU-Waste | 20 | Small wrappers, bottles, bags, cardboard and amorphous solid litter at varied scales |
| CC BY Roboflow fill-level set, after provenance review | 10 | Empty/half/full/overflow state sanity checks only |
| Project-owned current cameras | 35 | Fixed-ROI truth: 10 normal/empty, 10 full-contained, 8 waste above rim or on top, 7 bags/boxes beside a normal bin that must **not** become overflow |

Mandatory edge tags: `bin_absent`, `bin_partially_occluded`, `multiple_bins`, `lid_closed`, `object_on_lid`, `contained_full`, `above_rim`, `surrounding_waste`, `adjacent_bag_not_overflow`, `camera_shift_small`, `bin_shift_small`, `glare`, `shadow`, `blur`, `night`, `person_in_front`, `lookalike_container`.

### 2. Floor litter and F&B spills: 100 stills

| Allocation | Count | Purpose |
|---|---:|---|
| Stagnant-water/wet-surface CC BY set | 25 | Water, wet patch, reflections, mud and varying view angles |
| PIAP tea/coffee, after terms | 20 | Actual beverage spill shapes on tile/epoxy; select by source video, not adjacent random frames |
| TACO / MJU-Waste | 20 | Solid litter: wrapper, cup, bottle, plastic bag, paper/cardboard, large rubbish bag |
| SynSpill / Exylos | 10 | Rare shapes, partial cleanup and object occlusion; mark `synthetic=true` |
| Project-owned current cameras | 25 | 15 clean hard negatives plus 10 staged, safely removable water/coffee-like and food-residue cases on the actual floor |

Mandatory edge tags: `clean_floor`, `solid_litter`, `food_solid`, `clear_liquid`, `dark_beverage`, `sauce_or_residue`, `old_stain`, `reflection`, `shadow`, `tile_grout`, `wet_mop_mark`, `transparent_plastic`, `spill_under_object`, `spill_under_feet`, `roi_edge`, `partially_cleaned`, `mixed_spill_litter`, `small_distant`, `low_contrast`.

### 3. People population: 100 stills

| Allocation | Count | Purpose |
|---|---:|---|
| QUT SAIVT fixed-building cameras | 40 | Empty/sparse/busy periods, multiple views, ROI and perspective changes |
| CAVIAR, manually recounted | 24 | Sparse occupancy, crossing, groups, stationary people, entry/exit and occlusion |
| MICC, only after terms | 16 | Queue and clustered-group cases close to the expected 4–8 people |
| Open Images, individually license-verified | 12 | Partial bodies and hard negatives such as reflections/posters/mannequins |
| Project-owned camera perturbations | 8 | Exact camera view with small movement, blur and lighting changes |

Required count strata: 20 frames with 0 people, 20 with 1–3, 40 with 4–8, and 20 with more than 8. Cross-tag `roi_boundary`, `partial_body`, `seated`, `crouched`, `occluded`, `near_far_scale`, `static_queue`, `group_cluster`, `entry_exit`, `motion_blur`, `reflection`, `poster`, `mannequin`, `duplicate_frame`, and `camera_shift`.

## Fusion and temporal edge cases

After each specialist pipeline passes independently, add 60 project-owned frames or short clips that exercise integration rather than retraining:

- 10 completely clean frames: no task should be created.
- 8 overflow-only, 8 floor-hazard-only and 8 occupancy-only cases.
- 6 overflow plus surrounding litter, 6 spill plus people walking nearby, 4 all-three-event cases.
- 5 frames where a cleaner or passer-by temporarily occludes the incident.
- 5 repeated 10-second samples of one unchanged incident to verify deduplication and alert persistence.

Keep the event definitions separate. Waste around a bin may support `bin_overflow=true` and `floor_litter=true`; it should not be forced into only one label. Occupancy is always a count in the configured camera ROI, not a vague `crowded` classification.

## Split and labelling rules

Adjacent frames from one clip are not independent. Split by **source video, physical location and capture session**, then sample frames. Otherwise the benchmark will overstate generalization.

Every mock record should include at least:

```json
{
  "sampleId": "source-scene-frame",
  "pipeline": "bin|floor|occupancy|fusion",
  "sourceUrl": "https://...",
  "sourceLicense": "...",
  "attribution": "...",
  "redistributable": false,
  "captureGroup": "video-or-location-id",
  "timestampSeconds": 0.0,
  "synthetic": false,
  "expected": {
    "binPresent": true,
    "binState": "normal|contained_full|overflow|unknown",
    "floorHazards": ["litter|spill"],
    "peopleCount": 0
  },
  "edgeTags": ["occluded", "reflection"]
}
```

Use human-reviewed boxes/masks/counts when available. Dataset-provided auto-labels are not sufficient ground truth without a documented quality audit. For CAVIAR, manually recount every selected occupancy frame because stationary people can be unboxed.

## Evaluation gates

Report independent results before fusion:

- **Bin state:** per-state precision/recall/F1; overflow false positives on adjacent bags and objects-on-lid; ROI localization success.
- **Floor hazard:** litter and spill precision/recall/F1 separately; mask IoU if segmentation exists; false positives on reflections, grout, stains and shadows.
- **Occupancy:** MAE, exact-count accuracy, within-one accuracy, and error by count stratum/occlusion tag.
- **Temporal behaviour:** event start delay, missed-event duration, duplicate alerts, state flicker and false alerts per camera-hour.
- **System:** per-module and fused latency, peak VRAM, error/timeout rate and stored diagnostic evidence.

For this prototype, do not treat non-empty JSON as success. A useful initial gate is zero task creation on clean hard negatives, occupancy MAE no worse than 1 in the 4–8 band, and independently reviewed recall/precision thresholds for each alert type. Final thresholds should be selected from the cost of false cleaner dispatches versus missed incidents.

## Redistribution policy for this repository

| Status | Sources | Repository treatment |
|---|---|---|
| May redistribute with obligations | QUT SAIVT (CC BY-SA 3.0 AU), CAVIAR (CC BY-SA), Mendeley wet-surface (CC BY 4.0), Exylos (Apache 2.0) | Include only a small purposeful subset, license/notice, attribution, original URL, checksum and any share-alike requirements. |
| Verify license scope/provenance first | MJU-Waste, SynSpill, Roboflow fill-level data, individual TACO/Open Images assets | Default to source manifest/download script. Commit pixels only after a per-asset audit is recorded. |
| Download-only / local cache | StreetView-Waste, PIAP liquid, CUHK Mall, MICC, CrowdHuman, JHU-CROWD++ | Do not commit pixels. Record access instructions, source, checksum and local expected labels. |
| Do not use for this product | IndoorCrowd | License prohibits surveillance; seek separate permission or omit. |
| Non-commercial only | MVTec AD | Omit from a business prototype unless written permission is obtained. |

This is an engineering license triage, not legal advice. If LitterSpot will be commercialized, review every training/evaluation source and downstream model license before release.

## Key primary sources

- StreetView-Waste official [dataset page](https://streetview-waste.di.ubi.pt/) and [repository](https://github.com/DiogoJPaulo/StreetView-Waste).
- TACO official [repository/toolkit](https://github.com/pedropro/TACO) and [dataset paper](https://arxiv.org/abs/2003.06975).
- MJU-Waste official [repository](https://github.com/realwecan/mju-waste).
- Mendeley [stagnant-water/wet-surface dataset](https://data.mendeley.com/datasets/y6zyrnxbfm/4).
- PIAP [liquid detection paper](https://mgv.sggw.edu.pl/article/download/9817/8722/14851) and [dataset bundle](https://cloud.piap.pl/index.php/s/ApiXNzt4ZUUSRks).
- SynSpill official [repository](https://github.com/eternal-f1ame/SynSpill) and [project page](https://synspill.vercel.app/).
- QUT [SAIVT-BuildingMonitoring](https://research.qut.edu.au/saivt/databases/saivt-buildingmonitoring/).
- EC CAVIAR [test scenarios and terms](https://homepages.inf.ed.ac.uk/rbf/CAVIARDATA1/).
- CUHK [Mall Dataset](https://staff.ie.cuhk.edu.hk/~ccloy/downloads_mall_dataset.html).
- CrowdHuman [official dataset page](https://www.crowdhuman.org/) and JHU-CROWD++ [official page](https://www.crowd-counting.com/).
- Google [Open Images V7 facts and licensing](https://storage.googleapis.com/openimages/web/factsfigures_v7.html).
- IndoorCrowd [official project page](https://sheepseb.github.io/IndoorCrowd/) and [gated dataset card/license](https://huggingface.co/datasets/sebnae/IndoorCrowd).
