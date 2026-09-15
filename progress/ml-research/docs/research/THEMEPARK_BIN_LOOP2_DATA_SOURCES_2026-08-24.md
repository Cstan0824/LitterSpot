# Theme-park bin Loop 2 data-source audit

Research date: 2026-08-24
Scope: licence-auditable public sources for the Loop 2 bin localizer hard-negative
pass and the real bin-state classifier. This was a metadata and primary-source
review only; no large image archive was acquired.

## Decision

There is enough public data to start the **Loop 2 localizer** without drawing
new boxes. Use Open Images V7 as the primary source because it contains the
exact `Waste container` class and machine-readable boxes for nearly every
failure family observed in V0. It also publishes human-verified negative
image-level labels: a `Waste container` label with `Confidence=0` is an
especially useful source of explicit no-bin frames. The existing project
pipeline already verifies each image's original landing page and attribution,
which is necessary because Google does not warrant every image licence.

There is **not** an admission-ready public source for the complete Loop 2 state
problem. StreetView-Waste is the strongest real overflow source, but access is
controlled by an academic data-licence agreement. The immediately accessible
Waste Bin Dataset supplies useful `empty`/`half-full`/`full` supervision but no
overflow or lid-relation label. No official source found labels the critical
distinction between an object resting on a closed lid and waste crossing the
opening of that same bin.

Accordingly:

1. Start the hard-negative/localizer pass now from verified Open Images rows.
2. Use the Waste Bin Dataset only to regularize the fullness head, with a
   source-held-out evaluation and no claim that `full` means `overflow`.
3. Do not train a production overflow head from GBS, Roboflow repacks, CDCM,
   or complaint photos.
4. Keep overflow alerts conservative until either StreetView-Waste rights are
   cleared or a small controlled, tracked theme-park edge set is captured.

## Admission matrix

| Source | Useful supervision | Published volume | Rights/access | Grouping risk | Loop 2 decision |
| --- | --- | ---: | --- | --- | --- |
| **Open Images V7** | Boxes for bins and blocker classes; human-verified positive and negative image labels | 16M boxes over 600 classes on 1.9M densely annotated images; image labels span 20,638 classes | Annotations CC BY 4.0; images listed as CC BY 2.0, but every image licence must be independently verified | Web images can contain near-duplicates; group by author/landing page and perceptual hash | **Admit after row-level licence verification. Primary Loop 2 source.** |
| **LVIS v1** | Instance masks/boxes for `trash_can` and many blockers; `neg_category_ids` records categories verified absent | 159,623 images and over 1,200 categories | Annotations/API are public; pixels are COCO/Flickr images with per-image terms | COCO/LVIS overlap and long-tail duplication; group by COCO image ID and Flickr source | **Conditional supplement.** Use only after per-image licence filtering; Open Images is simpler for this loop. |
| **COCO** | Boxes/masks for person, chair, dining table, bag, suitcase, bottle, bench and related blockers | 330k images, over 200k labelled, 1.5M instances, 80 object categories | Images retain per-image Flickr licences; do not treat the API/code licence as a blanket pixel licence | Some images overlap LVIS; deduplicate by COCO/Flickr ID | **Conditional blocker supplement.** It has no trash-bin class and is unnecessary if Open Images quotas are met. |
| **CODa Re-ID / CLOVER** | Persistent `Trash_Can` identity, 2D box/mask and repeated viewpoints; signs are useful blockers | 1,037,814 observations of 557 physical objects across eight classes; no official trash-can-only count published | Official repository says CODa Re-ID is MIT licensed; raw camera sequences are very large | Extremely correlated observations; split by physical ID, route and sequence | **Admit only as a bounded positive/verifier supplement.** Do not download all raw streams. |
| **StreetView-Waste** | Container boxes/tracks and real overflow/litter instance masks | 71,170 boxes, 376 tracks, 5,149 masks on 7,230 segmentation images; 4,197 positive images | Access managed by a GDPR-compliant academic data-licence agreement; repository MIT licence covers code, not automatically the pixels | Split at video/track level; mask-to-parent-container relation still needs inspection | **Rights-gated. Best state-data lead, not admitted yet.** |
| **Waste Bin Dataset** | Image-folder labels `empty`, `half-full`, `full`; simulated plus real examples | 1,546 simulated: 371/658/517; 74 real: 22/33/19. These sum to 1,620 although the hosting UI reports 1,621 rows | Author-hosted card declares CC BY-SA 4.0 | No sequence or physical-bin groups published; simulation variants may be highly correlated | **Admit as auxiliary fullness data only.** Never map `full` to `overflow`. |
| **GBS** | COCO boxes `garbage_bin`, `overflow`, `garbage` | Official record: 16,857 images, 16,771 annotated. Local metadata audit found 16,079 overflow boxes on 9,878 images | Zenodo record declares CC BY 4.0, but the release mixes web/field, generated and augmented images without row-level origin/licence lineage | No parent/derivative groups; augmented descendants can cross splits | **Quarantine.** Large label volume does not cure provenance or rim-relation ambiguity. |
| **Outdoor Garbage Classification Dataset** | Image-level `is_full`, `is_empty`, `is_scattered`; XML annotations | Advertised as 10,000 images, but the public hosting page says the downloadable content is only a sample | CC BY-NC-ND 4.0 and full access is commercial/request-only | Capture and duplicate groups not disclosed | **Reject from product training.** Non-commercial/no-derivatives terms and sample-only access do not fit this checkpoint. |
| **Proprietary overfilled-bin route dataset** | Overfilled domestic/commercial bins with detection and segmentation labels | Exact public counts not supplied | Paper explicitly says authors do not have permission to share the data | Route/video correlation | **Unavailable.** Evidence that the task is feasible, not a data source. |

## 1. Hard-negative source that is ready now: Open Images V7

The official [Open Images V7 description](https://storage.googleapis.com/openimages/web/factsfigures_v7.html)
reports roughly 9M images, 16M bounding boxes over 600 classes, and states that
annotations are CC BY 4.0. The official
[download and format page](https://storage.googleapis.com/openimages/web/download_v7.html)
defines image-level `Confidence=1` as human-verified present and
`Confidence=0` as human-verified absent. It also publishes per-image original
URL, landing URL, licence, author, title and checksum metadata. The same page
warns that image licences must be verified independently.

The official
[boxable-class CSV](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv)
contains the following exact classes needed for the measured V0 failures:

| Loop 2 bucket | Open Images display name | MID | Use |
| --- | --- | --- | --- |
| Positive | Waste container | `/m/0bjyj5` | Bin boxes |
| Furniture | Chair | `/m/01mzpv` | Explicit hard negative |
| Furniture | Table | `/m/04bcr3` | Explicit hard negative |
| Furniture | Coffee table | `/m/078n6m` | Explicit hard negative |
| Crowd | Person | `/m/01g317` | Explicit hard negative/context |
| Carts | Cart | `/m/018p4k` | Explicit hard negative |
| Carts | Golf cart | `/m/0323sq` | Theme-park blocker |
| Mobility | Wheelchair | `/m/0qmmr` | Chair/cart-shaped blocker |
| Bags | Plastic bag | `/m/05gqfk` | Explicit hard negative |
| Bags | Handbag | `/m/080hkjn` | Bag-shaped blocker |
| Bags | Backpack | `/m/01940j` | Bag-shaped blocker |
| Bags | Suitcase | `/m/01s55n` | Box/bin-shaped blocker |
| Containers | Box | `/m/025dyy` | Explicit hard negative |
| Architecture | Window | `/m/0d4v4` | Glass-wall proxy |
| Architecture | Door | `/m/02dgv` | Glass-door/partition proxy |
| Other | Barrel | `/m/02zn6n` | Ambiguous bin-like negative |
| Other | Picnic basket | `/m/07kng9` | Basket-bin confuser |
| Other | Bench | `/m/0cvnqh` | Theme-park furniture negative |
| Other | Couch | `/m/02crq1` | Furniture negative |
| Other | Bottle | `/m/04dr76w` | Small litter/context blocker |

There is no exact boxable `glass partition` class. `Window` and `Door` are
retrieval proxies, not semantic substitutes. A contact-sheet pass should retain
only scenes with reflective glass doors/walls. This is a batch decision, not
new box annotation.

### Safe negative selection rules

Use two kinds of negatives and retain the reason in the manifest:

- **Class-explicit negatives:** an image has one or more blocker boxes above
  and no positive `Waste container` box.
- **Verified no-bin negatives:** the human-verified image label for
  `/m/0bjyj5` has `Confidence=0`. Prefer these over merely assuming that an
  unlabeled image contains no bin.

An image lacking a waste-container box is not automatically a negative because
Open Images annotations are federated rather than exhaustively box-labelled for
every class in every image. The verified-absence label is the stronger signal.

For this loop, acquire at least 300 verified negative images with a minimum of
40 each for chair/table, people/crowd, cart/wheelchair, bag/suitcase, box/barrel/
basket, and glass-door/window scenes. Keep at least 100 additional verified
no-bin frames with mixed theme-park-like backgrounds. Exact candidate counts
must be computed from the official annotation CSV before pixels are fetched;
the headline 16M box count is not a per-class quota.

## 2. Useful supplements, but not required for the first Loop 2 run

### LVIS

The official [LVIS API repository](https://github.com/lvis-dataset/lvis-api)
reports 159,623 v1 images. LVIS provides masks and boxes for a long-tailed
vocabulary including `trash_can`. More importantly, its official
[evaluation implementation](https://github.com/lvis-dataset/lvis-api/blob/master/lvis/eval.py)
uses each image's `neg_category_ids`: these are category-level negatives in the
federated annotation protocol, not absence inferred from a missing box.

LVIS shares COCO/Flickr pixels. Therefore every admitted row must retain the
COCO image ID, Flickr URL and image licence. All COCO/LVIS versions of the same
image stay in one split. This source is technically attractive but adds a
second rights adapter; it should be used only if Open Images cannot meet a
specific confuser quota.

### COCO

The official [COCO overview](https://cocodataset.org/dataset/home.htm) reports
330k images, over 200k labelled images, 1.5M object instances, and 80 classes.
It is a strong source of people, chairs, dining tables, bags, suitcases,
bottles and benches, but has no waste-container category. Its pixels came from
Flickr and the annotation records carry per-image licence IDs and source URLs;
filter those rather than assuming the software/API licence governs pixels.

### CODa Re-ID

The official [CLOVER repository](https://github.com/ut-amrl/CLOVER) reports
1,037,814 observations of 557 persistent physical instances across eight
classes, including exact `Trash_Can`, and says CODa Re-ID is MIT licensed. It
is useful for physical-bin verification under viewpoint, weather and lighting
change, but observations are highly correlated. Acquire only sequences that
contain trash cans, cap frames per physical ID, and split by physical object
and route. Never random-split frames.

## 3. State supervision

### StreetView-Waste: the best real overflow source, still gated

The official [StreetView-Waste repository](https://github.com/DiogoJPaulo/StreetView-Waste)
reports 36,478 fisheye images, 71,170 container boxes, 376 persistent container
tracks, and 5,149 overflow/litter instance masks over a 7,230-image
segmentation benchmark; 4,197 images contain positive masks. Its overflow task
targets unstructured waste/litter around containers. The repository explicitly
says dataset access is managed through a GDPR-compliant academic data-licence
agreement. The repository's MIT licence must not be interpreted as a pixel
licence.

Before admission, the agreement and annotation files must answer:

1. Is commercial model training and checkpoint deployment permitted?
2. Does every overflow mask identify or join to its parent container/track?
3. Do negative segmentation frames contain a visible non-overflow bin, or only
   no labelled litter?
4. Are overflow masks specifically connected/spilling waste, or can they be
   unrelated litter near any container?
5. Can derived crops, checksums and model weights be retained or distributed?

If those gates pass, this is the first source to add for the rim/outside waste
head. Track/video-level splitting is mandatory.

### Waste Bin Dataset: admit only for fullness

The author-hosted
[Waste Bin Dataset](https://huggingface.co/datasets/akirsch1/waste-bin-dataset)
declares CC BY-SA 4.0 and publishes 1,546 Unity images (371 empty, 658
half-full, 517 full) plus 74 real images (22 empty, 33 half-full, 19 full).
It provides image-folder state labels, no overflow class, no rim-crossing mask,
and no object-on-lid negative. Its top/down aerial viewpoint is also different
from the current theme-park CCTV views.

It can enter Loop 2 only as an auxiliary fullness dataset under these rules:

- keep simulated and real data as separate sources;
- hold all 74 real images out of training for a small cross-domain check;
- group near-identical simulation variants before splitting;
- preserve CC BY-SA attribution and lineage; and
- never convert `full` into `overflow`.

### Sources that remain quarantined

The official [GBS Zenodo record](https://zenodo.org/records/14711706) declares
CC BY 4.0 and describes 16,857 images with three COCO box classes:
`garbage`, `garbage_bin`, and `overflow`. However, its published construction
mixes web/field images, generated images and conventional augmentations without
a row-level origin/rights/parent manifest. Its `overflow` box is not a mask of
the waste-to-rim relationship. It remains useful for visual error analysis but
must not enter the product checkpoint.

The public 1,974-image Hugging Face/Roboflow overflow repacks merely copy a
third-party project and do not supply upstream pixel provenance, state
definitions or capture groups. They remain quarantined even when a hosting
page displays `CC BY 4.0`.

The advertised 10,000-image Outdoor Garbage Classification Dataset uses
`is_full`, `is_empty`, and `is_scattered`, but the public page says only a
sample is downloadable and declares CC BY-NC-ND 4.0. It is unsuitable for a
product checkpoint.

The paper
[Detecting the overfilled status of domestic and commercial bins using computer vision](https://www.sciencedirect.com/science/article/pii/S2667305323000546)
describes a highly relevant route-video dataset, but its data-availability
statement says the authors do not have permission to share it. It cannot be
counted.

## 4. The unresolved edge cases

Primary-source search found no accessible dataset with a machine-readable
`object_on_closed_lid` label. None of the sources above establishes all of:

- a visible physical bin;
- a visible opening/rim or positively identified closed lid;
- waste located inside, crossing, or outside that specific bin;
- an object resting on the lid but not connected to inside waste; and
- a persistent bin/scene ID for leakage-safe video splitting.

StreetView-Waste can potentially supply connected outside-waste masks, while
the Waste Bin Dataset supplies contained fullness. Neither supplies the closed-
lid counterexample. This is the irreducible local-data gap.

The lowest-effort mitigation is not frame-by-frame labelling. Capture short,
controlled clips for each installed bin design with four staged events:
`normal`, `full-contained`, `rim-crossing overflow`, and `object-on-lid`.
Annotate one key frame per event, propagate the bin/rim regions through the
track, and review a contact sheet of disagreements. Ten to twenty events per
bin design produce many frames while requiring only tens of human decisions.
All frames from one staged event must stay in one split.

## 5. Acquisition order for Loop 2

1. Query Open Images metadata for the exact classes and verified-negative
   label above; do not download pixels yet.
2. Select 300--500 hard-negative images using balanced class quotas and retain
   at least 100 verified `Waste container=0` scenes.
3. Reuse the existing landing-page licence verifier, attribution manifest,
   checksum, author grouping and perceptual-hash deduplication before admission.
4. Train the localizer/verifier candidate and measure the frozen WhatsApp
   chair/table/bag false-bin rate.
5. Add the CC BY-SA Waste Bin Dataset only to the fullness head and measure it
   separately from overflow.
6. Continue the StreetView-Waste rights request in parallel. Do not block the
   localizer pass on it.
7. If StreetView-Waste remains unavailable, build the small tracked local edge
   set described above; it is the only evidence capable of resolving the lid
   mistake with the required semantics.

## Bottom line

Loop 2 has enough licence-auditable data to fix the **bin-versus-chair/table/
bag/cart** problem now. It does not have enough public, rights-cleared semantic
data to declare the **overflow-state** problem solved. The correct second-loop
design is therefore asymmetric: scale public hard negatives aggressively,
while keeping the state head conservative and spending the small amount of
manual effort only on tracked rim/lid relations that public datasets do not
label.
