# InternVL mock-evaluation fixtures

This versioned fixture set contains five supplied CCTV-style videos and five
supplied photos for repeatable, manual evaluation of the LitterSpot scene
pipeline. It is intentionally separate from `ml-training/`: these are test
fixtures, not annotated training data.

## Contents

- `images/`: five still images, including normal recycling bins, people, bags,
  visible litter, and an overflowing bin.
- `videos/`: five short video inputs. The evaluation runner samples three evenly
  distributed frames from each by default.

## Run the evaluation

Start the local FastAPI service, then run from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts\run-mock-vlm-evaluation.py --video-samples 3
```

The runner's default input set is this directory. It writes generated reports,
frame extracts, raw HTTP responses, and structured input/outcome logs under
`artifacts/mock-evaluations/`, which is ignored by Git.

`provisional-expected-stills.json` is now a human-review checklist for the five
still images. It is intentionally marked provisional: approve or correct it
with the operations team before using it as evaluation ground truth or training
data.

`provisional-expected-bin-video.json` applies the supplied overflow definition
to three fixed-ROI bin events sampled from the videos. Run
`scripts/evaluate_whatsapp_bin_video_replay.py` to score the bin-state model by
frame and by event. The fixture is locked, evaluation-only, and must not be used
for training or threshold calibration.
