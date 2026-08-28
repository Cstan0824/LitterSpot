# Theme-park bin overflow dataset discovery

Research date: 2026-08-21
Scope: public or author-hosted sources that claim a garbage-bin fill/overflow
state, an overflow/content mask, or an edge-negative signal. This was a
metadata and primary-source review only: no source pixels were downloaded.

## Decision

**No source is ready to enter the licence-safe theme-park state-training
manifest as-is.** The newly verified **San Francisco 311 / DataSF** source is
the largest public *complaint-photo review queue* found: it has 417,740 cases
explicitly routed as `city_garbage_can_overflowing`, with 98,215 published
media-URL rows. It is not visual ground truth: the label is a service-request
classification, not a reviewed bin/rim relationship; much of the media is a
dead legacy page or an HTML landing page; and the City's terms do not clear
third-party attachment rights for model training.

**StreetView-Waste** remains the best actual-annotation lead, because it has
5,149 official overflow/litter masks and video-level splits, but its data are
currently agreement/credential gated and its public material does not prove a
mask-to-parent-bin join or commercial-use rights. It should be the first source
for a written access-and-rights request.

The sources that look most convenient at first glance are not substitutes:

- **GBS** has substantial source-labelled overflow-box volume but mixes
  web-crawled, field, generated, and augmented images without per-image
  lineage; it has boxes, not masks.
- **CDCM** has clean/dirty labels but its `dirty` class intentionally combines
  full bins and surrounding rubbish. It also contains Google Street View,
  social-media, and news pixels, so its dataset-level CC BY declaration is not
  enough for this product.
- The public **Roboflow garbage-can-overflow** project exposes state-looking
  class names, but does not publish their definitions, per-class counts, source
  provenance, or grouping.

This is a useful result: a generic litter label, a pile of rubbish beside a
container, and an object resting on a closed lid must not be silently promoted
to the same `overflow` class.

## Acceptance contract used for this review

A source can count toward the state classifier only after a row-level review
and provenance ledger confirm all of the following.

| Requirement | Minimum | What counts |
| --- | ---: | --- |
| Genuine overflow positives | 300 reviewed masks or crops | The target bin is identifiable and waste either crosses/rises above its visible rim/opening, or is visibly connected spill from that bin. Generic litter is not enough. |
| Non-overflow positives | 600 reviewed bin crops | A physical bin is identifiable and no reviewed overflow condition is present. A full-but-contained bin remains non-overflow. |
| Edge negatives | 150 reviewed crops | At least 30 each of: object-on-closed-lid, adjacent bag/pile not tied to the bin, visible liner/bag rim, partial occlusion, and full-but-contained/ambiguous view. |
| Independence | 20 independent groups per state | A group is a capture session/video/site/bin trajectory, not an image filename. All derivatives and near-duplicates stay in one split. |
| Rights and provenance | 100% of admitted rows | Pixel source, licence/permission, attribution, checksum, capture group, and review evidence are retained. A dataset-card licence alone does not override upstream image restrictions. |

For mask sources, a positive mask still needs a reviewed relationship to a
specific container. An unstructured ground-litter mask is **not** automatically
an overflow mask for every nearby bin.

## Source scorecard

`Potential` means that a published raw count is large enough to investigate;
it does not mean the source is admitted. `0 explicit` means the source does not
publish that class/relationship, not that no such scene happens to exist.

| Source | Published state/annotation evidence | Exact verifiable volume | Pixel licence, access, provenance | Groups / leakage evidence | Gate outcome |
| --- | --- | --- | --- | --- | --- |
| **SF311 / DataSF 311 Cases** | Official complaint route `City_garbage_can_overflowing` / `city_garbage_can_overflowing`; each case can carry `media_url`; no masks or visual verification | 417,740 labelled cases; 98,215 `media_url` rows / 98,211 distinct URL values; 23,684 distinct direct-Cloudinary image candidates (three temporal `HEAD` samples returned `200 image/jpeg`) | Dataset metadata says ODC PDDL, but DataSF terms say they grant no City or third-party IP rights; media includes citizen/third-party attachments and some stale/HTML pages | Case ID and point only; no capture session, bin trajectory, original-photo, or derivative group | **Large review/rights lead; no admission.** Visual, rights, direct-asset, and grouping gates all remain open. |
| **BOS:311 Open311** | Official `Overflowing Trash` service code; API's `extended_attributes.photos` are documented as public media | Fully queried 2026-08-20 UTC window: 9 labelled cases, 8 with media, 15 distinct photo entries. The API has no published all-history aggregate in this review. | City terms give the City permission to use submitted 311 photos, not an explicit downstream ML licence | No capture/site/duplicate group metadata | **Discovery-only; no admission.** The small verified snapshot cannot establish a reusable licensed corpus. |
| **StreetView-Waste** | Waste-container boxes/tracks plus instance masks for waste described as spilling from containers | 5,149 masks; 7,230 segmentation images; 4,197 positive waste/overflow images; 376 container tracks | Dataset server is currently HTTP 401 Digest protected; official repository says access uses a GDPR-compliant academic data-licence agreement. No public commercial-use grant was found. | Paper says splits are at video level; 376 tracks exist, but public metadata does not prove which segmentation masks map to which track or state group. | **Conditional lead; no admission** until agreement, rights, annotations, and joins are inspected. |
| **GBS** | COCO boxes: `overflow`, `garbage_bin`, `garbage`; authors describe `overflow` as overflowing bins and `garbage` as outside-bin rubbish | 16,771 unique annotated images; 16,079 overflow boxes on 9,878 images; 18,375 `garbage_bin` boxes on 10,029 images; 3,964 images contain both categories | Zenodo record declares CC BY 4.0, but authors disclose 3,349 web/field base images, 8,408 Stable-Diffusion-generated images, and 5,014 conventional augmentations. COCO rows do not identify origin/rights/parent for each image. | No verified sequence/site/derivative group field. Generated and augmented descendants cannot be split safely without a lineage map. | **Quarantine**: raw crop volume is high; masks, per-image rights, rim relation, and group proof fail. |
| **Roboflow: garbage can overflow** | Object-detection boxes with classes including `empty`, `Close_empty`, `Close_full`, `Open_empty`, `Open_full`, `full`, `closed`, and `Trash flow` | 1,974 images; version v1 split: 1,185 train / 253 valid / 536 test; 10 class names; no published per-class object counts | Project page declares CC BY 4.0, but its author provides no dataset description, source manifest, original licences, or class definitions. | Pre-made image split only; no capture/site/duplicate groups disclosed. | **Quarantine**: `Trash flow` is not a defined overflow relation, and every required count is unverified. |
| **CDCM — Clean Dirty Containers in Montevideo** | Image-level `clean`/`dirty` labels plus Pascal-VOC `container` boxes; `dirty` means a maintenance condition, not a pure rim-overflow class | V6.1 release changelog: 1,806 clean + 1,606 dirty = 3,412 images (the later paper reports a different 3,414/1,608 total, so do not mix releases) | Kaggle declares CC BY 4.0, but per-image metadata names Google Street View, contributor smartphone, PorMiBarrio, and social/news sources. Current Google Maps terms prohibit using Google Maps Content to train, test, validate, or fine-tune ML/AI models. | Author says each split contains near duplicates; source and GSV coordinates exist, but there is no universal capture-group or rights field. | **Reject for product training**. Potentially request a separately cleared, contributor-only subset; do not ingest GSV/social/news pixels. |
| **Waste Bin Dataset (Kirsch & Rexilius)** | Image-folder fill-level labels: empty, half-full, full; simulated Unity scenes plus a small real evaluation set | Simulated: 1,546 (371 empty, 658 half-full, 517 full). Real: 74 (22 empty, 33 half-full, 19 full). | Dataset card is CC BY-SA 4.0. It describes simulation provenance but does not publish per-image grouping or a separate licence statement for the 74 real images. | No sequence/site groups published. | **Auxiliary only**: useful for fill appearance research, but no overflow class, no masks, no edge labels, and real-data volume is far below threshold. |
| **UrbanWaste** | In-bin waste item segmentation; camera sees contents inside bins, not an external rim-overflow relationship | 25,254 RGB images, 140,008 item annotations, 193 waste categories | Official paper points to an author GitHub repository, which currently contains only a one-line README: no pixel download, licence, or manifest is published. | No public group metadata. | **Not a state source**: content segmentation may be useful only after author contact; it has no full/overflow label and no exterior-bin relation. |
| **Abo-Zahhad & Abo-Zahhad 2025 dataset** | Explicit main classes: full trash container, trash bag, trash outside bins, wet trash container | 912 full containers; 710 bags; 664 outside-bin trash; 714 wet containers = 3,000 images | The paper explicitly says the generated data are not public because they have commercial value and are available only on reasonable request. | No published group/rights manifest. | **Unavailable** until a written data licence and actual annotations are supplied. It is the closest published edge-negative taxonomy, but cannot be counted. |
| **TACO** | COCO litter masks, including bag classes, but no parent-bin or state relationship | Official annotation file: 1,500 images, 4,784 instances, 60 categories; 31 `Garbage bag`, 27 `Paper bag`, 61 `Single-use carrier bag` = 119 bag-like masks | Official repository says images are hosted on Flickr. Its COCO image rows contain Flickr URLs but no per-image licence field. | No bin/site/state grouping for the needed relation. | **Not a bin-state source**. It cannot satisfy 150 bin-associated edge negatives; retain only as a separately licensed litter research candidate. |

## Detailed evidence and interpretation

### 1. SF311 / DataSF — a large complaint-photo queue, not visual ground truth

The official [DataSF 311 Cases catalog](https://data.sfgov.org/City-Infrastructure/311-Cases/vw6y-z8j6/about_data)
is published by San Francisco 311. It documents `service_details` as the
human-readable request detail and `media_url` as a URL to media associated with
the case, for example an image. Unlike the generic datasets above, this is a
municipal system with a specific overflow route: both
`City_garbage_can_overflowing` and `city_garbage_can_overflowing` occur as
`service_details` values.

On 2026-08-21, an aggregate query against the official
[SODA endpoint](https://data.sfgov.org/resource/vw6y-z8j6.json) returned the
following live snapshot. The catalog says it updates nightly/multiple times per
day, so rerun the query before any acquisition decision.

```text
$select=count(*) as total_rows,
        count(media_url) as rows_with_media,
        count(distinct media_url) as distinct_media_urls,
        count(distinct point) as distinct_points,
        min(requested_datetime) as first_opened,
        max(requested_datetime) as last_opened
$where=lower(service_details)='city_garbage_can_overflowing'
```

| Exact `service_details` value | Cases | Rows with `media_url` | Distinct `media_url` values | Date range |
| --- | ---: | ---: | ---: | --- |
| `City_garbage_can_overflowing` | 278,119 | 68,445 | 68,442 | 2015-02-12 to 2024-06-12 |
| `city_garbage_can_overflowing` | 139,621 | 29,770 | 29,769 | 2024-06-13 to 2026-08-20 |
| **Total (case-insensitive query)** | **417,740** | **98,215** | **98,211** | **2015-02-12 15:30:05 to 2026-08-20 22:20:26** |

The same query reported **134,057 distinct `point` values**. That is useful
location diversity evidence, but it is **not** a capture-group field: repeated
reports of the same can, post-resolution photos, and visually related cases can
still occur. The catalog has no parent-bin ID, visual annotation, image hash,
capture session, photographer, or derivative-group field.

#### Media-access audit, without downloading pixels

`media_url` is an endpoint field, not a guaranteed direct image file. A
metadata-only partition of the 98,215 rows gave the following exact snapshot.

| URL family | Rows | Distinct URL values | Metadata-only check | Training interpretation |
| --- | ---: | ---: | --- | --- |
| `spot-sf-res.cloudinary.com` | 23,685 | 23,684 | Three temporal `HEAD` samples (2023-08-02, 2025-06-22, 2026-08-20) each returned `200 image/jpeg` | Direct-image **candidates**, not automatically rights-cleared or visually valid positives. |
| `mobile311.sfgov.org/reports/.../photos` | 68,258 | 68,257 | A current `HEAD` sample returned `404` | Do not count as accessible pixels. |
| `verintcloudservices.com` | 6,086 | 6,086 | A current `HEAD` sample returned `200 text/html` | Landing/form URLs, not direct image assets. |
| Other social/third-party URL families | 186 | 184 | Includes Twitter/X, `pbs.twimg.com`, Imgur, and social-management URLs | Exclude unless the original asset, source, and rights are independently cleared. |

Thus, **23,684** is the exact published count of direct-Cloudinary image URL
*candidates* in this snapshot, not a claim that 23,684 photos are still live,
licence-safe, or genuine overflowing-bin crops. The audit intentionally used
only `HEAD` requests; no image pixels were downloaded.

The catalog page declares the [Open Data Commons Public Domain Dedication and
License](https://opendatacommons.org/licenses/pddl/1-0/) (PDDL). However, the
City's governing [DataSF Terms of Use](https://data.sfgov.org/terms-of-use) say
that data can be compiled and processed by the City **and third parties**, and
that the terms do not grant rights in City or other parties' IP where such
rights are claimed. That prevents treating the table-level PDDL label as a
written commercial ML licence for each attached photo. Request written
clarification from SF311/DataSF covering third-party attachments, commercial
training/evaluation/deployment, model weights, retention, and redistribution
before any pixels enter a manifest.

Most importantly, this is a **complaint routing label**, not a reviewed visual
state. A reporter can submit a wrong route; a photo can show ground litter,
multiple cans, a closed-lid bag, a missing bin, a service vehicle, or no useful
bin/rim at all. It supplies a large queue for post-rights human review, not
417,740 genuine positives. It provides no masks and cannot by itself satisfy
the 300-positive, 600-non-overflow, 150-edge-negative, or 20-independent-group
requirements.

#### SF311 edge-negative review queues

The same official source has useful *request-type* candidates under
`service_name='Litter Receptacles'`. These figures count cases with a
`media_url`; they are not visual labels and must not be automatically called
non-overflow or edge-negative examples.

| Official `service_subtype` | Rows with media | Distinct URL values | Potential review use |
| --- | ---: | ---: | --- |
| `Toters_left_out_24x7` | 17,147 | 17,145 | Bin/toter present but possibly closed, moved, adjacent to waste, or obscured. |
| `Add_remove_garbage_can` | 9,355 | 9,355 | Potential empty/missing-bin or layout negatives. |
| `Other_garbage_can_repair` | 5,266 | 5,265 | Damaged/occluded-bin confusers. |
| `Tipped_over` | 2,590 | 2,590 | A distinct state, not overflow; useful for hard-negative review. |
| `Transit_shelter_platform` | 1,820 | 1,820 | Context-negative candidate only; may not contain a bin. |
| `Damaged_City_Can` | 191 | 191 | Rare damaged-can candidate. |
| `Liner_issue_damaged_missing` | 60 | 60 | Closest official queue for the visible-liner false positive. |
| `Liner_issues` | 11 | 11 | Same intent, insufficient alone. |
| `Recycling_top_issues` | 9 | 9 | Lid/top confuser, insufficient alone. |
| `Debris_box_maintenance_overflowing` | 20 | 20 | Explicit overflow wording, but a debris box is not necessarily a public litter bin. |

For the first five subtypes, the historical no-detail / `N/A` split explains
the raw counts (for example, `Toters_left_out_24x7` is 14,439 no-detail plus
2,708 `N/A`). This is metadata evolution, not duplicate-photo proof. The
labels are valuable for reviewer sampling after rights clearance, especially
the 60 liner cases, but they are not substitutes for the five explicit
edge-negative classes in the acceptance contract.

### 2. BOS:311 — confirms public complaint media, but no reusable corpus yet

The official [BOS:311 Open311 documentation](https://311.boston.gov/open311/docs)
states that `extended_attributes.photos` represents all public media associated
with a service request. The official API exposes a dedicated `Overflowing
Trash` service code, `c8e719d6-06ce-4375-813d-dccb3ca66402`.

A fully paginated, metadata-only query of that code for the UTC window
2026-08-20 00:00:00 through 2026-08-21 00:00:00 returned **9** labelled
requests, **8** requests with media, and **15** distinct `photos` entries. This
confirms the API mechanism but is deliberately not presented as an all-history
corpus count: the API limits date queries to 90 days and paginates at 300 rows,
and a full history crawl was outside this discovery-only audit.

The City's [digital-service terms](https://www.boston.gov/government/cabinets/innovation-and-technology/terms-use-and-privacy-policy-city-boston-digital)
say that a contributor grants **the City** permission to use a 311 photo. They
do not grant a downstream party an explicit copyright or commercial ML-training
licence. No source/capture grouping, visual annotation, rim relation, or
dataset-level photo-rights manifest was found. BOS:311 should therefore remain
a contact/reference lead, not an admitted data source.

### 3. StreetView-Waste — first actual-annotation source to pursue

The official [project page](https://streetview-waste.di.ubi.pt/) and
[repository](https://github.com/DiogoJPaulo/StreetView-Waste) describe three
tasks: container detection, tracking/counting, and overflow segmentation. The
published figures are 71,170 detection boxes, 36,478 images, 376 unique
container tracks, 5,149 overflow/litter instance masks, and 7,230 segmentation
images. The repository further reports 4,197 positive segmentation images and
states that overflow/litter masks target unstructured waste near containers.
The [official WACV paper](https://openaccess.thecvf.com/content/WACV2026/papers/Paulo_StreetView-Waste_A_Multi-Task_Dataset_for_Urban_Waste_Management_WACV_2026_paper.pdf)
defines the desired task as pixel-accurate masks of waste spilling out of
containers and says splits are made at video level to prevent frame leakage.

That is materially closer to the product definition than generic litter. The
positive-mask count exceeds the 300-mask threshold and the 376 tracks are more
than enough in principle for 20 independent groups. But two facts block an
automatic pass:

1. `7,230 - 4,197 = 3,033` is only a count of no-positive-mask images. It is
   not proof of 3,033 visible, non-overflow **bins**.
2. The public materials do not show whether a segmentation label carries a
   parent-container ID, or whether the detection/tracking and segmentation
   archives can be joined by frame and container ID. That join is essential for
   a per-bin state classifier.

The repository says data access is managed through a GDPR-compliant academic
data-licence agreement. On 2026-08-21, a metadata-only `HEAD` request to the
official segmentation ZIP returned `401 Unauthorized`, with the Digest realm
`Street View Waste Dataset`. Therefore do not bypass access controls or assume
that the repository's MIT code licence applies to the pixels.

**Request before downloading any pixels:** a copy of the dataset agreement;
permission for the intended commercial model training, evaluation, deployment,
and derived weights; the annotation schema; confirmation of the source-pixel
rights; session/video IDs; and a frame/container/mask join. If that is granted,
run an annotation-only audit first and review a stratified set of positive masks
for visible bin/rim association.

### 4. GBS — direct state names, but not state-grade evidence yet

The official [Zenodo record](https://zenodo.org/records/14711706) describes
three COCO bounding-box categories (`garbage`, `garbage_bin`, `overflow`) and
declares 16,857 image rows, of which 16,771 are annotated. A metadata-only
audit of its official COCO member, recorded in
[gbs-zenodo-14711706-sufficiency.json](../../artifacts/dataset-readiness/gbs-zenodo-14711706-sufficiency.json),
finds 44,809 boxes and the exact counts in the scorecard. The apparent 86-row
difference is duplicate image rows in the record, so 16,771 unique annotated
image IDs is the usable count.

The authors' [primary paper](https://www.mdpi.com/2624-6511/8/2/71) says that
`garbage_bin` is non-overflowing, `overflow` is an overflowing bin, and
`garbage` is rubbish outside the bin. That makes `overflow` a **declared state
label**, rather than merely a generic litter class. It does not make it a
mask, prove that every box includes a visible rim/opening, or prove that an
`overflow` box in an `overflow`-only image belongs to a visible bin. The 3,964
same-image `garbage_bin`+`overflow` cases are the strongest review candidates,
not automatically admitted positives.

The paper also reports 3,349 base images (2,651 web-crawled plus 698 field
photographs), 8,408 generated images, and 5,014 augmented images. Zenodo's CC
BY record licence gives a record-level declaration, but no COCO row says which
of those origin classes it is, who owns the original source image, or which
base image generated/augmented children derive from. Treat GBS as an
annotation/provenance research source until that lineage or a written rights
grant exists.

### 5. Roboflow garbage-can-overflow — promising names, insufficient evidence

The author-hosted [project page](https://universe.roboflow.com/mariswary-deepak-4ajr0/garbage-can-overflow)
declares CC BY 4.0 and shows state-looking classes. Its
[v1 record](https://universe.roboflow.com/mariswary-deepak-4ajr0/garbage-can-overflow/dataset/1)
provides the exact image split, says there were no Roboflow augmentations, and
offers COCO/YOLO/Pascal-VOC exports. It also explicitly says that no project
description has been published.

That absence matters. `Trash flow` could mean overflowing waste, flow from a
vehicle, or another annotation convention; `Close_full` and `Open_full` do not
state whether material is contained below the rim. No source manifest, per-class
instance count, original image-rights record, capture group, or state definition
is available. Do not use the page's declared CC BY label as a substitute for
those facts. The correct next action is author contact, not automatic download.

### 6. CDCM — a useful lesson in why `dirty` is not `overflow`

The author's [Kaggle dataset card](https://www.kaggle.com/datasets/rodrigolaguna/clean-dirty-containers-in-montevideo)
publishes a V6.1 metadata schema with split, `clean`/`dirty` label, source, and
coordinates for GSV rows. Its companion [author repository](https://github.com/rola93/clean-dirty-preprocess-baseline)
explains the intended two-stage use: detect a container, then crop and classify
it as clean or dirty. The dataset card also says that split-internal near
duplicates occur.

This label is intentionally broader than a rim-overflow alarm: a dirty
container may be fully occupied and may have waste piled beside it. It can
provide review candidates, but never a direct `overflow` target. More
importantly, the author identifies Google Street View, social/news, individual
contributors, and PorMiBarrio as sources. The current
[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms?sign=1)
explicitly prohibit using Google Maps Content to train, test, validate, or
fine-tune ML/AI models. The dataset-level CC BY card therefore cannot clear its
GSV pixels for this project.

### 7. Sources that fill only part of the problem

The [Waste Bin Dataset](https://huggingface.co/datasets/akirsch1/waste-bin-dataset)
is author-attributed and gives exact simulated/real fill-level counts. It is
appropriate only for a clearly marked synthetic auxiliary experiment after the
team decides whether CC BY-SA model/derivative obligations are acceptable. It
cannot prove the visible-rim overflow relation.

The [UrbanWaste AAAI paper](https://ojs.aaai.org/index.php/AAAI/article/download/35043/37198)
is a valuable in-bin-content segmentation reference, but it labels waste items
inside bins rather than an external bin state. Its
[official repository](https://github.com/zma029/UrbanWaste) currently provides
no data or licence text. It cannot be used as a public source today.

The [Scientific Reports study](https://www.nature.com/articles/s41598-025-99885-x)
is valuable because it separates full bins, bags, outside-bin trash, and wet
containers. Its data-availability statement says the data are not public due to
commercial value. Thus it is a taxonomy reference, not a dataset source.

Finally, the official [TACO repository](https://github.com/pedropro/TACO)
provides COCO-format litter segmentation. Its official `annotations.json`
contains the exact 1,500/4,784/60 and 119 bag-like-instance totals above, but
its image rows point to Flickr and omit per-image licence fields. More
fundamentally, it has no bin-parent relation: a bag mask on a beach cannot teach
the system whether a bag is on a bin lid, in a liner, or beside a target bin.

## Edge-negative discovery result

No reviewed public source in this search publishes explicit labels for all of
the product's high-risk false-positive cases:

| Required edge negative | Nearest discovered evidence | Why it cannot be counted yet |
| --- | --- | --- |
| Object on closed lid | SF311 has 9 `Recycling_top_issues` media rows; Roboflow has `closed`/`Close_full` names | Neither supplies a reviewed lid/object geometry relationship or adequate count. |
| Adjacent bag/pile not tied to bin | Abo-Zahhad has `trash bag` and `trash outside`; TACO has 119 bag-like masks | Abo data are unavailable; TACO has no bin relation. |
| Visible liner/bag rim | SF311 has 60 `Liner_issue_damaged_missing` media rows and 11 `Liner_issues` rows | A maintenance-request type is not proof that a visible liner appears in the photo; rights and direct-image availability also remain unresolved. |
| Partial occlusion | StreetView-Waste records realistic occlusions; SF311 repair/tipped-can queues provide candidates | No per-bin occlusion-negative label/count is published. |
| Full but contained | Waste Bin Dataset gives full images; Roboflow has `Open_full`/`Close_full` names | Neither publishes the required rim/containment evidence for product admission. |

The answer to the original false-alarm problem is therefore not to lower the
overflow threshold against generic litter. It is to make these five cases a
first-class, reviewed negative taxonomy. Public sources can seed review queues,
but none can replace that taxonomy with verified labels.

## Recommended acquisition order (still no model training)

1. **Obtain written SF311/DataSF attachment rights clarification first.** Ask
   whether the table-level PDDL covers each linked complaint photo, especially
   Cloudinary, legacy Mobile311, Verint, and social-hosted media; request
   permission for commercial training, evaluation, deployment, derived weights,
   retention, and redistribution. No pixel should be acquired until that is
   answered.
2. **If SF311 rights clear, run an annotation-only/direct-asset gate.** Verify
   which of the 23,684 Cloudinary candidates are still direct images, then
   establish capture grouping and human-review the bin/rim relationship before
   sampling positives or the subtype-based negative queues.
3. **Request StreetView-Waste access and a commercial rights clarification.**
   It remains the only source found that can plausibly cover the 300-mask
   requirement with realistic, sequence-grouped imagery. After permission,
   confirm mask-to-bin linkage, visible non-overflow bins, and at least 20
   video/site groups per state before downloading selected pixels.
4. **Keep GBS and the Roboflow project in quarantine.** Ask authors for a
   row-level origin/licence/derivative manifest and state definitions. Do not
   use their aggregate CC BY declaration to admit pixels.
5. **Treat CDCM as a source-filtering/contact lead only.** Exclude all GSV and
   unverified social/news images; request contributor-only rights if the author
   can identify them.
6. **Plan a small, targeted private edge set even if StreetView-Waste clears.**
   The exact lid/bag/liner/occlusion confusers are absent from public labels and
   are central to this theme-park deployment.

The state-training gate remains **closed** until an admitted manifest satisfies
all five acceptance-contract rows.
