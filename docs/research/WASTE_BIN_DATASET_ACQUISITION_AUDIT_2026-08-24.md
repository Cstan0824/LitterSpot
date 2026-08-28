# Waste Bin Dataset acquisition audit

Audit date: 2026-08-24
Source: [`akirsch1/waste-bin-dataset`](https://huggingface.co/datasets/akirsch1/waste-bin-dataset)
Pinned revision: `b2a470de0d0c48ff56d714696db37339a6cc4e91`

## Admission decision

Admit this source only as **auxiliary three-level fullness supervision**. It is
public, ungated, author-hosted, and declared CC BY-SA 4.0. It does not contain
an overflow class, rim-crossing masks, bin boxes, object-on-lid negatives, or
capture-group metadata. It must not train or validate the overflow decision.

Use all real images as one untouched cross-domain test set. Train and validate
only on leakage-grouped simulated images. This is a diagnostic benchmark, not
evidence that the theme-park overflow target has been reached.

## Verified repository state

The official [Hub repository API](https://huggingface.co/api/datasets/akirsch1/waste-bin-dataset?blobs=true)
reported the following on the audit date:

| Field | Verified value |
| --- | --- |
| Revision | `b2a470de0d0c48ff56d714696db37339a6cc4e91` |
| Visibility | Public, not gated, not disabled |
| Repository files | 1,624 |
| PNG files | 1,621 |
| Actual labelled dataset images | 1,620 |
| README example image | 1 (`img/simulated_dataset_examples.png`) |
| Labelled image bytes | 2,541,838,990 bytes (about 2.37 GiB) |
| Example image bytes | 1,603,068 bytes |
| Total PNG bytes | 2,543,442,058 bytes |
| Integrity metadata | Every PNG is stored with an LFS SHA-256 value |

The counts in the author's
[README](https://huggingface.co/datasets/akirsch1/waste-bin-dataset/blob/main/README.md)
match the file tree exactly:

| Domain | Empty | Half-full | Full | Total | Bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simulated | 371 | 658 | 517 | 1,546 | 2,506,163,309 |
| Real | 22 | 33 | 19 | 74 | 35,675,681 |
| **Labelled total** | **393** | **691** | **536** | **1,620** | **2,541,838,990** |

The exact folder layout is:

```text
LICENSE.md
README.md
img/
  simulated_dataset_examples.png       # documentation; exclude
real/
  empty/*.png                           # 22
  halffull/*.png                        # 33
  full/*.png                            # 19
simulated/
  empty/*.png                           # 371
  halffull/*.png                        # 658
  full/*.png                            # 517
```

The simulated files use sparse, globally unique numeric stems from `00000` to
`01804`; a stem occurs in only one class folder. Real filenames contain capture
timestamps. There are 68 real images dated `20251119` and six dated `20251120`.
These dates indicate at most two disclosed collection-day groups, not 74
independent scenes.

### Hub-viewer trap

The official
[dataset-server info endpoint](https://datasets-server.huggingface.co/info?dataset=akirsch1/waste-bin-dataset)
reports 1,621 examples and an `imagefolder` schema with only one feature,
`image`. It includes the README example PNG and does not expose a label column.
Therefore, do not use the auto-converted Hub/Parquet row count or call
`load_dataset(...)` expecting labels. Derive labels from the pinned repository
paths and explicitly reject anything outside the six class folders.

## Reproducible metadata-only audit

PowerShell:

```powershell
$api = 'https://huggingface.co/api/datasets/akirsch1/waste-bin-dataset?blobs=true'
$repo = Invoke-RestMethod -Uri $api
$repo | Select-Object id, sha, lastModified, private, gated, disabled

$repo.siblings |
  Where-Object { $_.rfilename -match '^(real|simulated)/(empty|full|halffull)/' } |
  ForEach-Object {
    $parts = $_.rfilename -split '/'
    [pscustomobject]@{
      Domain = $parts[0]
      Label = $parts[1]
      Bytes = [long]$_.size
      Sha256 = $_.lfs.sha256
    }
  } |
  Group-Object Domain, Label |
  Select-Object Name, Count

Invoke-RestMethod -Uri `
  'https://datasets-server.huggingface.co/info?dataset=akirsch1/waste-bin-dataset'
```

The API response itself should be saved beside the eventual acquisition
manifest so a later upstream change is visible.

## Pinned download mechanism

The official
[Hugging Face download documentation](https://huggingface.co/docs/huggingface_hub/guides/download)
supports dataset repositories, revision pinning, path filters, and a local
directory. The bounded download is:

```powershell
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='akirsch1/waste-bin-dataset', repo_type='dataset', revision='b2a470de0d0c48ff56d714696db37339a6cc4e91', local_dir=r'ml-training\data\public\waste-bin-dataset', allow_patterns=['simulated/**','real/**','README.md','LICENSE.md'])"
```

This excludes the example image and pins the exact audited revision. Before
training, compare every downloaded image to the LFS SHA-256 returned by the
repository API. Record at minimum:

```text
source_repo, source_revision, source_path, domain, native_label,
bytes, sha256, licence, admitted_task, split, group_id
```

Do not rename `halffull` silently. Normalize it to `half_full` in the manifest
while retaining `native_label=halffull`.

## Leakage-safe split recommendation

### Locked real test

Use all 74 real images as `test_real`:

- `empty`: 22
- `half_full`: 33
- `full`: 19

Do not use these images for checkpoint selection, early stopping, threshold
selection, class weighting, prompt tuning, visual filtering, or augmentation
design. Evaluate a frozen candidate once. Report per-class recall, balanced
accuracy, macro-F1, ordinal mean absolute error, and the 3-by-3 confusion
matrix. Label the result as a two-collection-day diagnostic; the sample is too
small and correlated for a strong generalization claim.

### Simulated train/validation

The publisher provides no Unity scene, camera, render-seed, bin-instance, or
sequence ID. A random image split is therefore not defensible. Use this
conservative proxy:

1. Parse the numeric filename stem.
2. Assign a provisional source block `floor(stem / 50)`. This keeps nearby
   generation IDs together and yields roughly 37 possible blocks before
   accounting for missing IDs.
3. Compute exact duplicate hashes and perceptual hashes after acquisition.
   Union any duplicate/near-duplicate images, even across provisional blocks.
4. If a visual embedding audit finds the same rendered background/bin in
   multiple blocks, union those blocks as well.
5. Deterministically assign whole merged groups to approximately 85% train and
   15% validation using a hash of `source_revision + group_id`.
6. Search only among group-level assignments for one that retains all three
   classes in validation and keeps class proportions reasonably close. Never
   move individual images across groups to balance labels.

The proposed split is `simulated_train` / `simulated_val` / `real_test`; there
is no random mixed-domain split. Because the 50-ID grouping is a proxy rather
than publisher metadata, the build report must state `group_confidence=proxy`.

## Label use in the current system

Preserve the source's native ordinal target:

```text
empty < half_full < full
```

Recommended use is an auxiliary fullness head or scalar target. Do not map any
row to `overflow`. In particular:

- `full` does not prove waste crosses the rim;
- the source does not prove `full` is visually contained;
- `empty`/`half_full` are not generic `normal` labels for all operational bin
  states; and
- the source cannot supervise `lid_obstruction`, `outside_connected_waste`, or
  `rim_crossing_waste`.

This separation prevents a high fullness score from recreating the original
"object on top means overflow" mistake.

## Licence obligations

The repository README and
[`LICENSE.md`](https://huggingface.co/datasets/akirsch1/waste-bin-dataset/blob/main/LICENSE.md)
apply CC BY-SA 4.0 to the work. The licence permits commercial use,
modification, distribution, and private use, subject to its conditions.

When sharing the original or adapted dataset material:

- credit André Kirsch and Jan Rexilius;
- link the source repository;
- identify CC BY-SA 4.0 and link or include the licence;
- retain supplied copyright/licence notices;
- indicate modifications, including resizing, cropping, relabelling, or
  augmentation; and
- distribute adapted material under CC BY-SA 4.0 or a compatible licence,
  without additional downstream restrictions.

The README asks users to cite Kirsch and Rexilius, *Vision-Based Autonomous
Waste Bin Fill-Level Monitoring with a Micro Aerial Vehicle*, IE 2026,
DOI `10.1109/IE69249.2026.11539031`. Preserve that citation in dataset and
model documentation.

Whether a trained checkpoint is legally an Adapted Material of the images is
not resolved by the repository. Before publicly distributing a checkpoint
trained on this source under an incompatible licence, obtain legal review or
written clarification from the authors. This is a rights-management caution,
not a claim that ShareAlike automatically attaches to model weights.

## Acceptance checklist

- [ ] Download is pinned to revision `b2a470de...`.
- [ ] Only `real/**`, `simulated/**`, `README.md`, and `LICENSE.md` are fetched.
- [ ] Exactly 1,620 labelled images and the six expected buckets are present.
- [ ] Every file passes its upstream LFS SHA-256 check.
- [ ] README example image is absent from the training manifest.
- [ ] Real images appear only in `test_real`.
- [ ] Simulated near-duplicates and provisional ID blocks never cross splits.
- [ ] Native labels remain traceable; no row is assigned `overflow`.
- [ ] Attribution, licence URI, citation, revision, and modification history are
  carried into the release ledger.
