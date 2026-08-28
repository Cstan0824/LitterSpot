# LitterSpot mock data

The mock set is split by purpose and provenance:

- `internvl-evaluation/` contains the five user-supplied images and five videos.
- `public-domain/` contains six curated Public Domain/CC0 Wikimedia Commons
  thumbnails plus a generated provenance manifest with current source URLs,
  authors, licenses and SHA-256 checksums.
- `edge-cases/` contains deterministic derivatives of the user-supplied stills:
  low light, overexposure, motion blur, JPEG compression, small camera shift,
  partial occlusion and synthetic beverage spills.
- `coverage/` defines the independent scenario targets and provisional labels.

Derived images test robustness but do not count as independent semantic scenes.
Synthetic spills are smoke-test positives only; they do not replace real F&B
spill footage from the deployment cameras.

## Rebuild and audit

```powershell
.\.venv\Scripts\python.exe scripts\acquire-public-domain-mocks.py
.\.venv\Scripts\python.exe scripts\build-edge-mock-suite.py
.\.venv\Scripts\python.exe scripts\audit-mock-coverage.py
```

## Evaluate through the logged curl workflow

```powershell
.\.venv\Scripts\python.exe scripts\run-mock-vlm-evaluation.py --suite public-domain
.\.venv\Scripts\python.exe scripts\run-mock-vlm-evaluation.py --suite edge
.\.venv\Scripts\python.exe scripts\run-mock-vlm-evaluation.py --suite expanded
```

The expanded suite is intentionally slow with InternVL3.5-1B. Each request is
logged with input hash, source, HTTP outcome, raw response path and latency under
`artifacts/mock-evaluations/`.
