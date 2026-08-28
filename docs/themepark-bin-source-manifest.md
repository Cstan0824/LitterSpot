# Theme-park bin source-manifest contract

The admitted dataset uses JSON Lines: one JSON object per task/sample. Candidate
or quarantined source rows must remain outside this manifest until their
licence, provenance and semantic review gates pass.

Audit a materialised manifest with:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\audit_themepark_bin_dataset.py `
  ml-training\data\themepark-bin-v1\source-manifest.jsonl `
  --root ml-training\data\themepark-bin-v1 `
  --output artifacts\dataset-readiness\themepark-bin-v1-audit.json `
  --require-ready
```

## Fields required on every row

| Field | Meaning |
| --- | --- |
| `sampleId` | Stable unique row ID. |
| `image` | Path below the supplied manifest root. |
| `sourceId`, `sourceRecord` | Official dataset/source identifier and record URL. |
| `attribution` | Creator/source attribution that must accompany the pixel. |
| `license` | Object with non-empty `id` and official `url`. |
| `commercialUseStatus` | Must be `approved` for an admitted row. Candidate rows with another status stay quarantined. |
| `sha256` | SHA-256 of the original-resolution local image. |
| `perceptualHash64` | Sixteen hexadecimal characters used for cross-split near-duplicate checks. |
| `groupId` | Physical instance, source video, route, location or derivative-family grouping. |
| `split` | `train`, `valid`, or `test`; one group may occur in only one split. |
| `task` | `localizer_positive`, `localizer_negative`, or `state`. |
| `reviewStatus` | `upstream_verified` or `reviewed`. State evidence must be `reviewed`. |
| `isLockedAcceptance` | Must be `false`; locked WhatsApp media is never admitted. |

## Task-specific fields

- `localizer_positive`: requires `binStyle`. Only
  `appearanceReviewStatus=reviewed` rows count toward the
  `wheeled_closed_lid`, `open_top_cylindrical`, and `open_receptacle` quotas.
- `localizer_negative`: requires `negativeFamily` and
  `binAbsenceVerified=true`. Required families are `chair`, `person_table`,
  `cart_stroller`, `sign_box`, and `bag_bottle`.
- `state`: requires `state` (`overflow`, `non_overflow`, or `unknown`) and
  `stateEvidenceType` (`mask`, `reviewed_crop`, or `none`). Only reviewed masks
  and crops count. Non-overflow edge rows use zero or more of
  `object_on_lid`, `adjacent_bag`, `exposed_liner`, and `partial_occlusion` in
  `edgeTags`.

Set `completeSourceHoldout=true` only when the source's admitted evaluation
slice is intentionally source-held-out and every row for that `sourceId` is in
`test`. At least one such source is required.

## Important semantics

- An upstream GBS `garbage_bin` box can become a physical-bin candidate.
- An upstream GBS `overflow` box is state evidence only after rim/relationship
  review; it is not automatically a bin-localizer box.
- A generic basket, barrel, box, bucket or cart label is never automatically a
  waste-bin positive.
- A negative category annotation does not prove a bin-free full frame. The
  source must explicitly support the `binAbsenceVerified` assertion.
- The auditor counts unique SHA-256 values, not rows, and rejects checksum,
  group and perceptual-hash leakage across splits.
