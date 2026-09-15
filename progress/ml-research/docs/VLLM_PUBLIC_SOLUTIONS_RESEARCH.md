# Public solutions research for the LitterSpot vLLM detection workflow

## Research question

Can LitterSpot adopt an already-built public solution or library for the full
camera-to-vLLM detection workflow instead of implementing stream ingestion,
frame sampling, VLM serving, localization, tracking, event stabilization, and
evaluation from scratch?

Research date: 2026-08-15.

The focused limited-hardware analysis, including PicoLM and BitNet, is in
[`VLLM_LIMITED_HARDWARE_RESEARCH.md`](VLLM_LIMITED_HARDWARE_RESEARCH.md).

## Executive conclusion

There is no single public, vLLM-native package that supplies LitterSpot's exact
end-to-end semantics. vLLM serves supported multimodal models and can constrain
their generated output, but it is not a persistent RTSP ingestion, object
tracking, segmentation, people-counting, or incident-state engine.

The recommended approach is a **hybrid adopted stack**:

1. Evaluate [Roboflow Inference Workflows](https://github.com/roboflow/inference)
   as the primary stream and computer-vision orchestration layer.
2. Run vLLM as a private GPU sidecar and use a Qwen VLM for semantic
   verification and structured scene observations.
3. Keep LitterSpot's existing trained detectors as fast candidate generators
   during the first release.
4. Use a conventional detector and tracker for stable people counts and object
   identity; do not make VLM text-generated counts or boxes the only source of
   truth.
5. Keep LitterSpot's temporal episode policy, output validation, evidence
   mapping, and `ConfirmedFlag` handoff as owned code.
6. Use NVIDIA's public Video Search and Summarization blueprint as an
   architecture reference, not as the initial runtime dependency.

Before adopting Roboflow Inference, run a bounded spike that verifies the exact
required blocks are available in the Apache-2.0 core or under acceptable terms,
can operate self-hosted without an unwanted cloud dependency, and can call the
pinned vLLM/model combination.

For the inspected RTX 4050 Laptop 6 GiB development host, the direct-vLLM spike
starts with InternVL3.5-1B as a smoke baseline and
`Qwen/Qwen3-VL-2B-Instruct-FP8` as the first meaningful quality candidate.
Qwen2.5-VL-3B-AWQ is the next challenger, not the starting requirement. PicoLM
and BitNet.cpp are excluded from the vision path because their supported
inference paths are text-only. The primary resource strategy is to avoid
unnecessary VLM calls and visual tokens, then use a supported compact
multimodal checkpoint; it is not to substitute a text-only low-bit runtime.

## Why vLLM is only one layer

vLLM's official multimodal interface supports image and, for compatible models,
video inputs through its OpenAI-compatible server. The video interface accepts
a video file/URL that vLLM decodes into frames; it is not a long-running RTSP
camera-session manager. vLLM provides multiple video-decoding backends,
including OpenCV, PyAV, TorchCodec, PyNvVideoCodec, and DeepStream. It also warns
that multimodal support continues to evolve and recommends restricting media
domains to reduce server-side request forgery risk. See the official
[multimodal input guide](https://docs.vllm.ai/en/latest/features/multimodal_inputs/)
and [supported-model matrix](https://docs.vllm.ai/en/latest/models/supported_models/).

vLLM supports JSON Schema and other constrained-generation forms through its
OpenAI-compatible server. This guarantees output shape, not visual truth. The
application must still validate counts, coordinates, enums, model identity, and
business meaning. See vLLM's official
[structured-output example](https://docs.vllm.ai/en/stable/examples/features/structured_outputs/).

vLLM does not natively provide:

- persistent RTSP reconnection and latest-frame backpressure;
- stable track IDs across frames;
- calibrated detector tensors;
- semantic/instance segmentation masks as a general facility;
- camera ROI and zone configuration;
- temporal incident deduplication or clear hysteresis;
- LitterSpot's event contract or business workflow.

## Candidate 1: Roboflow Inference Workflows

### What is reusable

Roboflow Inference is the closest public implementation platform for the
required camera pipeline. Its official repository states that it can manage
cameras and video streams, use composable Workflows, chain models, track/count/
measure objects, run on RTSP streams, handle hardware acceleration,
multiprocessing, video decoding and GPU batching, and connect results to
external systems. Its stream pipeline can drop accumulated old frames in favor
of the latest frame when inference is slower than the source. Sources:

- [Roboflow Inference repository](https://github.com/roboflow/inference)
- [Inference pipeline documentation](https://inference.roboflow.com/using_inference/inference_pipeline/)
- [Video processing with Workflows](https://inference.roboflow.com/workflows/video_processing/overview/)
- [WebRTC/RTSP examples](https://inference.roboflow.com/webrtc-streaming/)

Available workflow concepts relevant to LitterSpot include VLM-as-detector and
VLM-as-classifier blocks, Qwen vision blocks, object detection, segmentation,
ByteTrack/BoT-SORT/OC-SORT, SAM2 video tracking, zones, counting, detection
stabilization, consensus, rate limiting, webhooks, and event sinks. The public
[workflow block index](https://inference.roboflow.com/workflows/blocks/) is the
source of truth for the installed release.

The June 2026 release merged a vLLM proxy backend. The merged implementation
places a CPU inference server in front of a vLLM GPU sidecar, preserves model
pre/post-processing, supports Qwen3.5/Qwen3-VL family adapters, propagates
correlation IDs, and reported CPU-mocked tests plus staging throughput results.
This is directly relevant, but it is recent and must be verified against the
chosen model and self-hosted deployment. Source:
[Roboflow Inference PR #2434](https://github.com/roboflow/inference/pull/2434).

### Licensing and dependency caveats

The repository says its core is Apache-2.0, while models retain their own
licenses, cloud-connected functionality may require an account/API key, and
enterprise functionality under `inference/enterprise` uses a separate
source-available license. Private Workflows, some monitoring/device features,
and some event functionality may be metered or enterprise features. Source:
[Roboflow Inference license section](https://github.com/roboflow/inference#-license).

Therefore, do not assume that every block visible in the documentation is
available under the open core. The adoption spike must produce a bill of
materials listing each imported package/block, source path, license, account
requirement, and offline behavior.

### Recommendation

Use Roboflow Inference as the **preferred prototype**, not an unreviewed hard
dependency. Adopt it if the spike proves:

- self-hosted RTSP ingestion works on the target Linux/NVIDIA deployment;
- old-frame dropping and sampling behavior meet freshness requirements;
- the required detector/tracker/zone blocks are open-core or commercially
  approved;
- a custom block or supported proxy can call the selected vLLM server;
- workflow definitions can be versioned in this repository;
- outputs can be mapped deterministically to `VisionObservation`;
- there is no mandatory cloud path for production camera images or events.

## Candidate 2: NVIDIA Video Search and Summarization blueprint

NVIDIA publishes a substantial reference architecture for GPU-accelerated video
analytics. It contains real-time video intelligence, object detection/tracking,
message-broker output, downstream incident analytics, VLM processing, video I/O
and storage, and alert workflows. Of particular relevance, its **Alert
Verification** workflow uses perception and behavior analytics to generate
candidate alerts and a VLM to reduce false positives. Sources:

- [NVIDIA VSS public repository](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization)
- [VSS skills/architecture catalog](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/blob/main/skills/README.md)
- [VSS architecture documentation](https://docs.nvidia.com/vss/2.4.0/content/architecture.html)

This is the strongest public evidence for the recommended hybrid design:
continuous perception finds/tracks candidates, while a VLM verifies meaning.
It is not the preferred direct dependency because the blueprint is designed
around NVIDIA NIM and a larger NVIDIA microservice stack rather than LitterSpot's
existing FastAPI service and required vLLM runtime. Use its service separation,
alert verification, message metadata, and observability patterns as references.

## Candidate 3: NVIDIA DeepStream

DeepStream is a mature NVIDIA streaming-analytics toolkit. Its official docs
cover RTSP/file/camera inputs, batching, inference, multi-object tracking,
visualization, message conversion, and Kafka/MQTT/AMQP/cloud broker output. It
also provides Python Flow APIs and analytics for ROI filtering, overcrowding,
direction, and line crossing. Sources:

- [DeepStream overview](https://docs.nvidia.com/metropolis/deepstream/8.0/text/DS_Overview.html)
- [DeepStream Python Flow APIs](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_service_maker_python_intro_to_flow_api.html)

DeepStream is a credible scale-up choice when LitterSpot must process many RTSP
streams on NVIDIA hardware. It does not provide the LitterSpot VLM prompt/schema
or vLLM integration by itself, and it adds GStreamer/NVIDIA deployment
complexity. Prefer it over Roboflow Inference only if the adoption spike shows a
clear throughput or operational advantage at the target camera count.

## Candidate 4: Grounded SAM 2 and SAM 2

[Grounded SAM 2](https://github.com/IDEA-Research/Grounded-SAM-2) publicly
combines Grounding DINO or Florence-2 with SAM 2 to detect, segment, and track
text-prompted objects in video. The repository includes camera and custom-video
tracking examples and uses `supervision` for detection representation and
visualization. It is useful reference code for open-vocabulary candidate
generation and mask propagation.

[Meta SAM 2](https://github.com/facebookresearch/sam2) provides promptable image
and video segmentation, a video predictor with streaming memory, multi-object
support, and published inference examples.

These are model/demo libraries, not durable camera orchestration or incident
systems. Add SAM 2 only if masks materially improve spill-area measurement or
tracking; do not add its GPU cost merely to draw nicer overlays. Grounded SAM 2
is a challenger to the existing localizers, not the initial vLLM workflow host.

## Candidate 5: lightweight computer-vision primitives

If Roboflow Inference is rejected, a smaller custom stack can reuse:

- [Roboflow Supervision](https://github.com/roboflow/supervision) for common
  detection containers, annotations, geometry, zones, metrics, and video helpers.
- [Roboflow Trackers](https://github.com/roboflow/trackers) for Apache-2.0
  implementations of trackers including ByteTrack.
- [Ultralytics tracking](https://docs.ultralytics.com/modes/track/) for existing
  model integration with BoT-SORT or ByteTrack, subject to the project's
  licensing decision.
- OpenCV, already installed in LitterSpot, for controlled capture and image
  preprocessing.

This route has fewer platform assumptions but requires LitterSpot to continue
owning RTSP reconnection, worker supervision, GPU scheduling, latest-frame
backpressure, and stream observability. It is the fallback, not the first choice.

## Model candidates for vLLM

### Reference baseline: Qwen2.5-VL-7B-Instruct

Qwen's official material describes image/video understanding, object grounding
with bounding boxes/points, actual image-coordinate output, structured JSON, and
long-video understanding. The 7B checkpoint is Apache-2.0. Sources:

- [Qwen2.5-VL announcement and grounding examples](https://qwenlm.github.io/blog/qwen2.5-vl/)
- [Qwen2.5-VL-7B model card](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)
- [vLLM Qwen2.5-VL recipe](https://github.com/vllm-project/recipes/blob/main/Qwen/Qwen2.5-VL.md)

Use it as the initial reproducible baseline because it is established and its
grounding behavior is documented. License approval is checkpoint-specific; do
not infer the 3B or 72B checkpoint license from the 7B checkpoint.

### Challenger: Qwen3-VL 4B/8B Instruct

Qwen3-VL is supported by current vLLM and Roboflow Inference has a Qwen3-VL
workflow block plus the new proxy family adapter. Benchmark 4B and 8B variants
for improved spatial/temporal reasoning and throughput. Sources:

- [vLLM supported-model matrix](https://docs.vllm.ai/en/latest/models/supported_models/)
- [vLLM Qwen3-VL recipe](https://docs.vllm.ai/projects/recipes/en/stable/Qwen/Qwen3-VL.html)
- [Roboflow Qwen3-VL block](https://inference.roboflow.com/workflows/blocks/qwen3_vl/)

### Independent challenger: InternVL3.5 4B/8B

Use an independent architecture to avoid selecting only between generations of
one model family. Verify that the precise checkpoint has vLLM image/video
support and whether `trust_remote_code` is required. Sources:

- [InternVL3.5 model card](https://huggingface.co/OpenGVLab/InternVL3_5-8B)
- [vLLM supported-model matrix](https://docs.vllm.ai/en/latest/models/supported_models/)

### Model-selection rule

Select on LitterSpot's camera-stratified data using per-class episode precision,
recall, people-count error, localization error where applicable, latency,
invalid-output rate, and sustainable camera throughput. Public VQA benchmark
rankings are not deployment acceptance evidence.

## Tracking and people-count recommendation

Use conventional person detection plus tracking and configured zones for
population counts. VLM counting may be stored as a shadow comparison but should
not be the only operational count until it passes density-stratified tests.

For stable identity and geometry:

- use the existing YOLO person detector as the initial proposal source;
- normalize its output into a common detection container;
- use ByteTrack or BoT-SORT through the adopted workflow layer;
- count active tracks in the configured polygon/zone;
- send a sampled full frame or candidate crops to the VLM for semantic context;
- reconcile outputs through deterministic policy rather than averaging model
  confidence values.

## Annotation and evaluation libraries

### FiftyOne

FiftyOne's official evaluation API handles classifications, detections,
polygons, masks, video, temporal detections, per-sample TP/FP/FN, confusion
matrices, precision/recall curves, and interactive failure analysis. It is the
recommended evaluation/triage layer for comparing existing, VLM-only, and
hybrid outputs. Source:
[FiftyOne evaluation documentation](https://docs.voxel51.com/user_guide/evaluation.html).

FiftyOne does not replace LitterSpot's episode-level evaluation, people-count
metrics, or production database; add project-specific evaluators for those.

### CVAT

CVAT Community is a public annotation platform for image/video datasets, and
its SDK exposes auto-annotation functions. It is appropriate for camera-frame,
box, polygon, and video-sequence review. Sources:

- [CVAT repository](https://github.com/cvat-ai/cvat)
- [CVAT SDK](https://docs.cvat.ai/docs/api_sdk/sdk/)
- [CVAT auto-annotation API](https://docs.cvat.ai/docs/api_sdk/sdk/auto-annotation/)

Use CVAT only if the team needs collaborative annotation beyond the repository's
current manifest/scripts. Export immutable manifests for every evaluation run.

## Recommended target assembly

```text
RTSP/file/test frame
        |
        v
Roboflow Inference Pipeline (preferred) or LitterSpot capture adapter
  - reconnect and source health
  - max FPS / latest-frame backpressure
  - motion/ROI gate
        |
        +---------------- conventional perception ----------------+
        |  person detector -> tracker -> polygon population count  |
        |  bin localizer/state -> candidate bin episodes           |
        |  floor segmenter -> spill/litter candidate regions       |
        +-----------------------------------------------------------+
        |
        v
Candidate frame group/crops
        |
        v
Private vLLM sidecar -> Qwen/InternVL VLM -> JSON Schema output
        |
        v
LitterSpot validator and fusion policy
        |
        v
LitterSpot temporal episode policy
        |
        v
Versioned, idempotent ConfirmedFlag
```

Maintain a VLM-only shadow branch during evaluation:

```text
sampled full frame group -> vLLM/VLM -> validated observation
```

This allows evidence-based comparison. Promote VLM-only detection for a class
only if it beats or materially simplifies the hybrid path without violating
latency or localization requirements.

## Adopt versus own

| Concern | Recommended ownership |
| --- | --- |
| RTSP ingestion, reconnect, source FPS, frame dropping | Adopt Roboflow Inference if spike passes; otherwise own a focused adapter |
| Video decode/GPU batching | Adopt workflow/runtime support; use DeepStream only at proven scale need |
| Existing object/people/floor inference | Reuse current models behind workflow adapters |
| Object tracking and zones | Adopt ByteTrack/BoT-SORT and zone primitives |
| VLM serving | Adopt pinned vLLM container/API |
| Base VLM | Adopt pinned Qwen/InternVL checkpoint after evaluation |
| Prompt, JSON Schema, model-output validation | Own in LitterSpot |
| Per-camera calibration and model fusion | Own in LitterSpot |
| Temporal raise/update/clear episode policy | Own in LitterSpot |
| Evidence mapping and `ConfirmedFlag` contract | Own in LitterSpot |
| Annotation/review | Adopt CVAT if needed |
| Model/failure analysis | Adopt FiftyOne plus custom episode/count metrics |
| Downstream incident/task workflow | Own in the business backend; outside this plan |

## Required adoption spike

Build three thin, disposable paths against the same recorded camera manifest:

### Path A — current baseline

Run the existing LitterSpot pipeline unchanged and export normalized predictions
and episode flags.

### Path B — direct vLLM

Use a pinned vLLM container with Qwen2.5-VL-7B, then Qwen3-VL challenger. Send
2–4 sampled frames or selected crops, require JSON Schema output, and normalize
results into `VisionObservation`.

### Path C — Roboflow hybrid

Use a versioned Roboflow Workflow for RTSP/file input, current detector adapters,
tracking/zones, crop/frame-group preparation, vLLM proxy/custom call, and a
webhook result to LitterSpot validation.

Compare:

- installation and target-GPU compatibility;
- required cloud/API-key connections;
- exact feature and model licenses;
- output portability and version control;
- frame freshness under overload;
- accuracy and population error;
- p50/p95 latency and sustainable camera rate;
- GPU/CPU memory and utilization;
- invalid/malformed output and restart recovery;
- amount of custom code and upgrade surface.

The spike exit decision is one of:

1. **Adopt Roboflow hybrid** — preferred when licensing, offline operation, and
   performance pass.
2. **Adopt Roboflow for streams only** — use its pipeline/trackers but call vLLM
   from a LitterSpot module.
3. **Use the lightweight custom stack** — only when Roboflow constraints or
   overhead fail the evidence-based gate.
4. **Escalate to DeepStream** — only when camera-scale benchmarks justify the
   operational complexity.

## Production cautions

- vLLM is fully supported on Linux; use a Linux GPU server/container deployment
  rather than assuming native Windows production support.
- Pin container digest, vLLM, Transformers, model revision, prompt, schema, and
  workflow definition together.
- Explicitly cap model context, media count, frames, image dimensions,
  completion tokens, concurrency, and request size.
- Prefer image batches for the first live implementation. Disable unused video
  input if it reserves unnecessary memory; benchmark video decode separately.
- Do not permit arbitrary remote media URLs. Restrict media domains/redirects
  or send controlled bytes/short-lived internal URLs.
- Avoid `trust_remote_code` unless the exact revision has been reviewed and
  pinned.
- Use data-parallel replicas for independent camera requests when the model fits
  on one GPU; use tensor parallelism primarily when the selected model does not
  fit. Validate with the model-specific vLLM recipe.
- Discard camera work that is older than a configured freshness deadline rather
  than processing an unbounded stale backlog.
- Review the license of every selected model/checkpoint independently from the
  serving/workflow library license.

## Final recommendation

Update the implementation plan so Phase 0 is an adoption spike, not immediate
custom construction. The preferred target is Roboflow Inference for video
orchestration plus a vLLM sidecar and a Qwen VLM, with current LitterSpot models
generating fast candidates and LitterSpot retaining the deterministic
observation, fusion, temporal episode, and handoff semantics.

This maximizes reuse without allowing a third-party workflow definition or a
generative model to become the owner of product-critical incident behavior.
