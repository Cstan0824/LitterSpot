# Theme-park bin data admission pilot — 2026-08-21

## Decision

There is now **enough discovered raw localiser candidate volume**, but still
not enough **product-admitted data** to start either training loop.

The useful change in this phase is that the Open Images candidate process is
now evidence-driven and reproducible. A class-balanced sample contains actual
bins, and 36 of 50 sampled bin landing pages passed the strict licence and
author check. Those 36 are rights/provenance candidates only: their pixels
have not been downloaded and their theme-park bin form has not been visually
confirmed.

The overflow-state gate remains the hard blocker. None of the freely usable
boxed localiser datasets labels the relation that matters to this product:
material crossing a bin rim/opening versus an object resting on a closed lid,
an adjacent bag, an exposed liner, or ordinary occlusion.

## Actions completed

1. Regenerated the official [Open Images V7](https://storage.googleapis.com/openimages/web/download_v7.html)
   train metadata audit over 14,610,229 bounding-box rows. No image URL was
   opened by that audit.
2. Fixed a sampling defect. The previous global lexical 50-row slice contained
   46 person rows and zero bins. Candidate rows are now the union of each
   class's bounded quota, yielding 674 metadata candidates including 50 bins.
3. Added a landing-page verifier that emits exactly `verified`, `rejected`, or
   `manual_review`. It reads HTML landing pages only, refuses to read non-HTML
   bodies, stores body hashes for evidence, handles localized Creative Commons
   deed URLs, rejects contradictory licences, and retries transient failures.
4. Audited [pLitterStreet](https://zenodo.org/records/8288500) and
   [StreetScouting](https://zenodo.org/records/7564876) annotations without
   downloading source-image pixels.
5. Prepared, but did not send, rights requests for
   [StreetView-Waste](https://github.com/DiogoJPaulo/StreetView-Waste#dataset-overview)
   and [SF311/DataSF](https://data.sfgov.org/api/views/vw6y-z8j6).

No training was started, no external request was submitted, and no image
pixels were downloaded in this phase.

## Exact candidate evidence

| Source | Direct localiser evidence | Rights/provenance result | Group/style result | Current training admission |
| --- | ---: | --- | --- | ---: |
| Open Images V7 train | 1,807 `Waste container` boxes / 1,020 images | All 1,020 metadata rows declare CC BY 2.0 and have the five provenance fields. Live first-50 landing-page pilot: 36 verified, 5 rejected, 9 manual review. | No bin-form, rim, state, site, or physical-bin grouping field. Pixels not reviewed. | 0 |
| pLitterStreet 10-class | 768 boxes / 547 frames | Official record is CC BY 4.0; annotation archive checksum passed. | 47/79 bin-bearing capture folders cross supplied splits; no style/state labels. | 0 |
| pLitterStreet 4-class alternative | 932 boxes / 659 frames | Same record and source pixels as the overlapping 10-class variant; choose one, never add both. | Must be capture-folder re-split and visually audited. | 0 |
| StreetScouting | 404 boxes / 234 union frames | Official record is CC BY 4.0; COCO member CRC passed. | No split or annotation-to-route linkage; no style/state labels. | 0 |

Using the larger pLitter variant, the three sources expose at most 1,913 raw
candidate image rows before cross-source deduplication (1,020 + 659 + 234).
That clears the *discovery-volume* threshold of 1,200, but it is not an
admission count and does not prove 1,200 independent physical bins. The first
50 Open Images rows were selected lexicographically, not randomly, so their
36/50 verification yield must not be statistically extrapolated to all 1,020.

### Open Images live pilot details

| Result | Count | Meaning |
| --- | ---: | --- |
| `verified` | 36 | Exact CC BY 2.0 licence instrument and declared author/profile evidence were present on the original Flickr landing page. |
| `rejected` | 5 | Four landing pages returned 404; one currently exposed CC0 instead of the CC BY 2.0 declaration, so the metadata and landing page conflicted. |
| `manual_review` | 9 | Four pages lacked complete machine-readable author evidence, four exhausted transient connection retries, and one returned 403. |

The verifier read 41 HTML bodies and left 9 unavailable/non-HTML bodies
unread. The output explicitly records `pixelsDownloaded: false`.

## Updated gate

| Gate required before Loop 1 | Product-admitted today | Decision |
| --- | ---: | --- |
| 1,200 independent, explicitly boxed physical-bin positives after group and perceptual deduplication | 0 | **FAIL.** Raw discovery volume is sufficient; landing verification, authorised pixel acquisition, visual form review, and group-safe deduplication remain. |
| At least 300 wheeled/closed-lid, 300 cylindrical/open-top, and 200 approved open-receptacle positives | 0 verified by style | **FAIL.** Public annotation schemas do not carry these fields. |
| Theme-park holdout with chair, cart, table, sign, box, stroller, and bag confusers | 0 admitted | **FAIL.** Open Images has candidate confuser annotations, but no theme-park evaluation set. |
| 300 true-overflow examples tied to a parent bin/rim | 0 | **FAIL.** StreetView-Waste has 5,149 published masks but is agreement-gated and the mask-to-parent-bin join is unverified. |
| 600 non-overflow bin examples with visible lid/opening | 0 | **FAIL.** Generic `not overflow` cannot be inferred from a bin box. |
| 150 explicit edge negatives across object-on-lid, adjacent bag, exposed liner, and partial occlusion | 0 | **FAIL.** No discovered public source provides this relation taxonomy. |
| At least 20 independent site/session/physical-bin groups for state evaluation | 0 admitted | **FAIL.** Group fields are missing or rights-gated. |

Therefore Loop 1 and Loop 2 remain blocked by the data gate, not by model code.

## Next admission iteration

The lowest-effort path is to reuse existing annotations and make only
coarse, contact-sheet decisions—not draw boxes one by one.

1. Regenerate the Open Images ledger with all 1,020 bin candidate rows, then
   run the verifier slowly with checkpoint/resume. Retain only verified rows.
2. After organisational approval of the documented CC obligations, download
   only verified Open Images assets plus one pLitter annotation variant and
   StreetScouting. Verify archive checksums and preserve an attribution ledger.
3. Produce clustered contact sheets and bulk-label each cluster as
   `wheeled_closed_lid`, `cylindrical_open_top`, `approved_open_receptacle`,
   `reject`, or `uncertain`. Existing COCO/Open Images boxes are reused.
4. Re-split pLitter by capture folder. Obtain or derive a defensible
   StreetScouting route grouping before it can enter validation/test. Apply
   perceptual deduplication across all sources.
5. Keep state data separate. Either obtain written commercial permission and
   the container/mask/group joins for StreetView-Waste, or capture a small
   scripted local theme-park state set. The local set needs only state/rim and
   edge-case labels because the generic boxes come from public datasets.
6. Re-run the gate. Start Loop 1 only when every required row has a rights
   ledger, group key, visual form/state label, and immutable split assignment.

## Two-loop benchmark contract after gate pass

| Loop | Required report | Promotion signal | Required mitigation if it fails |
| --- | --- | --- | --- |
| Loop 1 baseline | Group-safe bin AP/recall; chair-as-bin false positives per minute; per-state precision/recall/F1; object-on-lid false-overflow rate; unknown/reject coverage | Establish the baseline on the untouched WhatsApp acceptance media and independent holdout. No acceptance media may train the model. | Rank errors by bin form, viewpoint, state relation, and confuser; add only the missing training strata, not acceptance frames. |
| Loop 2 mitigation | Same frozen metrics and thresholds, plus deltas from Loop 1 | Improve the targeted failure strata without regressing bin recall or unknown handling. | If chair/bin confusion persists, strengthen localiser hard negatives and form validation. If lid objects still trigger overflow, replace whole-crop state classification with rim/opening localization plus material-crossing-rim evidence and temporal confirmation. |

## Reproducibility artifacts

- Open Images scan: `artifacts/dataset-readiness/openimages-v7-train-sufficiency.json`
- Landing-page pilot: `artifacts/dataset-readiness/openimages-v7-license-verification-pilot.json`
- Verifier: `ml-training/scripts/verify_openimages_candidate_licenses.py`
- Localiser source audit: `docs/research/THEMEPARK_LOCALIZER_ADMISSION_AUDIT_2026-08-21.md`
- Unsent rights pack: `docs/research/THEMEPARK_BIN_DATA_RIGHTS_REQUEST_PACK_2026-08-21.md`
