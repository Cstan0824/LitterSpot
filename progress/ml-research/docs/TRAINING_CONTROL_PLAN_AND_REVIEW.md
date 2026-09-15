# Controlled Training Plan and Static Self-Review

## Goal and model-selection policy

The controlled run trains YOLOE-26S unattended, writes a recoverable checkpoint every epoch, logs what happened, and stops gracefully on convergence or sustained resource pressure.

Checkpoint meanings:

- `last.pt`: newest completed epoch; resume source.
- `epochN.pt`: per-epoch rollback checkpoints.
- `best_ultralytics.pt`: Ultralytics aggregate-fitness winner.
- `best_controlled.pt`: LitterSpot overflow-oriented winner.
- `best.pt`: synchronized to `best_controlled.pt` after each epoch.
- `best_accepted.pt`: only produced after overflow precision >= 0.85, overflow recall >= 0.80, and overall mAP50 >= 0.65.

The controlled score is 55% overflow F2, 20% overflow mAP50, 15% overall mAP50, and 10% overall mAP50-95. F2 emphasizes recall because a missed overflowing bin is the primary operational failure. Selection begins at epoch 5 and requires improvement >= 0.002.

## Stop and resource policy

The guard requests a graceful stop so validation and `last.pt` can be written. Limits are configurable in `ml-training/configs/training_control.yaml`:

- GPU temperature >= 85 C for 30 seconds.
- GPU memory >= 95% for 60 seconds.
- RAM >= 92% for 60 seconds.
- CPU usage >= 98% for five minutes.
- disk free below 10 GB.
- no train/validation heartbeat for 20 minutes.
- total runtime reaches 12 hours.
- controlled score fails to improve for 20 epochs.
- Ultralytics early stopping reaches patience 20.
- `ml-training/control/STOP` appears or the process receives Ctrl+C/termination.

High GPU utilization is expected and is not itself unhealthy. CPU temperature is enforced only if Windows exposes a sensor through `psutil`; otherwise it is logged as null. GPU temperature is read through `nvidia-smi`.

## Review surface

- `epochs.jsonl`: time, losses, aggregate metrics, overflow metrics, score and resources per epoch.
- `resources.jsonl`: resource sample every 10 seconds.
- `events.jsonl`: checkpoint promotions and stop reasons.
- `state.json`: latest dashboard state.
- `summary.json`: final outcome.
- Ultralytics `results.csv`: canonical epoch table.
- Native redirected console: batch-level progress and validation output.

Commands:

```powershell
# Fresh controlled run
.\.venv\Scripts\python.exe ml-training\scripts\train_controlled.py

# Resume without changing PyTorch/Ultralytics versions
.\.venv\Scripts\python.exe ml-training\scripts\train_controlled.py --resume

# Live terminal dashboard; closing it does not stop training
.\.venv\Scripts\python.exe ml-training\scripts\live_training.py

# Graceful stop request
New-Item -ItemType File ml-training\control\STOP
```

## Static self-review

1. **Checkpoint ordering:** selection executes after Ultralytics writes `last.pt`; promoted files are complete checkpoints.
2. **Resume compatibility:** optimizer restoration can fail if PyTorch or Ultralytics changes mid-run. Pin the environment for the duration of a run.
3. **Dataset validity:** passing public-dataset validation is not theme-park approval. An untouched, camera-sequence-grouped CCTV test set remains mandatory.
4. **False-alert gap:** validation metrics do not directly enforce the required normal-bin false-alert rate. Measure it separately before deployment.
5. **CPU temperature:** many Windows systems do not expose it to Python. Use HWiNFO/vendor telemetry if CPU-temperature enforcement is mandatory.
6. **Brief spikes:** 10-second sampling may miss brief spikes; sustained thresholds deliberately avoid stopping on harmless transients.
7. **Power loss:** the active epoch is lost, but the prior `last.pt` and `epochN.pt` remain recoverable.
8. **Concurrent games:** guards protect stability, but contention can slow training substantially. Use the STOP file before gaming if latency matters.
9. **Best semantics:** `best.pt` intentionally means the LitterSpot controlled score; the Ultralytics result is preserved separately.
10. **Log growth:** JSONL logs should be rotated for multi-day or repeated production runs.
