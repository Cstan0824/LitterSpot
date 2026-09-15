# Theme-park bin dataset and two-loop model goal

Date started: 2026-08-20
Status: active — dataset sufficiency audit in progress; training is not yet authorised

## Goal

Build a reproducible, licence-safe dataset that covers the bin designs and
non-bin confusers visible in the theme-park media, then train and evaluate the
bin-localisation and overflow-state pipeline in exactly two evidence-driven
loops. Promote a checkpoint only when source-separated public tests and the
locked WhatsApp regression suite pass every fixed gate.

Completion requires all of the following:

1. every training pixel and annotation has source, licence, attribution and
   checksum lineage;
2. the dataset passes the localisation, hard-negative and state-evidence gates;
3. Loop 1 produces a versioned benchmark and failure gallery;
4. each Loop 2 change is justified by a specific Loop 1 failure;
5. Loop 2 reports absolute metrics and deltas against Loop 1 on the same
   untouched evaluation sets; and
6. the final report makes an explicit promote, shadow-only, or reject decision.

## Operating roles

| Lane | Responsibility | Decision boundary |
| --- | --- | --- |
| Codex lead | Own the goal, plan, data sufficiency decision, experiment contract, benchmark review and final promotion decision | Only this lane may change gates, approve training entry or declare completion |
| Terra/Max research | Check official/primary sources, exact class counts, licences, access methods and unresolved evidence gaps | Research and recommendations only; headline dataset size is not accepted as class coverage |
| Luna/Max execution | Run bounded acquisition/import/conversion/test tasks and return machine-readable results | No source is downloaded before licence approval; no model is promoted |

## Non-negotiable sequence

```text
official metadata and licence audit
             |
             v
dataset sufficiency PASS ----no----> fill documented data gaps, then re-audit
             |
            yes
             v
       acquire + normalise
             |
             v
          Loop 1
             |
             v
 failure review and mitigation mapping
             |
             v
          Loop 2
             |
             v
 promotion gates -> promote / shadow-only / reject
```

Training must not start from an attractive source list. It starts only from a
materialised, deduplicated and audited manifest that passes the following
entry gates.

## Dataset sufficiency gate

All counts are unique source images after perceptual/content deduplication.
Repeated frames of one physical bin do not count as independent coverage.

### Localiser and verifier coverage

| Coverage bucket | Entry minimum |
| --- | ---: |
| Explicitly annotated physical waste/trash-container positives | 1,200 |
| Wheeled or rectangular closed-lid bins | 300 |
| Cylindrical or open-top bins | 300 |
| Approved waste baskets/open receptacles | 200 |
| Hard-negative full frames | 1,500 |
| Chair, person/table, cart/stroller, sign/box and bag/bottle families | at least 150 per high-risk family |
| Independent positive sources | 2 |
| Independent negative sources | 2 |

An upstream `basket`, `barrel`, `bucket`, `cart` or storage-container label is
not automatically a bin. Ambiguous candidates require contact-sheet approval.

### Overflow-state coverage

| Coverage bucket | Entry minimum |
| --- | ---: |
| Genuine overflow/rim-crossing masks or reviewed crops | 300 |
| Verified non-overflow bin crops with visible opening/lid | 600 |
| Object-on-lid, adjacent-bag, exposed-liner and partial-occlusion negatives | 150 total, with each subtype represented |
| Independent capture groups per state | 20 |

If the localiser gate passes but the state gate fails, localiser work may be
prepared but the overflow-state training loop remains blocked. Missing state
labels must not be manufactured from generic litter labels.

### Governance and split gates

- production lineage contains no unknown, academic-only or non-commercial
  source;
- all images retain original URL/record, licence, author/attribution,
  annotation ID and SHA-256;
- perceptual and content hash collision across train/validation/test is zero;
- one source video, physical instance, route, location or capture burst belongs
  to exactly one split;
- the locked WhatsApp pixels are absent from acquisition, pseudo-labelling,
  similarity ranking, training and threshold selection; and
- at least one complete public source is held out for cross-source testing.

The visible WhatsApp attributes may define text queries and coverage buckets.
The exact pixels remain acceptance evidence. If pixel-similarity retrieval is
needed later, it must use a separately captured reference-only clip.

## Candidate source allocation

The primary-source audit is complete and its current verdict is **FAIL**. The
source roles are constrained as follows until the materialised-manifest audit
changes that verdict:

| Source | Intended role | Current condition |
| --- | --- | --- |
| GBS, official Zenodo record 14711706 | Core bin/overflow candidate pool | Record is CC BY 4.0 and metadata has 10,029 direct `garbage_bin` images plus 9,878 `overflow` images; mixed per-image pixel provenance, appearance, and label semantics remain unapproved |
| Open Images V7 | Explicit waste-container positives and labelled blockers | Count class rows and verify every retained image's licence metadata |
| LVIS v1 | Trash-can boxes/masks and explicit negative-category images | Count `trash_can` and preserve underlying COCO/Flickr terms |
| CODa Re-ID | Viewpoint, lighting and physical-instance diversity for `Trash_Can` | Split by physical instance/route and download only relevant sequences |
| COCO | Chair/person/table/bag/bottle and other blockers | Negative data only; COCO has no trash-bin positive class |
| StreetView-Waste | Container boxes and real surrounding-overflow masks | Counts do not enter the production gate until its separate data agreement is approved |
| University of Malaya Figshare | Malaysian-domain weak supplement | No machine-readable boxes; weak labels cannot count as reviewed test truth |
| Objects365 | Potential academic experiment | Excluded from production lineage under the published academic-only condition |

Arbitrary search-result images and repacks without upstream provenance are
rejected even when they would make a quota appear complete.

## Frozen pre-goal reference benchmark (B0)

These values describe the existing system and are not a substitute for Loop 1.
Future reports must identify the exact checkpoint, fixture manifest, dataset
manifest, thresholds, commit and command used.

| Metric | B0 value | Promotion gate |
| --- | ---: | ---: |
| Generic localiser precision | 0.6299 | >= 0.90 |
| Generic localiser recall | 0.5551 | >= 0.90 |
| Generic localiser mAP50 | 0.5756 | >= 0.90 |
| Locked positive-bin track recall | 12/31 = 38.7% | >= 90% |
| Negative-frame false-bin rate, unguarded | 4/9 = 44.4% | <= 1% |
| Negative-frame false-bin rate, blocker guarded | 0/9 = 0% | <= 1% |
| Synthetic state macro-F1 | 0.985 | diagnostic only |
| Weak-public state macro-F1 | 0.207 | >= 0.80 before it can support a real-state claim |

The large synthetic/public state gap is itself a failure. Synthetic results
must be reported separately and cannot be averaged into a production score.

## Dataset build before Loop 1

### Local readiness confirmed on 2026-08-20

- 63 relevant acquisition/dataset tests passed in 5.61 seconds after adding the
  GBS metadata gate.
- Python 3.12.4, PyTorch 2.7.1+cu118 and Ultralytics 8.4.92 are installed.
- CUDA is available on an RTX 4050 Laptop GPU with about 6 GB VRAM.
- The workspace has about 84.7 GB free on C: and 589.9 GB free on D:; a
  selective 4,000–6,000-image build is practical without fetching full source
  archives.
- The reusable merge, YOLO audit, contact-sheet and bin-state training tools
  exist, but the generic bin dataset and reviewed bin-state rows do not.
- `artifacts/dataset-readiness/gbs-zenodo-14711706-sufficiency.json` records the
  official GBS record, CC BY 4.0 licence, 5.16 GB archive checksum, exact class
  counts and the still-failing appearance-family gate. It read only about
  19.3 MB through HTTP ranges and downloaded no image members.
- The corrected image-level intersections expose 6,065 `garbage_bin` candidates
  without an overflow annotation and 9,878 overflow candidates. These exceed
  the numerical state-crop gates but remain review candidates, not state truth.
- The balanced 30-image GBS visual proof found 4 clear wheelie rows, 17 other
  rectangular containers, 0 open-top/cylindrical bins, 0 open receptacles, 5
  rows without a verified physical bin, 3 uncertain rows and 1 rejected
  composite. GBS therefore cannot fill the two weakest deployment families by
  simply increasing its sample size.

The missing implementation is one licence-aware official-source adapter plus
cross-source hash deduplication, group-safe splitting and a coverage/data-card
report. That adapter is the first Luna/Max execution task after sufficiency
passes.

1. Query and save official annotation metadata before downloading pixels.
2. Produce `source-manifest.jsonl` with provenance, licence, class, box/mask,
   physical-instance group and intended split group.
3. Download only approved rows into ignored source caches.
4. Validate decoding, annotation geometry and source checksums.
5. Map only explicit waste-container classes automatically to one `bin` class.
6. Generate empty YOLO labels for verified negative frames.
7. Deduplicate across sources and split by physical instance/capture group.
8. Create deterministic contact sheets for ambiguous positives and a random
   quality-control sample; review rows, not manually drawn boxes.
9. Publish a data card containing accepted/rejected counts by source, style,
   state, confuser, split and licence.
10. Compute and store the manifest checksum. No later row may enter a loop
    without producing a new dataset version.

The admitted-manifest contract is documented in
`docs/themepark-bin-source-manifest.md`. Run
`ml-training/scripts/audit_themepark_bin_dataset.py --require-ready` before
either loop. It validates local pixels/checksums and counts only governance-
approved rows; candidate-source headline totals cannot satisfy its gates.

## Loop 1 — measured baseline on sufficient data

### Training scope

Train three narrow responsibilities rather than one overloaded scene model:

1. a one-class whole-bin localiser;
2. a crop verifier that decides `physical_bin` versus `not_bin`; and
3. an overflow-evidence component trained only where state evidence is known.

The state component must retain `unknown`. A loose item, object on a closed lid,
adjacent bag or floor litter is not a positive unless the annotation proves
waste crossing/connected to the bin opening under the project's definition.

### Loop 1 benchmark

| Area | Metric | Loop 1 gate |
| --- | --- | ---: |
| Localisation | source-separated precision / recall / mAP50 | >= 0.90 / >= 0.90 / >= 0.90 |
| Localisation | recall by wheeled, open-top and open-basket family | >= 0.85 each |
| Localisation | locked positive-video track recall | >= 0.90 each video |
| False bins | hard-negative false-bin frame rate | <= 1% |
| False bins | accepted chair detections | 0 |
| Verification | physical-bin precision / recall | >= 0.95 / >= 0.90 |
| State | public held-out overflow precision / recall | >= 0.90 / >= 0.85 |
| State | non-overflow/object-on-lid false-overflow rate | <= 2% |
| State | partial-occlusion returned as correct-or-unknown | >= 90% |
| Locked replay | object-on-lid false overflow | 0 |
| Runtime | end-to-end latency on the local RTX 4050 | record p50/p95; no regression above the configured service budget |

### Loop 1 feedback artifacts

Loop 1 must write:

- one JSON metric report and one Markdown summary;
- confusion matrices and precision-recall curves;
- per-source, per-style, per-state and per-confuser metric tables;
- a contact sheet for every false positive and false negative;
- confidence, box-size, angle, occlusion and source distributions for failures;
- throughput, VRAM, p50 and p95 latency; and
- a signed decision table mapping each failed gate to an allowed mitigation.

Thresholds are selected on validation data only. The locked WhatsApp replay is
run after the choice is frozen and cannot be used to tune Loop 1.

## Loop 1 review -> Loop 2 mitigation map

Only mitigations supported by Loop 1 evidence enter Loop 2.

| Loop 1 failure | Primary diagnosis to verify | Allowed Loop 2 mitigation | Required improvement evidence |
| --- | --- | --- | --- |
| Low recall in one bin family | style under-coverage, tiny boxes or bad upstream labels | add/reweight that reviewed style cluster; repair boxes; raise resolution only if miss rate correlates with pixel size | per-family recall rises without >1 point precision loss |
| Chairs/tables/carts accepted as bins | negative under-coverage or verifier confusion | mine false crops plus same-family official negatives; balance verifier batches; calibrate verifier on validation | zero locked chairs and hard-negative FPR <=1% |
| Good localiser mAP but poor locked track recall | domain/scale shift or unstable frame detections | domain-safe augmentation, multiscale training and temporal track confirmation; never lower confidence from locked results | each positive video >=90% track recall with negative FPR unchanged |
| Overflow called for object on lid/adjacent bag | classifier using object presence instead of rim connectivity | add reviewed edge negatives; introduce opening/rim visibility and connectedness evidence; return `unknown` when rim is hidden | false-overflow <=2% and zero on locked lid case |
| Overflow recall too low | insufficient true positives, context crop too tight or segmentation fragmentation | add source-balanced overflow masks, tune context on validation, use mask connectivity/temporal vote | overflow recall >=85% while precision remains >=90% |
| Public holdout strong but one source weak | source dominance or split leakage | rebalance by source/physical instance; strengthen dedup/group split; remove contaminated run | every source reports separately and no source falls below its gate |
| Occluded inputs become confident states | no visibility/uncertainty signal | explicit visibility head or deterministic occlusion veto; train masked unknown target | >=90% correct-or-unknown and no increase in missed visible overflow beyond gate |
| Latency/VRAM exceeds budget | model/input or multi-stage cost | batch ROIs, cache proposals, distil/prune or reduce input size after accuracy ablation | p95 meets service budget without violating accuracy gates |

## Loop 2 — targeted correction

1. Freeze the Loop 1 report and select only the mapped mitigations required by
   failed gates.
2. Version any added data as dataset revision 2 and report exactly which categories and
   sources changed.
3. Keep the Loop 1 public test and locked WhatsApp fixtures untouched.
4. Retrain with the smallest defensible change set.
5. Re-run the identical metric command and publish B0, Loop 1, Loop 2 and
   Loop2-minus-Loop1 columns.
6. Reject a mitigation that improves the aggregate but regresses a critical
   bin family, hard-negative family or source below its gate.

Loop 2 ends with exactly one decision:

- **promote to shadow:** every gate passes and lineage is clean;
- **shadow-only diagnostic:** useful recall but one non-safety gate remains;
  alerts cannot dispatch tasks; or
- **reject:** any chair/object-on-lid safety gate, overflow precision gate,
  leakage check or licence gate fails.

No third training loop is hidden inside this goal. If Loop 2 fails, the final
report identifies the missing evidence and opens a new goal only with explicit
approval.

## Rolling status

| Stage | Status | Evidence |
| --- | --- | --- |
| Primary-source sufficiency audit | complete: strict FAIL; training blocked | `docs/research/THEMEPARK_BIN_DATASET_SUFFICIENCY_AUDIT_2026-08-20.md` |
| Local acquisition/tool readiness | complete for metadata stage; 63 tests pass | Luna/Max execution lane |
| Dataset materialisation | in progress; GBS proof complete but open-top/basket and licensed-negative gaps remain | `docs/research/GBS_VISUAL_AUDIT_PROOF30_2026-08-21.md` plus LVIS/Open Images licence/count query |
| Loop 1 | not started | dataset gate not passed |
| Loop 1 review/mitigation selection | not started | requires Loop 1 report |
| Loop 2 | not started | requires signed mitigation map |
| Final promotion decision | not started | requires both loop reports |
