# Real-camera data collection protocol

## Objective

Close the overflow-recall gap using permissioned images from the cameras where
LitterSpot will operate. Do not add public-dataset duplicates to this set.

## Minimum coverage

- Every camera position and focal length planned for deployment.
- Day, night, glare, rain, shadows, crowds, partial occlusions, and cleaning.
- Normal, full, and overflowing bins, plus bags or litter near a bin that are
  not an overflow.

## Labeling and split rules

- Use `normal trash bin`, `full trash bin`, and `overflowing trash bin` only.
- Keep a CSV beside the images with `camera_id`, timestamp/period, condition,
  and a reviewer flag for borderline overflow cases.
- Split by camera and time block: adjacent frames must never cross train,
  validation, and test. Reserve the real-camera test set for deployment gating.

## Review loop

After each held-out test, review every missed overflow and every false overflow.
Tag its failure mode, then add representative labels before the next retrain.
