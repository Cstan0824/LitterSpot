# Theme-park bin localiser admission audit — pLitterStreet and StreetScouting

**Audit date:** 2026-08-21
**Scope:** metadata and annotations only. This is a localiser-source audit; it
does not treat either dataset as an overflow-state source.

## Decision

Neither dataset is admitted to Loop 1 today. Both have a clear **record-level
CC BY 4.0 declaration**, and both are plausible *candidate* sources for a
generic bin localiser, but their present annotations cannot establish the
required bin form, rim/opening relation, overflow state, or independent
evaluation groups.

| Dataset | Record-level rights and capture claim | Candidate localiser evidence | Current Loop 1 admission | State-classifier admission |
| --- | --- | ---: | --- | --- |
| pLitterStreet | Open, CC BY 4.0; record says vehicle-mounted cameras captured street-side images | Choose **one** annotation variant: 10-class has 768 bin boxes / 547 frames; 4-class has 932 bin boxes / 659 frames | **0 rows admitted.** Re-split by capture folder, choose one variant, verify source-file mapping, and complete a visual style audit first. | **0.** No overflow, rim, lid, or opening label exists. |
| StreetScouting | Open, CC BY 4.0; record says its four route collections were captured in 2022 | 404 bin/recycling-bin boxes / 234 frames | **0 rows admitted.** There is no split or annotation-to-route mapping; obtain/derive group mapping and perform a visual style audit first. | **0.** No overflow or rim/opening label exists. |

The clear record licences make either source reasonable to **stage under a
licence-and-attribution manifest** after organisational approval. They do not
make its pixels, capture groups, or visual semantics automatically safe ground
truth for this product. In particular, no image-level licence/provenance fields
are present in either COCO payload.

The raw box counts must not be mistaken for the project gate of 1,200
independent physical bin positives:

* The conservative 10-class pLitterStreet choice plus StreetScouting is only
  **1,172 raw boxes** (768 + 404), already 28 short of that numerical gate.
* The 4-class pLitterStreet choice plus StreetScouting is **1,336 raw boxes**
  (932 + 404), but those are still boxes rather than independently verified
  physical bins; the style quotas and leakage controls remain unmet.
* The 10-class and 4-class pLitterStreet variants overlap. They must never be
  added together.

## Audit method and evidence boundary

The audit queried the authors' official Zenodo records and read only their
annotation material. It did **not** download RGB/source-image payloads.

* For pLitterStreet, the 8.76-MB official `annotations.zip` was read in memory
  and its MD5 was calculated. The large image ZIP was inspected only through
  ZIP central-directory ranges, which contain filenames and archive metadata,
  not image bytes.
* For StreetScouting, the 2.26-GB image-and-annotation archive was not
  downloaded. Its central directory and the compressed
  `coco_annotations.json` member were range-read; the member's ZIP CRC was
  verified after decompression. No PNG payload was requested.

Archive-member results below are reproducible from the official record files;
they are not claims made by a third-party mirror.

## pLitterStreet

### Official provenance and archive integrity

The authors' [official pLitterStreet Zenodo record](https://zenodo.org/records/8288500)
(DOI `10.5281/zenodo.8288500`) is open and declares
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.en). Its
description says that vehicle-mounted cameras were positioned toward the sides
of streets. The authors' [pLitter project repository](https://github.com/gicait/pLitter)
links to this DOI and names Thailand, Vietnam, and Sri Lanka collection
locations. That is useful source-level capture provenance, but it is not a
per-image rights ledger.

| Record file | Record size | Record MD5 | Audit result |
| --- | ---: | --- | --- |
| `images.zip` | 13,728,630,001 bytes | `02382a3b9620ae7b086ff4c7fd11891d` | ZIP64 central directory enumerates 15,138 image files (14,942 `.jpg`, 196 `.jpeg`). No image data was read and the whole-file MD5 was not recalculated. |
| `annotations.zip` | 8,764,662 bytes | `2484e076b1e9d66036b0a15e9928692f` | **PASS:** annotation-only download calculated the same MD5. |

The annotation archive contains two alternative annotation families:
`annotations/10_class_splits/` and `annotations/4_class_splits/`. The latter
does not merely describe an additional independent dataset: its 15,138
filenames include every one of the 13,064 filenames in the 10-class family,
then add 2,074 more. Select one family and record that decision in the source
manifest.

### Exact localisation evidence

| Annotation family | Image rows | Annotation rows | Bin category | Bin boxes | Bin-bearing image rows | Split details |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| 10-class | 13,064 | 79,101 | `trash bin` (category 4) | 768 | 547 | train 569/409, validation 123/84, test 76/54 (boxes/images) |
| 4-class | 15,138 | 88,060 | `Trash bin` (category 4) | 932 | 659 | train 745/526, validation 94/65, test 93/68 (boxes/images) |

The 10-class record is the cleaner choice for the first group-leakage audit.
It has ten litter-oriented categories (`litter`, `pile`, `face mask`, `trash
bin`, `plastic bag`, `bottle`, `cup`, `rope`, `sachet`, `straw`). Its bin
annotations have COCO boxes, `area`, `iscrowd`, and implementation metadata,
but no segmentation, bin-style, rim, opening, fullness, or overflow field.
The selected bin rows had empty image and annotation `metadata` objects.

The data is geographically concentrated even before visual review: of the 768
10-class bin boxes, 554 are from the `Rangsit_2021` path namespace, 108 from
`Taladthai_2021`, 78 from `Chiangrai_2021`, 22 from `Ubon_2022`, four from
`Mekong_2020`, and one each from `Hanwella_2022` and `Mawanella_2022`.
This is an important domain-balance warning for a theme-park deployment.

### Split-leakage finding

The official 10-class train/validation/test image IDs and filenames are
disjoint. That check alone is insufficient. The author-supplied `path` field
has the form `/datasets/<place_year>/<capture-folder>/<filename>`. Treating
`<place_year>/<capture-folder>` as a **candidate capture group** produces the
following result for bin-bearing rows:

| Measure | Result |
| --- | ---: |
| Candidate capture folders containing a bin | 79 |
| Folders occurring in more than one official split | 47 |
| Bin boxes in a cross-split folder | 703 / 768 |
| Bin-bearing frames in a cross-split folder | 503 / 547 |
| Train / validation / test boxes in a cross-split folder | 515 / 569; 116 / 123; 72 / 76 |

These path components are not author-certified physical-bin IDs, so this does
not prove that every same-folder frame shows the same bin. It *does* prove that
the published image split separates frames from the same labelled capture
folder. It must not be used as the project benchmark. Rebuild all splits at the
capture-folder level and then use image-content deduplication after pixels are
authorised for acquisition.

### pLitterStreet admission checklist

| Required action | Status | Why it matters |
| --- | --- | --- |
| Retain Zenodo DOI, creators, CC BY 4.0 text, and the two record checksums in a source manifest | Required | Preserves attribution and the record-level rights evidence. |
| Verify the full `images.zip` MD5 after an authorised acquisition | Pending | The image archive itself was intentionally not downloaded in this audit. |
| Select **only** the 10-class or 4-class family | Required | The families share all 10-class frames; combining them duplicates source pixels. |
| Match selected annotation filenames to the downloaded source archive | Pending | Central-directory counts agree with the 4-class family, but a filename-level manifest is still required. |
| Replace the supplied random frame split with a capture-folder split | Required | 47 of 79 bin-containing folders cross supplied splits. |
| Make contact sheets and label bin form: wheeled/closed-lid, cylindrical/open-top, open receptacle, and reject/uncertain | Required | None of those semantics is in the COCO labels. |
| Build an independent theme-park holdout, including chair/cart/sign/box confusers | Required | Street-litter frames alone do not prove performance against the observed false positives. |
| Keep `litter`, `pile`, and `plastic bag` out of the overflow target | Required | They do not encode a material-to-rim relationship. |

**pLitterStreet disposition:** conditional, localiser-only candidate; **zero
currently admitted training or evaluation rows**.

## StreetScouting

### Official provenance and archive integrity

The authors' [official StreetScouting Zenodo record](https://zenodo.org/records/7564876)
(DOI `10.5281/zenodo.7564876`) is open and declares
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.en). It says
that all street data was collected in 2022 and describes four consecutive
driving routes in Thessaloniki with per-frame GPS data.

| Record file | Record size | Record MD5 | Audit result |
| --- | ---: | --- | --- |
| `annotated_dataset.zip` | 2,258,875,915 bytes | `938841b07a10e31e6b944d0104ca2534` | Central directory has 766 entries: 763 PNG frames, two directories, and `coco_annotations.json`. Only the annotation member was read. Its 806,049-byte decompressed content passed ZIP CRC-32 `63c795e3`. Whole-file MD5 remains pending authorised download. |
| `routes.zip` | 6,882,452,419 bytes | `6c5b992d13b8e539552b5467ba103de1` | Not downloaded or inspected beyond official record metadata. |

The route descriptions list 41,650, 23,035, 18,000, and 18,273 frames
respectively (100,958 total), but they are not mapped to the UUID-named
annotated PNGs by the available COCO file.

### Exact localisation evidence

The record prose calls the two relevant labels “Waste Bin” and “Recycling
Bin”; the actual COCO category names must be used by ingestion code:

| COCO category | Category ID | Boxes | Image rows with category |
| --- | ---: | ---: | ---: |
| `Bin` | 2 | 223 | 176 |
| `Bin_recycle` | 3 | 181 | 133 |
| **Union** | — | **404** | **234** |

Seventy-five frames contain both categories. The full COCO file has 763 image
rows and 3,670 annotations across five categories (`Tree`, `Bin`,
`Bin_recycle`, `Shop`, `Street Light`). All 3,670 boxes have positive width
and height. Every `segmentation` value is empty and every annotation
`attributes` value is exactly `{"occluded": false}`. Thus the source supplies
ordinary detection boxes, not instance masks or meaningful occlusion/state
metadata.

### Grouping and leakage limitation

StreetScouting ships no train/validation/test field. Its COCO image records
contain random UUID filenames; for the 234 bin-bearing rows their
`date_captured` is `0`, `license` is `0`, and `flickr_url`/`coco_url` are blank.
The root `info` and `license` entries are likewise blank placeholders. There
is no route ID, GPS coordinate, frame number, capture timestamp, physical-bin
ID, or route-to-annotation mapping in the inspected schema.

Consequently, the four route collections establish a high risk of correlated
views, while the data needed to group the 763 annotated frames is missing.
Do not randomly split this COCO file. Obtain a UUID-to-route/frame mapping
from the authors or derive one with post-acquisition content/temporal matching;
until then it can only be a candidate training pool, not an independent
benchmark source.

The category names also cannot identify wheeled versus cylindrical/open-top
versus open receptacle forms. This cannot be inferred from metadata: it needs
a visual review of selected frame crops after source-pixel acquisition is
authorised.

### StreetScouting admission checklist

| Required action | Status | Why it matters |
| --- | --- | --- |
| Retain Zenodo DOI, creators, CC BY 4.0 text, and record checksums in a source manifest | Required | Preserves attribution and the record-level rights evidence. |
| Verify full archive MD5 after authorised acquisition | Pending | Only metadata and the JSON member CRC were checked here. |
| Map UUID annotations to a route/frame/GPS group, or obtain that mapping from the authors | Blocking | Without it, correlated frames cannot be excluded from evaluation. |
| Create group-aware train/validation/test splits after the mapping step | Blocking | The supplied COCO has no split. |
| Visually type/review selected bins and mine theme-park confusers | Required | `Bin` and `Bin_recycle` do not describe bin geometry or common false positives. |
| Use boxes only for localisation; never remap either class to overflow | Required | The data contains no lid, opening, fullness, or overflow truth. |

**StreetScouting disposition:** conditional, localiser-only candidate; **zero
currently admitted training or evaluation rows**.

## What can safely happen next

1. Keep both datasets in the candidate ledger with the exact counts above;
   do not count them as completed gate volume.
2. When acquisition is authorised, choose the 4-class *or* 10-class
   pLitterStreet variant, checksum it, create a filename/source manifest, and
   re-split by capture folder before any training.
3. Request StreetScouting's UUID-to-route/frame mapping. If it cannot be
   supplied, use it only for non-benchmark localiser augmentation and exclude
   it from all validation/test claims.
4. Run a batched contact-sheet review to fill the bin-form taxonomy and reject
   non-theme-park or uncertain examples. This is a small review step, not
   one-by-one full-image labelling.
5. Keep the overflow classifier blocked until a source supplies reviewed
   rim-linked overflow and explicitly reviewed edge negatives. Neither audit
   target changes that requirement.
