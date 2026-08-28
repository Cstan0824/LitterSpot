# Overall pipeline test — 2026-08-18

## Automated verification

| Scope | Result |
| --- | --- |
| AI-service unit/integration tests | 66 passed |
| ML-training/data-audit tests | 11 passed |
| Backend Vitest contract tests | 2 passed |
| Backend TypeScript build | passed |
| Frontend production build | passed |
| Python compilation | passed |
| `git diff --check` | passed (only existing CRLF warnings) |
| Specialist source with missing weights | correctly returns degraded/503 |

The HTTP integration test exercises multipart upload, source inference,
three-module fusion, diagnostics, SQLite persistence, and the response schema.
It also verifies that an incomplete specialist source fails closed instead of
combining a bin adapter with VLM floor or occupancy output.

## Live VLM/curl smoke test

The service was started with the local
`OpenGVLab/InternVL3_5-1B-Instruct` checkpoint in Transformers mode on CPU.
One locked mock image was sent through:

```powershell
curl.exe --request POST http://127.0.0.1:8000/analyze/frame `
  --header "x-internal-token: local-playground-token" `
  --form "file=@mock-data/internvl-evaluation/images/WhatsApp Image 2026-07-27 at 5.59.59 PM (1).jpeg" `
  --form "camera_id=integration-real-1" `
  --form "confirmation_frames=1" `
  --form "include_diagnostics=true"
```

The request returned HTTP 200 and was persisted by the service:

| Metric | Observed |
| --- | ---: |
| End-to-end processing time | 199,119 ms (CPU) |
| People | 1 |
| Bin observations | 3 (`normal`, `overflow`, `unknown`) |
| Floor hazards | 0 |
| Flags | `bin_overflow` |
| Provider | `transformers` |
| Model | `OpenGVLab/InternVL3_5-1B-Instruct` |

This confirms the overall request path works, but the CPU latency is not a
deployment target. The earlier mock evaluations remain the accuracy baseline;
this smoke test is a plumbing check, not evidence that the VLM is accurate
enough to replace the specialists.

## Specialist backend status

`PERCEPTION_BACKEND=specialists` starts successfully but reports degraded until
all three approved checkpoints exist:

- bin state: `runs/state_classifier/multitask_gco_gbs_v2/production.pt`;
- floor hazards: the configured segmentation checkpoint;
- occupancy: `models/production/occupancy_yolo11n.pt`.

The training-data audit is also blocked until reviewed samples are added to
`ml-training/data/specialists/manifest.json`. The locked `mock-data/` pixels
remain evaluation-only.
