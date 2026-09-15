# Fixed-camera localisation and fast local inference

Date: 2026-08-18
Target: fixed CCTV, 4–8 known bins, NVIDIA RTX 4050 Laptop GPU (6 GiB), Windows 11

## Decision

Localisation will help, but the useful form is **camera-calibrated regions of
interest (ROIs)**, not asking Qwen to discover and localise every object on every
sample. For LitterSpot, use fixed padded bin crops, one walkable-floor polygon,
and one occupancy polygon. Run compact specialist models on those regions and
reserve Qwen2.5-VL-3B for asynchronous review of uncertain events.

The fastest practical first deployment is:

1. fixed bin ROI -> MobileNetV3-Small multi-head state classifier;
2. floor ROI -> custom nano semantic/instance segmenter for `spill` and
   `floor_litter`;
3. full frame -> nano person detector -> ByteTrack -> occupancy polygon;
4. export the three neural models to fixed-shape TensorRT FP16 engines;
5. confirm hazards over time before creating a cleaner task.

This removes text generation from the normal detection path. The existing Qwen
benchmark averaged 18.77 seconds per frame and produced false spills, phantom
bins and false overflow. A larger prompt or another full-frame VLM pass does not
address that failure mode.

## What localisation can and cannot improve

There are three different operations that are often called localisation:

| Operation | Use here | Expected effect |
|---|---|---|
| Manually calibrated fixed-camera ROI | **Yes, primary path** | Removes irrelevant scene content, preserves physical bin identity and avoids searching for bins that cannot exist outside registered zones. |
| Compact learned bin detector | **Yes, periodic validator/fallback** | Detects a moved/missing bin or corrects small ROI drift; it proposes a crop but does not decide overflow. |
| VLM-generated bounding boxes | **No, not the primary gate** | Qwen supports box/point output, but the local benchmark shows that its scene grounding is not safe enough to authorize tasks. |

A padded ROI also makes a small bin occupy more of the classifier input after
resize. That is useful only when the crop retains the evidence needed for the
decision. Use roughly 10–15% context around the bin so the model sees the rim,
lid and nearby waste. Keep the floor ROI separate and wider, because a tight bin
crop can hide surrounding litter that operationally counts as overflow.

NVIDIA DeepStream documents exactly this cascaded structure: primary inference
can operate on a full frame, while secondary inference operates on detected
object crops; it also supports predefined ROIs and cascaded inference. This is
evidence that the architecture is supported, not evidence that any untrained
classifier will be accurate. Accuracy still depends on labelled camera-domain
examples and hard negatives. See NVIDIA's
[Gst-nvinfer documentation](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvinfer.html)
and [ROI preprocessing documentation](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvdspreprocess.html).

ROI failure must be explicit. If alignment confidence is low, the bin is
missing, or a person heavily occludes it, return `unknown`; never classify the
background inside a stale ROI as a bin. Small camera movement can be handled by
estimating a limited affine transform against a reference view and transforming
the configured polygons. OpenCV provides
[`estimateAffinePartial2D`](https://docs.opencv.org/doc/doxygen/html/d2/d48/group__d__projection.html)
for this purpose. Large or unreliable movement should pause automatic alerts
and request recalibration.

## Recommended three pipelines

### 1. Bin overflow

Use each registered bin ROI as the normal source of geometry. Batch all 4–8
padded crops into one 224×224 classifier call. A MobileNetV3-Small backbone is a
good starting point: Torchvision reports 2.54 million parameters and 0.06 GFLOPS
for the standard model, before replacing its head with the LitterSpot outputs.
See the official
[MobileNetV3-Small model documentation](https://docs.pytorch.org/vision/2.0/models/generated/torchvision.models.mobilenet_v3_small.html).

Use independent outputs for:

- bin present;
- contained fullness;
- true overflow;
- unknown/occluded.

Train with `normal`, `contained full`, waste above the rim, waste surrounding
the bin, bag beside a normal bin, object on lid, chair/container lookalikes,
missing bin and person occlusion. Confirm overflow in two of the last three
samples. A small one-class detector may revalidate the physical ROI periodically
or when alignment fails, but it should not run as a VLM localisation query.

### 2. Floor spill and litter

Run one custom segmentation model over the walkable-floor polygon, with separate
classes for `spill`, `floor_litter` and ignore/background. Segmentation is the
right output geometry for irregular liquid and debris: Ultralytics' official
[segmentation documentation](https://docs.ultralytics.com/tasks/segment) states
that segmentation models return masks or contours as well as class and
confidence information.

Start with a nano model at 512–640 px. Filter components by floor-polygon
overlap, area, confidence and persistence. Include reflections, shadows, drains,
floor panels, old stains, mop marks and transparent material as labelled clean
negatives. A cheap background-subtraction or frame-difference gate can trigger
an immediate scan when the floor changes, but it cannot be the only trigger:
run a scheduled full floor scan as well so a spill remains detectable after it
becomes static. NVIDIA VPI officially provides CUDA/CPU
[background subtraction](https://docs.nvidia.com/vpi/algo_background_subtractor.html)
for continuous video.

### 3. Occupancy

Use a closed-set person detector on the full frame, then count track centres or
bottom-centres inside the occupancy polygon. Do not use language generation for
counting. For the simplest prototype, reuse the project's YOLO nano stack and
ByteTrack. Ultralytics documents persistent video track IDs and ByteTrack in its
[tracking guide](https://docs.ultralytics.com/modes/track). NVIDIA's
[DeepStream analytics plugin](https://docs.nvidia.com/metropolis/deepstream/8.0/text/DS_plugin_gst-nvdsanalytics.html)
likewise documents per-ROI object counts and overcrowding thresholds.

Run the detector more frequently than the hazard models if live occupancy
matters, and let the tracker bridge skipped detector frames. NVIDIA documents
that detector intervals can skip frames while the tracker continues receiving
frames, and Ultralytics describes ByteTrack as its fastest/simple baseline. If
wind movement is visually material, test BoT-SORT's camera-motion compensation;
otherwise ByteTrack avoids that additional work.

## Model choice on 6 GiB

| Candidate | Role | Resource/accuracy position | Decision |
|---|---|---|---|
| YOLO11n custom detector/segmenter | Person detection or trained floor/bin locator | 2.6M parameters for detection; official T4 TensorRT figures show the model family is designed for low latency, but those numbers are **not** RTX 4050 measurements | **First prototype**, if AGPL-3.0 is acceptable |
| YOLOX-Nano | Permissively licensed detector alternative | 0.91M parameters, 1.08 GFLOPS at 416 px; ONNX and TensorRT are officially supported | Use if Apache-2.0 licensing is required; expect to validate the accuracy trade-off |
| RT-DETR-R18 / RT-DETRv2-S | Accuracy challenger for person/bin detection | 20M parameters and 60 GFLOPS at 640 px in the official repository | Benchmark only after the nano baseline; unnecessary for fixed bin ROIs and not the cheapest option |
| Qwen2.5-VL-3B 4-bit | Semantic reviewer | 2.74 GiB loaded locally in the current test, but 18.77 s/frame and unsafe false positives | Asynchronous fallback only |

Primary model sources: [YOLO11](https://docs.ultralytics.com/models/yolo11),
[YOLOX](https://github.com/Megvii-BaseDetection/YOLOX), and the official
[RT-DETR implementation](https://github.com/lyuwenyu/RT-DETR). Published
latencies are hardware- and dataset-specific; selection must use the actual
RTX 4050 replay benchmark.

Ultralytics is AGPL-3.0 and its own documentation says a closed-source product
needs an enterprise licence or a compliant AGPL deployment. YOLOX and the
official RT-DETR repository are Apache-2.0. Review the distribution model before
choosing the production dependency; this is a licence flag, not legal advice.
See the official [Ultralytics licence guidance](https://github.com/ultralytics/ultralytics/blob/main/docs/en/help/contributing.md)
and [RT-DETR licence](https://github.com/lyuwenyu/RT-DETR/blob/main/LICENSE).

## Fastest practical runtime on this Windows host

Use the current PyTorch/Ultralytics path while training and debugging, then
export accepted models to **TensorRT FP16 with fixed input shapes**. Ultralytics
officially supports TensorRT export for detection, segmentation and
classification, including static shapes, batching, FP16 and INT8. See its
[export guide](https://docs.ultralytics.com/modes/export).

Recommended deployment settings:

- one resident process and one shared CUDA context;
- fixed shapes (`224` bin crops, `512` or `640` floor, `640` occupancy);
- batch the 4–8 bin crops instead of invoking the classifier separately;
- reuse input/output buffers and preallocated tensors;
- TensorRT FP16 first;
- ONNX Runtime TensorRT execution provider, with CUDA execution provider as
  fallback, if direct engine integration is inconvenient on Windows;
- use I/O binding to avoid unnecessary CPU↔GPU copies;
- warm every engine before accepting requests and benchmark p50/p95 after
  warm-up.

Fixed shapes matter because NVIDIA documents one-time latency when TensorRT
changes dynamic shapes or optimization profiles. NVIDIA also recommends a
measure-and-optimize loop and supports FP16/INT8 and CUDA graphs. See
[TensorRT performance optimization](https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html).
ONNX Runtime documents that its
[TensorRT execution provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)
accelerates supported ONNX subgraphs and can fall back to CUDA; its
[I/O Binding guide](https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html)
explains that default CPU/device copies can dominate measured execution time.

Do not begin with INT8. It can be faster and smaller, but representative
calibration is required and quantization can reduce accuracy. Export FP16,
validate the locked dataset, and only then build INT8 engines using real frames
from every camera and compare the same per-class/event metrics. NVIDIA documents
these precision trade-offs in
[TensorRT accuracy considerations](https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/accuracy-considerations.html).

DeepStream is a strong Linux deployment option, but its current installation
path is Linux/Ubuntu-oriented. For this Windows prototype, direct TensorRT or
ONNX Runtime is the shorter path; do not migrate the whole application merely
to access DeepStream scheduling features.

## Scheduling and expected responsiveness

Do not force the three models to block one another or run at the same rate in
production. A useful initial schedule is:

| Work | Cadence | Notes |
|---|---:|---|
| Occupancy detector | 2–5 FPS while live count is required | Tracker maintains identities between detections; reduce rate if only a 10-second business metric is needed. |
| Batched bin-state crops | Every 5–10 s, plus change trigger | Four to eight crops in one batch; confirm 2-of-3. |
| Floor segmentation | Every 5–10 s, plus motion/change trigger | A scheduled scan prevents static spills from disappearing from consideration. |
| ROI/alignment check | Every 30–60 s or after scene-change alarm | Pause bin alerts when alignment is unreliable. |
| Qwen review | Only for new uncertain/conflicting episodes | Asynchronous, rate-limited and outside the primary latency budget. |

The existing engineering targets—below 50 ms per bin ROI, below 100 ms for
occupancy, below 250 ms for floor analysis and below 500 ms for a complete
specialist cycle—are reasonable prototype acceptance goals, not achieved
measurements. Record image decode, preprocessing, GPU inference,
post-processing and fusion separately so optimization targets the real
bottleneck.

## If Qwen is retained

Send only the relevant crop, never the unrestricted full frame. Ask one
forced-choice question and return a tiny schema, for example
`{"state":"normal|full|overflow|unknown"}`. Cap output at roughly 32–64 new
tokens and cap the input image's visual pixels. Qwen's official model card
documents `min_pixels`, `max_pixels` and exact resized dimensions as controls
for balancing visual tokens, speed and memory; it also recommends
FlashAttention 2 for acceleration and memory saving. See the
[Qwen2.5-VL-3B model card](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct).

This may make a fallback materially faster than the 1,024-token, full-scene
evaluation, but it is not allowed to bypass specialist confidence, temporal
confirmation, or a human-review rule until a new labelled crop benchmark proves
its precision and recall.

## Implementation order

1. Calibrate and persist each camera's bin, floor and occupancy polygons.
2. Add alignment confidence and an explicit `unknown/recalibration_required`
   outcome.
3. Train and evaluate the batched MobileNetV3 bin-state classifier first.
4. Establish the YOLO nano + ByteTrack occupancy baseline and count error by
   0, 1–3, 4–8 and >8 people.
5. Label real spill/litter masks and train the floor segmenter.
6. Export all gate-passing models to static TensorRT FP16 and measure the full
   pipeline on the RTX 4050.
7. Add temporal fusion and shadow-mode task creation.
8. Re-benchmark a crop-only, short-output Qwen verifier only after the three
   specialist paths are working.

The key mitigation is therefore not “a better VLM localiser.” It is to stop
solving a constrained fixed-camera problem as unrestricted image-to-text
generation.
