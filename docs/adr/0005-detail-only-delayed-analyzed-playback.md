---
status: accepted
---

# Reserve delayed analyzed playback for Camera Detail

LitterSpot presents smooth Delayed Analyzed Playback only in Camera Detail on the capture-owner browser. The Camera grid and secondary Supervisor browsers show exact analyzed snapshots with their matching overlays. Camera Detail uses a compressed rolling presentation buffer capped at 1280 × 720, waits for sufficient footage and successful analysis coverage, and then plays behind capture at a fixed delay. If analysis coverage becomes unsafe, the player re-buffers instead of continuing as unanalysed footage. It resumes from the frozen position after a short interruption or skips missed presentation footage and resumes at the newest safely analyzed delayed position after a longer interruption. Failure to build safe coverage within thirty seconds produces a retryable error.

This choice prioritizes correct overlays and strong Camera Detail presentation without paying the decoding, memory, and inference cost of continuous delayed playback on every Camera card. It accepts lower-cadence snapshots in the grid and on secondary browsers.
