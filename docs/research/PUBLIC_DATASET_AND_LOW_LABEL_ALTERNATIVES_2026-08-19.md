# Public data and low-label alternatives for the three detection facts

## Decision

Do **not** wait for someone to hand-crop and pixel-label every camera frame.  Use
public data to initialise the two waste models, keep the already-validated
COCO-pretrained person detector for population counting, and let the fixed-camera
workflow produce weak labels over time.  Public data can make a useful prototype,
but it cannot fully replace local examples of this site's bin design, floor finish,
lighting, reflections, and F&B spills.

The strongest immediately relevant public option is **StreetView-Waste**, subject
to obtaining its dataset licence agreement.  It is the only verified source found
that contains both container boxes and instance masks for overflow/litter around
containers.  It does *not* label a bin's internal `normal`/`full` state, and it is
not an indoor F&B-camera dataset.  Therefore it should initialise detection, not
be treated as proof that the deployed alert is correct.

## Verified public sources

| Rank | Dataset | Detection facts it can support | Annotations and scale verified at source | Licence/access | Fit and limitation |
| --- | --- | --- | --- | --- | --- |
| 1 | [StreetView-Waste](https://github.com/DiogoJPaulo/StreetView-Waste) | Bin localisation; overflow/litter near bins | 36,478 fisheye images; 71,170 container boxes; 5,149 overflow/litter instance masks. Its segmentation benchmark has 7,230 frames, including 4,197 positive frames and negatives. | The repository code is MIT, but **the data is separately gated by a GDPR-oriented data-licence agreement**. Obtain and review that agreement before downloading or training. | Closest verified match to bin overflow. Outdoor, vehicle fisheye imagery and municipal containers create a material domain gap from a fixed indoor camera. |
| 2 | [TACO — Trash Annotations in Context](https://github.com/pedropro/TACO) | Litter/trash on floor or ground | The original authors provide reviewed hierarchical litter segmentations in COCO format and a supplied image-download script. | Dataset is [CC BY 4.0](https://github.com/dataset-ninja/taco/blob/main/LICENSE.md); retain attribution. The repository code itself is MIT. | Best broad litter seed set for bags, cans, bottles and wrappers. Most scenes are woods, roads and beaches, not an indoor food court. Avoid its explicitly unreviewed annotation file. |
| 3 | [pLitterStreet](https://github.com/gicait/pLitter) | Ground litter | The official project provides street-level litter RGB images and COCO-style JSON annotations; its [Zenodo record](https://zenodo.org/records/8288500) states that all images are annotated. | Public download, but an explicit dataset-use licence was not verifiable from the official material examined. Treat commercial use as **unresolved** until the Zenodo record/file metadata is confirmed. | Useful complement to TACO for ground perspective and small plastic litter; outdoor-only. |
| 4 | [Liquid Spill (Roboflow Universe)](https://universe.roboflow.com/vision-fz36p/liquid-spill-danhp) | Spill candidate detector | 49 images, one `Spill` object-detection class. | CC BY 4.0 according to its project page. | The only directly relevant openly downloadable RGB spill set found, but much too small and has no supplied provenance/scene description. Use only as a small supplemental seed or smoke-test set—not as the primary model source. |
| 5 | [Exylos table-spill-cleanup](https://huggingface.co/datasets/ExylosAi/table_spill_cleanup_bimanual_rgbd_segmentation_poses) | Spill segmentation pretraining/pipeline test | 6,736 frames from five tabletop clean-up episodes, RGB views and PNG masks; class value `4` denotes `liquid_spill`. | Apache-2.0. | Strong pixel-mask format, but controlled tabletop robotics—not a floor, restaurant, or CCTV domain. Do not use it to claim production spill accuracy. |
| 6 | [ZeroWaste](https://ai.bu.edu/zerowaste/) | Generic waste detection/segmentation research only | The official project exposes the 4,503-image labelled `ZeroWaste-f` subset, framed for detection and segmentation. | CC BY-NC 4.0. | Industrial recycling-line imagery and non-commercial licence make it a poor fit for this system; exclude it from commercial deployment training. |

### Population counting

No additional dataset is needed for the prototype.  The installed YOLO11n person
detector is COCO-pretrained and the project evaluation already accepted 35/35
still-frame cases within ±1 and 14/15 video samples within ±1.  The official
[COCO site](https://cocodataset.org/index.htm) provides the detection benchmark
and downloads; retain its terms if the detector is ever retrained.  For this
prototype, tune only the confidence/ROI threshold from unlabeled video and retain
the existing ±1 acceptance rule.

## What public data cannot supply

1. **Bin `normal` versus `full`.**  An overflow mask can teach waste *outside*
   a bin, but it does not establish the visual threshold of rubbish visible at the
   top of this exact bin.  No verified open dataset found supplied those three
   labels for fixed-camera indoor bins.
2. **F&B floor spills.**  Transparent water, drinks, oil and food residue depend
   on the floor material, light direction, reflections and camera angle.  The
   verified public spill sources are tiny or the wrong domain.  Treat "missing a
   spill" as an unresolved safety limitation with RGB-only video.
3. **Your alert threshold.**  A public instance mask does not decide when a
   cleaner should be dispatched.  That is a site policy, not a universal visual
   class.

## Recommended implementation: no per-image manual review

### Phase A — establish a public-data prototype

1. Request StreetView-Waste access and record its data licence in the experiment
   manifest.  Fine-tune the floor/overflow segmentation model on its overflow
   masks, then add TACO as a broad litter class.  Keep a held-out split per source;
   never evaluate on training frames.
2. Use the existing `floor_litter` model output as one class.  Do **not** pretend
   that it distinguishes food residue from a wet spill.  Add the 49-image spill
   set only as a low-weight supplemental class and document it as such.
3. Use the bin-localisation model plus the camera's calibrated bin ROI.  Compute
   overflow from segmented waste intersecting a thin band around the bin and
   `full` from the occupied fraction of the bin's opening.  Require a positive
   result in at least 3 of 5 samples (10-second cadence) before alerting.

### Phase B — turn normal operations into weak labels automatically

The existing workflow already begins snapshots when a cleaner accepts a task and
stops them on completion.  It can produce a useful *event-level* training signal
without anyone drawing masks or manually cropping frames:

| Automatic signal | Label to create | Reliability rule |
| --- | --- | --- |
| Frames before an accepted overflow/litter task | `suspected_positive` for that task/ROI | Use only detections persistent across samples; do not call them ground truth. |
| Frames after a cleaner marks the task completed, once the scene is stable | `likely_clean` negative | Require no people in the ROI and stable background for several samples, so cleaning activity is not labelled clean. |
| Repeated alert that disappears without a task, or task rejected by staff | `hard_negative` | Prioritise these automatically for later threshold tuning. |
| A cleaner completes a spill task | `spill_event` (weak positive) | Preserve before/after clips; do not assign a pixel mask automatically. |

This supports a **classification/alert calibration** dataset first: whole fixed
ROI frames labelled `likely_clean`, `suspected_overflow`, or `suspected_litter`.
It avoids crop-by-crop review and is better matched to the deployment camera than
web imagery.  Train a small classifier only after enough event groups exist; keep
the segmentation model as the proposal generator.

### Phase C — minimal, not per-frame, human confirmation (optional)

If any human feedback becomes possible, review only one representative thumbnail
per *alert event*, not each captured frame.  A single `confirmed / false / spill`
choice for an event makes the weak labels substantially safer.  This is the
highest-return human effort: it corrects many nearly identical frames at once.

## Ranked recommendation for LitterSpot

1. **Occupancy:** deploy the current YOLO11n person pipeline now; no new training.
2. **Overflow and litter:** request StreetView-Waste, fine-tune a small YOLO
   segmentation model on overflow masks, then blend TACO ground-litter examples.
   Calibrate the detector with fixed bin and floor ROIs plus temporal persistence.
3. **Spills:** keep it a separate, conservative `possible_spill` alert; use the
   tiny CC-BY seed set for an experiment only.  Do not merge it with litter or
   claim broad F&B-spill coverage until local event clips exist.  A thermal/depth
   sensor would be a separate hardware decision, not a public-data substitute.
4. **Do not train from arbitrary Hugging Face/Kaggle bin-overflow collections.**
   Their origin, labels and licence were not verified here.  Using them could
   introduce legal and evaluation risk without solving the site-domain mismatch.

## Source verification notes

* StreetView-Waste's official repository explicitly documents its container
  detection, tracking, overflow-mask benchmarks, counts and data-licence
  requirement: [README](https://github.com/DiogoJPaulo/StreetView-Waste).
* TACO's original-author repository documents reviewed COCO annotations, its
  downloader and warns that separately published unofficial annotations have not
  been reviewed: [README](https://github.com/pedropro/TACO).
* ZeroWaste's own project page and the authors' dataset description identify the
  labelled subset and its industrial context: [ZeroWaste project](https://ai.bu.edu/zerowaste/).

Research date: 2026-08-19.  Dataset terms can change; re-check them immediately
before downloading or distributing a derived checkpoint.
