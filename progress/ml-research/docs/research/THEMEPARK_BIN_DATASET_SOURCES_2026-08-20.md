# Theme-park bin dataset sources and acquisition plan

Research date: 2026-08-20

## Decision

Do not scrape arbitrary web-image results and do not draw thousands of boxes.
Build the first localizer from public datasets that already contain bounding
boxes or instance masks, then use the supplied WhatsApp media only as a locked
theme-park regression set.

The most defensible low-effort mix is:

1. Open Images V7 and LVIS for broad `waste container` / `trash_can` positives;
2. CODa Re-ID for many viewpoints of persistent outdoor `Trash_Can` instances;
3. StreetView-Waste, after its data agreement is approved, for municipal
   container boxes and true overflow masks;
4. COCO/Open Images/LVIS non-bin categories for chair, person, table, cart,
   sign, bag and bottle hard negatives; and
5. the University of Malaya 200-image set as a Malaysian weak-label/domain
   supplement, not as ground-truth detection evaluation.

This data can bootstrap a theme-park proposal detector and a binary
`physical_bin` / `not_bin` verifier. It cannot, by itself, define the project's
state labels `normal`, `full`, `object_on_lid`, and `overflow`.

## Target appearance taxonomy from the supplied media

| Family | WhatsApp example | Online positive labels to collect | Important confusers |
| --- | --- | --- | --- |
| Wheeled, closed-lid bin | Tall green rectangular wheelie bin with black liner visible below the lid | `Waste container`, `trash_can`, `Trash bin Can`, StreetView `Default`/`Green` containers | chair backs, luggage, cabinets, signs, people |
| Open-top cylindrical bin | Black round/cylindrical bin with exposed liner and waste | `Waste container`, `trash_can`; also retrieve barrel/bucket candidates for review but do not automatically relabel them as bins | barrel, plant pot, stool, bucket, person |
| Open basket/bin | Black or woven/open receptacle whose waste is visible | `Waste container`, `trash_can`; retrieve `basket` candidates for review | picnic baskets, storage baskets, bags, chair seats |
| Overflow evidence | Waste crossing the opening or lying connected around a container | StreetView-Waste overflow masks; TACO litter masks as supplementary waste-shape data | object resting on a closed lid, adjacent loose bag, floor litter not connected to a bin |

The label unification rule should be conservative: only an upstream annotation
whose class explicitly denotes a waste/trash container maps automatically to
`bin`. `basket`, `barrel`, `bucket`, `cart`, or `storage box` must not be mapped
to `bin` without an automated similarity pass followed by batch approval.

## Primary-source matrix

| Priority | Source | Exact useful classes / annotations | Documented scale | Licence and access | Fit and limitation |
| --- | --- | --- | --- | --- | --- |
| 1 | [Open Images V7 description](https://storage.googleapis.com/openimages/web/factsfigures_v7.html), [download/API page](https://storage.googleapis.com/openimages/web/download_v7.html), [official boxable-class CSV](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv) | Bounding boxes include `Waste container` (MID `/m/0bjyj5`). The same official vocabulary has `Person`, `Chair`, `Table`, `Coffee table`, `Cart`, `Golf cart`, `Wheelchair`, `Traffic sign`, `Handbag`, `Backpack`, `Suitcase`, `Plastic bag`, `Bottle`, `Barrel`, `Box`, `Bench`, `Couch` and `Picnic basket`, so one source can provide positives and explicit blocker classes. The wider release also has image labels and instance masks, but waste-container mask coverage must be checked in the annotation metadata before assuming masks exist. | About 9M images overall; 16M bounding boxes for 600 classes on 1.9M densely annotated images. The official landing page does not publish a current per-class count for `Waste container`; query annotation metadata before committing to a quota. | Google licenses annotations under CC BY 4.0. Images retain per-image source licences and the official metadata includes original URL, landing page, author and licence. Google explicitly gives no warranty that every listed image licence is correct; preserve and audit those fields. | Best scalable first source because boxes already exist and negative classes match the WhatsApp chair/crowd failures. Web-photo viewpoint remains different from fixed CCTV. |
| 2 | [LVIS official API/repository](https://github.com/lvis-dataset/lvis-api), [LVIS paper](https://arxiv.org/abs/1908.03195) | COCO-style bounding boxes and high-quality instance masks for 1,203 categories. The official annotation vocabulary includes `trash_can` (synonyms cover garbage can, wastebin, dustbin and trash bin), plus `basket`, `barrel`, `baby_buggy`, `chair`, `table`, `bag`, `bottle`, and many other hard negatives. LVIS records `neg_category_ids`, which is especially useful for verified no-bin training images. | LVIS v1 contains 159,623 images: 100k train and roughly 20k each for val, test-dev and test-challenge. Category records include `image_count` and `instance_count`; use these rather than estimating class volume from thumbnails. | LVIS annotations are CC BY 4.0; the pixels are COCO/Flickr images and retain their underlying image terms. Keep COCO image licence IDs and source URLs in the manifest. | Strong positive masks and explicit category-negative metadata. Long-tailed `trash_can` coverage may be modest, and the photographs are not theme-park CCTV. |
| 3 | [CODa Re-ID / CLOVER official repository](https://github.com/ut-amrl/clover), [official data record](https://doi.org/10.18738/T8/E9WFTW) | Eight outdoor classes include exact `Trash_Can`. Each observation has persistent physical-object ID, 2D box and segmentation mask; the same object is seen across viewpoint, weather and lighting changes. `Informational_Sign` and `Traffic_Sign` add useful hard negatives. | 1,037,814 observations of 557 physical instances across eight classes. The official page does not state the `Trash_Can`-only count. | The authors state CODa Re-ID is MIT licensed. The annotation pack is about 90 MB compressed, but raw camera streams are very large (roughly 500 GB for all camera-0 sequences). Use only sequences that actually contain trash cans and retain the official record. | Excellent for a reference-gallery verifier and viewpoint robustness. Highly correlated repeated observations must be split by physical instance/route, not random frame. It is an outdoor mobile-robot domain, not indoor CCTV. |
| 4 | [StreetView-Waste official dataset page](https://streetview-waste.di.ubi.pt/), [official repository](https://github.com/DiogoJPaulo/StreetView-Waste) | Seven boxed container classes: `Default`, `Green`, `Blue`, `Yellow`, `Biodegradable`, `Oil`, and `Battery`; persistent tracking IDs; and pixel masks for overflowing waste/litter around containers. | 36,478 fisheye images, 71,170 container boxes, 376 container tracks. The segmentation benchmark has 7,230 images and 5,149 overflow masks; 4,197 images are positive and the remainder provide negatives. | Access is gated by a separate data licence agreement for GDPR-compliant academic use. The repository's MIT code licence does **not** license the dataset pixels. Review the signed agreement before download, commercial training, checkpoint distribution, or derivative-data sharing. | Only verified source found with both container localization and genuine surrounding-overflow masks at useful scale. Its European curbside/fisheye domain differs materially from theme-park indoor and walkway bins. |
| 5 | [University of Malaya three-bin Figshare record](https://figshare.com/articles/figure/Solid_waste_bin_images_with_3_bin_per_node/6269042), [official metadata API](https://api.figshare.com/v2/articles/6269042) | Each disposal-node image contains three bins that may be shifted, rotated, or occluded by trash. The release is individual JPG images and does not include machine-readable boxes/masks or state labels. | 200 images; the authors describe a 100-train/100-test experiment. | CC BY 4.0 according to the Figshare record; preserve attribution and record/file MD5 values. | Useful Malaysian appearance/domain supplement. It is one repeated three-bin layout, so adjacent images are highly correlated. Generate weak boxes only for training and keep a source-separated portion untouched. Do not call its three-bin count proxy mAP. |
| 6 | [COCO official dataset](https://cocodataset.org/dataset/home.htm), [2017 detection task](https://cocodataset.org/dataset/detection-2017.htm) | COCO has masks/boxes for `person`, `chair`, `couch`, `dining table`, `bottle`, `backpack`, `handbag`, `suitcase`, `cell phone`, and related blockers. It has **no waste-bin/trash-can positive class**. | 330k images, more than 200k labelled, 1.5M object instances and 80 object categories; the 2017 detection task has more than 500k segmented train/validation instances. | Annotations are CC BY 4.0; images retain per-image Flickr licences. Preserve the licence ID/source information and exclude non-commercial pixels from a commercial training mix. | Best ready-labelled negative/blocker source and already aligned with the current blocker model. It cannot improve bin recall by itself. |
| 7 | [TACO official repository](https://github.com/pedropro/TACO), [authors' paper](https://arxiv.org/abs/2003.06975) | Manually reviewed litter instance segmentations in COCO format and a hierarchical 60-category taxonomy dominated by bottles, cans, bags/wrappers and cups. It labels litter, **not the physical bin**. Use only the reviewed official annotation JSON; the repository warns its weekly `annotations_unofficial.json` is unreviewed. | 1,500 images and 4,784 annotations in the documented release. | The toolkit/code is MIT. Pixels are hosted on Flickr and retain source-specific licences; preserve each URL/licence/attribution record. Do not infer a blanket pixel licence from the repository's code licence. | Helpful for learning waste appearance inside/around an already verified bin, but it is mostly woods, roads and beaches and supplies neither bin boxes nor `full`/`object_on_lid` state labels. |
| Conditional only | [Objects365 official site](https://www.objects365.org/), [official download/licence page](https://www.objects365.org/download.html), [authors' ICCV paper](https://openaccess.thecvf.com/content_ICCV_2019/html/Shao_Objects365_A_Large-Scale_High-Quality_Dataset_for_Object_Detection_ICCV_2019_paper.html) | Boxes include `Trash bin Can`, `Chair`, `Bottle`, `Desk`, `Handbag/Satchel`, `Storage box`, `Bench`, `Couch`, `Basket`, `Barrel/bucket`, `Traffic Sign`, `Dining Table`, `Trolley`, `Stroller`, and `Wheelchair`. | The current official site reports 2M images and 30M boxes over 365 categories (the original ICCV release described over 600k train images and more than 10M boxes). | The official download page says the dataset is available for **academic purpose only**. Annotations/site are CC BY 4.0, images remain subject to Flickr terms, users may not redistribute images. | Very relevant vocabulary, but exclude from a commercial/product checkpoint unless the owner grants suitable permission. It is acceptable for a clearly isolated academic experiment. |

## Sources to reject or quarantine

- **Google/Bing image-search results:** search visibility is not a licence, boxes
  are absent, duplicates are common, and provenance is difficult to reproduce.
- **Kaggle, Roboflow Universe, and Hugging Face repacks without an upstream
  record:** a platform licence field does not prove that the uploader owned the
  pixels or annotations. Use the official upstream source, or quarantine the
  data until provenance is documented.
- **Fill-level datasets with only `empty`/`half`/`full` image-level labels:**
  these may help state experiments but cannot train a full-frame localizer
  without boxes. Many public copies have unclear origin.
- **Objects365 in a production mix:** the official page limits it to academic
  use. Do not hide that restriction by using a third-party converted copy.
- **StreetView-Waste before agreement review:** its code licence and dataset
  agreement are different things.
- **TACO as bin-positive data:** litter is not a physical bin. Mapping its
  objects to `bin` would recreate the current item-on-top false positive.

## Acquisition and training plan with minimal manual effort

### Phase 0 — preserve the acceptance set

Keep all supplied WhatsApp images/videos out of training, pseudo-labelling and
threshold fitting. Tag them as locked cases:

- `green_wheelie_closed_lid`;
- `black_open_top`;
- `open_basket_bin`;
- `chair_people_no_bin`; and
- `object_on_lid_not_overflow`.

They remain the product-specific evidence that an online-trained candidate
actually transfers to the intended scenes. The visible attributes in the
taxonomy above may define text queries and coverage buckets, but do not compute
retrieval embeddings from these exact pixels or use their results to select
training samples. If pixel-level similarity retrieval is later required,
capture a separate reference-only clip and keep it out of acceptance scoring.

### Phase 1 — metadata-only source audit

Before downloading pixels, query each official annotation/API and write one
manifest row per candidate with:

```text
source,source_image_id,source_instance_id,physical_instance_id,class,
annotation_type,box_or_mask,original_url,landing_url,licence,author,
commercial_use_status,split_group,sha256
```

Count the exact `Waste container`/`trash_can`/`Trash_Can` positives and blocker
classes from metadata. Stop if a licence or original landing page is missing.
This is the point at which "enough" is measured; do not assume the headline
dataset size applies to the bin class.

### Phase 2 — automatic subset construction

1. Download only relevant Open Images/LVIS/CODa instances and their annotated
   images. Do not fetch whole multi-hundred-gigabyte datasets.
2. Convert upstream boxes/masks directly to the project's one-class `bin`
   YOLO format. No hand-drawn box is needed.
3. Build explicit negative frames/crops from `person`, `chair`, `table`,
   `cart`/`stroller`, `sign`, `bag`, `box`, `barrel`, `basket`, `bottle`, and
   `wheelchair`. Preserve the original non-bin class as `negative_reason`.
4. For ambiguous `basket`/`barrel` candidates, rank crops using the text-defined
   style taxonomy and public-source exemplars, not embeddings of the locked
   WhatsApp pixels. Put only uncertain nearest matches on contact sheets for
   one-click accept/reject; never auto-map the entire class to `bin`.
5. Collapse adjacent/repeated CODa and Malaysian frames by perceptual hash and
   cap observations per physical instance so one bin does not dominate.

Initial acquisition gates (unique source images after deduplication):

| Bucket | Minimum before first training run |
| --- | ---: |
| Explicit waste/trash-container positives | 1,200 |
| Wheeled/rectangular-lid candidates | 300 |
| Open-top/cylindrical candidates | 300 |
| Basket/open-receptacle candidates approved as actual waste bins | 200 |
| Chair/person/table/cart/sign/bag/bottle hard negatives | 1,500 total, at least 150 per high-risk family |
| True overflow masks/crops | 300, source licence permitting |

These are engineering start gates, not claims about what any source contains.
If metadata cannot meet a style quota, do not fill it with unlicensed search
results. Fill that gap using automatically sampled, tracked video from actual
park bin designs.

### Phase 3 — leakage-safe split

Split by source and physical object/location, never random image:

- all observations of one CODa trash can stay in one split;
- all adjacent Malaysian frames from one capture sequence stay together;
- StreetView tracks stay together; and
- near duplicates across Open Images/LVIS/COCO are detected by content and
  perceptual hash before splitting.

Keep at least one complete public source out of training for cross-source
testing. Public-source validation must never replace the locked WhatsApp test.

### Phase 4 — train two narrow models

1. **One-class localizer:** train only `bin`; use explicit empty-label negative
   frames. Start from an Open Images/LVIS-capable detector rather than a COCO-only
   model because COCO has no bin class.
2. **Binary crop verifier:** `physical_bin` versus `not_bin`; oversample the
   supplied failure families (chairs, tables, people, carts, signs, bags). The
   verifier, not the proposal detector, decides whether a box may reach the
   state stage.

Do not train `normal/full/overflow` from these localization labels. Build the
state model only from sources with explicit state evidence, and retain a
non-alerting `unknown` outcome.

### Phase 5 — promotion gates

A candidate is not promotable unless it satisfies all of these on untouched
media:

- zero accepted bins on `chair_people_no_bin`;
- no chair/table/cart/sign/bag crop passes the binary verifier;
- at least 90% verified-bin track recall for each supplied positive-bin video;
- zero overflow alerts for an object merely resting on a closed lid;
- at least 90% generic precision/recall/mAP50 on source-separated public tests;
  and
- licence ledger has no `unknown`, `academic-only`, or `non-commercial` item in
  the production training lineage.

## Remaining gaps

1. No verified public source above labels the distinction between an object
   resting on a closed lid and waste crossing that exact bin's rim.
2. Public data is dominated by web photos, outdoor robots or curbside fisheye
   imagery; it does not reproduce crowded theme-park CCTV scale and placement.
3. The black open-top and basket-like park bins are semantically ambiguous with
   ordinary baskets, barrels and plant pots. A small amount of park-design
   evidence is unavoidable, but it can be captured as short videos and tracked
   automatically rather than boxed frame by frame.
4. Public headline sizes do not guarantee sufficient examples of each bin
   design. Exact class/style quotas must be computed from metadata and an
   automatic visual clustering pass before download/training.

The practical conclusion is that online data can remove nearly all manual box
annotation and produce a much stronger generic localizer/verifier. It cannot
remove the need for a small, locked theme-park validation set or supply the
business definition of overflow.
