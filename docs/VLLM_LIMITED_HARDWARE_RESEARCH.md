# Limited-hardware VLM research for LitterSpot

Research date: 2026-08-15

## Question

Can PicoLM or Microsoft BitNet run a more advanced model on limited hardware
for LitterSpot's bin-overflow, spill, floor-litter, and population analysis?
What is the most suitable starting point for the hardware currently available?

## Conclusion

**Do not use PicoLM or BitNet.cpp in the detection/VLM path.** Both projects
optimize text-model inference. Neither supplies the image encoder,
multimodal-projector support, compatible VLM checkpoint, or vLLM serving path
needed for LitterSpot's camera analysis.

For the inspected development host—RTX 4050 Laptop GPU with 6 GiB VRAM,
i5-13500HX, and about 24 GiB RAM—the smallest first step is
`OpenGVLab/InternVL3_5-1B-Instruct` for pipeline and memory validation. The
preferred first meaningful quality candidate is the official
`Qwen/Qwen3-VL-2B-Instruct-FP8`, used as an on-demand semantic verifier after
conventional candidate detection. Neither checkpoint is a promise that every
vLLM configuration fits 6 GiB.

The larger-model strategy is to centralize inference on a larger GPU, not to
force a 7B/8B VLM through a text-only low-bit runtime or heavy CPU offload.

## Fit comparison

| Option | Image/video input | Runs required VLMs | vLLM path | Fit for detection module |
| --- | --- | --- | --- | --- |
| PicoLM | No | No; LLaMA-style text GGUF only | No | Reject |
| BitNet.cpp | No supported multimodal model | No; native ternary text/embedding models | No | Reject |
| InternVL3.5-1B-Instruct + vLLM | Yes | Yes | Documented vLLM launch path | Smallest smoke baseline |
| Qwen3-VL-2B-Instruct-FP8 + vLLM | Yes | Yes | Native supported model/runtime combination | Primary constrained-hardware candidate |
| Qwen2.5-VL-3B-Instruct-AWQ + vLLM | Yes | Yes | Native supported model/runtime combination | Next quality challenger |
| 7B/8B VLM + vLLM | Yes | Yes | Supported for compatible checkpoints | Larger central-GPU quality tier |

## PicoLM assessment

[PicoLM](https://github.com/RightNow-AI/picolm) is a minimal C11 inference
engine for LLaMA-architecture GGUF text models. Its documented example is
TinyLlama 1.1B Q4_K_M. It keeps the 638 MB model memory-mapped on disk and
advertises approximately 45 MB of runtime allocation for a 2,048-token context.
That is useful for a tiny offline text generator, but it does not make the model
multimodal and does not remove disk-bandwidth or model-compute costs.

Its public CLI accepts text prompts/stdin and provides grammar-constrained JSON.
Its documented architecture contains a text tokenizer, token embeddings,
decoder attention, sampling, and GGUF quantization kernels, but no image/video
input, vision tower, multimodal projector, GPU server, or vLLM adapter. See the
[official features and architecture](https://github.com/RightNow-AI/picolm#features),
[memory budget](https://github.com/RightNow-AI/picolm#memory-budget), and
[supported models](https://github.com/RightNow-AI/picolm#supported-models).

PicoLM could later be tested as a tiny text-only formatter after a different
system has already produced structured detections. It should not receive camera
frames and should not be part of Phase 0's VLM candidates.

## BitNet.cpp assessment

[Microsoft BitNet.cpp](https://github.com/microsoft/BitNet) is the official
inference framework for native 1.58-bit/ternary language models. Its speed,
memory, and energy claims apply to compatible BitNet models and kernels; they do
not mean an arbitrary pretrained Qwen or InternVL vision model can be converted
to an equivalent 1.58-bit model.

The official supported-model table lists BitNet-b1.58 text models, Falcon/Llama
community ternary models, and text embedding models. It does not list a
multimodal VLM suitable for LitterSpot. The project explicitly points users to
T-MAC for general low-bit LLMs beyond ternary models. See the
[official overview and supported models](https://github.com/microsoft/BitNet#overview)
and [conversion/acknowledgement notes](https://github.com/microsoft/BitNet#convert-from-safetensors-checkpoints).

BitNet.cpp is credible future research for the cleaner-allocation LLM or local
text embeddings if a compatible model passes task-quality tests. That is outside
the present detection scope and would be a separate service/runtime decision.

## Compact multimodal candidates

[InternVL3.5-1B-Instruct](https://huggingface.co/OpenGVLab/InternVL3_5-1B-Instruct)
has approximately 1.1B total parameters—0.3B vision and 0.8B language—and its
model card documents direct vLLM serving. It is the safest first memory and
contract smoke test, although its LitterSpot accuracy must not be assumed.

The official
[Qwen3-VL-2B-Instruct-FP8 repository](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-FP8)
is a multimodal 2B model with a documented vLLM path. Its checkpoint is
approximately 3.47 GB. This leaves limited headroom on a 6 GiB GPU for the
vision encoder, activations, CUDA graphs, multimodal profiling, and KV cache,
so a bounded launch configuration and actual peak-VRAM measurement are
mandatory.

The 3B AWQ candidate remains useful as a quality comparison:

The official
[Qwen2.5-VL-3B-Instruct-AWQ repository](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct-AWQ)
is an image-text model, provides a vLLM serving example, and stores an
approximately 3.4 GB checkpoint. Its
[quantization configuration](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct-AWQ/blob/main/config.json)
uses 4-bit AWQ for eligible language-model weights but explicitly excludes the
visual module. Consequently, checkpoint file size alone cannot establish VRAM
fit; the vision encoder, activations, CUDA graphs, multimodal profiling, and KV
cache also need memory.

vLLM's official [quantization matrix](https://docs.vllm.ai/en/v0.12.0/features/quantization/)
supports AWQ on Ada GPUs, which includes the RTX 4050 architecture. Current
vLLM also officially lists
[Qwen2.5-VL and Qwen3-VL among supported multimodal models](https://docs.vllm.ai/en/latest/models/supported_models/).

## Recommended constrained-hardware configuration

The Phase 0 launch experiment should use these constraints before attempting
CPU weight offload:

- one selected image or crop per request initially;
- no video modality;
- an actual context cap near 4K rather than the model's maximum context;
- bounded image dimensions/visual tokens;
- a short JSON Schema-constrained completion;
- concurrency of one, increased only after VRAM and p95 latency measurements;
- candidate gating, stale-work dropping, and temporal deduplication before the
  VLM call;
- the current detector/tracker for boxes, people counts, and candidate crops.

These controls follow current vLLM capabilities for
[multimodal item/dimension limits](https://docs.vllm.ai/en/latest/configuration/engine_args/)
and its official examples, which use explicit model-length, sequence-count,
image-count, and pixel constraints. vLLM offers CPU weight offload, but its
documentation notes that weights then cross the CPU/GPU link during every
forward pass. It is therefore a fit experiment, not the preferred steady-state
architecture.

## Phase 0 benchmark matrix

Run the same camera-stratified evidence manifest through:

1. Existing detector/classifier pipeline.
2. Hybrid candidates plus InternVL3.5-1B on the 6 GiB host.
3. Hybrid candidates plus Qwen3-VL-2B-FP8 on the 6 GiB host.
4. Hybrid candidates plus Qwen2.5-VL-3B-AWQ if it launches with safe headroom.
5. The same workload with a 4B/7B/8B model on a larger GPU tier.

Measure per-class precision/recall and episode accuracy, people-count error,
invalid-output rate, peak VRAM/RAM, p50/p95 latency, sustainable requests per
minute, frame age at completion, and thermal stability. Select the smallest
model that passes the operational quality and alert-delay gates.

## Decision

- Exclude PicoLM from the vision pipeline benchmark.
- Exclude BitNet.cpp from the vision pipeline benchmark.
- Keep BitNet as a future text-only allocation/embedding research item.
- Start the constrained-hardware VLM spike with InternVL3.5-1B for smoke
  validation, followed by Qwen3-VL-2B-Instruct-FP8 for quality evaluation.
- Preserve Qwen2.5-VL-3B-AWQ and Qwen3-VL 4B as measured challengers.
- Treat 7B/8B VLMs as central-GPU candidates unless real measurements prove
  otherwise.
- Do not select final hardware/model capacity until the expected camera count,
  sampling interval, and maximum acceptable flag delay are specified.
