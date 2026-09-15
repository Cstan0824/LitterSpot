# LitterSpot AI pipeline

## 1. Boundary

FastAPI performs stateless inference. Node owns every decision that creates or changes application records. Model results are AI Observations, not Alerts or Work Orders.

## 2. Inputs

Node sends one JPEG sample with:

- floor confidence, default 0.25;
- generic bin-localizer confidence, default 0.80;
- normalized walkable-floor points;
- Camera Registration source dimensions;
- registered physical-bin polygons, IDs, and types;
- reference image bytes when registered-bin review is enabled.

FastAPI accepts JPEG, PNG, or WebP up to 10 MiB. It rejects invalid images, invalid focus-region JSON, invalid normalized points, and unavailable models.

## 3. Model sequence

### Camera monitoring and AI

1. The scene detector runs on the full frame to produce people and common-object boxes.
2. The configured floor region is converted into a cropped, masked floor input.
3. For registered Cameras, each registered-bin polygon becomes a stable candidate with its `binId`.
4. Person, bottle, TV, and cell-phone boxes covering at least 40% of a candidate block bin classification and produce an unknown result.
5. The bin-state classifier predicts normal, full, overflow, or unknown for accepted bin candidates.
6. Registered-scene evidence compares current and reference content when bin review is enabled.
7. The generic bin localizer runs in shadow mode for registered Cameras. Unmatched generic detections remain explicit unknown candidates and cannot replace registered bins.
8. The floor-hazard model detects litter and spill in the floor input.
9. Hazard geometry is translated back to source coordinates.
10. A hazard is retained only when its centroid is inside valid floor, at least 60% of its mask overlaps valid floor, and it is not substantially covered by registered bins or detected scene objects.

For an unregistered analysis context, the generic localizer supplies bin candidates directly.

## 4. Response

The response contains:

- image width and height;
- people count and people boxes;
- bin ID or index, state, confidence, state confidence, and box;
- floor litter or spill boxes and polygons;
- model version labels;
- processing time in milliseconds.

The response has no Firestore identifier unless Node supplied the related Camera context outside FastAPI.

## 5. Node processing

### Alert and evidence management

Node normalizes the response into one AI Observation. It groups issues into floor litter, floor spill, and bin service, keeps recent temporal observations, selects candidate evidence, and applies the rules in `alertPolicy`.

### Cleaner and Work operations

When Camera Work awaits review, Node sends fresh samples through the same pipeline and feeds their results into a deterministic Verification collector.

### Orchestration and operational intelligence

Node admits bounded numeric observation summaries into minute analytics. It does not persist every sampled image or every transient Detection Signal.

## 6. Devices

`DEVICE` defaults to CPU. A numeric value such as `0` selects a CUDA device when PyTorch reports CUDA availability. On a CPU-only machine, the configuration resolves a numeric request back to CPU so every inference component uses a valid device.

## 7. Failure handling

- Unloaded models produce HTTP 503.
- Unsupported or oversized media produces 415 or 413.
- Invalid regions or inference options produce 422.
- Node rejects results completed after lease, episode, source, Registration, or playback-generation changes.
- Failed inference updates safe Camera runtime status and analytics failure counts but does not create a positive observation.

## 8. Model evidence

Production paths, thresholds, evaluation notes, hashes, and known weaknesses are recorded in [model-card.md](model-card.md). The `progress/ml-research` directory preserves the experimental evidence behind those choices.
