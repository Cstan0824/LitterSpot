# Open Images V7 metadata-audit source record

The audit uses the first-party [Open Images V7 download page](https://storage.googleapis.com/openimages/web/download_v7.html)
as its source contract. That page documents the dense annotation downloads,
the bounding-box CSV schema, the class-name mapping, and the image-information
fields. It links the validation boxes at
`https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv`
and the validation image-information CSV at
`https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv`.
The V7 boxable MID mapping is the official
[`oidv7-class-descriptions-boxable.csv`](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv).

The first-party page describes image-information rows as containing
`OriginalURL`, `OriginalLandingURL`, `License`, `AuthorProfileURL`, `Author`,
and related fields, and states that the data is as it appears on destination
websites. The metadata audit therefore reports the declared `License` URL as a
screening field only. It does not call that declaration approved, does not
fetch image pixels, and does not independently verify landing pages. The
landing-page-verified counters remain zero unless an explicit verification file
is supplied.

The implementation is
[`audit_openimages_v7_metadata.py`](../../ml-training/scripts/audit_openimages_v7_metadata.py).
It streams the validation CSVs, preserves overlap-safe ID sets, and writes the
machine-readable report to
`artifacts/dataset-readiness/openimages-v7-validation-audit.json`.
