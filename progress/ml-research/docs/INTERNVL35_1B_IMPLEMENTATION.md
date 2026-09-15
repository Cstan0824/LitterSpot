# InternVL3.5-1B implementation

## Selected model

- Repository: `OpenGVLab/InternVL3_5-1B-Instruct`
- Revision: `5648fa26ff23acaba53588936d9f1dfaf305f522`
- License: Apache-2.0
- Lock file: `models/internvl3_5_1b.lock.json`

Ollama was not selected. Its official library did not contain the requested
InternVL3.5-1B vision checkpoint, and Ollama was not installed on the inspected
host. The repository uses the official Hugging Face checkpoint.

## Install the model

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
.\.venv\Scripts\python.exe scripts\download-internvl.py
```

The checkpoint is placed under
`models/huggingface/OpenGVLab--InternVL3_5-1B-Instruct`. That directory is
ignored by Git.

## Local Windows mode

This workstation has no Docker installation or WSL Linux distribution. vLLM
therefore cannot be launched locally yet. The default development provider is
Transformers using the same official checkpoint:

```powershell
$env:VLM_PROVIDER = "transformers"
$env:VLM_MODEL_PATH = "$PWD\models\huggingface\OpenGVLab--InternVL3_5-1B-Instruct"
$env:DEVICE = "0"
npm start
```

The launcher sets these defaults automatically. Model loading happens once in
the FastAPI lifespan.

## Production vLLM mode

Run vLLM on a Linux NVIDIA host. Start with one image, one sequence, and a
bounded context because the target development GPU has 6 GiB VRAM:

```bash
vllm serve OpenGVLab/InternVL3_5-1B-Instruct \
  --host 127.0.0.1 \
  --port 8001 \
  --max-model-len 4096 \
  --max-num-seqs 1 \
  --limit-mm-per-prompt '{"image":1,"video":0}' \
  --gpu-memory-utilization 0.90
```

Then configure FastAPI:

```text
VLM_PROVIDER=vllm
VLM_MODEL_ID=OpenGVLab/InternVL3_5-1B-Instruct
VLM_API_URL=http://127.0.0.1:8001/v1
VLM_API_KEY=EMPTY
```

The adapter sends controlled in-memory JPEG data, requests JSON
Schema-constrained output, and validates the response again with Pydantic.

## Detection contract

InternVL returns:

- every visible person with a normalized bounding box;
- visible bins classified as `normal`, `full`, `overflow`, or `unknown`;
- `floor_litter` observations;
- `floor_spill` observations.

Coordinates use integers from 0 to 1000 and are converted into image pixels.
Malformed boxes, invalid enums, malformed JSON, and out-of-range confidence are
rejected. People and bin observations below `VLM_MIN_CONFIDENCE` are dropped.
Floor hazards use `floorConfidence` separately so the prototype can favor spill
recall.

InternVL commonly emits compact four-value bounding-box arrays. The adapter
normalizes those arrays to the API's named `x1`, `y1`, `x2`, `y2` contract before
validation. Evaluation requests may enable `include_diagnostics=true` to return
the raw model response, tile count, scene counts before filtering, and accepted
counts after fusion. Those diagnostics are excluded from persisted analyses.

For camera streams, overflow and hazard alerts require the configured number of
consecutive matching observations. Missing observations reset their streak.

## Three-module prototype

The current prototype calls InternVL once per frame and passes the validated
scene to three independent modules:

1. `bin_state` associates observations with fixed physical-bin ROIs and maps
   `normal`, `full`, `overflow`, or `unknown` state;
2. `floor_hazard` keeps `floor_litter` and food/beverage or liquid
   `floor_spill` observations whose center lies inside the optional floor ROI;
3. `occupancy` counts visible people in the frame. It does not identify or
   track individuals.

The fusion layer applies confirmation streaks and emits one integrated result.
Each response contains a `stages` array with module name, configured interval,
observation count, and module processing time. All intervals default to one
second. Keep them equal initially with `PERCEPTION_INTERVAL_SECONDS`; future
deployments can independently override `BIN_INTERVAL_SECONDS`,
`FLOOR_INTERVAL_SECONDS`, and `OCCUPANCY_INTERVAL_SECONDS`.

This split is logical rather than three InternVL calls. Three VLM calls would
increase latency and GPU pressure without improving the 1B checkpoint's visual
quality. Each module is an adapter seam that can later receive a specialist
model without changing the public response contract.

### Fixed-camera ROI calibration

For this prototype, calibration means drawing one approximate rectangle around
each physical bin and storing it as 0-to-1 coordinates in
`config/bin-profiles.json`. A default `movementMarginNormalized` of `0.04`
allows minor camera or bin movement. When `calibratedCamera=true`, InternVL is
told to inspect every registered bin region and its observation is associated
with the physical bin ID. If the VLM misses it, the API returns that configured
bin as `unknown` with reason `vlm_no_bin_in_calibrated_roi`; it does not pretend
the bin is normal.

Overflow means waste is piled above the rim, protrudes beyond the container,
or has fallen around the bin. A bag near the registered bin therefore belongs
in the overflow decision, while unrelated floor waste belongs to
`floor_litter`.

## Main implementation seams

- `ai-service/app/internvl_analyzer.py`: model/runtime integration and schema.
- `ai-service/app/perception_modules.py`: three module adapters and fusion.
- `ai-service/app/vlm_pipeline.py`: shared-inference orchestration and storage.
- `ai-service/app/main.py`: FastAPI lifecycle and HTTP endpoints.
- `scripts/download-internvl.py`: reproducible pinned download.
- `models/internvl3_5_1b.lock.json`: immutable model identity.

## Validation

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s ai-service/tests -p "test_*.py"
npm --workspace=backend run build
npm --workspace=frontend run build
```

Model quality is not established by these contract tests. Prototype acceptance
targets for the supplied camera domain are:

| Measure | Initial gate |
| --- | ---: |
| Bin-overflow event recall / precision | >= 90% / >= 85% |
| Spill event recall / precision | >= 95% / >= 80% |
| Floor-litter event recall / precision | >= 85% / >= 85% |
| People count mean absolute error | <= 1 person/frame |
| End-to-end alert latency | p95 <= 10 seconds |
| Stability | no OOM in 30 minutes at 4 streams, then 8 |

Spill recall is deliberately the strictest because the stated business cost of
missing a spill is greater than reviewing a false positive. These are prototype
alignment targets, not current performance claims. The 2026-08-17 mock rerun
returned HTTP 200 for all 20 samples but produced 19 empty results. Mean local
Transformers latency was 16.8 seconds, p95 was 20.0 seconds, and the maximum was
30.4 seconds, so InternVL3.5-1B currently fails the recall and latency gates.

A separate calibrated request returned the registered physical `bin-1` as
`unknown` with `vlm_no_bin_in_calibrated_roi`. This is the intended safe
fallback: ROI calibration preserves bin identity but cannot compensate for a
VLM that failed to visually recognize or classify the bin.

## Recovery experiment and production handoff

The original empty result was traced to copied zero-confidence prompt examples,
single-square image preparation, and a parser that did not accept InternVL's
compact bounding-box arrays. The active recovery implementation removes the
example values, uses bounded official aspect-ratio tiling, normalizes compact
arrays, and provides opt-in evaluation diagnostics.

This does not establish the model as production-ready. See
[`THREE_PIPELINE_SPECIALIST_HANDOFF.md`](THREE_PIPELINE_SPECIALIST_HANDOFF.md)
for the specialist model replacement plan and validation gates.

### Recovery result (2026-08-17)

The five supplied still images were replayed after the recovery changes with
evaluation diagnostics enabled. All five produced non-empty structured output,
where the earlier 20-sample run produced 19 empty results. This confirms the
empty-output root cause was implementation-level, not corrupt input media.

The recovery did **not** pass the operational gate: mean latency was 31.4
seconds, p95 was 40.0 seconds, and the outputs included duplicate normal bins,
an unsupported floor-litter flag, and coarse boxes. The provisional review set
and detailed report are intended for manual inspection only. Do not use these
predictions to allocate cleaners without specialist-model validation.

The complete 20-sample replay confirmed this conclusion: all 20 requests were
non-empty and HTTP-successful, but 18 reported a person, 16 raised floor
litter, no spills were detected, mean latency was 27.4 seconds, and p95 latency
was 36.2 seconds. Treat those numbers as a VLM failure signature, not an
accuracy score, because the video frames do not yet have human-approved labels.

If CUDA reports an illegal instruction, the analyzer now becomes unhealthy and
the HTTP adapter returns a retryable 503 rather than a 500 with a poisoned GPU
context. Run the AI service under a process supervisor that restarts an unhealthy
worker before accepting further requests.
