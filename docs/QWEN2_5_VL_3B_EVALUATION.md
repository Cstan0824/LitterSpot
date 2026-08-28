# Qwen2.5-VL-3B 4-bit evaluation

## Candidate

`Qwen/Qwen2.5-VL-3B-Instruct` is the accuracy challenger to the current
InternVL3.5-1B prototype. It is the official 3B vision-language checkpoint
(7.52 GiB on disk), loaded in NF4 at runtime. A maintained 3.81 GiB pre-quantized
variant also exists, but its Hugging Face large-file endpoint was inaccessible
from this machine. The service supports either checkpoint through the same
validated `VlmScene` contract as InternVL, so no task-routing behavior changes
when a candidate is evaluated.

## Resource guardrails

- Use `DEVICE=0`, `VLM_PROVIDER=transformers`, and `VLM_MODEL_FAMILY=auto`.
- Cap `VLM_QWEN_MAX_PIXELS=128450`; increase only after confirming peak VRAM.
- Keep `VLM_QWEN_LOAD_IN_4BIT=true`, including when evaluating the official
  BF16 checkpoint from ModelScope.
- Start with `VLM_MAX_NEW_TOKENS=256` for this fixed-schema response.
- Run a single camera/request at a time on the 6 GiB RTX 4050.
- Compare against the existing 19-frame mock regression. Do not enable task
  creation based solely on this VLM, even if its score improves.

## Current download result

The Hugging Face large-file request and the alternative Ollama installer were
both interrupted by this machine's network/download layer on 2026-08-18. The
adapter and tests are complete, but a GPU accuracy/latency claim is deliberately
deferred until the 3.81 GiB checkpoint is present and the regression can run.

## Start command after model download

```powershell
$env:DEVICE='0'
$env:VLM_PROVIDER='transformers'
$env:VLM_MODEL_FAMILY='qwen2_5_vl'
$env:VLM_MODEL_ID='Qwen/Qwen2.5-VL-3B-Instruct'
$env:VLM_MODEL_PATH='C:\Cstan\Projects\LitterSpot\models\huggingface\Qwen--Qwen2.5-VL-3B-Instruct'
$env:VLM_QWEN_MAX_PIXELS='128450'
$env:VLM_MAX_NEW_TOKENS='256'
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-service --port 8000
```

Then run the existing mock harness and compare response validity, latency, spill
recall, clean-floor false positives, overflow recall, and people count error.
