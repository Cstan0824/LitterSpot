# GBS visual-audit proof: 30-image balanced sample

Review date: 2026-08-21
Purpose: source suitability and sampler validation only; no rows were admitted
to training and no state truth was created.

## Result

The range-based sampler completed a deterministic 30-image proof from the
official [GBS Zenodo record](https://zenodo.org/records/14711706), balanced as
10 `garbage_bin_only`, 10 `overflow_present`, and 10
`mixed_garbage_context` rows. It produced three contact sheets, zero download
failures, no orphan pixels, and did not download the 5.16-GB archive.

Conservative visual review found:

| Appearance/evidence | Reviewed rows |
| --- | ---: |
| Clear wheeled/closed-lid family | 4 |
| Clear open-top/cylindrical family | 0 |
| Clear basket/open-receptacle family | 0 |
| Other rectangular public bin/dumpster | 17 |
| No verified physical bin | 5 |
| Appearance uncertain | 3 |
| Derivative/composite rejected | 1 |

Within the ten `overflow_present` rows, six show a physical bin with plausible
rim-related state evidence, one is occluded/ambiguous, two do not show a
verified physical bin, and one is a composite/derivative reject. These are
candidate-quality observations only. An upstream category name and this
contact-sheet review are not sufficient to create `normal` or `overflow`
training truth.

## Decision

GBS may supply rectangular/wheelie candidates and can support further
overflow-crop review, subject to resolving its mixed per-image provenance. It
must not be used to claim coverage of the black cylindrical/open-top or
basket/open-receptacle deployment bins. Those families must come from a
different licence-approved source or separately captured non-acceptance park
footage.

The result confirms that a random large GBS download would preserve the main
coverage gap. The next source-selection work must target the missing families
explicitly rather than increasing the aggregate bin count.

Machine evidence:

- `artifacts/dataset-readiness/gbs-visual-sample-proof30/manifest.json`;
- `artifacts/dataset-readiness/gbs-visual-sample-proof30/appearance-review.json`;
- `artifacts/dataset-readiness/gbs-visual-sample-proof30/contact-sheets/`.
