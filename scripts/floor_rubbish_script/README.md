# Floor Rubbish Dataset Scripts

These scripts prepare the YOLO segmentation dataset for floor rubbish and spills.

Run them from the project root with the project virtual environment.

```bash
.venv/bin/python scripts/floor_rubbish_script/inspect_datasets.py
.venv/bin/python scripts/floor_rubbish_script/convert_taco.py
.venv/bin/python scripts/floor_rubbish_script/convert_hd10k_spills.py
.venv/bin/python scripts/floor_rubbish_script/convert_uavvaste.py
.venv/bin/python scripts/floor_rubbish_script/build_dataset.py
.venv/bin/python scripts/floor_rubbish_script/validate_dataset.py
.venv/bin/python scripts/floor_rubbish_script/visualize_samples.py
```

## What Each Script Does

```text
inspect_datasets.py        checks raw datasets and writes an inspection report
convert_taco.py            converts TACO rubbish polygons to floor_litter
convert_hd10k_spills.py    converts HD10K liquid masks to floor_spill
convert_uavvaste.py        converts UAVVaste rubbish polygons to floor_litter
build_dataset.py           combines converted data into train, val, and test folders
validate_dataset.py        checks images, labels, classes, polygons, and split overlap
visualize_samples.py       creates preview images with masks drawn on top
dataset_utils.py           shared helper functions used by the other scripts
```

Raw datasets live in:

```text
dataset/floor_rubbish/raw_dataset
```

The final YOLO dataset lives in:

```text
dataset/floor_rubbish/prepared_dataset
```
