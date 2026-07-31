# Bin localizer and data gate

The production sequence is `full frame -> bin localizer -> padded bin crop ->
MobileNet state classifier -> distinct-frame confirmation`. The localizer has
one class only: `trash bin`. It must not decide normal/full/overflow.

Generate its dataset from the reviewed GCO boxes and the independent GBS
container annotations:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\prepare_bin_localizer_dataset.py
.\.venv\Scripts\python.exe ml-training\scripts\train_bin_localizer.py
```

The generated localizer dataset maps all container states to the single
`trash bin` class. GBS loose-garbage annotations are not converted to bins;
images containing only loose garbage remain useful negatives. Source images
are hard-linked by default to avoid duplicating more than 5 GB of data.

GBS adds substantial container and overflow variation, but it is not
Malaysia-specific. The production checkpoint therefore adds a small Malaysian
adaptation set using replay training; it is still not a nationwide Malaysian
validation. A suitable local example must show the physical container, not
only loose rubbish.

For a small Malaysian domain check, download the CC BY 4.0
[University of Malaya three-bin dataset](https://figshare.com/articles/figure/Solid_waste_bin_images_with_3_bin_per_node/6269042)
and measure whether the detector finds all three physical bins:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\download_malaysia_bin_dataset.py
.\.venv\Scripts\python.exe ml-training\scripts\evaluate_malaysia_bin_node.py `
  runs\bin-localizer\<run-name>\weights\best.pt
```

This set contains 200 fixed-camera images and no machine-readable bounding-box
or state labels. Its three-bin count is useful as a domain diagnostic, but it
must not be reported as detection mAP or used as unattended pseudo-ground
truth.

Bootstrap weak labels from only the first 100 images, create a replay mix, and
fine-tune without Ultralytics' high classifier-bias warmup:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\bootstrap_malaysia_bin_labels.py
.\.venv\Scripts\python.exe ml-training\scripts\prepare_bin_localizer_replay_dataset.py --repeats 6
.\.venv\Scripts\python.exe ml-training\scripts\train_bin_localizer.py `
  --data ml-training\configs\bin_localizer_malaysia_replay.yaml `
  --model runs\bin-localizer\<generic-run>\weights\best.pt `
  --epochs 4 --batch 32 --lr0 0.00005 `
  --warmup-epochs 0 --warmup-bias-lr 0.00005
```

The final 100 University of Malaya images stay untouched. Two candidates were
measured. The replay-balanced checkpoint preserved generic performance
(precision 0.9369, recall 0.8866, mAP50 0.9532) and improved the Malaysian
count proxy from 0.34 to 0.85. The active, Malaysia-first checkpoint
`bin-localizer-yolo11n-gco-gbs-um-v2` instead reaches 76% exactly-three, 96%
at-least-three, and 0.9867 count coverage at confidence 0.85. This specialization
does not pass the generic gate (generic mAP50 0.5756), which is an explicit
tradeoff for the current deployment target. Malaysian figures are a count
proxy, not bounding-box accuracy.

Evaluate the chosen `best.pt` on the untouched test split before deployment:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\evaluate_bin_localizer.py `
  runs\bin-localizer\<run-name>\weights\best.pt
```

The evaluator writes `test-report.json` beside the run and applies generic
precision, recall, and mAP50 gates. Passing those gates is not a substitute for
a Malaysian camera test. Promote the model only when it also localizes the
intended bin reliably on each deployment camera; a missed or wrong bin must
produce `unknown`, never `normal`.

For new CCTV data, maintain `ml-training/data/cctv-labelled/manifest.csv` with
these columns:

```text
image,split,state,bin_style,view_angle,lighting,scene_type,bin_id,notes
```

Use `normal`, `full`, and `overflow` consistently: `overflow` requires waste
outside the bin boundary. Include hard negatives (no bin, other containers,
posters), multiple bin designs, camera angles, day/night/weather, occlusion,
and borderline full-versus-spilling examples. Audit before training:

```powershell
.\.venv\Scripts\python.exe ml-training\scripts\audit_bin_state_data.py
```

The audit reports coverage only; it does not replace visual label review.
