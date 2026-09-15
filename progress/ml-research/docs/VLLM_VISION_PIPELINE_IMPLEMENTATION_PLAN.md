# LitterSpot vLLM vision pipeline implementation plan

## Status and scope

- Status: proposed
- Immediate scope: replace and evaluate the image-analysis path using a
  vision-language model (VLM) served through vLLM
- Output scope: validated observations, temporal confirmation, operational
  flags, evidence metadata, and a durable handoff event for the future business
  workflow
- Explicitly deferred: LLM cleaner allocation, cleaner authentication, task
  management, task-state UI, and task-scoped snapshot capture

This plan uses **VLM** for the multimodal model and **vLLM** for the runtime that
serves it. vLLM is not itself a detection model. The selected model, model
revision, vLLM version, prompt version, and output schema must be pinned as one
tested deployment unit.

The current product workflow is documented in
[`current-clarified-requirements.md`](../../../docs/current-clarified-requirements.md)
and its continuation. This historical implementation plan ends at a versioned
`ConfirmedFlag` contract.

## Objective

Build a production-ready vision pipeline that maximizes reuse of public,
maintained video-analytics libraries:

1. Receives sampled frames from a registered camera.
2. Uses conventional perception to generate stable people counts and candidate
   regions, then sends selected frames/crops and versioned instructions to a VLM
   served by vLLM.
3. Produces fused, structured observations for:
   - bin overflow;
   - liquid or hazardous spills;
   - litter/trash on the floor;
   - people count and population-density analysis.
4. Rejects malformed or unsafe model output.
5. Confirms findings across time to reduce single-frame false alerts.
6. Emits idempotent flags that the future business workflow can convert into
   incidents and work tasks.
7. Runs beside the existing detector until the VLM passes accuracy, latency,
   stability, and capacity gates.
8. Adopts public stream/tracking/workflow libraries when a measured adoption
   spike proves they fit the license, offline, deployment, and contract needs.

## Non-goals

- Selecting or assigning a cleaner.
- Calling an allocation LLM.
- Creating cleaner users or login sessions.
- Implementing task states such as accepted or completed.
- Starting or stopping task-linked camera snapshots.
- Replacing camera ingestion with continuous video recording.
- Treating a model-generated confidence number as calibrated probability
  without evaluation.
- Removing the existing YOLO/classifier pipeline before the rollback window.

## Current repository assessment

The present Python path is a useful baseline:

- `ai-service/app/pipeline.py` coordinates bin localization, bin-state
  classification, people detection, floor-hazard analysis, flag generation,
  and persistence.
- `ai-service/app/video_tracking.py` already demonstrates temporal confirmation
  for sampled video frames.
- `ai-service/app/schemas.py` defines the current analysis response.
- `ai-service/app/analysis_store.py` stores full result payloads, evidence, and
  operational alerts in SQLite.
- `backend/src/services/pipelineClient.ts` is the TypeScript adapter to Python.
- `shared/detection-schema.json` is too generic to be the new cross-process
  contract.

The new implementation should deepen the Python inference module but stop it
from owning downstream task behavior. During this focused phase, existing
SQLite persistence may remain for comparison evidence, but new business-state
features must not be added to it.

## Public-solution decision

The supporting research is in
[`VLLM_PUBLIC_SOLUTIONS_RESEARCH.md`](VLLM_PUBLIC_SOLUTIONS_RESEARCH.md) and
[`VLLM_LIMITED_HARDWARE_RESEARCH.md`](VLLM_LIMITED_HARDWARE_RESEARCH.md).

There is no single vLLM-native system that owns live RTSP ingestion, tracking,
segmentation, people counting, temporal incident semantics, and LitterSpot's
handoff contract. The preferred solution is therefore an adopted hybrid:

| Layer | Preferred choice | Reason |
| --- | --- | --- |
| Stream/workflow orchestration | Roboflow Inference Workflows, pending spike | Public RTSP/video pipeline, latest-frame behavior, GPU batching, model chaining, trackers/zones, VLM blocks, webhooks |
| VLM serving | Pinned vLLM sidecar | OpenAI-compatible multimodal serving, continuous batching, structured output |
| Semantic VLM | InternVL3.5-1B smoke baseline; Qwen3-VL-2B-Instruct-FP8 primary constrained-hardware candidate; Qwen2.5-VL-3B-AWQ quality challenger | Start with the smallest vLLM-compatible VLM, then increase size only when measured accuracy requires it |
| Candidate perception | Current bin, people, and floor models | Already integrated and faster/more geometrically stable than generative output |
| Tracking/counting | ByteTrack or BoT-SORT plus polygon zones | Stable identity/count semantics across frames |
| Optional masks | Existing floor segmenter; SAM 2 only if measured benefit | Avoid unneeded GPU and operational cost |
| Output and temporal semantics | LitterSpot-owned validator, fusion, episode policy, and `ConfirmedFlag` | Product-specific invariants and auditability |
| Evaluation | FiftyOne plus LitterSpot episode/count metrics; CVAT if collaborative labeling is needed | Reuse standard detection/mask/video evaluation and review tooling |

NVIDIA's public Video Search and Summarization blueprint is the reference for
the architecture pattern: fast perception and behavior analytics create
candidate alerts, and a VLM verifies them to reduce false positives. It is not
the initial runtime because it is centered on NVIDIA NIM and a substantially
larger microservice stack.

Roboflow Inference's core is Apache-2.0, but models, cloud-connected features,
private workflows, and enterprise blocks can have different requirements. No
dependency is approved until the Phase 0 spike records the license and offline
behavior of every exact block used.

## Limited-hardware decision

The currently inspected development host has an NVIDIA RTX 4050 Laptop GPU
with 6 GiB VRAM, an Intel i5-13500HX, and approximately 24 GiB RAM. Treat this
as a development benchmark tier, not as the production hardware contract.

Neither PicoLM nor BitNet is a replacement for the vLLM/VLM detection layer:

- PicoLM is a small, text-only LLaMA/GGUF CPU runtime. It has no supported
  image encoder or Qwen/InternVL multimodal path and does not serve through
  vLLM.
- BitNet.cpp accelerates native ternary BitNet text models. It cannot convert
  an arbitrary pretrained VLM into a native 1.58-bit multimodal model, and its
  official supported-model list does not supply the required vision model.
- Either project may be reconsidered for a future text-only edge utility or
  cleaner-allocation experiment, but neither belongs in the current detection
  implementation.

The optimization order for this scenario is:

1. Reduce how often the VLM runs: use motion/ROI gates, current detectors,
   temporal candidate generation, freshness deadlines, and deduplication.
2. Reduce each multimodal request: use selected crops or one image initially,
   cap image dimensions/visual tokens, use a 4K-or-smaller real context cap,
   disable video input, and keep structured completions short.
3. Start with `OpenGVLab/InternVL3_5-1B-Instruct` as a pipeline and memory smoke
   test, then use the official `Qwen/Qwen3-VL-2B-Instruct-FP8` as the first
   meaningful constrained-hardware quality candidate. The FP8 artifact is
   approximately 3.47 GB, so total runtime fit still requires measurement.
4. Benchmark `Qwen/Qwen2.5-VL-3B-Instruct-AWQ` only if the 2B model misses the
   detection-quality gate. Use CPU weight offload only as a last-resort
   experiment because it transfers weights across the CPU/GPU link during
   inference.
5. Run 4B/7B/8B challengers on a larger central GPU or hosted benchmark tier; do
   not make them a requirement for the 6 GiB edge host.

The model winner is the smallest checkpoint that meets class-specific episode
accuracy and alert-delay gates at the required camera load. A larger model is
not "more optimal" if it forces stale queues, low sampling coverage, or CPU
offload that misses the operational latency target.

## Target flow

```text
RTSP camera / file / test upload
                |
                v
 Roboflow Inference Pipeline (preferred after spike)
  - reconnect/source health
  - max FPS and latest-frame backpressure
  - motion/ROI gates and frame grouping
                |
                +----> existing detectors ----> tracker/zones/population
                |              |
                |              +----> candidate boxes/masks/crops
                v
       VLM analysis module ----HTTP----> vLLM + pinned VLM
                |                            |
                |<---- schema-constrained JSON
                v
     LitterSpot validation and fusion
                |
                v
     Temporal confirmation policy
                |
                v
  Observation + ConfirmedFlag outbox/handoff
                |
                +----> current dashboard during migration
                +----> future incident/task workflow
```

The public browser continues to call the TypeScript backend. vLLM remains on a
private network and must never be exposed directly to the browser.

Keep a full-frame VLM-only branch in shadow mode. It is a comparison path, not
the presumed production winner. A detection class may move to VLM-only only
after camera-stratified evidence shows that doing so improves or simplifies the
system without unacceptable count, geometry, latency, or capacity regressions.

## Proposed adopted workflow

The Phase 0 Roboflow path should implement this version-controlled graph. Block
names are conceptual until verified against the pinned Inference release and
its license bill of materials.

```text
Video source (RTSP/file)
  -> video metadata/source timestamp
  -> max-FPS sampler + freshness deadline
  -> camera focus/quality + optional motion gate
  -> fork
       A. person detector
          -> per-class confidence filter
          -> ByteTrack/BoT-SORT
          -> polygon zone
          -> operational people count

       B. current bin localizer/state model adapter
          -> stable physical-bin mapping
          -> overflow candidate

       C. current floor segmentation adapter
          -> ROI/overlap filters
          -> spill/litter candidate masks

       D. sampled full-frame shadow branch
  -> candidate list roll-up and crop/frame-group builder
  -> vLLM proxy/custom VLM block
  -> strict JSON parse and workflow output
  -> authenticated webhook/SDK result to LitterSpot
  -> LitterSpot schema validation, fusion, episode confirmation
```

Workflow outputs must include source frame ID/timestamp, candidate source and
revision, track/physical-bin ID, original and crop geometry, workflow version,
and correlation ID. The workflow must not directly call the future task or
cleaner modules. Its only production destination is the LitterSpot validation
interface.

Prefer two to four temporally spaced JPEG frames or candidate crops per vLLM
request for the initial release. vLLM can accept video files for compatible
models, but a file request is not a persistent camera session, and decode/token
cost can hide capacity problems. Short-video input remains a measured
challenger, not the default.

## Module design

### Stream workflow adapter

External interface:

```python
frames = frame_source.consume(camera_profile)
```

The preferred production adapter delegates stream mechanics to a versioned
Roboflow Inference Workflow. A recorded-file adapter and in-memory adapter are
required for deterministic tests. If the adoption spike rejects Roboflow, this
same interface is implemented by a focused OpenCV/FFmpeg capture worker.

The workflow/adapter owns:

- RTSP connection and reconnect behavior;
- camera freshness and source timestamps;
- maximum analysis FPS and dropping stale queued frames;
- motion/ROI gates and deterministic frame grouping;
- invocation of existing detectors;
- tracker and polygon-zone state;
- creation of candidate crops and metadata;
- a typed result/webhook to the LitterSpot analyzer.

It does not own finding taxonomy, semantic verification, episode confirmation,
or downstream incident creation.

### VLM analysis module

External interface:

```python
observation = vision_analyzer.analyze(frame_bundle, candidates, request_context)
```

The interface accepts:

```text
camera_id
frame_id
captured_at
one to four image frames and/or candidate crops
image media types
candidate detections, masks, track IDs, and source model metadata
optional camera/zone analysis profile
correlation_id
```

It returns a validated `VisionObservation`; callers do not need to know the
prompt, chat template, image encoding, retry policy, vLLM request fields, or raw
generated text.

Implementation responsibilities:

- apply orientation and color normalization;
- enforce image byte and dimension limits;
- optionally resize while retaining coordinate mapping;
- support `full_frame_shadow` and `candidate_verification` analysis modes;
- preserve candidate/track identity through crop and coordinate transforms;
- construct the versioned system/user prompt;
- call the vLLM adapter with a strict timeout;
- request schema-constrained JSON;
- validate and normalize output;
- attach model/runtime/prompt metadata;
- preserve bounded diagnostic data without logging image bytes or secrets;
- classify errors as retryable or terminal.

For people population, the conventional detector/tracker count is the initial
operational value. The VLM count is retained as a shadow field until it passes
density-stratified evaluation. Never average unrelated detector and generated
confidence values; fusion uses explicit versioned rules.

### vLLM adapter

Internal interface:

```python
result = vllm_client.analyze_image(image, prompt, output_schema)
```

The production adapter owns:

- base URL and authentication;
- OpenAI-compatible request formatting;
- supported multimodal image representation;
- model name and revision;
- structured-output parameters for the pinned vLLM version;
- connect/read timeout and one bounded retry;
- health and model-info checks;
- response size limit;
- circuit-breaker metrics.

Tests use a deterministic in-memory adapter. A recorded HTTP fixture may verify
transport compatibility, but policy tests must not depend on a running GPU.

### Output validator

External interface:

```python
observation = validate_vision_output(raw_output, frame_context, deployment_info)
```

Reject the entire response when it contains invalid JSON, an unknown schema
version, impossible people counts, disallowed finding kinds, invalid
coordinates, excessive findings, non-finite numbers, or an unexpected model.

Do not silently coerce free text into a flag. A failed response becomes an
`InferenceFailed` record and never becomes a clear frame or a detection event.

### Temporal confirmation module

External interface:

```python
flags = confirmation_policy.observe(observation)
```

The module owns per-camera history, spatial matching, N-of-M confirmation,
hysteresis, clear rules, cooldown, and policy version. It must not ask the VLM
whether an alert should be raised; the VLM reports visible evidence and the
deterministic policy decides flag state.

Replace in-memory history with a durable or reconstructable store before live
unattended operation. A process restart must not immediately re-raise every
active condition as a new flag.

## Detection taxonomy

Use these names consistently in prompts, schemas, evaluation, and events:

| Observation kind | Meaning | Downstream behavior |
| --- | --- | --- |
| `bin_overflow` | Waste crosses the bin rim/opening or spills down/outside the bin | Actionable cleaning flag after confirmation |
| `liquid_spill` | Visible liquid or wet spill on a traversable floor area | Safety-critical cleaning flag after confirmation |
| `floor_litter` | Discrete trash, rubbish, or debris lying on the floor | Actionable cleaning flag after confirmation |
| `people_population` | Count/quality metric for visible people | Stored on every valid frame; raises a crowd flag only through zone policy |

`full` and `overflow` must remain distinct. A full but contained bin is a useful
observation but does not automatically produce a critical overflow flag unless
the business policy later adds a proactive emptying task.

People population is not inherently a cleaning problem. The vision pipeline may
emit `crowd_threshold_exceeded`, but its destination is controlled by the
future system policy and may be dispatch or security rather than cleaners.

## VisionObservation contract

Add `shared/vision-observation.schema.json` and matching Pydantic/Zod models.

Required logical shape:

```json
{
  "schemaVersion": "1.0",
  "observationId": "uuid",
  "cameraId": "camera-1",
  "frameId": "uuid",
  "frameSha256": "hex",
  "capturedAt": "RFC-3339 timestamp",
  "processedAt": "RFC-3339 timestamp",
  "image": { "width": 1920, "height": 1080 },
  "analysisMode": "candidate_verification",
  "candidateSources": [
    { "name": "people-yolo", "revision": "pinned-revision" },
    { "name": "floor-segmenter", "revision": "pinned-revision" }
  ],
  "deployment": {
    "model": "pinned-model-name",
    "modelRevision": "immutable-revision",
    "runtime": "vllm",
    "runtimeVersion": "pinned-version",
    "promptVersion": "vision-v1"
  },
  "population": {
    "operationalCount": 7,
    "operationalSource": "tracked_detector",
    "vlmShadowCount": 8,
    "quality": "good",
    "confidence": 0.82
  },
  "findings": [
    {
      "findingId": "frame-local-id",
      "kind": "floor_litter",
      "confidence": 0.88,
      "bboxNormalized": { "x1": 0.2, "y1": 0.6, "x2": 0.35, "y2": 0.82 },
      "evidence": "discrete waste visible on walkway",
      "qualityWarnings": []
    }
  ],
  "frameQuality": {
    "status": "usable",
    "warnings": []
  },
  "processingTimeMs": 940
}
```

Rules:

- Normalize coordinates to `[0, 1]` and require `x1 < x2`, `y1 < y2`.
- Cap findings per kind and total findings.
- Keep evidence descriptions short and non-authoritative.
- Record `population.quality`; do not treat an occluded/blurred count as zero.
- Record the detector/tracker and VLM counts separately. Do not average them.
- Preserve candidate source, revision, track ID, and original geometry when a
  verified finding originated from conventional perception.
- Hash the exact input bytes before preprocessing.
- Use an immutable model revision rather than a floating model alias.
- Store raw model output only in restricted diagnostics with bounded size and
  retention.

## ConfirmedFlag handoff contract

The focused implementation ends at this contract:

```json
{
  "schemaVersion": "1.0",
  "eventId": "uuid",
  "idempotencyKey": "camera/kind/spatial-key/episode",
  "cameraId": "camera-1",
  "zoneId": "zone-1",
  "kind": "bin_overflow",
  "severity": "critical",
  "status": "raised",
  "firstObservedAt": "RFC-3339 timestamp",
  "confirmedAt": "RFC-3339 timestamp",
  "policyVersion": "confirmation-v1",
  "supportingObservationIds": ["uuid-1", "uuid-2", "uuid-3"],
  "representativeFinding": {
    "confidence": 0.91,
    "bboxNormalized": { "x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.8 }
  }
}
```

Emit `status: raised`, `updated`, and `cleared` for the same episode. Consumers
must deduplicate by `eventId` and `idempotencyKey`. The future incident module
owns task creation; the vision pipeline does not.

## Prompt design

The prompt must:

1. Define each class operationally and distinguish full from overflow.
2. Instruct the model to analyze only visible evidence.
3. Provide an `unknown`/quality path for blur, darkness, occlusion, glare, and
   unusable views.
4. Request people count separately from actionable findings.
5. Require normalized geometry only when the finding is localized reliably.
6. Prohibit recommendations, cleaner assignment, and task wording.
7. Produce only the requested schema.

Maintain a small prompt suite with expected outputs for representative clear,
positive, ambiguous, crowded, night, glare, and adversarial-text frames. A
prompt change is a model release and must repeat the evaluation gate.

Camera images may contain text intended to manipulate a model. The system
instruction must treat image text as scene content, never as executable
instruction. Structured validation and deterministic confirmation remain the
primary controls.

## Initial temporal policy

These values are starting hypotheses and must be calibrated on labeled camera
sequences:

- `bin_overflow`: same physical bin or overlapping region in 3 of 5 valid
  samples; clear after 3 valid clear samples.
- `liquid_spill`: overlapping floor region in 2 of 3 valid samples; clear only
  after verified clear evidence or downstream resolution policy.
- `floor_litter`: overlapping region in 3 of 5 valid samples; clear after 3
  valid clear samples.
- `crowd_threshold_exceeded`: rolling population window above the configured
  zone raise threshold, with a lower clear threshold.

Invalid or poor-quality frames do not count as positive or clear. Sampling
interval is part of the policy version because 3-of-5 at one second is not the
same behavior as 3-of-5 at thirty seconds.

## Persistence during the focused phase

Store:

- frame identity and camera/timestamps;
- validated observation JSON plus indexed kind/count fields;
- deployment and prompt version;
- inference error category and latency;
- temporal episode state;
- confirmed flags and their supporting observation IDs;
- evidence storage key and content hash when evidence retention is enabled.

Do not add cleaners, task offers, login sessions, assignments, or capture
sessions to the Python SQLite store. The later system implementation will move
operational state to backend-owned PostgreSQL as defined by the PRD.

## vLLM deployment plan

Initial benchmark order for the inspected 6 GiB development tier:

1. `OpenGVLab/InternVL3_5-1B-Instruct` as the smallest pipeline/VRAM smoke
   baseline.
2. `Qwen/Qwen3-VL-2B-Instruct-FP8` as the primary constrained-hardware quality
   candidate.
3. `Qwen/Qwen2.5-VL-3B-Instruct-AWQ` as the next local quality challenger only
   if it fits without unacceptable offload or queue delay.
4. `Qwen/Qwen2.5-VL-7B-Instruct` and an InternVL 4B/8B checkpoint on a larger
   GPU tier to determine whether their accuracy gain justifies centralized
   serving.

Checkpoint license, model-repository code, chat template, processor, and vLLM
support are reviewed separately for every exact revision. Do not choose from
public general-purpose VQA rankings; choose from LitterSpot episode accuracy and
target-hardware throughput.

Pin a container image/digest and explicit startup configuration. At minimum,
document and test:

- model repository and immutable revision;
- GPU type/count and memory budget;
- tensor/data parallel settings if used;
- maximum model/context length;
- maximum images per prompt;
- chat template source;
- structured-output backend and request syntax;
- image input method and allowed media sources;
- API authentication and private network policy;
- concurrency and queue limits;
- health/readiness behavior;
- generation parameters and whether model repository generation defaults are
  disabled or pinned;
- logs, metrics, restart policy, and rollback artifact.

Start with one GPU when the selected 4B/7B model fits. For many independent
camera requests, benchmark data-parallel replicas before tensor parallelism;
use tensor parallelism primarily when the model does not fit on one GPU. Reduce
the maximum model length to the real workload, explicitly cap image/video items,
frame count, dimensions and completion tokens, and disable unused video input
if it creates avoidable memory reservation. Treat every model-specific vLLM
recipe as part of the pinned deployment evidence.

The selected integration is either:

- **direct:** LitterSpot calls vLLM's OpenAI-compatible endpoint; or
- **workflow proxy:** the pinned Roboflow Inference adapter calls the vLLM
  sidecar and returns normalized workflow output.

Maintain the direct adapter as a contract test even if the workflow proxy is
selected, so workflow upgrades can be compared with the underlying model
server. Do not maintain two active production inference paths without a clear
fallback policy.

Do not enable broad local-media paths or arbitrary remote image fetching. The
preferred adapter supplies controlled image bytes/data or an authenticated,
short-lived internal object URL.

## Implementation phases

### Phase 0 — public-solution adoption spike

Build three disposable paths against the same permissioned, camera-stratified
recorded manifest:

1. **Path A — current baseline:** run the existing LitterSpot pipeline and
   export normalized frame and episode results.
2. **Path B — direct vLLM:** run pinned InternVL3.5-1B and Qwen3-VL-2B-FP8 on
   the constrained tier, Qwen2.5-VL-3B-AWQ if it fits, and a 4B/7B/8B quality
   challenger on a larger GPU tier through pinned vLLM containers with JSON
   Schema output.
3. **Path C — Roboflow hybrid:** run a versioned Workflow for RTSP/file input,
   current detector adapters, tracking/zones, candidate crops/frame groups, a
   vLLM proxy or custom block, and typed webhook output.
4. Record the exact source path, license, model license, account/API-key need,
   offline behavior, and deployment requirements of every selected Workflow
   block.
5. Compare frame freshness under load, per-class accuracy, people-count error,
   latency, GPU/CPU utilization, restart recovery, output portability, amount of
   custom code, and upgrade surface.
6. Evaluate DeepStream only if the target RTSP scale exposes a measured
   throughput or reliability gap.

Exit: choose and document one of `roboflow_hybrid`, `roboflow_streams_only`, or
`lightweight_custom`; freeze the evaluation manifest; identify the selected VLM
baseline/challenger; retain the existing detector as rollback. No third-party
runtime is committed to production before this exit review.

### Phase 1 — contracts and portable seams

1. Add shared observation and confirmed-flag JSON schemas.
2. Add matching Pydantic and Zod validators.
3. Define the stream workflow adapter so a Roboflow Workflow and recorded test
   source satisfy the same interface.
4. Define the vLLM adapter with direct and workflow-proxy implementations when
   both are justified by the Phase 0 decision.
5. Add deterministic in-memory adapters for tests.
6. Add configuration to `.env.example` without committing credentials.

Exit: contract and adapter tests pass without a camera, cloud account, or GPU.

### Phase 2 — adopted stream and perception workflow

1. Version the selected Workflow or capture configuration in the repository.
2. Implement RTSP reconnect, source health, maximum FPS, freshness deadline,
   and old-frame dropping.
3. Normalize the existing bin, person, and floor-model outputs.
4. Add ByteTrack/BoT-SORT and polygon-zone population counting.
5. Select full frames/crops and construct deterministic two-to-four-frame groups
   for semantic verification.
6. Verify self-hosted operation and prevent camera images from using unapproved
   cloud/event paths.

Exit: recorded and test RTSP streams produce reproducible candidate bundles,
stable track IDs, population counts, and freshness metrics without VLM output.

### Phase 3 — VLM verifier and full-frame shadow analyzer

1. Implement frame/crop validation, preprocessing, and exact input hashing.
2. Add versioned prompts for `candidate_verification` and `full_frame_shadow`.
3. Add schema-constrained requests through the selected vLLM adapter.
4. Implement strict output validation, coordinate mapping, candidate identity
   preservation, and error taxonomy.
5. Record model/runtime/prompt/workflow and source-detector revisions in every
   observation.
6. Add a private analysis endpoint while keeping existing endpoints available.

Exit: golden-frame, candidate-crop, coordinate-roundtrip, prompt-injection, and
malformed-output tests pass; no unvalidated model output crosses the interface.

### Phase 4 — deterministic fusion, temporal confirmation, and handoff

1. Define class-specific fusion rules for detector candidates and VLM semantic
   verification. Never average unrelated confidence values.
2. Adapt the useful concepts from `video_tracking.py` into a finding-agnostic,
   restart-safe confirmation module.
3. Add spatial episode keys, N-of-M windows, cooldown, and clear hysteresis.
4. Persist enough episode state to survive restart and redelivery.
5. Emit versioned, idempotent `ConfirmedFlag` raise/update/clear events.
6. Add recorded-sequence and duplicate-delivery tests.

Exit: replaying or retrying the same sequence produces one logical episode and
one stable handoff, and invalid/unusable frames never count as clear.

### Phase 5 — shadow evaluation and model/workflow selection

1. Run the current baseline, VLM-only, and hybrid paths on identical frames.
2. Prevent new flags from entering the production alert/task workflow.
3. Export predictions to FiftyOne-compatible fields and generate per-camera
   disagreement/failure views; use CVAT only when collaborative relabeling is
   required.
4. Measure episode quality, population error, localization, latency percentiles,
   frame freshness, GPU/CPU utilization, queue time, invalid output, and
   sustainable camera rate.
5. Tune prompts and deterministic policy on development data only, then rerun
   the frozen held-out set.
6. Decide per detection class whether hybrid or VLM-only becomes the candidate
   production path.

Exit: the chosen path and exact version bundle pass approved held-out and live
shadow gates; rejected paths and the reasons are documented.

### Phase 6 — canary and controlled cutover

1. Enable confirmed flags for one canary camera/site behind a feature flag.
2. Keep the current pipeline in shadow for comparison.
3. Monitor false/missed flags, event delay, frame staleness, vLLM/workflow
   failures, source reconnects, and operator feedback.
4. Expand by camera/site only after the approved observation window.
5. Exercise rollback of both the VLM deployment and stream workflow before
   broad rollout.

Exit: the selected hybrid/VLM path is active for approved cameras with tested
rollback and no downstream contract change.

### Phase 7 — stabilization

1. Add capacity tests for target cameras, sampling rate, detector load, and vLLM
   concurrency.
2. Add alerts for stale cameras, reconnect loops, inference failure, queue
   depth, latency, circuit-breaker state, model/workflow identity mismatch, and
   webhook delivery.
3. Add workflow/model/prompt deployment and rollback runbooks.
4. Pin the approved dependency/container bill of materials.
5. Remove unused current inference paths only after the rollback window and a
   separate approval.

Exit: production dashboards, runbooks, capacity evidence, license bill of
materials, and retention checks are complete.

## Repository change map

```text
shared/
  vision-observation.schema.json
  confirmed-flag.schema.json

deploy/vision/
  workflow.json or workflow.yaml # only if Roboflow path is selected
  docker-compose.yml             # pinned workflow + vLLM sidecars
  versions.lock                  # image digests, model/workflow revisions

ai-service/app/
  frame_source.py                # stream workflow seam
  roboflow_workflow_client.py    # only if selected by Phase 0
  vision_analyzer.py
  vllm_client.py
  perception_fusion.py
  vision_output.py
  vision_prompt.py
  confirmation_policy.py
  vision_store.py              # focused observation/episode persistence
  schemas.py                   # add validated contract models
  main.py                      # add private VLM analysis endpoint

ai-service/tests/
  test_frame_source.py
  test_roboflow_workflow_client.py
  test_vllm_client.py
  test_perception_fusion.py
  test_vision_output.py
  test_vision_analyzer.py
  test_confirmation_policy.py
  fixtures/vision/

backend/src/
  schemas/vision.ts
  services/visionClient.ts
  routes/visionRoutes.ts        # admin/test access only during focused phase

docs/
  vlm-evaluation.md             # extend with selected model/runtime results
  VLLM_PUBLIC_SOLUTIONS_RESEARCH.md
  VLLM_VISION_PIPELINE_IMPLEMENTATION_PLAN.md
```

Do not create task, assignment, authentication, or capture modules as part of
this plan.

## Verification gates

### Detection quality

Report separately for each camera group and class:

- precision, recall, F1, and false flags per camera-hour;
- episode-level detection delay;
- full-versus-overflow confusion;
- spill-versus-shadow/reflection confusion;
- litter-versus-personal-object confusion;
- performance in blur, low light, glare, occlusion, and crowding.

### Population quality

Report:

- mean absolute error and signed bias;
- exact-count accuracy by density band;
- undercount rate in crowded/occluded scenes;
- crowd-threshold event precision, recall, and raise/clear delay.

### Runtime quality

Report:

- p50/p95/p99 end-to-end inference latency;
- queue time and timeout rate;
- malformed/invalid output rate;
- GPU memory and utilization;
- sustainable frames per minute at the target camera count;
- recovery time after vLLM restart;
- performance under one camera burst and multi-camera steady state.

Production thresholds must be approved from measured data. Do not approve the
pipeline using one aggregate “accuracy” score.

## Failure behavior

- Camera/workflow source unavailable: mark the camera stale/offline, retry with
  bounded backoff, and do not manufacture a clear observation.
- Roboflow workflow unavailable: fail over only to an approved LitterSpot stream
  adapter; otherwise expose degraded state and retain freshness bounds.
- Workflow output/model revision mismatch: reject at the LitterSpot seam and
  stop production flag emission for that source.
- vLLM unavailable: queue within a bounded freshness window, then mark analysis
  delayed/failed; optionally invoke the approved legacy adapter.
- Invalid output: store a restricted diagnostic and emit `InferenceFailed`; do
  not interpret it as clear.
- Model identity mismatch: fail readiness and stop production flag emission.
- Poor frame quality: record unknown/unusable; do not count it as positive or
  clear.
- Backlog beyond freshness window: discard stale analysis work explicitly and
  record a metric rather than processing obsolete frames indefinitely.
- Persistence unavailable: do not emit flags that cannot be made idempotent;
  recover from the bounded input queue.
- Existing and VLM pipelines disagree: record disagreement during shadow mode;
  do not merge their confidence numbers.

## Decisions needed before Phase 0 exit

1. Production GPU model/count/VRAM, CPU/RAM, number of active cameras, frame
   sampling policy, maximum concurrent VLM requests, and alert-delay target.
2. Whether Phase 0 selects `roboflow_hybrid`, `roboflow_streams_only`, or
   `lightweight_custom`, including the exact block/container license bill of
   materials and offline/cloud requirements.
3. Which exact Qwen2.5/Qwen3/InternVL checkpoint revision wins the benchmark.
4. Whether precise boxes/polygons come from the conventional perception path,
   VLM, or both; VLM geometry must pass a localization gate before operational
   use.
5. Required sampling interval and frame-group strategy for each camera/zone.
6. Class-specific accuracy gates and maximum alert delay.
7. People-density thresholds and whether crowd flags are enabled.
8. Evidence retention and access policy for analyzed frames.
9. Whether the current detector is a shadow-only baseline or an automatic
   fallback during vLLM outages.

None of these decisions expands the immediate scope into task allocation or
cleaner workflow implementation.
