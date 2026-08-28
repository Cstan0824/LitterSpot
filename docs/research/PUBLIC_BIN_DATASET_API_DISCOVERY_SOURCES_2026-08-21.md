# Public bin/waste dataset metadata discovery sources — 2026-08-21

This discovery pass is metadata-only. It queries repository JSON APIs, records
declared metadata, and does not open archive, image, or annotation download
URLs. A repository search hit is a lead, not evidence that the dataset is
sufficient for training.

## Official API sources

- [Zenodo Developers — Records API](https://developers.zenodo.org/): record
  search and record metadata, including files and declared licence fields.
- [Figshare API documentation](https://docs.figshare.com/): article search and
  article-detail metadata, including file names, sizes, checksums, and licence
  fields. The implementation uses the official `POST /v2/articles/search`
  route and `GET /v2/articles/{id}` detail route.
- [DataCite REST API documentation](https://support.datacite.org/docs/rest-api):
  DOI metadata search. The ledger retains DataCite results only when the DOI
  uses the Mendeley Data prefix `10.17632/` or the publisher identifies
  Mendeley; DataCite `sizes` and `formats` are metadata, not downloaded files.
- [Hugging Face Hub API documentation](https://huggingface.co/docs/hub/en/api):
  dataset-card and sibling metadata. HF entries are retained only when a
  declared licence and a traceable `source_datasets` reference or homepage are
  present.

## Evidence rules

- Counts parsed from titles/descriptions are labelled `claimed` and are never
  upgraded from prose alone.
- A `verified` count is emitted only for an explicit structured repository
  field currently exposed by Hugging Face (`dataset_info.splits.*.num_examples`).
  This is verification of the repository metadata field, not independent
  pixel-level or annotation validation.
- Annotation formats are detected from metadata descriptions and file names;
  this does not validate that an archive can be opened or that labels match
  images.
- Records are deduplicated by normalized DOI first, then normalized title.
- Every ledger record has `recordCountedAsSufficient: false`, and title-only
  evidence can never establish sufficiency. A later acquisition/audit stage
  must independently verify file integrity, image/annotation joins, licence
  terms, and per-image provenance.

## Reproducible execution

The reusable adapter is
[`discover_public_bin_dataset_candidates.py`](../../ml-training/scripts/discover_public_bin_dataset_candidates.py).
It searches the configured garbage/trash/waste-bin detection, container,
litter-bin, wheelie-bin, open-top-bin, waste-basket, overflow, and fullness
phrases. The bounded live run used for this ledger was:

```powershell
python ml-training/scripts/discover_public_bin_dataset_candidates.py `
  --output artifacts/dataset-readiness/public-bin-dataset-candidate-ledger.json `
  --max-results-per-term 3 `
  --max-detail-records 40
```

The resulting
[`public-bin-dataset-candidate-ledger.json`](../../artifacts/dataset-readiness/public-bin-dataset-candidate-ledger.json)
contains 26 deduplicated metadata candidates from the run (15 Zenodo, 8
Figshare, and 3 Mendeley/DataCite records; no Hugging Face record met the
traceable-source/licence gate). The run reported two transient Hugging Face
API failures; they are preserved in `apiFailures` rather than hidden. It
opened no archive, image, annotation, or file-content URL.

Focused tests:

```powershell
python -m pytest -q ml-training/tests/test_discover_public_bin_dataset_candidates.py
```
