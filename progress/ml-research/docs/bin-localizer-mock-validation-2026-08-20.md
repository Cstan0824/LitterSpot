# Bin-localizer localized-data implementation and mock validation

## Outcome

The localized-data, locked-video regression, blocker-veto comparison, and hard
promotion-gate tooling are implemented. No replacement checkpoint was trained
or promoted because the workspace does not contain an operator-reviewed CCTV
localization manifest or the generic localizer dataset required for replay.

The supplied WhatsApp media was used only as locked mock evaluation data. It
was not converted into training frames and was not used to choose a threshold.

## Real checkpoint replay

The last committed `bin-localizer-yolo11n-gco-gbs-um-v2` checkpoint was
materialized to a temporary directory and evaluated at the existing 0.85
operating confidence. Five videos were sampled at one frame per second.

| Metric | Localizer only | Localizer + person/chair/table veto | Required |
| --- | ---: | ---: | ---: |
| Chair false detections | 0 | 0 | 0 |
| False-bin frames on negative clips | 4 / 9 (44.4%) | 0 / 9 (0%) | <= 1% |
| Positive bin track samples found | 12 / 31 (38.7%) | 12 / 31 (38.7%) | >= 90% |
| Locked suite coverage | 3 positive, 2 negative clips | same | >= 3 positive, 3 negative |
| Promotion result | blocked | blocked | all gates pass |

The blocker veto is a valid immediate mitigation for the false-positive side:
all nine accepted false detections in the people-only clip were rejected, and
it did not reduce positive recall in this replay. It cannot repair missed bins.
The weak recall is concentrated in the basket and black-bin videos; the green
closed-lid bin was found in all five samples.

The older generic-test metadata also remains below the required gate:
precision 0.6299, recall 0.5551, and mAP50 0.5756 versus 0.90 each.

## Promotion decision

Promotion is blocked for four independent reasons:

1. reviewed localized training data is not present and coverage cannot pass;
2. the generic precision/recall/mAP50 gates fail;
3. positive-track recall is only 38.7%;
4. the locked suite has only two negative videos, one short of the minimum.

The machine-readable results are:

- `artifacts/bin-localizer-regression/baseline-head-report.json`;
- `artifacts/bin-localizer-regression/baseline-head-guarded-report.json`;
- `artifacts/bin-localizer-regression/baseline-head-guarded-promotion.json`.

## Next executable step

Collect and review separate training footage, especially black/open bins,
baskets, chairs, tables, carts, and people-only scenes. Do not add the locked
WhatsApp clips. Once the builder reports `readyForTraining: true`, fine-tune
from the best generic checkpoint, run the generic and locked-video evaluators,
and allow the promotion script to decide whether the candidate may enter
shadow mode.
