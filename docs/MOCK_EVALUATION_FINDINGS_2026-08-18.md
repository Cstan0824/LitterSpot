# Mock evaluation findings — 2026-08-18

## Decision

The repaired InternVL3.5-1B path is API-reliable but not detection-reliable.
It should not create cleaner tasks. Its JSON compliance hides repeated,
high-confidence guesses, and the original mock set does not cover the cases
needed to claim detection accuracy.

## Existing 20-request replay

Source: `artifacts/mock-evaluations/20260817T133207Z/`.

| Signal | Result | Interpretation |
|---|---:|---|
| HTTP 200 | 20/20 | Transport and parser path recovered |
| Non-empty result | 20/20 | Output-format problem recovered |
| Person emitted | 18/20 | Implausibly common across unrelated frames |
| Bin emitted | 20/20 | A bin was hallucinated even in the no-bin still |
| Raw floor hazard emitted | 17/20 | One was later filtered; 16 accepted litter flags remained |
| Spill emitted | 0/20 | Spill recall cannot be measured because there was no positive spill fixture |
| Mean / p95 latency | 27.4 s / 36.2 s | Too slow for the proposed 10-second cycle |

Confidence is not calibrated. The first person confidence was exactly `0.95`
in 16 of 18 person-bearing outputs, first-bin confidence was `0.98` in 16 of 20
outputs, and first-hazard confidence was `0.99` in 14 of 17 raw hazard outputs.
Several coordinate patterns also repeat across unrelated scenes. These are
generation habits, not trustworthy probabilities.

## Five provisionally labelled stills

These numbers are diagnostic only because the labels still require operations
review and there are no reviewed boxes or masks.

| Metric | Provisional result | Main failure |
|---|---:|---|
| People count within allowed range | 4/5 (80%) | Missed one of two people; hallucinated one person in the zero-person bin scene |
| People count MAE | 0.4 | Too few scenes and no 4–8-person case |
| Exact bin count | 2/5 (40%) | Duplicate bins on both overflow scenes and a phantom bin in the no-bin scene |
| Bin count MAE | 0.8 | Event-level overflow hits obscure invalid localization |
| Confirmed clean/litter case correctness | 2/3 | One clean office-floor image was falsely flagged as litter |
| Spill accuracy | Not measurable | No real positive spill image |

The two provisional overflow-positive stills both produced an overflow flag,
but this is not acceptable evidence of accuracy: both outputs contained extra
bin instances and one scene contained contradictory `normal`, `overflow` and
`unknown` states for one physical bin.

## Independent public-scene replay

Source: `artifacts/mock-evaluations/20260818T015914Z/`.

Six newly acquired Public Domain/CC0 scenes were replayed through the same curl
and diagnostic logging path. They were not used in the earlier prompt repair.

| Check | Result |
|---|---:|
| HTTP success | 6/6 |
| People count within provisional range | 1/6 |
| People count lower-bound MAE | 1.67 |
| Exact bin count | 3/6 |
| Fully correct bin count/state/absence | 2/6 |
| Exact floor-hazard case | 1/6 |
| Mean / maximum latency | 16.8 s / 27.7 s |

Notable failures:

- three partially visible people around an overflowing street bin were counted
  as one;
- a scene with three large bins and obvious piled overflow was reduced to one
  `normal` bin with no hazard;
- a normal closed bin was falsely labelled with floor litter;
- a contained-full trash can was classified as normal;
- two no-bin people scenes produced phantom normal bins;
- the dense shopping-mall image produced false litter and false spill alerts.

This independent replay rules out the original WhatsApp images as the primary
cause. The dominant problem is model/task fit and ungrounded structured output.

## Controlled synthetic-spill replay

Source: `artifacts/mock-evaluations/20260818T020120Z/`.

The same deterministic beverage stain was inserted into five different local
camera scenes. All requests succeeded, but spill recall was **0/5**. In contrast,
the public shopping-mall people image with no spill produced a spill alert.
This is the clearest current evidence that InternVL3.5-1B is not grounding the
spill class: it missed explicit controlled positives while firing on an
unrelated negative.

## Coverage after expansion

The repository now has 11 independent real scenes (five local plus six licensed
Public Domain/CC0 scenes) and 35 deterministic robustness variants. The audit
keeps these counts separate so transforms cannot inflate semantic coverage.

Smoke coverage is now present for normal bins, above-rim and surrounding
overflow, no-bin negatives, clean floors, large litter, 0-person and 2–3-person
counts, partial people, and six cross-cutting image degradations. Thirteen
required semantic scenarios remain below the three-independent-scene smoke
target. The most consequential are:

- real beverage spills and food spills;
- the expected 4–8-person operating band;
- contained-full bins that are not overflowing;
- staged bags beside bins as hard negatives;
- reflection, shadow, drain/panel and occlusion negatives.

Synthetic beverage stains are useful parser/detector smoke tests, but they do
not close the real-spill gap.

## Data acquisition decision

Use three source-separated specialist benchmarks rather than one combined VLM
benchmark. The target is 100 independently labelled stills for each module,
plus 60 project-owned fusion/temporal frames. Details and licensing decisions
are in `docs/research/PUBLIC_MOCK_DATASETS.md`.

Immediate priorities:

1. Acquire and label 20 real tea/coffee spill frames after confirming PIAP data
   terms, or stage safe project-owned spills on the actual floors.
2. Add fixed indoor 4–8-person frames from QUT SAIVT/CAVIAR with manual recounts.
3. Add project-owned contained-full bins, staged-bag negatives and temporary
   person occlusions in each fixed bin ROI.
4. Evaluate the three specialist modules independently. Run fusion only after
   their per-module gates pass.
