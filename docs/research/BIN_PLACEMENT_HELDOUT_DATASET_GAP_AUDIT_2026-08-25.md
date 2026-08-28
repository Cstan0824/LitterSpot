# Bin-placement held-out dataset gap audit

Audit date: 2026-08-25  
Scope: external test data not present in LitterSpot's training or mock manifests  
Method: repository inventory plus primary publisher/repository review; no dataset pixels were downloaded

## Decision

Use a small, locked, source-separated external suite rather than adding another
training corpus. The practical first acquisition is:

1. **CDW-Seg publisher test split** for out-of-domain bin localization and
   contained-waste hard negatives;
2. **RoLID-11K publisher test split**, sampled by source sequence, for small
   floor-litter recall;
3. **PHELE v4 wet-floor subset plus matched non-wet hazards** for indoor
   wet-floor false-positive/recall stress; and
4. **three complete runs from the 2018 Pedestrian Dynamics entrance
   experiment** for occupancy count and temporal-stability stress.

Keep every acquired row `trainingUse=false`, `thresholdSelectionUse=false`, and
`promptSelectionUse=false`. Evaluate a frozen candidate once. Do not move these
images into a training split after seeing failures.

This suite does **not** close the most important state gap. No new source found
in this pass combines clear pixel rights, theme-park-like municipal bins, and a
ground-truth relation between the parent bin/rim and waste that is truly
crossing it. CDW-Seg is useful for contained-waste negatives, not overflow
truth. Until a rights-cleared rim-linked source is obtained or locally captured,
the overflow recommendation remains provisional.

## What is already covered and therefore excluded

The repository already materializes or locks the following sources, so none is
new held-out evidence for this audit:

| Task | Existing source coverage |
| --- | --- |
| Bin localization | Open Images V7 verified `Waste container` boxes and reviewed no-bin negatives; University of Malaya three-bin images; local/WhatsApp and Wikimedia mocks |
| Bin state | `akirsch1/waste-bin-dataset` empty/half-full/full auxiliary data; synthetic multi-angle derivatives; provisional WhatsApp fixtures |
| Floor litter | TACO plus local/Wikimedia mocks and synthetic perturbations |
| Spill/wet floor | Mendeley Stagnant Water and Wet Surface v4; Figshare road wet/dry data; synthetic beverage-spill mocks |
| Occupancy | COCO-pretrained YOLO person detector evaluated on locked local/WhatsApp/Wikimedia mocks; no dedicated public occupancy corpus is materialized |

Sources already investigated in repository research notes were also not
re-presented as discoveries: GBS, StreetView-Waste, pLitterStreet,
StreetScouting, LVIS/COCO, CODa/CLOVER, MJU-Waste, CrowdHuman, JHU-CROWD++,
CUHK Mall, CAVIAR, QUT SAIVT, PIAP liquids, SynSpill, and the Outdoor Garbage
Classification Dataset.

## New source audit

### 1. CDW-Seg — admit as a bin/local-state stress set

The official [Figshare record and API](https://api.figshare.com/v2/articles/28573229)
identify version 1, DOI `10.6084/m9.figshare.28573229.v1`, as **CC0**. The
publisher supplies original images/annotations and separate VOC and COCO
packages. The companion first-party data descriptor reports **430 real
3000x4000 images** from active construction sites, captured from multiple
angles and distances, with semantic masks for nine waste-material classes and
`skip bin`; it uses a 75/15/10 publisher split. It contains 5,413 annotated
objects and provides LabelMe, VOC, and COCO representations
([Scientific Data descriptor](https://www.nature.com/articles/s41597-025-05243-x)).

Why it adds evidence: its real, cluttered, partly filled skip bins are absent
from the current Open Images/three-bin/fill-level manifests. The bin masks test
whether the localizer generalizes to large open-top receptacles; the contained
material masks create a useful counterexample to the shortcut “visible waste
means overflow.”

Limits: a construction skip is not a theme-park bin, and the dataset has no
fill-level or rim-crossing label. It must not contribute true-overflow recall.
The publisher split is image-based and the paper does not publish a site/group
identifier, so treat its estimates as correlated diagnostics.

Minimal acquisition: download only `Ground_Truths_COCO_Format.zip` (official
API file ID `52959722`, 920,164,601 bytes, MD5
`c7c5be4923673a47c0ebaee36ac7ab8a`) and retain only the publisher test split
(about 43 images). Record the Figshare article version, file ID, supplied MD5,
and every image hash.

### 2. RoLID-11K — conditional admit for litter small-object stress

The authors' [official repository](https://github.com/xq141839/RoLID-11K)
links the released dataset and places an
[Apache-2.0 license](https://github.com/xq141839/RoLID-11K/blob/main/LICENSE)
at the dataset-repository root. The official WACV paper reports **11,565**
anonymized 1920x1080 dashcam images with one `litter` box class, split into
7,990 train, 1,201 validation, and **2,374 test** images. The test split has
4,189 litter boxes, and more than 80% of boxes are small under COCO criteria
([CVF paper](https://openaccess.thecvf.com/content/WACV2026W/WasteVision/html/Wu_RoLID-11K_A_Dashcam_Dataset_for_Small-Object_Roadside_Litter_Detection_WACVW_2026_paper.html)).

Why it adds evidence: it is temporally sourced dashcam litter from UK rural,
suburban, dual-carriageway, and urban scenes, not TACO still photography. It is
particularly useful for the missed-small-litter failure family.

Limits: this is roadside rather than indoor/theme-park imagery; negative frames
were deliberately removed, so it cannot measure false-positive rate. The
pixels are delivered from the repository's linked Google Drive rather than
stored in Git. Before product use, retain a snapshot of the root license and
obtain author confirmation if counsel considers the license's application to
the Drive-hosted pixels ambiguous.

Minimal acquisition: lock the official **test** split, then select 200 images
by complete source-video groups if group metadata is supplied. If it is not,
do not pretend a random sample is independent: hash/near-duplicate cluster the
test images first and sample whole clusters. Score only litter recall and box
localization, not precision.

### 3. PHELE v4 — conditional admit for indoor wet-floor stress

The publisher's [Mendeley Data record](https://data.mendeley.com/datasets/yzsxcvc8dp/4)
pins version 4 at DOI `10.17632/yzsxcvc8dp.4`, declares **CC BY 4.0**, and
describes labelled indoor and outdoor physical hazards with comprehensive
annotations. `Wet floor` is an explicit label alongside confusers such as
chairs, uneven carpets, glass fragments, mold/dampness, and peeling surfaces.
The record categorizes the work as computer vision/object detection and offers
one 2.35 GB `PHELE.zip` archive.

Why it adds evidence: the current spill data are outdoor wet-surface and road
surrogates; PHELE is the first identified licensed source in this workspace
whose published scope explicitly includes indoor wet-floor hazards.

Limits: the landing page does not disclose wet-floor counts, capture groups,
split policy, annotation schema details, or per-image provenance. `Wet floor`
is broader than an active food-and-beverage spill. Admission therefore requires
an archive metadata audit before any inference result is accepted.

Minimal acquisition: after downloading the single archive, inventory without
altering it; reject rows lacking a traceable wet-floor label or valid
annotation. From the remainder, lock at most 100 wet-floor positives and 100
matched indoor non-wet hard negatives, grouped by filename sequence and
perceptual hash. Use event presence/absence only unless the annotation format
proves spatial ground truth. Preserve author, DOI, version, CC BY notice, and
modification history.

### 4. FZJ 2018 entrance experiment — admit for occupancy count/stability

The Forschungszentrum Juelich Pedestrian Dynamics Data Archive publishes the
[2018 entrance/bottleneck experiment](https://doi.org/10.34735/ped.2018.1).
The authors' primary study states that the setup simulates a concert entrance
and that raw video recordings, head trajectories, and questionnaire data are
available from that DOI
([Royal Society Open Science/PMC record](https://pmc.ncbi.nlm.nih.gov/articles/PMC7211470/)).
The associated method paper describes a static top-view camera at 25 FPS and
1920x1440 resolution, synchronized trajectory data, multiple entrance widths,
and low/high motivation runs; it states that the archive data are under
**CC BY 4.0**
([Sensors paper](https://www.mdpi.com/1424-8220/22/11/4040)).

Why it adds evidence: this is fixed-camera, dense event-entry video with exact
per-frame person trajectories, a closer occupancy analogue to a theme-park
queue than the current local stills or generic COCO pretraining. Whole runs
also test count stability rather than isolated-frame accuracy.

Limits: the overhead viewpoint, colored participant caps, controlled setting,
and bottleneck behavior differ from normal park circulation. Trajectory points
are count truth, not full-body boxes; use them to score ROI count error and
temporal stability, not detector AP.

Minimal acquisition: choose three complete runs before viewing predictions:
one low-density, one medium-density, and one high-density run, preferably
spanning motivation/entrance-width conditions. Never split frames from a run
across decisions. Derive the ground-truth count per sampled second from unique
trajectory IDs inside a predeclared ROI and retain the archive's calibration
and timing metadata.

### 5. WHU-Infra3D — valuable, but rights-blocked

The new [official WHU-Infra3D repository](https://github.com/WHU-USI3DV/WHU-Infra3D)
reports 5,449 panoramic images, 175,021 2D boxes, cross-frame physical-object
IDs, and `Trash Bin` among ten roadside asset classes. It also publishes
occlusion and physical/status attributes. This would be strong independent
bin-localization and temporal-consistency evidence.

Do not acquire it yet. Access requires a questionnaire, the public repository
does not publish a dataset license, and the status keys shown publicly do not
establish fill or overflow semantics. Request explicit evaluation/commercial
rights and a data dictionary first; a public GitHub page is not a pixel-use
license.

## Acquisition and leakage controls

For each admitted source, create a source record before downloading pixels:

```text
source_name, canonical_url, doi, source_version, acquired_at,
archive_file_id, archive_bytes, publisher_checksum, local_sha256,
license_id, license_url, attribution, native_split, capture_group,
admitted_task, trainingUse=false, thresholdSelectionUse=false,
promptSelectionUse=false
```

Then apply these controls:

1. Hash exact files and perceptually cluster near duplicates against **all**
   current training, validation, and mock manifests. Reject any collision.
2. Preserve publisher test splits. Where a source lacks capture groups, infer
   conservative groups from video/sequence/path metadata and perceptual hashes.
3. Freeze sample IDs and expected labels before running any LitterSpot model.
4. Use source-specific metrics: bin presence/IoU and contained-waste false
   overflow for CDW-Seg; recall for RoLID; event precision/recall for PHELE;
   count MAE/exact-count rate and per-run jitter for FZJ.
5. Report each source separately. Do not average these domain-shift diagnostics
   into one promotion score or use them to claim theme-park qualification.

## Remaining evidence gap

Even after this acquisition, production promotion still requires a locked,
rights-cleared deployment-like set containing:

- municipal/theme-park bins with visible rim/opening geometry;
- contained-full, object-on-lid, adjacent-bag, and truly rim-crossing overflow;
- parent-bin linkage for every overflow mask;
- real beverage/food spills plus clean glossy-floor, reflection, drain, stain,
  and wet-mop negatives; and
- ordinary 0-8-person fixed-camera sequences with reflections and partial
  occlusion.

The public shortlist improves independent stress testing. It does not replace
that final deployment-camera qualification set.
