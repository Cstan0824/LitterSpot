# Lightweight VLM evaluation

## Decision

Use a VLM only as a **shadow reviewer** during data collection and error
analysis. Do not replace the calibrated MobileNet decision path with a
zero-shot VLM.

The first local candidate, `HuggingFaceTB/SmolVLM-500M-Instruct`, is Apache-2.0
licensed and fits the development GPU. It is a useful low-effort experiment,
but its generated state labels are not calibrated probabilities. In the
validation screen run on 2026-07-17 it predicted `overflow` for all 30 balanced
tight crops: overflow recall was 1.00 and precision was 0.33. It therefore
fails the production alert gate and must not influence `normal`, `full`,
`overflow`, or `unknown` responses.

## Candidate shortlist

| Model | Size | Best role here | Decision |
| --- | ---: | --- | --- |
| SmolVLM-500M-Instruct | 0.5B | Cheap local captions / VQA / label review | Evaluated; shadow-only |
| Florence-2-base-ft | 0.23B | Grounding or caption-based bin localization prototype | Worth a separate locator experiment, not a direct state classifier |
| Qwen2.5-VL-3B-Instruct | 3B | Stronger qualitative reviewer | Not a comfortable native fit for the 6 GB development GPU; use only quantized or remote |

## Reproduce the experiment

Install the Python dependencies once, then iterate on the validation split.
Keep the held-out test split untouched until the prompt and protocol are
frozen.

```powershell
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
.\.venv\Scripts\python.exe ml-training\scripts\evaluate_smolvlm_bin_state.py --split valid --limit 30 --output runs\prompt_experiments\smolvlm_500m_trial
```

The script uses the same labelled tight bin crops and 15% context used by the
current state-classifier workflow. It writes the raw answer per crop, a
confusion matrix, latency, and peak VRAM. It intentionally contains no call to
the FastAPI production endpoint.

## Fine-tuning recommendation

Fine-tuning is **not required** to run a discovery experiment. It is required
before a VLM could be considered for production state decisions, because
zero-shot output is neither calibrated nor sufficiently precise for the
full-versus-overflow boundary. Start with the existing MobileNet two-stage
pipeline as the alert model. If the VLM proves valuable for reviewer assistance,
collect several hundred camera-specific, consistently labelled bin crops and
fine-tune it only after the data-quality review; evaluate it against the same
camera/time-separated gate as MobileNet.
