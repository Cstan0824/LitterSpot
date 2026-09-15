# Qwen2.5-VL-3B 4-bit evaluation results

## Decision

**Do not replace the current prototype or enable automatic cleaner tasking with
Qwen2.5-VL-3B.** It is transport-stable after the compatibility adapter, and
it improves the synthetic-spill signal, but it generates too many false hazard
and bin alerts for this safety-sensitive workflow.

## Environment

| Item | Result |
|---|---|
| Model | `Qwen/Qwen2.5-VL-3B-Instruct` |
| Runtime | Transformers 4.52.4, bitsandbytes 0.50.1, NF4 4-bit |
| GPU | NVIDIA RTX 4050 Laptop GPU, 6 GiB |
| Loaded GPU memory | 2.74 GiB |
| Visual cap / response cap | 128,450 pixels / 1,024 generated tokens |
| Contract | existing `VlmScene`, with Qwen `bbox_2d` normalization |

The earlier 512-token trial was invalid on dense frames because Qwen truncated
its verbose JSON. The 1,024-token configuration completed all assessed calls.

## Results

| Suite | Frames | HTTP 200 / valid contract | Mean latency | Key result |
|---|---:|---:|---:|---|
| Independently labelled public scenes | 6 | 6 / 6 | 18.54 s | 1/2 overflow scenes detected; clean negatives produced false hazards and phantom bins |
| Synthetic beverage spill positives | 5 | 5 / 5 | 19.05 s | 3/5 spill positives detected, with false overflow/litter on otherwise normal scenes |
| **Combined** | **11** | **11 / 11** | **18.77 s** | Structurally robust but semantically unsafe |

### Public-scene review

| Expected case | Result | Assessment |
|---|---|---|
| Overflow bin with three people | overflow + litter, but 1 person and 3 spill alerts | partial detection; people undercount and spill false positives |
| Two overflow bins + one normal bin | `full`, `unknown` | missed overflow condition and one bin |
| Normal bin, clean floor, no people | one person, unknown bin, litter + three spills | false positive failure |
| Contained full bin + litter | overflow + litter + three spills | false overflow failure |
| Dense mall, no bins/hazards | eight people and a phantom bin | occupancy cap undercounts; phantom bin |
| Three-to-four people, no bins/hazards | two people and a phantom bin | occupancy undercount; phantom bin |

### Synthetic-spill review

Spill recall is **3/5**: detected on recycling bins, office basket/panel, and
loose foam/bags; missed on the black-bin/bag and green-overflow scenes. The
recycling-bin scene also emitted a false overflow and litter alert, while the
green-overflow scene missed the injected spill.

## Comparison with the existing InternVL3.5-1B evaluation

The prior 19-frame GPU regression averaged 8.36 seconds/frame and detected
none of five synthetic beverage spills. Qwen raises this narrow spill recall
from 0/5 to 3/5, but approximately doubles latency and introduces severe false
positives. This is not a production trade-off for automated cleaner dispatch.

## Evidence

- Public requests, responses, JSONL input/outcome log, and review table:
  `artifacts/mock-evaluations/20260818Tqwen25vl3b-public-1024/`
- Synthetic-spill equivalents:
  `artifacts/mock-evaluations/20260818Tqwen25vl3b-synthetic-spills-1024/`
- A raw dense-frame Qwen response demonstrating the verbosity/truncation issue:
  `artifacts/mock-evaluations/20260818Tqwen25vl3b-bounded-smoke/raw-failing-frame-1024.txt`

## Recommended next step

Keep Qwen as an optional human-review assistant for ambiguous evidence, not a
detector. Continue the three specialist pipelines: a registered-bin localizer
plus bin-state classifier, a trained floor-hazard segmenter, and a person
detector. Use Qwen only to summarize a specialist-generated alert/evidence
bundle for an operator.
