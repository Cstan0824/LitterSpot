# Mock data validation report — 2026-08-12

## Result: PASS

Command executed:

```powershell
$env:PYTHONPATH = "ai-service"
.\.venv\Scripts\python.exe ml-training\scripts\evaluate_bin_state_edge_cases.py --strict --validate-localizer
.\.venv\Scripts\python.exe -m unittest discover -s ai-service\tests -p "test_*.py"
```

Checkpoint: `runs/state_classifier/multitask_bin_state/production.pt`

| Mock fixture | Samples | Expected behavior | Actual result | Status |
| --- | ---: | --- | --- | --- |
| Closed green bin / visible liner | 5 video frames | Normal; never overflow | 5 `normal`, each verified by `matches_normal_reference` | Pass |
| Black bin / visible waste image | 1 image | Overflow | `overflow`, score 0.701 | Pass |
| Black bin / visible waste | 5 video frames | Overflow | 5 `overflow`, scores 0.659–0.766 | Pass |
| Crowded no-bin scene | 3 video frames | No overflow alert | One false localizer candidate (0.807) became `unknown` / `unregistered_bin`; other frames had no candidates | Pass |

The automated test suite also passed: **38 tests**.

## What changed

The state model remains a useful overflow candidate detector, but it is not the
final authority for a fixed CCTV view. For each configured physical bin, the
pipeline compares the fixed bin region with a reviewed normal reference image.
The normal reference overrides a model overflow candidate only when the scene
still matches that normal bin. A visibly different bin scene does not match the
baseline and continues through the normal overflow policy.

Floor-litter masks that are almost wholly within a localized bin are also
discarded; they are bin contents, not litter on the floor.

## Deployment requirement

`config/bin-profiles.json` contains a mock profile for `camera-1:bin-1` made
from the supplied green-bin video. For every production camera, record a clear
normal frame and its physical-bin ROI, then add a separate profile. Re-capture
the reference when the camera moves, the bin is replaced, or the lighting
changes materially.

The full machine-readable JSON is generated locally at
`runs/edge-case-evaluation/report.json`.
