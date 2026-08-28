# CDW-Seg held-out acquisition record

Acquired: 2026-08-25
Source: [Figshare article 28573229](https://api.figshare.com/v2/articles/28573229)
DOI: `10.6084/m9.figshare.28573229.v1`
License: CC0 ([license text](https://creativecommons.org/publicdomain/zero/1.0/))

## Locked archive

| Field | Value |
| --- | --- |
| Publisher file | `Ground_Truths_COCO_Format.zip` |
| Figshare file ID | `52959722` |
| Download URL | `https://ndownloader.figshare.com/files/52959722` |
| Bytes | `920164601` |
| Publisher MD5 | `c7c5be4923673a47c0ebaee36ac7ab8a` |
| Local MD5 | `c7c5be4923673a47c0ebaee36ac7ab8a` |
| Local SHA-256 | `92b54647a6b196cc59aa5bade3c4dc09f79b006f0ad79167ad0b6305b8355524` |

The archive contains 430 images and 5,413 annotations. It does not contain a
publisher split file. The acquisition script therefore selects the last 43
lexicographically sorted image IDs and labels them `test_proxy`; this is a
deterministic held-out stress subset, not a claim that the original publisher
test partition was recovered.

## Local subset

- 43 images, 334 annotations;
- categories include `BIN` and the contained-material classes;
- extracted pixels and COCO JSON are under ignored
  `data/heldout-evaluation/cdw-seg/test-proxy/`;
- extraction is reproducible with
  `python scripts/acquire_cdw_seg_heldout.py`;
- `trainingUse=false`, `thresholdSelectionUse=false`, and
  `promptSelectionUse=false` are locked in the generated manifest.

This source is valid for bin-presence/localization and contained-waste hard
negative stress. It has no rim-crossing overflow truth, so it must not be used
to claim overflow recall or to tune the replacement threshold.
