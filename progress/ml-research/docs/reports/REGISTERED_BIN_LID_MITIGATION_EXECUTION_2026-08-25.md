# Registered-bin lid-mitigation prototype execution report

Date: 2026-08-25
Scope: stable mock prototype only; no production alert promotion

## Outcome

The registered-camera mitigation plan is implemented and replayed against the locked mock video fixture. The pipeline now treats the enrolled whole-bin polygon as the authoritative identity, derives lid/body/exterior evidence zones automatically, gates lid-only changes to `review`, requires a two-of-three temporal vote for registered video overflow, and keeps generic-localizer candidates outside the registration as unknown and non-alerting.

## Implemented controls

- Registration schema revision 2 stores one `binId`, one whole-bin `binPolygon`, `binType`, a clean reference media ID, a walkable-floor polygon, and optional exclusions. Revision 1 registrations are normalized for compatibility; new publishes write schema version 2.
- A registered camera emits one primary observation per enrolled bin. Generic localization is shadow-only: an unmatched candidate is `unknown/unregistered_candidate`, has no `binId`, and cannot enter state history, alerts, or placement analysis.
- `RegisteredSceneEvidenceModule` derives top, side, bottom, and exterior zones from the whole-bin polygon. It compares a current frame with a clean reference after blur and brightness normalization.
- A top-only change with no exterior evidence becomes `review/lid_obstruction`. A model overflow proposal without exterior evidence becomes `review/overflow_without_exterior_evidence`. Exterior side/bottom evidence is required before overflow remains eligible.
- Video confirmation uses the latest three observations inside five seconds; at least two matching eligible states are required. `unknown` and `review` reset or do not advance overflow confirmation.
- Floor-hazard masks are accepted only inside the registered walkable-floor polygon, outside exclusions, and outside the registered bin/object regions.
- A single confirmed event can create a provisional replacement recommendation for the short prototype path. `automaticAction` is always `false`.
- Frontend registration and analysis views display the stable `binId`, review/unknown states, walkable-floor overlays, and unregistered-candidate labels.

## Mock replay benchmark

Command:

```powershell
.venv\Scripts\python.exe scripts/evaluate_registered_bin_mitigation.py `
  --output artifacts/detection-stability/current/diagnostics/registered-bin-mitigation.json
```

Fixture: `mock-data/internvl-evaluation/provisional-expected-bin-video.json` (three sampled frames per video; first frame is used as a clean-reference stand-in for this prototype).

| Metric | Result | Interpretation |
| --- | ---: | --- |
| Registered identity retention | 9/9 (100%) | Every enrolled-bin observation kept its configured `binId`. |
| Raw overflow candidates | 4 | The underlying model still proposes overflow in some frames. |
| Spatial review gates | 2 | Lid-only/no-exterior frames were withheld from alerting. |
| Confirmed overflow events | 2 | Both overflow fixtures had two eligible overflow votes. |
| Unregistered alert-eligible events | 0 | Shadow candidates cannot alert or enter placement logic. |

Per-case replay result:

- `video-basket-topped-waste`: `review, overflow, overflow` → 2/3 overflow → confirmed overflow.
- `video-green-closed-lid-bin`: `unknown, normal, normal` → 2/3 normal → confirmed normal.
- `video-black-bin-topped-waste`: `review, overflow, overflow` → 2/3 overflow → confirmed overflow.
- `video-people-no-bin` and `video-crowd-no-bin`: no registered bins and no alert-eligible events.

The supplied still-image replay also returned exactly one `bin-1`; its model overflow score was downgraded to `review/overflow_without_exterior_evidence`. Replacing only the lid area in a synthetic current/reference pair produced `review/lid_obstruction` with `topChangeRatio=0.5072` and `outsideChangeRatio=0.0072`, demonstrating the specific false-overflow mitigation.

The replay artifact is written to [registered-bin-mitigation.json](/C:/Cstan/Projects/LitterSpot/artifacts/detection-stability/current/diagnostics/registered-bin-mitigation.json).

## Verification

- Backend build: passed.
- Frontend build: passed.
- Backend tests: 194 passed, 18 skipped (51 files; integration skips require external services).
- Targeted AI tests: 27 passed, covering registered identity, shadow unknown candidates, floor ROI filtering, lid/exterior evidence, temporal-facing contracts, and placement policy.
- Python compile check for `ai-service/app` and the replay script: passed.

The complete AI test directory still contains unrelated legacy collection failures in `internvl_analyzer.py` (missing legacy config constants) and several old integration tests (missing `app.analysis_store`). Those modules were not required by this registered-bin prototype and remain separate follow-up work.

## Prototype limits and next gate

- The replay uses fixed fixture polygons and the first sampled frame as a reference stand-in; it is not a trained-model benchmark or a camera-registration quality benchmark.
- A real registration still needs a Firestore-owned reference media record; automatic upload from the canvas remains deferred.
- Invalid/draft or resolution-mismatched registrations fail closed in the current inference contract (no bin/hazard result); an explicit `unknown` response can be added when the API contract is ready.
- The `0.08/0.04/0.03` evidence thresholds are mock-calibrated. Before production, collect operator-approved clean/lid-object/true-overflow clips, measure false-alert rate and overflow recall, then revise the single config file rather than per-camera code.
- Camera motion/alignment, cross-camera history, dedicated lid-object training, and automatic relocation actions remain deferred.

This report therefore marks the prototype execution complete, not production readiness.
