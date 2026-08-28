# Open Images bin-localizer V0 preview — 2026-08-22

## Outcome

A deliberately incomplete one-class YOLO11n bin localizer was trained and
replayed on the locked WhatsApp media. It is suitable for inspecting the first
model behavior, but it is not suitable for production or threshold selection.

The planned 150-row acquisition was interrupted by sustained HTTP 429 responses
from the source image host. The preview therefore uses the 76 assets that were
successfully downloaded, decoded, hashed, and checkpointed before the rate
limit. The dataset build is explicitly marked `previewOnly: true`.

## Dataset and training

- Source: landing-page-verified Open Images V7 Waste container rows.
- Images: 76.
- Physical-bin boxes: 155.
- Split: 62 train / 7 validation / 7 test images.
- Grouping: author profile URL, with author and ImageID fallbacks; an author
  group never crosses splits.
- Filters: Open Images depiction and group-of boxes are excluded.
- Model: pretrained YOLO11n, 15 epochs, image size 640, batch 8, seed 42.
- Checkpoint SHA-256:
  `FCF35E492E7F939BDE62FADEBDA7D6F88EB59B69905D834F7486FAA64C179B4E`.
- Reproducible dataset: `ml-training/data/bin-localizer-openimages-v0-copy/`.
  It contains copies rather than hard links so decoder repairs cannot mutate
  the attributed source cache. A post-repair audit validated all 76 cached
  assets against their acquisition hashes and dimensions.

## Metrics

| Evaluation | Precision | Recall | mAP50 | mAP50–95 |
| --- | ---: | ---: | ---: | ---: |
| Validation, 7 images / 17 boxes | 0.571 | 0.706 | 0.547 | 0.321 |
| Test, 7 images / 11 boxes | 0.705 | 0.437 | 0.584 | 0.361 |

The locked WhatsApp video replay at confidence 0.25 produced:

| Metric | V0 result | Informational preview target | Result |
| --- | ---: | ---: | --- |
| Positive bin-track recall | 35.5% (11/31) | at least 50% | miss |
| Negative-video false-bin frame rate | 44.4% (4/9) | at most 20% | miss |
| Chair false detections | 4 | 0 | miss |

The locked suite has only two negative videos, below the existing three-case
coverage gate. These figures are diagnostic, not a production acceptance test.

## What the first version looks like

- Strong example: the black open bin is localized with 0.90 confidence.
- False positives: glass/wall structures receive oversized bin boxes.
- Confusers: a table and a loose rubbish bag are predicted as bins.
- The errors are consistent with training from bin-positive scenes without an
  explicit chair/table/cart/bag/background-negative set.

Annotated stills and videos are under
`runs/detect/artifacts/bin-localizer-openimages-v0/`. The raw checkpoint is
`runs/bin-localizer/bin_localizer_openimages_v0_76/weights/best.pt`.

## Loop 2 mitigation selected from V0 evidence

1. Resume acquisition with host throttling and grow the positive set to at
   least 500 successfully acquired images before treating metrics as stable.
2. Acquire explicit Open Images negative frames containing chairs, tables,
   carts, bags, glass partitions, boxes, people, and no waste container.
3. Preserve author/source grouping and add an independent negative test split.
4. Add underrepresented local forms: black open bins, wheelie bins, basket bins,
   partially occluded bins, crowded scenes, and fixed-CCTV viewpoints.
5. Retrain the same YOLO11n architecture before considering a larger model;
   the present error is data coverage, not model capacity.
6. Keep overflow state downstream and provisional. Reuse the existing state
   checkpoint only after a candidate passes bin-presence validation and require
   three-frame confirmation. Do not infer overflow from an object merely being
   above a lid or near a bin.
