# Phase 12.7 Bin Placement integration completed brief

## Outcome

The delivered Insights layout now uses the V2 Bin Placement APIs. The previous hardcoded Zones, scores, recommendation labels, dates, and graph arrays are gone.

This completes the Bin Analysis part of Phase 12.7. Dashboard completion and the System page remain separate work.

## What was wired

- The page name is **Bin placement analysis**.
- The authenticated Site is shown as read-only context.
- Ranking accepts any whole-number lookback from 2 to 3660 days.
- **Refresh recommendations** rebuilds the cached snapshot using the selected lookback.
- The ranking table uses V2 rank, total score, factor values, coverage, status, and reason.
- The only recommendation action is **Implement**.
- Insufficient-data Zones show no score or rank and cannot be implemented.
- The selected-Zone section shows three equal factors: people activity, cleaning frequency, and bin-service frequency.
- Implement records the exact snapshot timestamp reviewed by the Supervisor and refreshes both ranking and Intervention history.
- Intervention history defaults to the latest record and supports older records.
- Comparison accepts any whole-number range from 2 to 3660 days.
- Cleaning-frequency and bin-overflow graphs use real before/after series.
- Missing calendar dates create gaps rather than fabricated zero values.
- Requested, available, partial, and missing comparison coverage is visible.

## Backend correction

Phase 11 now treats `lifecycleStatus` as the canonical Zone lifecycle field. It temporarily accepts the older `status` field only when `lifecycleStatus` is missing, so existing development fixtures still work.

The correction applies to Dashboard Busy Zones, recommendation ranking, and Implement validation.

## How to test

1. Sign in as a Root or Regular Supervisor and open **Insights**.
2. Confirm the active Site name is read-only.
3. Enter `3`, `9`, or another whole number of at least 2 in **Lookback days** and press **Refresh recommendations**.
4. Confirm the table shows real Zones, scores, three-factor explanations, and available/requested days.
5. Confirm insufficient-data Zones show **More data needed** and no Implement button.
6. Click different rows and confirm the three factor cards and coverage card update.
7. Only after a physical/demo bin placement, press **Implement** on a scored Zone.
8. Confirm the success message uses the server timestamp, the Zone leaves the recommendation list during its exclusion period, and the new Intervention becomes selected.
9. Select an older Intervention when available.
10. Enter any comparison range of at least 2 days and press **Update comparison**.
11. Confirm the graphs show cleaning frequency and bin-overflow frequency, with partial coverage and missing dates reported below them.
12. Try `1`, a decimal, or a value above `3660` in either day input and confirm the page rejects it without sending the request.

## Automated verification

- Frontend TypeScript and production build pass.
- Frontend V2 Bin Placement client tests pass.
- Backend build and unit tests pass.
- The focused 12-case Phase 11 Firestore emulator suite passes with canonical and legacy Zone lifecycle records.
- Canonical Postman resource validation passes.
