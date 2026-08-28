# Firestore bin-replacement prototype benchmark

Run date: 2026-08-25
Policy: `bin-replacement-v1-short-window`
Window: 10 minutes, 8 valid minutes required, two consecutive passing
evaluations to raise

## Loop 1: fresh decision state

| Scenario | Score | Coverage | High signals | Decision | Recommended | Raise streak |
| --- | ---: | --- | ---: | --- | --- | ---: |
| replacement-needed | 95.0 | 10/8 | 4 | keep_current_bin | no | 1 |
| keep-current-bin | 13.3 | 10/8 | 0 | keep_current_bin | no | 0 |
| temporary-crowd | 12.5 | 10/8 | 1 | keep_current_bin | no | 0 |
| insufficient-coverage | 53.3 | 5/8 | 2 | insufficient_evidence | no | 0 |

## Loop 2: previous state carried from Loop 1

| Scenario | Score | Decision | Recommended | Trigger |
| --- | ---: | --- | --- | --- |
| replacement-needed | 95.0 | replacement_recommended | yes | full_bin_with_recurring_litter |
| keep-current-bin | 13.3 | keep_current_bin | no | — |
| temporary-crowd | 12.5 | keep_current_bin | no | — |
| insufficient-coverage | 53.3 | insufficient_evidence | no | — |

The same scores and decisions were reproduced by the TypeScript policy and by
the Firestore-emulator smoke path. The Firestore smoke wrote the current
decision plus an evaluation history document and carried the raise streak
from Loop 1 into Loop 2.

## Held-out diagnostic

The locked 43-image CDW-Seg `test_proxy` produced:

- 17 annotated bins;
- 11 predicted bins;
- 0 matches at IoU 0.50, 11 false positives, and 17 misses;
- five raw overflow state diagnostics.

CDW-Seg is a construction skip-bin source without rim-crossing labels. This is
therefore a localization domain-shift warning, not an overflow-state score and
not a threshold-selection set.

## Loop-2 mitigation retained

The smallest evidence-supported mitigations are policy-side, not a threshold
tune on the held-out source:

1. raw one-frame `overflow` is never capacity pressure unless `stableState` or
   `confirmed` says overflow;
2. an explicit stable `unknown` and stale track block capacity evidence;
3. litter/spill events are collapsed into short spatial-temporal episodes;
4. coverage failure preserves the previous decision; and
5. raising and clearing use hysteresis (2 passing evaluations to raise, 3
   failing evaluations to clear).

The remaining blocker for production qualification is a rights-cleared,
deployment-like set with parent-bin/rim-linked contained versus truly crossing
overflow labels.
