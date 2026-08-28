# Floor-hazard datasets and fixed-camera bin enrollment

Audit date: 2026-08-25
Scope: new public evidence for floor litter/spills, a mock-scene catalogue, and
the practical value and limit of camera registration for bin state.

## Decision

Camera registration is the highest-return **immediate** correction for the
current false-bin and false-overflow behaviour.  It turns detection from
“search the whole scene for something bin-like” into “evaluate this known
physical bin and its known rim/ring.”  It can remove chair/box false bins and
make `unknown` the safe answer after camera movement or occlusion, without
retraining.

It cannot, by itself, learn whether visible material is a contained full bin,
an item on a lid, or waste truly crossing the rim.  That is a visual semantic
question.  It still needs a small, target-camera-labelled state set to
calibrate/validate an alert, and masks/labels if an explicit rim/ring segmenter
is wanted.

## Already-covered sources deliberately excluded

This is not a re-listing of sources already in LitterSpot research or training
notes: TACO, MJU-Waste, pLitterStreet, RoLID-11K, UAVVaste, Mendeley Stagnant
Water/Wet Surface, Figshare road wet/dry, PIAP tea/coffee, PHELE, SynSpill,
Exylos, StreetView-Waste, and the earlier 49-image Roboflow spill project are
excluded.  Their prior use or evaluation status is documented in
[`PUBLIC_MOCK_DATASETS.md`](PUBLIC_MOCK_DATASETS.md) and
[`BIN_PLACEMENT_HELDOUT_DATASET_GAP_AUDIT_2026-08-25.md`](BIN_PLACEMENT_HELDOUT_DATASET_GAP_AUDIT_2026-08-25.md).

## Newly identified sources

| Source | Verified source facts | Suitable use | Admission decision |
| --- | --- | --- | --- |
| [Hazards&Robots v3.1](https://zenodo.org/records/7729764) | Official IDSIA Zenodo record; **CC BY 4.0**; 324,408 real 512x512 RGB corridor frames: 145,470 normal and 178,938 anomalous frames in 20 classes.  Publisher supplies `training_set`, `training_mixed_set`, `validation_set`, `test_set`, metadata and checksums.  The authors describe real robot capture with reflection, lighting and surrounding variation; metadata keeps recording/location/illumination/anomaly information. | The best new source for **clean-floor normals**, temporal event episodes, and look-alikes/edge conditions: water puddles, debris, boxes, foam, sawdust, screws, cellophane, cables, people and clutter.  It supports a floor-ROI anomaly/presence gate and hard-negative evaluation. | **Admit for source-separated normal/edge evaluation and optional auxiliary anomaly training.** It has event/frame labels, not litter or spill masks: never score it as litter/spill segmentation AP and never use it as pixel-mask truth. |
| [PlastOPol](https://doi.org/10.5281/zenodo.5829155) | University of Campinas/Wageningen-associated dataset.  The authors state **CC BY 4.0**, 2,418 real in-context images, 5,300 one-class `litter` instances, and rectangular boxes `(x1, y1, width, height)`.  Images originate from Marine Debris Tracker; the publisher provides the Zenodo archive.  No publisher train/validation/test split is stated. | Additional solid-litter proposal training/evaluation: varied small/large litter in context, useful before target-camera fine-tuning. | **Conditional admit.** First preserve the Zenodo version/checksum and inspect metadata for location/capture sessions.  Split by source location/session (or conservatively by perceptual cluster), not a random image split.  It is outdoors and does not contain liquid or indoor tile/gloss conditions. |
| [FLOBOT Perception Dataset](https://lcas.github.io/FLOBOT/) | The official L-CAS page publishes real airport, warehouse and supermarket recordings, including floor-facing RGB-D/stereo data for dirt/object detection and linked annotated archives.  Its public page does **not** state a dataset licence. | The closest newly found real public-setting source for qualitative inspection of supermarket floor viewpoint, dirt/object scenes, and normal operational clutter. | **Rights-blocked.** Do not download/train/redistribute until L-CAS gives an explicit data-use licence.  It is a useful request lead, not an admitted dataset. |
| [Wet floor v1](https://universe.roboflow.com/aksh-wlpmt/wet-floor-arkyd/dataset/1) | Publisher page declares **CC BY 4.0**, one `wet floor` object-detection dataset, 1,831 images: 1,099 train / 366 validation / 366 test, with YOLO/COCO/VOC export.  It declares no augmentation.  It does not publish collection provenance, liquid type, camera context, per-class count, or a source manifest. | A potential quick *secondary* wet-floor experiment after visual and rights audit. | **Quarantine.** The page licence is necessary but is not enough provenance for a deployment model.  Do not mix it with the evaluation split or claim general spill accuracy.  Inspect all images and obtain source provenance before any training use. |

### What this means for spill training

There is still no newly found, well-provenanced, RGB fixed-CCTV dataset with
pixel masks for real coffee, sauce, water and oil on glossy food-court floors.
That is an honest data gap, not a search failure that a larger generic dataset
can hide.  Use Hazards&Robots to reduce false alarms on ordinary floors and
edge hazards; keep real-spill performance qualified only by a locked
target-camera set.  If the product needs reliable transparent-liquid recall,
consider a thermal/depth camera as a hardware path, not a substitute RGB
dataset.

Primary evidence: the [IDSIA/Zenodo record](https://zenodo.org/records/7729764)
and its [official repository](https://github.com/idsia-robotics/hazard-detection)
for Hazards&Robots; the [publisher's PlastOPol record](https://doi.org/10.5281/zenodo.5829155)
and [authors' data description](https://doi.org/10.3390/s22020548); the
[official FLOBOT page](https://lcas.github.io/FLOBOT/); and the
[publisher's Wet floor record](https://universe.roboflow.com/aksh-wlpmt/wet-floor-arkyd/dataset/1).

## Mock-data catalogue: real operational scenes

Each scene should be captured as a short 20–40 second clip, with independent
clips/sessions kept together in train, validation or test.  Record the floor
polygon, hazard masks/boxes when feasible, `clean|litter|spill|mixed|unknown`,
lighting, floor material, confidence, and whether staff cleaned it.  Synthetic
composites may exercise plumbing, but cannot count toward real-camera metrics.

| Class | Required scenes | Expected result |
| --- | --- | --- |
| **Positive: solid litter** | wrapper/napkin, bottle/can, takeaway cup, straw/cutlery, food scraps, plastic bag, tissue, cardboard; small/distant and near/large instances; one item and piles; beside-bin and far-from-bin placements | `floor_litter`; separate components where visually separable.  Litter beside a normal bin is still litter, not automatically overflow. |
| **Positive: spill** | clear water, dark coffee/tea, bright drink, sauce/grease/food residue; fresh and partly dried; small puddle, thin trail and large irregular pool; spill with/without a cup; spill partially hidden by table/chair/foot | `floor_spill` only when a real liquid/residue hazard is visible.  Preserve a before/after-cleaning clip and label uncertainty when a boundary is not visible. |
| **Normal clean** | dry tile, polished/glossy tile, matte concrete, grout, floor joins, drain, doormat edge; daylight/night lighting; empty and busy scene; normal bin and no bin | no hazard.  These negatives are as important as positives because reflections and floor texture currently cause false alarms. |
| **Hard negative: looks wet** | reflections from glass/window/LED, shiny polished tiles, sun patch, shadow, dark tile, old stain/discolouration, wet-mop mark, cleaning sign without an active spill, damp-but-safe entrance mat | no active spill (or `unknown` only if a reviewer genuinely cannot decide). |
| **Hard negative: looks like litter** | printed floor graphic, grout chips, leaves outside the walkable ROI, cable/rope, chair/table legs, shopping receipt behind glass, bag carried by person, bin liner visible inside bin, food on a table | no floor litter unless the object is actually on the walkable floor polygon. |
| **Hard positive / fusion** | litter around a full bin, litter plus spill, a person standing over a spill, a cleaner/mop temporarily hiding a litter event, hazard at ROI edge, two hazards at once | keep litter, spill and bin state as separate labels; temporal policy must avoid both missed persistent events and duplicate tasks. |

Minimal useful local target set: 15 clean clips across lighting/floor finishes,
10 litter events, 10 spill/residue events, and 15 deliberately chosen
look-alike clips.  That is only 50 event-level reviews, not thousands of
manually drawn frames.  Extract frames around each event only after choosing a
session-based split.

## Fixed-camera bin enrollment

### What to capture once per camera/bin

1. **Camera baseline:** camera ID, resolution, lens/distortion correction,
   a clean reference frame for each material lighting regime (day/night/indoor
   lights), and 4–8 stable background anchor points around—not on—the bin.
2. **Physical-bin geometry:** immutable `binId`; outer-bin polygon; rim/opening
   polygon or rim line; lid/slot polygon; padded crop; and a ground-level
   **outside ring** (for example a 10–30 cm equivalent band after perspective
   calibration) that excludes the bin interior.
3. **Operational context:** walkable-floor polygon, adjacent table/chair/cart
   exclusion zones, expected bin type/lid state, and whether this camera is
   permitted to make state decisions for that bin.
4. **Quality/visibility rules:** a minimum alignment score, blur/exposure
   limits, a person/foreground overlap threshold for the rim, and a rule that
   low visibility returns `unknown` rather than a guessed state.
5. **Optional measurement calibration:** four floor-plane points/homography if
   component area or distance to rim must be measured in real units.  This is
   not needed merely to crop the bin, but it makes the outside ring consistent
   when the bin is nearer/farther in the image.

The enrollment UI can therefore be a one-time workflow: choose camera,
click/trace bin body, trace its opening and outside ring, click anchors, save
a clean reference.  It is per **bin/camera**, not per image/frame.  Re-enrol
only after a camera move, bin relocation/replacement, or material layout change.

### Runtime decision after enrollment

```text
frame -> align to reference using anchors / bounded affine or ECC transform
      -> alignment or rim visibility invalid: unknown, no alert
      -> registered bin crop: estimate presence and contained fullness
      -> outside ring: detect/segment candidate waste
      -> overflow candidate only if rim/ring evidence is present
      -> require two valid positive samples out of three before task creation
```

This directly prevents a chair elsewhere in the scene becoming a bin: it lies
outside every registered bin polygon.  It also prevents stale camera geometry
from being classified as a bin by failing alignment instead of silently using
the old crop.  OpenCV documents [ECC registration](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html)
and [partial affine estimation](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
for the small shifts this step may correct.

### What registration improves without retraining

| Failure | Improvement from enrollment alone |
| --- | --- |
| Chair, box, sign or cart called a bin | Strong: state evaluation never starts outside the registered bin ROI. |
| Camera nudged / crop now points at background | Strong safety improvement: detect alignment failure and return `unknown`. |
| Person/cart hides bin rim | Strong safety improvement: detect overlap/visibility failure and abstain. |
| Adjacent litter mistaken as bin contents | Better: geometry separates interior/opening from the outside ring; but visual classification still needs validation. |
| One-frame flicker | Better: stable physical identity makes two-of-three temporal confirmation meaningful. |

### What still needs data

| Question | Why registration alone cannot answer | Minimum evidence to promote |
| --- | --- | --- |
| Normal vs contained-full | The opening may be visible, but “full” is a visual/operational threshold that varies by bin and camera angle. | Target-camera crops of normal and contained-full bins across lighting; label by event/session. |
| Object on closed lid vs overflow | The registered lid zone localizes the object but does not identify its relationship to the bin or whether it is waste. | Labelled target examples of lid objects, bags, trays and genuine overflow. |
| Waste crossing rim / outside-bin overflow | The ring defines *where* proof must appear, but RGB still has to recognize waste versus shadow/reflection/floor texture. | Target masks or reviewed boxes for bin body/rim and outside waste, plus hard negatives. |
| New bin design / moved bin | A profile cannot generalize to an unregistered physical container. | Enroll the new bin; use a general localizer only as a validator/fallback. |
| Occluded or poor-quality view | Missing pixels cannot be reconstructed reliably by a classifier. | Do not train a guess: return `unknown`; collect a clear view later. |

External public data remains useful for pretraining a waste/litter proposal
model, but it cannot calibrate the installed camera's rim semantics.  The
minimal local effort is event-level review: one representative thumbnail per
normal/full/overflow/lid-object/adjacent-bag event, with the system retaining
the surrounding clip.  Label a small, session-separated set first; only add
pixel masks if the geometry/ring gate still fails.

## Recommended sequence

1. Implement enrollment and the fail-closed visibility/alignment gate now; it
   improves safety without a training run.
2. Add Hazards&Robots as an external locked hard-negative/temporal benchmark
   and PlastOPol as source-separated litter training/validation only after its
   group audit.
3. Create the 50-event local floor suite and a small per-bin state-event suite.
4. Train/validate a floor segmenter and bin/ring classifier separately; do not
   claim a combined score until the same held-out target-camera events contain
   both tasks.
