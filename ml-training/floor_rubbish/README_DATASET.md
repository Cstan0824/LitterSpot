# LitterSpot Dataset Preparation

This project prepares a two-class YOLO segmentation dataset:

```yaml
0: floor_litter
1: floor_spill
```

Raw TACO, HD10K/IROS2022, and UAVVaste folders are treated as read-only. All generated conversion output goes into `dataset/floor_rubbish/prepared_dataset`.

## Pipeline

Run these commands from the project root:

```bash
.venv/bin/python scripts/floor_rubbish_script/inspect_datasets.py
.venv/bin/python scripts/floor_rubbish_script/convert_taco.py
.venv/bin/python scripts/floor_rubbish_script/convert_hd10k_spills.py
.venv/bin/python scripts/floor_rubbish_script/convert_uavvaste.py
.venv/bin/python scripts/floor_rubbish_script/build_dataset.py
.venv/bin/python scripts/floor_rubbish_script/validate_dataset.py
.venv/bin/python scripts/floor_rubbish_script/visualize_samples.py
```

If your raw datasets are not under the project root or `~/Downloads`, pass explicit roots:

```bash
.venv/bin/python scripts/floor_rubbish_script/inspect_datasets.py --search-root /path/to/TACO --search-root /path/to/IROS2022_Dataset
```

The final dataset config is `dataset/floor_rubbish/prepared_dataset/data.yaml`.

## Training Later

Start full training only after validating previews:

```bash
.venv/bin/python ml-training/floor_rubbish/train.py
```

For CPU-only machines:

```bash
.venv/bin/python ml-training/floor_rubbish/train.py --device cpu
```

The training script uses `yolo26s-seg.pt`, 100 epochs, image size 960, batch size 8, patience 20, and seed 42.

## Person And Object Filtering Prediction

Use this when full-room images cause people, tables, chairs, bags, or laptops to be mistaken as `floor_litter`.
It runs a pretrained YOLO detector first, counts people, and removes floor detections that overlap common non-floor objects.

```bash
.venv/bin/python ml-training/floor_rubbish/predict_with_person_filter.py \
  /path/to/image_or_folder \
  --floor-conf 0.35 \
  --person-conf 0.25 \
  --device cpu
```

By default, the ignore classes are:

```text
person, chair, dining table, bench, couch, backpack, handbag, suitcase, laptop
```

For debugging removed detections:

```bash
.venv/bin/python ml-training/floor_rubbish/predict_with_person_filter.py \
  /path/to/image_or_folder \
  --floor-conf 0.35 \
  --person-conf 0.25 \
  --show-removed \
  --device cpu
```

The script writes a `summary.csv` with:

```text
person_count
ignore_object_count
kept_floor_litter
kept_floor_spill
removed_floor_litter
removed_floor_spill
removed_outside_floor_roi
```

## Create A Floor ROI

Use a floor ROI when the image contains tables, walls, people, or chairs and you only want to check the floor zone.

Open the ROI click tool:

```bash
.venv/bin/python ml-training/floor_rubbish/create_floor_roi.py \
  /Users/chinchunggan/Downloads/IMG_6565.jpg
```

Controls:

```text
Left click  add a point around the floor boundary
U           undo the last point
R           reset all points
S           save the ROI and preview
Q           quit without saving
```

The tool saves:

```text
ml-training/floor_rubbish/rois/IMG_6565_floor_roi.json
ml-training/floor_rubbish/rois/IMG_6565_floor_roi_preview.jpg
```

Run prediction with the saved ROI:

```bash
.venv/bin/python ml-training/floor_rubbish/predict_with_person_filter.py \
  /Users/chinchunggan/Downloads/IMG_6565.jpg \
  --floor-conf 0.15 \
  --floor-roi ml-training/floor_rubbish/rois/IMG_6565_floor_roi.json \
  --show-removed \
  --device cpu
```

The white line in the result is the saved floor boundary. Red detections marked
`outside_roi` were rejected because less than half of their mask was inside the
floor area.

Use one ROI for each fixed camera view. Create another ROI if the camera position
or image framing changes. The ROI is post-processing, not model training.

## Production Safety Policy

The TACO conversion labels rubbish object identity; it does not prove that an
object is on the floor. In particular, an upright bottle can legitimately be a
model `floor_litter` prediction under the current labels. Production therefore:

- suppresses litter boxes overlapping detected foreground objects;
- exposes object-filtered litter candidates without requiring a focus region;
- optionally limits litter inference to an operator-plotted floor region;
- treats the current filter as a guardrail, not a semantic model fix.

A future floor-litter checkpoint must use reviewed floor-contact labels and
full-room negative frames. Validate by complete camera/video split and report
false-positive frames on offices containing people, bins, bottles, furniture,
and computers before replacing the production checkpoint.
