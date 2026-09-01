# Phase 11 Postman testing

Phase 11 builds Dashboard data, daily analytics, priority-zone recommendations and before/after comparisons. It consumes the monitoring, Alert and Work workflows from earlier phases. It does not create observations just because a report is requested.

## Before testing

1. Select the **LitterSpot Local** environment. Confirm `baseUrl` is `http://127.0.0.1:3000`. Check the current backend port if you change it later.
2. Use the Firebase web API key and accounts for **litterspot-v2-database**, not the retired personal or shared project. The database is `(default)`.
3. In **22 - V2 Phase 9 Orchestrator**, send **V2 Phase 9 Root Login**. It saves `v2RootToken`. Confirm `v2SiteId` identifies the root's Site. Phase 11 derives Site scope from the token, not this variable; the variable is used by Postman assertions.
4. Open **24 - V2 Phase 11 Analytics Dashboard Bin Placement**. Use the local collection files, not an older imported collection missing this folder.
5. Confirm the fresh project's Phase 11 indexes are READY before testing. The backend setup report records this state.

Cloud development keeps `ANALYTICS_WORKER_ENABLED=false` by default to protect the Spark read quota. Postman requests still work. Use request 03 to rebuild the dates you want before refreshing recommendations. Enabling the worker adds previous-day finalization; it no longer scans historical data every minute.

Do not run the whole folder automatically. Implementation records a real development-data intervention, and cleanup deletes expired minute data. Neither is needed to test Dashboard reads.

## 1. Dashboard

Send **V2 Root - Phase 11 Dashboard Refresh**, request 01. Expect **201**, with a `dashboard` object.

Check:

- `siteId` matches your Site.
- `counts` reports active Zones, Cameras and Cleaner accounts, actual availability, and Alert/Work totals and status breakdowns.
- `topAlerts` contains at most three Alerts. Active Alerts take precedence, sorted by priority. Only when none remain does resolved history supply the fallback. Dismissed Alerts do not appear in that fallback.
- `topAlertsSource` is `active` or `resolved_history`. The history array can still be empty.
- `busyZones` contains at most three active Zones. It combines people activity in the last 15 completed minutes and current active Work with equal weight. It is relative to other Zones in this Site, not a literal percentage of physical dirtiness. Zero scores are valid.
- `availableCleaners` uses schedule, override and active Work rules. An active Cleaner account is not automatically available.
- `assignedWork` includes active Work, including `in_progress` and `awaiting_review`.
- `orchestrator` reflects the Site configuration. It is not proof that the local worker is enabled or the model is healthy.
- `windowStart`, `windowEnd`, `generatedAt` and `staleAfter` explain the sample window and cache age.

Send request 02, **Dashboard Read**. Expect **200**. Within the one-minute cache window it normally returns the same calculation. Use request 01 when you want an immediate refresh after another workflow changes data.

Optional cross-check: create a simulated Alert with Phase 9 request 05b, then refresh. If the Orchestrator is enabled, it may already have assigned the Alert. Compare actual status rather than expecting it to remain waiting. This changes development data and is not required for the basic read test.

## 2. Daily summaries

Request 03, **Daily Rebuild**, ships with the three controlled Phase 11 seed dates. Dates are Site-local calendar dates, not ISO timestamps.

```json
{"dates":["2026-08-29","2026-08-30","2026-08-31"]}
```

Expect **200** with three `summaries` for the example body. If you change the number of dates, also change the post-response assertion `.length(3)`. The API additionally accepts `{"localDate":"2026-08-30"}`, but not both forms together.

Look at `localDate`, `zoneMetrics`, `siteTotals`, `coverage` and `status`:

- Completed local days are `final`; the current local day is `provisional`.
- `successfulSampleCount`, `peopleSum` and `peopleMax` come from monitoring samples. People sums are accumulated observations, not unique visitors.
- `resolvedWorkCount` represents completed cleaning, not every detection or every submission for review.
- `binServiceAlertCount` represents full/overflow service incidents. Comparisons separately use overflow events.
- `coverage.hasSourceData: false` and zero counts are valid for an empty date. `final` alone does not mean enough evidence exists.
- Partial monitoring is expected when the prototype browser ran for only part of a day.

Run the same rebuild again without new source data. Metric totals should stay the same, although calculation timestamps can change.

Request 04, **Daily List**, expects **200** with `summaries`. Change its `from` and `to` to match request 03. Both boundary dates are included. It reads summaries; it does not itself manufacture or backdate monitoring.

## 3. Recommendations

Request 05, **Bin Placement Refresh**, uses:

```json
{"days":30}
```

Expect **201** with `snapshot`. The lookback is the previous completed Site-local days; today's unfinished day is excluded. Whole-number windows from 2 through 3660 are accepted by the current implementation.

Check `requestedLookbackDays`, `requestedStart`, `requestedEnd`, `policyVersion`, `zoneRankings`, and each Zone's coverage:

- `insufficient_data`: fewer than two observed completed days; `totalScore` and `rank` are null.
- `partial_data`: enough observed days to rank, but less than the requested window. Seven observed days can still provide a score for a 30-day request.
- `ready`: requested coverage is available. Still inspect each Zone's own `status` and `coverage`; Site-level status does not prove every Zone is equally covered.
- The factors `peopleActivity`, `cleaningFrequency` and `binServiceFrequency` each contribute one third, normalized against sufficient Zones in the same Site.

The script saves `v2BinPlacementSnapshotAt` and selects the first scored Zone as `v2BinPlacementZoneId`. It clears the Zone variable when none qualifies.

Request 06, **Bin Placement Read**, expects **200**. It normally returns the cached snapshot and updates those variables again. It refreshes only when missing, the requested window changes, or the daily cache expires. Run request 05 when you want source changes reflected immediately.

Creating many Alerts on one day does not satisfy the two-day requirement. Rebuilding two empty dates does not satisfy it either. If you lack historical observations, mark the positive implementation/comparison path as untested, not failed. A separate emulator fixture could make that path deterministic without falsifying cloud history; no fixture is added by this guide.

## 4. Record implementation, only with a scored Zone

Request 07, **Implement Zone**, records that you acted on the recommendation. It does not physically install a bin or edit a Camera's bin polygons.

Its body sends the snapshot timestamp you reviewed:

```json
{"note":"Phase 11 Postman implementation test","snapshotCalculatedAt":"{{v2BinPlacementSnapshotAt}}"}
```

Expect **201** with `intervention`. The script saves `v2BinPlacementInterventionId`. Check `zoneId`, `implementedAt`, `rankingSnapshot` and `exclusionEndsAt`.

- Missing eligible Zone: the Postman pre-request script stops the request intentionally. Skip it.
- **409**: the snapshot changed, the Zone lacks sufficient data, or its exclusion period is active. Read the error. For a stale snapshot, run 06, review it again and retry only if eligible.
- Immediate exact replay against the same snapshot should return the same intervention, not another record. Do this before refreshing the snapshot; a newer snapshot can correctly reject the old timestamp.
- Refresh recommendations afterward. The implemented Zone is excluded until two full Site-local days have elapsed. This is not necessarily exactly 48 hours from your click.

## 5. History and comparison

Request 08, **List Interventions**, expects **200** with `interventions`. An empty array is valid. If using an older intervention, copy its `interventionId` into `v2BinPlacementInterventionId`; this list request does not select it automatically.

Request 09, **Intervention Comparison**, expects **200** with `comparison` when that ID exists in your Site. Its default example is `?days=7`; try 3, 9 or 11 to verify arbitrary whole-number windows.

Look at `implementedAt`, `before`, `after`, `availableDays`, `partial`, `missingDates` and `series`. The boundary is the implementation time. Each series row contains `cleaningFrequency` and `binOverflowFrequency`.

A new intervention should not claim seven days of after-data. Zero or fractional available days, missing dates and partial coverage are normal. Missing monitoring is not evidence of zero dirt. Skip request 09 if there is no intervention.

## 6. Retention, optional

Request 10, **Minute Cleanup**, expects **200** with `{"deleted":0}` on a development Site without expired data.

It deletes minute buckets whose stored 90-day expiry has passed, after preserving their data in final daily summaries. It is not a reset button and does not delete Alerts, Work or Interventions. Do not alter timestamps just to make it delete something.

## Pass criteria

- Requests 01 through 06 and 08 succeed; sparse-data responses are honest.
- Rebuilding unchanged source dates does not double counts.
- Requests 07 and 09 pass only when their data prerequisites exist. Otherwise record them as not exercised.
- Request 10 returns a count if you elect to run it.
- **401** means refresh the token. **403** means inspect role/Site permissions. **400** means inspect body or variable formatting. **500** is not a normal empty-data result; capture the response `requestId` and Node log, and check index readiness.

These manual checks complement the Phase 11 automated/emulator coverage recorded in `phase-11-completed-brief.md`. They do not replace an end-to-end frontend test.
