# Theme-park bin dataset sufficiency audit

Research date: 2026-08-20
Scope: primary/official dataset records and annotation metadata only. No source
pixel archive was downloaded for this audit.

## Decision: **FAIL — do not start either training loop yet**

There is enough labelled candidate volume to build a licence-aware bin and
overflow acquisition adapter. In particular, the official GBS record has far
more direct garbage-bin annotations than the generic 1,200-bin numerical
threshold, and far more source-labelled overflow crops than the 300-crop
threshold.

That is not the same as having a training-ready theme-park dataset. The
required appearance families are not encoded in any verified source metadata;
the high-risk negative families have not been admitted through a per-image
commercial-licence ledger; and no product-cleared source has 300 pixel masks
for overflow. Therefore the combined entry gate fails, even though some
individual volume checks pass.

The next action is a bounded metadata/visual-audit stage, not a web scrape and
not a full model-training run.

## What counts in this audit

- A **direct bin positive** is an upstream category that explicitly means a
  physical waste/trash container. garbage_bin, trash_can, Trash_Can, and Open
  Images Waste container qualify. Generic basket, barrel, box, bucket, or cart
  never qualify automatically.
- A **true-overflow crop** is a crop from an upstream overflow category. It is
  not automatically a bin-localiser positive: it can describe waste around a
  bin rather than the bin itself.
- A **mask** means a polygon/raster instance mask, not a bounding box.
- **Approved** means that source pixels have a commercial-use-compatible
  licence record, attribution/provenance fields are retained, and the image
  has passed the stated semantic/appearance rule. It does not mean merely that
  an annotation file is open.
- Counts are not added across sources unless image IDs, capture groups and
  derivatives have been deduplicated. This matters especially for GBS
  synthetic/augmented images and CODa repeated observations.

## Decisive gate scorecard

| Required gate | Verified evidence available now | Result | Reason |
| --- | ---: | --- | --- |
| 1,200 explicit physical-bin positives | 10,029 unique GBS image IDs with direct garbage_bin boxes; 18,375 boxes | **Numerical PASS; entry FAIL** | The count is before source-group/perceptual deduplication and has no wheelie/open-top/basket subtype field. The GBS paper also discloses generated and augmented derivatives. |
| >=300 wheeled/closed-lid bins | 0 approved/typed examples | **FAIL** | None of the audited annotations declares wheels, lid geometry, or wheeled-bin status. |
| >=300 open-top/cylindrical bins | 0 approved/typed examples | **FAIL** | None of the audited annotations declares opening visibility, top geometry, or cylindrical form. |
| >=200 approved open-bin/basket receptacles | 0 approved examples | **FAIL** | LVIS has basket, but a generic basket is not a waste receptacle. It cannot be remapped without review. |
| >=1,500 hard-negative images and >=150 per high-risk family | 0 production-admitted images; 3,213 COCO-val candidate image IDs across a partial family set | **FAIL** | COCO annotations are open, but its images retain Flickr terms. Cart, barrel and box coverage is not supplied by COCO's 80-class taxonomy. Open Images is scalable but not yet counted or licence-filtered. |
| >=300 genuine overflow **masks** | 0 commercial-clear masks | **FAIL** | GBS has no segmentation masks. StreetView-Waste has 5,149 masks, but its dataset is agreement-gated for GDPR-compliant academic use. |
| >=300 source-labelled overflow **crops** | 9,878 GBS image IDs / 16,079 overflow boxes | **Conditional PASS** | This passes only if a source-labelled bounding-box crop is accepted and review confirms rim/relationship semantics. It is not a pixel-mask pass. |

**Overall result: FAIL.** The minimums are conjunctive. Passing raw GBS volume
cannot compensate for a missing bin-style taxonomy, product-admitted hard
negatives, and overflow-mask evidence.

## Exact source evidence and access status

### 1. GBS — usable candidate core, not a final training set

The official [GBS Zenodo record](https://zenodo.org/records/14711706) declares
the archive GBS.zip under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
That verifies the record-level licence, but the COCO rows do not identify which
pixels are field-captured, web-crawled, generated, or conventional
augmentations and do not retain original landing pages or per-pixel licences.
The record licence therefore does **not** yet admit the mixed-provenance pixels
to this product dataset. Preserve the record, author and checksum, then obtain
per-image lineage or a written rights confirmation before setting
`commercialUseStatus=approved`.

The checked-in machine audit
[gbs-zenodo-14711706-sufficiency.json](../../artifacts/dataset-readiness/gbs-zenodo-14711706-sufficiency.json)
was generated from the official record and only the compressed COCO annotation
member. It read about 19.3 MB by HTTP ranges, not the 5.16-GB image archive.
Its reproducible implementation is
[audit_gbs_zenodo_metadata.py](../../ml-training/scripts/audit_gbs_zenodo_metadata.py).

| Official GBS COCO category | Boxes | Unique image IDs | Correct operational use |
| --- | ---: | ---: | --- |
| garbage_bin | 18,375 | 10,029 | Direct physical-bin localisation candidate. |
| overflow | 16,079 | 9,878 | Overflow-state crop candidate; do **not** merge into the localiser's bin class without a bin-linkage rule. |
| garbage | 10,355 | 7,511 | Litter/context only; never a bin positive. |
| all categories | 44,809 | 16,771 annotated IDs | Annotation-volume check only. |

The annotation file contains 16,857 image rows but 16,771 unique IDs (86
duplicate rows); all 16,771 unique IDs have annotations. The union of
garbage_bin and overflow has 15,943 image IDs. That union is a **bin-related
candidate-pool** statistic, not a direct physical-bin count.

The corrected image-level intersection audit finds 6,065 `garbage_bin`
candidate images without an `overflow` annotation, 3,964 images containing
both categories, and 5,914 `overflow` images without a `garbage_bin` box. The
6,065/9,878 non-overflow/overflow figures are review-pool sizes only: category
absence or presence does not by itself prove the product's state definition.

The GBS authors report 3,349 base images (2,651 web-crawled and 698 field
photos), 8,408 Stable-Diffusion-generated images and 5,014 conventional
augmentations. Those figures explain why random frame splits or raw box totals
would overstate independent coverage. The paper does not give class-by-source
or bin-style counts, so this audit cannot convert 10,029 direct-bin IDs into a
valid count for the three appearance gates. See the authors'
[GBS paper](https://www.mdpi.com/2624-6511/8/2/71).

**Category-semantics caveat:** overflow is a label for overflow/waste state,
not an asserted bounding box around a physical container. Train a state crop
model on it only after a spatial-link/review rule says it is connected to the
verified bin opening. Training it as a one-class bin detector would recreate
the project's present object-on-lid / nearby-litter-becomes-bin failure.

### 2. LVIS v1 — exact validation metadata, conditional pixels

The official [LVIS v1 validation annotation archive](https://dl.fbaipublicfiles.com/LVIS/lvis_v1_val.json.zip)
has category-level image_count and instance_count fields. Reading that official
JSON yields the following exact validation-split values:

| LVIS v1 validation category | Image count | Instance count | Gate use |
| --- | ---: | ---: | --- |
| trash_can | 389 | 548 | Direct bin candidate, but insufficient alone for 1,200. |
| basket | 311 | 731 | Review queue only; not automatically a bin. |
| chair | 392 | 2,368 | Candidate hard negative. |
| person | 390 | 2,530 | Candidate hard negative. |
| table | 371 | 595 | Candidate hard negative. |
| signboard | 398 | 1,799 | Candidate hard negative. |
| plastic_bag | 275 | 738 | Candidate hard negative. |
| bottle | 381 | 1,766 | Candidate hard negative. |
| box | 287 | 1,389 | Candidate hard negative. |
| barrel | 20 | 51 | Too sparse for the barrel family. |
| cart | 10 | 29 | Too sparse for the cart family. |
| handcart | 15 | 31 | Too sparse for the cart family. |
| shopping_cart | 8 | 17 | Too sparse for the cart family. |
| baby_buggy | 67 | 78 | Too sparse for the cart/stroller family. |

LVIS provides high-quality instance masks, but its images come through the
COCO/Flickr lineage. The official LVIS repository documents the data and API,
but does not grant a blanket commercial licence for every source image; retain
the original image terms. It is therefore **conditional**, not a
production-admitted pixel source, until the image-level licence ledger is
complete. The [official LVIS repository](https://github.com/lvis-dataset/lvis-api)
documents the v1 release and its 159,623 images.

### 3. CODa Re-ID — strong viewpoint variation, weak independent diversity

The official [CLOVER/CODa Re-ID repository](https://github.com/ut-amrl/clover)
states that CODa Re-ID is MIT licensed and has 1,037,814 observations of 557
physical instances across eight classes, including exact Trash_Can. The
authors' per-class table reports **31 physical Trash_Can instances** with a
mean of 1,072 observations each (about 33,232 observations, but only 31
physical objects). It has boxes, masks and persistent instance IDs.

This is useful for a viewpoint/track verifier and group-safe evaluation; it
cannot satisfy a 300-style quota by treating repeated robot views as
independent bins. It has no overflow state label and no published wheeled,
open-top or basket subtype field.

Direct access is the authors' [Texas Data Repository DOI](https://doi.org/10.18738/T8/E9WFTW)
and the repository's scripts/download_coda_reid_annotations.sh helper. The
annotation pack is about 90 MB; the raw camera streams are about 500 GB for
camera 0, so they were not downloaded for this audit. The source remains
conditional until the accompanying data licence file is captured in the
manifest, despite the repository's MIT statement.

### 4. StreetView-Waste — enough masks, but commercial use is gated

The official [StreetView-Waste repository](https://github.com/DiogoJPaulo/StreetView-Waste)
reports 36,478 fisheye images, 71,170 container boxes, 376 container tracks,
and 5,149 overflow/litter instance masks. Its segmentation benchmark has
7,230 images including 4,197 positive overflow images. It is the only audited
source that would satisfy the 300 **mask** threshold on raw count.

Its same official source says data access is managed through a data-licence
agreement for GDPR-compliant **academic use**. The repository's code licence
does not licence the data. Until a written agreement explicitly permits this
product's intended commercial training and checkpoint use, count all of these
rows as **0 for the production gate**.

### 5. University of Malaya Figshare — licensed domain supplement, no boxes

The official [Figshare record](https://figshare.com/articles/figure/Solid_waste_bin_images_with_3_bin_per_node/6269042)
and [metadata API](https://api.figshare.com/v2/articles/6269042) declare CC BY
4.0 and list exactly 200 JPG files. The description states that each disposal
node has three bins, potentially shifted, rotated or occluded.

This is 600 described bin occurrences, not 600 annotated detection examples:
the record has no machine-readable boxes, masks, opening state or overflow
labels. It is suitable only as a weak-label/contact-sheet supplement after
deduplication of the single repeated layout. It contributes **zero** to the
approved explicit-bin and overflow gates until reviewed boxes/links exist.

### 6. COCO 2017 — exact candidate negatives, not product-admitted pixels

The official 2017 validation annotations were queried from the
[COCO annotation archive](https://images.cocodataset.org/annotations/annotations_trainval2017.zip).
The exact **validation** image/instance counts are:

| COCO 2017 validation category | Image IDs | Instances |
| --- | ---: | ---: |
| person | 2,693 | 11,004 |
| chair | 580 | 1,791 |
| dining table | 501 | 697 |
| bottle | 379 | 1,025 |
| backpack | 228 | 371 |
| handbag | 292 | 540 |
| suitcase | 105 | 303 |

The union over those seven categories is **3,213 distinct validation image
IDs** (not the sum of the rows). COCO has no trash_can/waste-bin class, no
cart, no barrel and no generic box category, so it cannot finish the required
high-risk taxonomy on its own.

The official [COCO terms](https://github.com/cocodataset/cocodataset.github.io/blob/master/dataset/termsofuse.htm)
licence annotations under CC BY 4.0 but state that the consortium does not own
the images and that image use must abide by Flickr terms. Consequently these
are exact **candidate** counts, not a product-approved hard-negative count.

### 7. Open Images V7 — scalable and queryable, but not measured/admitted

The official [Open Images V7 class file](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv)
contains Waste container (/m/0bjyj5) and the required blocker vocabulary,
including Chair, Person, Table, Cart, Traffic sign, Plastic bag, Bottle,
Barrel, Box, Picnic basket and Wheelchair.

The official [V7 download page](https://storage.googleapis.com/openimages/web/download_v7.html)
does not publish current per-class counts. It instead exposes the official box
CSVs (the page links released train boxes at v6/oidv6-train-annotations-bbox.csv
and validation/test boxes at v5 paths). This makes exact counts reproducibly
queryable, but no full annotation scan or per-image licence filter has been
completed in this audit. Therefore every Open Images gate contribution is
**unproven / 0 approved**, not assumed from the 9-million-image headline.

Open Images image-information CSVs include OriginalURL, OriginalLandingURL,
License, AuthorProfileURL and Author. Google licences annotations under CC BY
4.0; individual image licences must still be checked and preserved. Retain only
image records whose actual licence and attribution are acceptable to the
deployment's legal policy.

## Reproducible queries

These commands are metadata-only. They do not fetch a large pixel archive or
train a model.

### GBS official-range audit

~~~powershell
py -3 ml-training/scripts/audit_gbs_zenodo_metadata.py
Get-Content artifacts/dataset-readiness/gbs-zenodo-14711706-sufficiency.json -Raw
~~~

The script validates the Zenodo record ID/title/licence, reads only
Annotations/GBS_coco.json by HTTP ranges, checks bounding-box validity and
writes the report cited above. Do not replace its source ID with a third-party
mirror.

### LVIS v1 validation category counts

~~~python
import json
from pathlib import Path

doc = json.loads(Path("lvis_v1_val.json").read_text(encoding="utf-8"))
wanted = {
    "trash_can", "basket", "chair", "person", "table", "signboard",
    "plastic_bag", "bottle", "box", "barrel", "cart", "handcart",
    "shopping_cart", "baby_buggy",
}
for category in sorted(
    (item for item in doc["categories"] if item["name"] in wanted),
    key=lambda item: item["name"],
):
    print(category["name"], category["image_count"], category["instance_count"])
~~~

Download only the official annotation archive above, extract
lvis_v1_val.json, and run the snippet. It does not require images.

### COCO 2017 validation counts and overlap-safe union

~~~python
import json
from collections import Counter, defaultdict
from pathlib import Path

doc = json.loads(Path("instances_val2017.json").read_text(encoding="utf-8"))
wanted = {"person", "chair", "dining table", "bottle", "backpack", "handbag", "suitcase"}
id_to_name = {category["id"]: category["name"] for category in doc["categories"]}
ids, boxes = defaultdict(set), Counter()
for annotation in doc["annotations"]:
    name = id_to_name[annotation["category_id"]]
    if name in wanted:
        ids[name].add(annotation["image_id"])
        boxes[name] += 1
for name in sorted(wanted):
    print(name, len(ids[name]), boxes[name])
print("union", len(set().union(*ids.values())))
~~~

Download only the official annotation archive above, extract
instances_val2017.json, and run the snippet. It does not require images.

### Open Images exact count and licence join — required before it can pass

First retrieve the official annotation CSVs linked by the V7 download page and
the matching image-information CSVs. Then perform a streaming query like the
following; it counts both boxes and distinct image IDs without downloading
pixels.

~~~python
# python count_openimages.py <bbox.csv> [<bbox.csv> ...]
import csv
import sys
from collections import Counter, defaultdict

classes = {
    "/m/0bjyj5": "waste_container", "/m/01mzpv": "chair",
    "/m/01g317": "person", "/m/04bcr3": "table", "/m/018p4k": "cart",
    "/m/01mqdt": "traffic_sign", "/m/05gqfk": "plastic_bag",
    "/m/04dr76w": "bottle", "/m/02zn6n": "barrel", "/m/025dyy": "box",
    "/m/07kng9": "picnic_basket", "/m/0qmmr": "wheelchair",
}
boxes, image_ids = Counter(), defaultdict(set)
for filename in sys.argv[1:]:
    with open(filename, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = classes.get(row["LabelName"])
            if label:
                boxes[label] += 1
                image_ids[label].add(row["ImageID"])
for label in sorted(classes.values()):
    print(label, "boxes=", boxes[label], "images=", len(image_ids[label]))
~~~

Join the resulting ImageID set to official image-information rows and reject
entries with missing/unacceptable License, OriginalLandingURL, Author or
OriginalURL. Deduplicate image content and routes before adding counts to any
quota. A class count by itself is not an approved image set.

### University of Malaya Figshare metadata check

~~~powershell
$record = Invoke-RestMethod https://api.figshare.com/v2/articles/6269042
$record.license.name
$record.files.Count
$record.description
~~~

This proves the licence, file count and weak three-bin description; it cannot
invent missing boxes or state labels.

## Gaps and least-effort route to a PASS

1. **Do a source-group and style audit before materialising pixels.** Run the
   GBS machine audit, collapse original/generated/augmented relatives, then
   generate contact sheets from a stratified candidate sample. A reviewer only
   chooses wheeled_closed, open_top_cylindrical, open_receptacle,
   reject/not-bin, or uncertain; they do not draw boxes. Do not infer these
   attributes from locked WhatsApp pixels.
2. **Finish one licence-filtered Open Images query.** It is the lowest-effort
   way to fill the cart, sign, barrel, box and bag/bottle confusers with direct
   labels. Only manifest rows with acceptable original-image licences may
   contribute to the 1,500/150 gates.
3. **Use GBS overflow boxes only as a candidate crop source.** Introduce a
   conservative spatial bin-link rule and an unknown state for no visible
   rim/opening. An object resting on a closed lid and a bag beside a bin must be
   negative state examples, not synthetic overflow positives.
4. **Request StreetView-Waste terms rather than silently using it.** If a
   product-compatible agreement is granted, it immediately supplies sufficient
   pixel masks; otherwise use only reviewed GBS crops for the first state
   experiment and record that the mask gate remains failed.
5. **Keep the WhatsApp media locked.** It remains evaluation-only and may define
   text labels/coverage buckets but must not participate in sample retrieval,
   pseudo-labelling, threshold fitting or training.

The recommended post-audit state is: **authorise a metadata and contact-sheet
acquisition adapter, but keep both model-training loops blocked until the
scorecard is re-run on a materialised, licence-filtered, deduplicated
manifest.**

## Primary sources

- [GBS Zenodo record](https://zenodo.org/records/14711706) and [GBS authors' paper](https://www.mdpi.com/2624-6511/8/2/71).
- [LVIS official API/repository](https://github.com/lvis-dataset/lvis-api) and [v1 validation annotation archive](https://dl.fbaipublicfiles.com/LVIS/lvis_v1_val.json.zip).
- [CLOVER/CODa Re-ID official repository](https://github.com/ut-amrl/clover) and [Texas Data Repository record](https://doi.org/10.18738/T8/E9WFTW).
- [StreetView-Waste official repository](https://github.com/DiogoJPaulo/StreetView-Waste) and [dataset page](https://streetview-waste.di.ubi.pt/).
- [University of Malaya Figshare record](https://figshare.com/articles/figure/Solid_waste_bin_images_with_3_bin_per_node/6269042) and [official API metadata](https://api.figshare.com/v2/articles/6269042).
- [COCO official annotation archive](https://images.cocodataset.org/annotations/annotations_trainval2017.zip) and [COCO terms](https://github.com/cocodataset/cocodataset.github.io/blob/master/dataset/termsofuse.htm).
- [Open Images V7 download page](https://storage.googleapis.com/openimages/web/download_v7.html), [facts page](https://storage.googleapis.com/openimages/web/factsfigures_v7.html), and [boxable-class CSV](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv).

This is an engineering and provenance audit, not legal advice. Product counsel
must approve the final per-image licence manifest and downstream checkpoint
distribution terms.

## Continuation — 2026-08-21: LVIS v1-train × COCO pixel-licence ledger and Open Images gap query

### Result: **production admission remains FAIL (0 accepted pixels)**

This continuation closes the previously missing **metadata evidence**, not the
pixel-licence gate. It uses the official [LVIS v1 train annotation
archive](https://dl.fbaipublicfiles.com/LVIS/lvis_v1_train.json.zip) and the
official [COCO 2017 annotation archive](https://images.cocodataset.org/annotations/annotations_trainval2017.zip),
without downloading `train2017.zip`, `val2017.zip`, or any other source-image
archive. The LVIS ZIP passed its built-in CRC check (`lvis_v1_train.json`,
1,097,154,875 uncompressed bytes; SHA-256
`334A4CAA374030A7817CF050364525E910F7960F9B6968CEF47CFFBF3893F8BA`).
The official COCO `annotations/instances_train2017.json` member was range-read
and its central-directory CRC (`3932cf47`) and uncompressed size
(`469,785,474`) both matched.

For each requested LVIS class, this query takes a set union of `image_id` and
a separate set union of annotation `id`; it does **not** add the category-level
`image_count` fields. All 16 queried target categories had non-null, non-duplicate
annotation IDs in the queried rows. Every resulting LVIS image ID joined to an
official COCO `images[]` row (0 missing joins). A single LVIS annotation has
one `category_id`, so each family `unique instance IDs` value is an overlap-safe
union, rather than a sum that can double-count a shared image.

### Annotation rights and pixel rights are different gates

LVIS annotations are CC BY 4.0, but LVIS pixels originate in COCO. The
[official LVIS licence clarification](https://groups.google.com/g/lvis-dataset/c/JeWfhD3vioM)
and [LVIS API](https://github.com/lvis-dataset/lvis-api) therefore do not give
LVIS a blanket commercial pixel licence. The [official COCO terms](https://github.com/cocodataset/cocodataset.github.io/blob/master/dataset/termsofuse.htm)
similarly licence annotations under CC BY 4.0 while stating that the consortium
does not own the images and that image use must follow the applicable Flickr
terms. Thus the following are **annotation/candidate** counts, never a claim
that the pixels themselves are CC BY 4.0.

| COCO image licence ID | Name in official COCO metadata | Licence URL in official metadata | Conservative disposition |
| ---: | --- | --- | --- |
| 1 | Attribution-NonCommercial-ShareAlike | `http://creativecommons.org/licenses/by-nc-sa/2.0/` | Exclude: non-commercial. |
| 2 | Attribution-NonCommercial | `http://creativecommons.org/licenses/by-nc/2.0/` | Exclude: non-commercial. |
| 3 | Attribution-NonCommercial-NoDerivs | `http://creativecommons.org/licenses/by-nc-nd/2.0/` | Exclude: non-commercial. |
| 4 | Attribution | `http://creativecommons.org/licenses/by/2.0/` | Declared-licence **review candidate** only; require current original-page check and attribution ledger. |
| 5 | Attribution-ShareAlike | `http://creativecommons.org/licenses/by-sa/2.0/` | Review candidate only; require a written product policy for share-alike implications plus original-page check. |
| 6 | Attribution-NoDerivs | `http://creativecommons.org/licenses/by-nd/2.0/` | Exclude under the conservative default. |
| 7 | No known copyright restrictions | `http://flickr.com/commons/usage/` | Exclude: not a complete product licence record. |
| 8 | United States Government Work | `http://www.usa.gov/copyright.shtml` | Exclude by default until the originating agency/work status is documented. |

**Product-admission rule used here (policy, not legal advice):** default-deny
pixels. A training row may be admitted only after it retains the source record,
dataset/split/image ID, checksum, original and landing URLs, declared licence
URL, author/attribution, acquisition timestamp, and a recorded check of the
original page's then-current terms. ID 4 is the narrowest potentially usable
declared licence after that check; ID 5 requires a separate written policy.
The COCO image records provide `license`, `flickr_url`, and `coco_url`, but not
enough evidence to complete that check/attribution ledger. Therefore every
`product-admitted` count below is **0**, even when an image has an ID-4 or ID-5
declaration. This is intentionally stricter than treating a COCO annotation
licence as a pixel licence.

### Exact LVIS v1-train candidate counts joined to COCO image licences

`1/2/3/4/5/6/7/8` is the number of **unique image IDs** in that family carrying
each official COCO licence ID, in the same order as the table above. `ID4+5`
is an optimistic declared-licence review pool, not an admitted training count.
The ordinary hard-negative target is 150 frames per family; `trash_can` is
shown against its separate 1,200-positive target.

| Family and exact LVIS taxonomy | Unique instance IDs | Unique image IDs | COCO ID distribution `1/2/3/4/5/6/7/8` | ID 4 | ID 5 | ID 4+5 review pool | Numerical reading only | Product-admitted gate |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
| Direct bin: `trash_can` | 2,722 | 1,883 | 548/251/496/330/170/87/1/0 | 330 | 170 | 500 | **FAIL** LVIS-alone 1,200-positive target | **FAIL** 0/1,200 |
| Chair: `chair` | 11,549 | 1,927 | 548/273/502/314/193/92/5/0 | 314 | 193 | 507 | PASS at declared-pool level | **FAIL** 0/150 |
| Person/table: `person`, `table` | 16,243 | 3,766 | 1,021/560/1,006/635/349/181/14/0 | 635 | 349 | 984 | PASS at declared-pool level | **FAIL** 0/150 |
| Cart/stroller: `cart`, `handcart`, `shopping_cart`, `baby_buggy` | 792 | 473 | 129/58/128/82/55/20/1/0 | 82 | 55 | 137 | **FAIL** even at declared-pool level | **FAIL** 0/150 |
| Signboard: `signboard` | 8,091 | 1,826 | 454/290/504/305/179/86/8/0 | 305 | 179 | 484 | PASS at declared-pool level | **FAIL** 0/150 |
| Box: `box` | 7,855 | 1,828 | 576/250/444/286/193/77/2/0 | 286 | 193 | 479 | PASS at declared-pool level | **FAIL** 0/150 |
| Bag family: `plastic_bag`, `handbag`, `backpack` | 11,485 | 4,973 | 1,422/677/1,301/827/532/208/6/0 | 827 | 532 | 1,359 | PASS at declared-pool level | **FAIL** 0/150 |
| Bottle: `bottle` | 7,969 | 1,901 | 564/284/489/294/177/90/3/0 | 294 | 177 | 471 | PASS at declared-pool level | **FAIL** 0/150 |
| Barrel: `barrel` | 707 | 186 | 49/23/51/28/22/8/5/0 | 28 | 22 | 50 | **FAIL** even at declared-pool level | **FAIL** 0/150 |

There is no separate LVIS category literally named `bag`; the three exact,
non-overlapping requested bag labels above are the available direct taxonomy.
For the sparse cart family, the constituent values are: `cart` 51 instances /
28 images (ID4/ID5 = 3/5), `handcart` 204/91 (19/4), `shopping_cart` 90/43
(6/8), and `baby_buggy` 447/314 (54/38). The family union is 473 images, not
28+91+43+314, because 3 images occur in more than one constituent label.

### Open Images official metadata-only fallback query

Because the LVIS declared pool still falls short for cart/stroller and barrel,
the official [Open Images V7 download page](https://storage.googleapis.com/openimages/web/download_v7.html)
was queried using the exact legacy files it links for box data: V5 validation
and test boxes plus the matching official `2018_04` image-information CSVs.
This read 163,062,109 bytes of CSV metadata only—**no pixels**. The image rows
were joined on `ImageID` and required non-empty `OriginalURL`,
`OriginalLandingURL`, `License`, and `Author`. The V7 page documents those
fields and the [official V7 facts/licensing page](https://storage.googleapis.com/openimages/web/factsfigures_v7.html)
states that users must independently verify image licences; consequently these
are still declared-licence candidates, not product-admitted pixels.

| Exact Open Images class/family, validation+test only | Annotation CSV rows | Overlap-safe unique image IDs | Joined rows with complete provenance fields | Declared licence URL(s) | Reading |
| --- | ---: | ---: | ---: | --- | --- |
| `Waste container` | 142 | 96 | 96 | CC BY 2.0: 96 | Direct bin candidate only; not a 1,200-positive solution. |
| `Chair` | 3,297 | 1,255 | 1,255 | CC BY 2.0: 1,255 | Declared candidate volume. |
| `Person` + `Table` union | 74,098 | 30,269 | 30,269 | CC BY 2.0: 30,269 | Declared candidate volume. |
| `Cart` | 426 | 351 | 351 | CC BY 2.0: 351 | Supplies a cart candidate route; not a substitute for stroller subclasses. |
| `Traffic sign` | 212 | 114 | 114 | CC BY 2.0: 114 | Not counted as `signboard`; label semantics differ. |
| `Box` | 502 | 304 | 304 | CC BY 2.0: 304 | Declared candidate volume. |
| `Plastic bag` + `Handbag` + `Backpack` union | 476 | 381 | 381 | CC BY 2.0: 381 | No generic boxable `Bag` class was silently substituted. |
| `Bottle` | 1,978 | 828 | 828 | CC BY 2.0: 828 | Declared candidate volume. |
| `Barrel` | 276 | 106 | 106 | CC BY 2.0: 106 | Still below 150 in validation+test. |

Open Images has no boxable class named `handcart`, `shopping_cart`,
`baby_buggy`, `signboard`, or generic `bag`; `Cart` and `Traffic sign` above
are reported as explicit related classes only, never silently remapped. Its
box CSV has no `BoxID`, so the table reports exact annotation-row counts and
split-qualified image-ID set unions; it does not claim cross-class physical
object deduplication.

The official train metadata query is now complete. It streamed
[V6 train boxes](https://storage.googleapis.com/openimages/v6/oidv6-train-annotations-bbox.csv)
and the official
[train image information](https://storage.googleapis.com/openimages/2018_04/train/train-images-boxable-with-rotation.csv),
scanning 14,610,229 box rows and joining only target image IDs. No source
pixels were requested. The exact train results are recorded in
[`openimages-v7-train-sufficiency.json`](../../artifacts/dataset-readiness/openimages-v7-train-sufficiency.json):

| Exact Open Images train class | Boxes | Unique image IDs | Complete declared CC BY 2.0 provenance rows | Independently landing-page verified |
| --- | ---: | ---: | ---: | ---: |
| `Waste container` | 1,807 | 1,020 | 1,020 | 0 |
| `Cart` | 2,755 | 1,981 | 1,981 | 0 |
| `Barrel` | 2,086 | 662 | 662 | 0 |
| `Chair` | 132,483 | 25,504 | 25,504 | 0 |
| `Person` | 1,034,721 | 248,384 | 248,384 | 0 |
| `Table` | 85,691 | 44,845 | 44,845 | 0 |
| `Traffic sign` | 6,112 | 2,817 | 2,817 | 0 |
| `Plastic bag` | 986 | 517 | 517 | 0 |
| `Bottle` | 40,188 | 11,456 | 11,456 | 0 |
| `Box` | 5,364 | 2,212 | 2,212 | 0 |

This closes the *raw metadata-volume* gaps for `Cart` and `Barrel`; it does
not admit pixels or prove the theme-park bin-form taxonomy. The train report
also contains overlap-safe family unions and 50 deterministic candidate rows
per class for a later landing-page audit. Its `readyForTraining` field remains
`false` because independent verification was not performed.

### Commands and exact remaining gaps

The completed query can be reproduced without source-image downloads by
retrieving only the four official metadata archives/CSVs above, validating ZIP
members, then performing these operations:

~~~powershell
# Metadata only — never request train2017.zip or Open Images JPEGs.
$lvis = Join-Path $env:TEMP lvis_v1_train.json.zip
$coco = Join-Path $env:TEMP annotations_trainval2017.zip
Invoke-WebRequest https://dl.fbaipublicfiles.com/LVIS/lvis_v1_train.json.zip -OutFile $lvis
Invoke-WebRequest https://images.cocodataset.org/annotations/annotations_trainval2017.zip -OutFile $coco

# Parse lvis_v1_train.json annotations; for each named family take set unions
# of (image_id) and separately of (annotation id). Parse COCO's licenses and
# images arrays; join LVIS image_id == COCO image id; group image IDs by license.
# Then stream the Open Images V5 val/test box CSVs, retain only the explicit
# class MIDs documented above, and join their ImageIDs to 2018_04 image metadata.
~~~

The exact code path must preserve the raw licence distribution rather than
filtering before reporting it. Its current gaps are:

1. **Every production pixel count is 0.** COCO/LVIS needs original Flickr
   licence/attribution verification; Open Images needs the documented
   original-landing-page verification. Until rows pass that ledger, every
   listed hard-negative family remains `0/150` and no source may enter training.
2. **The Open Images train stream closes the raw `Cart` and `Barrel` volume
   gaps, but not the admission gate.** It provides 1,981 declared-CC-BY `Cart`
   and 662 `Barrel` image candidates with complete metadata fields. None has
   yet passed the required original-landing-page check, `Cart` cannot prove
   stroller subclasses, and neither class is a bin-form label.
3. **Do not add LVIS and Open Images headline counts.** Their Flickr-origin
   content can overlap and both require content/perceptual deduplication plus
   verified licence ledgers. The 1,500-frame total and two-independent-source
   gates are therefore still unproven.
4. **LVIS `trash_can` has only 500 optimistic declared ID4+ID5 candidates,**
   below 1,200. GBS has a separately CC BY 4.0 record with enough raw direct
   bin volume, but the required style/source-group review has not occurred;
   these sources must not be combined into a passing count yet.

The dataset scorecard remains **FAIL** and both training loops stay blocked.
No pixels were downloaded, no manifest rows were admitted, and no training was
started by this continuation.

### Wikimedia Commons API fallback assessment — **licence-aware raw-photo lead, not an annotated replacement**

Wikimedia Commons is a useful public-source lead only if every retained file
is queried individually. Its category pages are mutable discovery structures,
not a dataset licence or object-annotation format. The following are exact
**direct-file** counts returned on 2026-08-21 by the official
[MediaWiki `categoryinfo` API](https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=categoryinfo&titles=Category%3AWheelie_bins%7CCategory%3AWaste_baskets%7CCategory%3AWaste_containers%7CCategory%3AMobile_garbage_bins%7CCategory%3APedal-bins):

| Need | Official Commons category/API evidence | Direct files | Subcategories | What the API actually proves |
| --- | --- | ---: | ---: | --- |
| Wheeled / closed-lid candidate | `Category:Wheelie bins` | 110 | 5 | A wheelie-bin discovery pool, not a closed-lid field or box. Its direct children `Category:2 wheelie bins`, `Category:3 wheelie bins`, and `Category:Schwerkraftschloss` report 27, 21, and 5 direct files respectively; colour/country branches report 0 direct files but have 6 and 14 subcategories. Do not add these headline counts: files may belong to several categories. |
| Related mobile containers | `Category:Mobile garbage bins` | 50 | 0 | Related candidate pool only; no reliable wheel/lid subtype field. |
| Generic public-bin pool | `Category:Waste containers` | 331 | 28 | Larger raw pool, but category tree does not label `open_top`, `cylindrical`, or visible opening. |
| Open receptacle candidate | `Category:Waste baskets` | 67 | 7 | A receptacle discovery pool, not proof of open basket geometry. `Category:Public waste baskets` has 81 direct files / 7 subcategories and `Category:Indoor waste baskets` 36 / 0; do not sum them without page-ID deduplication. |
| Closed-lid related candidate | `Category:Pedal-bins` | 35 | 0 | Too small alone and not a wheelie-bin substitute. |
| Open-top / cylindrical bin | Exact category-title search: `"open top litter bin"`, `"cylindrical litter bin"` | 0 hits | — | The official API returned zero Category-namespace hits for both exact phrases; no typed Commons route was found. |

The official Category-namespace API gives a similarly machine-queryable raw
lead for hard negatives, but it does not make an image a verified negative:

| Hard-negative family | Direct official category files (with subcategory count) | Safe interpretation |
| --- | --- | --- |
| Chair | `Category:Chairs`: 2,447 (108) | Large raw pool; visual review must reject frames containing bins. |
| Person / table | `Category:People`: 486 (87); `Category:Tables`: 818 (39) | Large raw pools, not empty-label truth. |
| Cart / stroller | `Category:Shopping carts`: 124 (19); `Category:Baby carriages`: 181 (18); `Category:Hand trucks`: 78 (13); `Category:Pushcarts`: 63 (3) | Useful class-specific discovery, but no single API category proves 150 clean frames after review. |
| Sign / box | `Category:Information boards`: 455 (31); `Category:Pavement signs`: 22 (3); `Category:Boxes`: 556 (64) | `Category:Signboards` itself currently has 0 direct files, so related categories must not be silently remapped. |
| Bag / bottle | `Category:Plastic bags`: 336 (24); `Category:Bags`: 599 (73); `Category:Handbags`: 601 (31); `Category:Backpacks`: 304 (26); `Category:Bottles`: 687 (60) | Candidate volume only; category membership can include art, interiors, and context images. |
| Barrel | `Category:Barrels`: 386 (19) | Candidate volume only; visual review must separate storage barrels from bins. |

For each `File:` page, the official
[MediaWiki `imageinfo` API](https://www.mediawiki.org/wiki/Special:MyLanguage/API:Imageinfo)
returned the fields needed to build a per-file ledger: `url`, `sha1`, `mime`,
`width`, `height`, and `extmetadata` values `LicenseShortName`, `LicenseUrl`,
`UsageTerms`, `Artist`, `Credit`, `AttributionRequired`, `Copyrighted`, and
`ImageDescription`. A complete query of **direct** category members found the
following mixed licence metadata (not a blanket Commons licence):

| Direct category queried through `generator=categorymembers` + `imageinfo` | Files returned | Examples of exact `LicenseShortName` values returned | Files with non-empty `url`, `sha1`, `LicenseShortName`, `LicenseUrl`, `Artist`, and `AttributionRequired` |
| --- | ---: | --- | ---: |
| `Category:Wheelie bins` | 110 | Public domain 10; CC0 9; CC BY 2.0/3.0 variants 17; CC BY-SA 2.0/2.5/3.0/4.0 variants 73; `Copyrighted free use` 1 | 99 |
| `Category:Waste baskets` | 67 | Public domain 9; CC0 2; CC BY 2.0 7; Attribution 1; CC BY-SA variants 48 | 57 |
| `Category:Pedal-bins` | 35 | Public domain 1; CC0 8; CC BY 2.0 2; CC BY-SA variants 24 | 34 |
| `Category:Mobile garbage bins` | 50 | Public domain 3; CC0 4; CC BY 2.0/2.5/3.0 variants 8; CC BY-SA variants 33; `Copyrighted free use` 2 | 45 |

The field-completeness figure is **not** an admission count: public-domain
files can legitimately have no `LicenseUrl`, attribution strings are HTML and
need normalization, and current category membership does not prove the target
object is present or visible. A Commons row can become a review candidate only
after preserving the immutable file-page revision, returned SHA-1, licence
metadata, author/credit, and an explicit image-level semantic decision.

Neither `categorymembers` nor `imageinfo` returned bounding boxes, polygons,
or object-region coordinates. [Commons Structured Data](https://commons.wikimedia.org/wiki/Commons:Structured_data)
can record whole-image statements such as a depicted subject, but the queried category/file APIs do
not constitute localisation annotations. Accordingly **0 Commons images count
as automatically boxed positives, masks, or reviewed empty-label negatives**
in this audit. A selected hard-negative frame may later use an empty label
without drawing a box only after a reviewer verifies that it contains no bin;
every selected positive would need an existing trusted box or a new
human/assisted box.

**Commons decision:** it does not make the `>=300` wheeled/closed-lid,
`>=300` open-top/cylindrical, or `>=200` open-receptacle quotas plausibly
fillable *without manual/assisted box labelling*. The raw wheelie and waste
basket pools may help a future contact-sheet acquisition stage, but (a) their
categories do not encode the required appearance attributes, (b) no exact
open-top/cylindrical category route was found, (c) licence evidence is
per-file and mixed, and (d) the required annotations are absent. It may be a
low-cost source of licence-review candidates and hard-negative discovery
frames, but it changes none of the current training-entry gates.

## Discovery expansion — 2026-08-21: direct-access bin and overflow source search

This expansion looked beyond GBS, COCO/LVIS/Open Images and Commons for
first-party records with a realistic chance of closing the required bin-style,
state and confuser gates. It used record metadata, documentation, ZIP central
directories and annotation-only material where available. **No RGB/source
pixel archive was downloaded.** The only payload retrieved in this expansion
was pLitterStreet's 8.76-MB official annotation ZIP, not its 13.73-GB image
archive.

### Outcome — no product-admissible composition yet

The search found two useful new public localiser candidates, several
classification/asset-photo leads, and one particularly strong *but proprietary*
real overflow dataset. It did **not** find a public, commercially clear,
pixel-provenance-complete composition that passes all of the gates below.

| Gate | New product-admitted evidence | Status after this search |
| --- | ---: | --- |
| 1,200 explicitly boxed physical bins | 0 | **FAIL** — pLitterStreet and StreetScouting are conditional pools, not admitted rows. |
| 300 wheeled / closed-lid bins | 0 typed, approved rows | **FAIL** — several datasets have likely candidates, but no public annotation has a sufficient, approved style field. |
| 300 cylindrical / open-top bins | 0 typed, approved rows | **FAIL** — no discovered source exposes this appearance taxonomy or verified rim/opening geometry at the required scale. |
| 200 open receptacles | 0 typed, approved rows | **FAIL** — inventory/classification labels do not substitute for boxes plus appearance review. |
| 300 true overflow/rim-linked masks or reviewed crops | 0 | **FAIL** — the one large, real, purpose-built source is proprietary; public `dirty`/`full` datasets have the wrong semantics or source lineage. |
| 600 verified visible-lid/opening non-overflow crops and edge negatives | 0 | **FAIL** — none of the sources represents object-on-lid, adjacent bag, exposed liner and partial occlusion as negative state labels. |

Consequently, the scorecard stays **FAIL** and training remains blocked. In
particular, adding a generic `waste container` class would not correct the
observed false positives: it supplies neither a bin-opening relation nor the
counterexamples that distinguish an item *on/next to* a bin from material that
crosses that bin's rim.

### Direct public localiser candidates

#### pLitterStreet — best new boxed street-bin supplement, conditional

The authors' official [pLitterStreet Zenodo record](https://zenodo.org/records/8288500)
is CC BY 4.0 and provides `images.zip` (13,728,630,001 bytes,
`md5:02382a3b9620ae7b086ff4c7fd11891d`) plus `annotations.zip`
(8,764,662 bytes, `md5:2484e076b1e9d66036b0a15e9928692f`). The record says
the images were captured with vehicle-mounted cameras aimed at street sides;
this is much stronger source provenance than a generic web scrape, but the
archive/readme and a retained source ledger still need to be checked before
rows are admitted.

Reading only the official COCO annotation member establishes **13,064 image
rows**, **79,101 total annotations**, and exactly **768 `trash bin` boxes over
547 image IDs** (train 569/409 IDs, validation 123/84 IDs, test 76/54 IDs).
Those `547` IDs are annotation-image identifiers, **not** verified independent
physical bins or capture groups. The same file has 8,231 `plastic bag` boxes
over 4,655 image IDs and 1,896 `bottle` boxes over 1,496 image IDs, which can
become hard-confuser *review pools* only after proving a selected full frame
has no bin.

The dataset's annotation taxonomy is litter-oriented: it has no wheelie,
closed-lid, cylindrical, open-receptacle, rim, or overflow label. `litter` and
`pile` must never be remapped to overflow, and a trash-bag box must never be
declared an adjacent-bag negative without an explicit bin relationship review.
Thailand/Vietnam/Sri Lanka vehicle sequences may repeatedly observe the same
route/physical container, and the public COCO rows do not provide a
physical-bin ID. Group reconstruction from capture metadata and
perceptual/content deduplication are required.

**Strict disposition: CONDITIONAL.** It is the most promising new public
source for a real-world bin localiser after a small visual style audit, but it
adds **0** approved rows to any style or state gate today.

#### StreetScouting — CC-BY urban bin boxes, conditional and route-correlated

The authors' [StreetScouting Zenodo record](https://zenodo.org/records/7564876)
is CC BY 4.0. Its description machine-specifies 763 annotated PNG street
frames (432 at 1080×2160 and 331 at 866×2400) with a COCO file in
`annotated_dataset.zip` (2,258,875,915 bytes,
`md5:938841b07a10e31e6b944d0104ca2534`). It reports exactly **223 `Waste Bin`**
and **181 `Recycling Bin`** boxes: **404 explicit physical-container boxes**.
The record does not state the number of distinct annotated frames containing a
bin, so 404 is a box count, not an independent-image count.

The companion `routes.zip` is 6,882,452,419 bytes
(`md5:6c5b992d13b8e539552b5467ba103de1`) and contains four consecutive 2022
Thessaloniki drives with GPS: 41,650, 23,035, 18,000 and 18,273 frames. The
annotated images have random UUID filenames, so a relation to those routes is
not guaranteed by the public metadata. Treat all route/frame data as
potentially correlated until a provenance/linkage audit or perceptual grouping
proves otherwise. The labels have no bin form, opening/rim or state semantics.

**Strict disposition: CONDITIONAL.** This is a licence-clear, own-captured
urban localiser supplement after annotation-image/group verification and style
review. It cannot satisfy a state gate and cannot by itself fill any of the
three theme-park form quotas.

#### Urban Community Issues — sufficient looking count, strict provenance reject

The public [Urban Community Issues Zenodo record](https://zenodo.org/records/18871460)
declares CC BY 4.0 and one YOLO archive, `Data_sets.zip` (703,063,005 bytes,
`md5:d1560309bf372b14c896113722ae2532`). A metadata-only central-directory
check finds exactly **600 `waste_container` image entries and 600 corresponding
YOLO label entries**. That proves file entries, not 600 independent physical
containers or a form/state distribution.

The record itself declares that the archive is derived from Open Images and a
third-party Kaggle dataset. It retains neither original-image landing pages nor
per-image upstream licence/attribution evidence. Its `waste_container` label
also has no wheel/lid/opening/overflow semantics. A record-level CC BY
declaration does not cure this mixed upstream-pixel provenance.

**Strict disposition: REJECT for product training.** Do not use it to make the
1,200-bin gate appear complete. It could be reconsidered only if the authors
publish an image-level lineage ledger that passes the project's commercial-use
policy.

#### Cloud-Robotics — licensed semantic-mask lead, uncounted and conditional

The official [KubeEdge Ianvs Cloud-Robotics documentation](https://kubeedge-ianvs.github.io/documentation-ss.html)
points to its first-party [Kaggle dataset record](https://www.kaggle.com/datasets/kubeedgeianvs/cloud-robotics).
The record identifies an Apache-2.0, 16,371,712,298-byte collection captured
by a robotic dog in Huawei Shenzhen Industrial Park. The project documentation
describes about 2,600 outdoor semantic-segmentation images and a `dustbin`
class; the downloadable label layout uses `gtFine`/`TrainIds` semantic masks,
not waste-bin boxes or per-bin instances.

Neither the documentation nor metadata exposes a machine-verifiable count of
frames/pixels containing `dustbin`, its `TrainIds` integer mapping, bin style,
rim state, or per-frame physical-instance group. The visible source structure
has two capture-environment names (`20220420_front` and `20220420_garden`),
so even a large pixel count could be heavily correlated. It also contains none
of the required overflow or edge-negative semantics.

**Strict disposition: CONDITIONAL.** Confirm that the Apache-2.0 declaration
applies to the image pixels, determine the class mapping from official
metadata, then perform a label-only count and visual form/group audit. Until
then it contributes zero boxes or images to the gate.

#### GeoDE — licence-clear, diverse, classification-only candidate

Princeton's official [GeoDE project page](https://visualai.princeton.edu/geode/)
states CC BY licensing, **61,940** crowdsourced images, 40 classes and six
world regions; the authors say images were creator-permitted, no personally
identifiable people were retained, and the set can be downloaded from the
project's linked release. This is unusually clean public pixel provenance for
diverse object-centric photography.

GeoDE is image classification, not object detection or segmentation. Its
published regional table reports 1,677 class-labelled `dustbin` image records
(220+423+266+203+271+294) and 1,330 `waste container` records
(231+213+209+213+211+253). These are author-published category rows, not an
independent inspection of the downloadable manifest, and are **not** box or
physical-bin counts. An image can also include a secondary object; no
localisation, rim/opening, overflow, or confuser-relation annotation exists.

**Strict disposition: CONDITIONAL classification reference only.** It is a
good licence/provenance lead for a future assisted-box or visual-taxonomy
stage, but it is not a no-labelling route to the detector or state gates.

#### Bath & North East Somerset litter-bin survey — typed asset-photo lead, not labels

The [Bath:Hacked datastore's Council-attributed litter-bin survey](https://data.bathhacked.org/datasets/litter-bin-survey)
lists 1,255 survey rows under the UK Open Government Licence, with `Image`,
`BinType`, `AssetNo`, GPS and location fields. A metadata query found **1,246
unique image URLs**. This is useful because `BinType`/asset identity can guide
style selection and route-safe grouping rather than asking an operator to
upload localisation photos one by one.

It is not an annotated visual dataset: it provides no boxes, masks, fill/overflow
labels or opening/rim evidence. A sampled URL-access check returned only 503
responses, so the image endpoint availability and the applicability of the
licence to each hosted photo remain unproven. Multiple survey rows can also
refer to the same asset or photo.

**Strict disposition: CONDITIONAL discovery/inventory lead only.** Retain it
for possible batch recovery/contact-sheet metadata if the Council confirms
photo rights and restores access; it currently adds zero training pixels or
labels.

### Purpose-built state sources and near misses

#### BSITW (Agnew et al.) — exact state volume, but not shared

The University of Limerick record for [*Detecting the overfilled status of
domestic and commercial bins using computer vision*](https://pure.ul.ie/en/publications/detecting-the-overfilled-status-of-domestic-and-commercial-bins-u/)
confirms that its Bin Status in-the-Wild (BSITW) images came from real
commercial collection-route video for two types: automated-side-loader
wheelie bins and front-end-loader commercial containers. The official article
explicitly calls the data **proprietary** and says, “The authors do not have
permission to share data.”

The authors' published table reports 4,466 frames, 2,329 overfilled and 3,296
non-overfilled bin instances (5,625 total); these are reported statistics,
not independently machine-verified manifest counts, and must not be credited
to this audit. The research used fully supervised detection and instance
segmentation, which makes it the closest discovered source to the desired
state task. Its capture geometry is collection-truck-specific, likely contains
sequential repeated physical bins and does not evidence open-top/receptacle
coverage.

**Strict disposition: CONDITIONAL procurement/contact lead, otherwise REJECT
for public product training.** Only an explicit rights agreement covering
commercial training, model deployment, annotation export, retention and
grouped splits could admit it. Its existence proves that the desired
rim/overflow signal is feasible, not that the public pipeline may use it.

#### CDCM clean/dirty containers — reject as both a rights and semantic trap

The author-published [Clean/Dirty Containers in Montevideo Kaggle record](https://www.kaggle.com/datasets/rodrigolaguna/clean-dirty-containers-in-montevideo)
describes a current set of 1,806 `clean` and 1,608 `dirty` images. The
associated paper says that inputs came from Google Street View, individual
contributors, social networks, local news and a municipal complaint platform;
it also acknowledges near-duplicate views. The record's CC BY declaration
does not supply individual rights/attribution for those original pixels.

More importantly, the source's `dirty` semantic includes full containers and
piles of rubbish **beside** containers. It therefore encodes exactly the
adjacent-bag/ground-litter shortcut that caused the current system to declare
an object on or near a bin as overflow. It has no rim-crossing mask or
bin-opening linkage field.

**Strict disposition: REJECT.** It must not enter either the state-training
set or the real-state benchmark, even as a convenient source-labelled
substitute for overflow.

#### Waste Bin Dataset (Kirsch/Rexilius) — useful synthetic diagnostic, not real-state truth

The first-party [Waste Bin Dataset](https://huggingface.co/datasets/akirsch1/waste-bin-dataset)
contains image-level fill labels for **1,546 Unity-simulated** and **74 real**
images: 371/22 empty, 658/33 half-full and 517/19 full. The archive is
CC-BY-SA-4.0 and contains image folders, not detector boxes, masks, bin
instance IDs or rim relation annotations.

The 74 real images are far below the required state coverage, only 19 are
`full`, and `full` does not assert waste protrudes over a visible rim. The
simulation is valuable for a controlled *diagnostic* of a fill-level crop
classifier, but its score must remain separate from a real theme-park
overflow benchmark.

**Strict disposition: REJECT for production gates; diagnostic-only if the
project's licence policy accepts CC BY-SA.** It cannot demonstrate a
real-world overflow improvement.

#### Remondis Contamination Dataset — bag confuser pool only

The official [Remondis Contamination Dataset Zenodo record](https://zenodo.org/records/8248169)
is CC BY 4.0 and provides a 399,953,791-byte archive
(`md5:401f0592b2aa6147bf9d9165ef6e8f07`). Its record reports 1,125 truck/hopper
frames and 1,851 KITTI **plastic-bag** boxes. It states that the imagery mixes
Remondis historical records with unspecified “open source online resources.”

There is no bin box, container mask, lid/opening, overflow, or edge-negative
label. The data may show bins/hoppers, but that cannot be inferred from the
bag label. Its camera views and mixed web provenance also need sample-level
rights and grouping verification.

**Strict disposition: CONDITIONAL confuser-review pool only.** It may help
source verified bag negatives after commercial-lineage and full-frame review;
it contributes zero bin or state labels now.

#### Mobiusi trash-can lid-opening listing — commercial lead, not public evidence

The vendor's first-party [Trash Can Lid Opening Area Detection Dataset listing](https://www.mobiusi.com/datasets/037ab85e051028e93df462bc345358b4)
advertises 15,000 records / 3.7 GB with high-resolution images and JSON fields
such as opening-mechanism type and lid colour. It is described as proprietary
under a commercial AI-training licence and requires subscription/authorisation;
the advertised volume is a vendor claim, not a manifest count available to
this audit. It does not publish overflow/rim labels, style counts, original
pixel provenance or grouping information.

**Strict disposition: CONDITIONAL commercial procurement lead only.** A
written agreement and sample/manifest audit could make it relevant to visible
opening geometry, but no public gate count may use it.

### Additional source checks that cannot solve the licence gap

- The official [CADC devkit](https://github.com/mpitropov/cadc_devkit) has a
  `Garbage_Container_on_Wheels` 3-D detection class across its 7,000 annotated
  adverse-driving frames. Its own README licenses the pixels CC BY-NC 4.0, so
  it is **REJECTED** for commercial/product training regardless of potential
  wheelie-bin volume.
- The official [SearchAD record](https://huggingface.co/datasets/iis-esslingen/SearchAD)
  contains a `Trash Bin` rare-object class and could also supply strong chair,
  cart/stroller, sign and box confusers. It is explicitly CC BY-NC-SA 4.0 and
  combines eleven upstream autonomous-driving datasets with separate download
  terms. It is **REJECTED** for the same commercial-lineage reason.
- [Mapillary Vistas](https://github.com/mapillary/mapillary_vistas) exposes an
  instance `object--trash-can` category, but supplies no published bin-style
  or overflow count, requires account-mediated data access, and carries
  user-imagery/CC-BY-SA policy questions. It remains **CONDITIONAL** only
  until a product licence analysis and manifest query are complete.

### Consequence for the acquisition strategy

The strongest public combination discovered in this expansion is
pLitterStreet + StreetScouting for general street-bin localisation, possibly
supplemented by Cloud-Robotics/GeoDE/Bath after their stated checks. It cannot
be honestly summed into a gate pass: (1) pLitterStreet image IDs and
StreetScouting route observations require deduplication, (2) none provides the
three required bin-form labels, (3) the potential mask/classification sources
are not localisation labels, and (4) none supplies real, rim-linked state
negatives.

The search instead makes the least-effort viable boundary clear: batch
acquisition and assisted review can reduce per-image operator work for the
localiser, but it cannot eliminate a **small, deliberately captured
theme-park state set** (or a negotiated dataset rights agreement) for the
state classifier. Any next data action should use a capture-group manifest and
label only the bin, its opening/rim, and the four adversarial relations
(`on_lid`, `adjacent`, `liner`, `occluded`) rather than relabelling generic
litter as overflow. Until then, both Loop 1 and Loop 2 stay blocked.
