# Phase 11 completed brief

Status: completed and regression-tested after the Phase 11 correctness and Firestore read-budget reviews. No product frontend was changed.

## Delivered behavior

### Minute analytics

- One deterministic UTC-minute document per Site holds Zone aggregates.
- Each Camera/Episode contribution has a stable identity. Retrying the same flush replaces that contribution instead of double-counting it.
- A later contribution to an already persisted minute merges with prior contributions instead of overwriting them.
- Current unfinished minutes and in-flight samples are not flushed.
- Browser time is accepted only inside a two-minute lateness and ten-second future-skew window.
- People sums, peaks, sample attempts, inference failures, issue counts, simulation counts and latency aggregates are retained.
- While monitoring has pending analytics, one-minute maintenance records eligible Cameras and approximate offline seconds by active Camera placement. An idle Site does not poll all Camera data every minute.
- Test and simulation signals remain included, with separate internal counters.

### Daily summaries and retention

- Daily boundaries use the Site timezone and support DST plus fractional-hour offsets.
- Daily Site totals correctly sum additive values while preserving `peopleMax` as a maximum.
- Alert and Work metrics rebuild from immutable event timestamps. Later parent-document edits do not move overflow escalation dates.
- Rebuilds are repeatable and do not reapply events.
- Current local dates are provisional; completed local dates are final.
- Coverage reports expected minutes, observed minute buckets, operational facts, missing monitoring coverage and source availability.
- Expired minute buckets are deleted at their stored 90-day `expiresAt`, only after a final daily summary preserves their minute totals.
- Automatic maintenance finalizes the previous Site-local day once. Older repairs use the explicit date rebuild API; the worker does not discover them by scanning all retained history.
- A multi-date rebuild reads Alert and Work history once for the whole request rather than once per date.

### Dashboard

- V2 Alert counts use `waiting_for_cleaner`, `assigned`, `in_progress`, `awaiting_review`, `resolved` and `dismissed`.
- Top Alerts use current priority and oldest-first ties. When no active Alerts exist, resolved history uses highest recorded severity then most-recent resolution. Dismissed Alerts never appear as fallback.
- Busy Zones use the last 15 complete UTC minutes, Zone-specific minute people averages, severity-weighted active Work and 50/50 Site-relative normalization.
- Scores are bounded from 0 to 100. Ties use qualifying issue count, visitor pressure, Zone name and Zone ID.
- Dashboard includes Zone/Camera/Cleaner/Alert/Work counts, available Cleaners, assigned Work, Orchestrator state and a one-minute cache.

### Bin Placement

- Ranking uses completed Site-local days inside the requested lookback window. Old dates do not replace missing requested dates.
- People activity, resolved cleaning frequency and bin-service Alert frequency are normalized against the same factor across sufficient Zones.
- Each normalized factor contributes one third. A Zone needs at least two observed completed days before receiving a score or being implementable.
- Requested versus available coverage and `ready`, `partial_data` or `insufficient_data` are explicit.
- GET normally reads the cached snapshot only. It refreshes when the snapshot is missing, its requested window changes, or its daily expiry passes. Source changes become visible through manual refresh or the daily worker.
- Implement requires the snapshot timestamp the Supervisor reviewed. Changed/stale snapshots return `409`.
- Exact replay is idempotent. A Zone remains excluded until two complete Site-local calendar days have elapsed.
- Comparisons use the selected Zone and exact Intervention boundary, preserve local wall-clock time across DST, show missing calendar dates and report fractional partial-day coverage without padding.

## API contract

All routes derive `siteId` from the authenticated V2 Supervisor.

```text
GET  /api/dashboard/v2
POST /api/dashboard/v2/refresh

GET  /api/analytics/v2/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
POST /api/analytics/v2/daily/rebuild
POST /api/analytics/v2/minute/cleanup

GET  /api/bin-placement/v2/recommendations?days=30
POST /api/bin-placement/v2/recommendations/refresh
POST /api/bin-placement/v2/zones/{zoneId}/implement
GET  /api/bin-placement/v2/interventions
GET  /api/bin-placement/v2/interventions/{id}/comparison?days=7
```

Daily rebuild accepts exactly one form:

```json
{"localDate":"2026-08-30"}
```

or:

```json
{"dates":["2026-08-28","2026-08-29","2026-08-30"]}
```

Implementation requires the current snapshot timestamp:

```json
{
  "note": "Bin installed after operational review",
  "snapshotCalculatedAt": "2026-08-31T02:00:00.000Z"
}
```

## Postman testing

Folder: `24 - V2 Phase 11 Analytics Dashboard Bin Placement`.

1. Run **V2 Phase 9 Root Login** first.
2. Requests 01 and 02 refresh/read Dashboard safely.
3. Request 03 rebuilds the example dates; change them to dates containing your own observations.
4. Request 04 lists daily coverage.
5. Request 05 refreshes a 30-day recommendation snapshot and saves `v2BinPlacementSnapshotAt`.
6. Request 06 reads the cache.
7. Request 07 is intentionally blocked unless request 05 returned a scored Zone with at least two observed completed local days.
8. Requests 08 and 09 list/compare Interventions when one exists.
9. Request 10 deletes only expired minute buckets after preserving final summaries.

Do not run the folder blindly as a single collection run. Empty or one-day Sites should return `insufficient_data`; that is correct behavior.

## Automatic maintenance

The backend starts the Phase 11 worker when:

```env
ANALYTICS_WORKER_ENABLED=true
```

Cloud development defaults this setting to `false`; enable it deliberately when automatic analytics are needed. With the worker enabled:

- the one-minute loop touches only Sites with pending in-memory monitoring analytics;
- a 15-minute sweep checks a small per-Site maintenance marker;
- after five minutes into a new Site-local day, one sweep finalizes the previous day, performs retention cleanup and refreshes recommendations;
- older or corrected dates are rebuilt through the manual endpoint.

This avoids rereading up to 90 days of minute buckets every minute. Site Operation recovery polls every five minutes and backs off to at most one hour after Firestore quota errors. Failed non-quota reconciliation is marked `failed` instead of being retried forever.

Firestore quota errors now return HTTP `503` with code `firestore_quota_exceeded`. Background logs retain a safe error code and retry delay without exposing provider details.

## Verification

`npm run verify:phase11` passed with the Phase 11 integration suite included. Backend compilation, policy tests, the full Auth/Firestore emulator workflow, FastAPI contracts, the frontend compatibility build and Postman validation passed. This does not claim cloud acceptance or frontend integration testing.

```bash
npm --workspace=backend run build
npm run test:backend
npm run validate:postman
npm run test:emulator
npm run verify:phase11
git diff --check
```

The Phase 11 emulator suite contains 12 scenarios covering minute replay, totals/peaks, Dashboard states and ties, 7-of-30 partial ranking, insufficient data, duplicate implementation, exclusion, comparison boundaries, immutable overflow times, previous-day finalization, bounded maintenance reads, Camera coverage and tenant authorization. The normal emulator runner includes it.

## Deployment

Indexes and field overrides cover retention, daily ranges, intervention lookups and large aggregate maps. No additional index was needed for the read-budget fix. Deploy index changes only to the isolated development project:

```bash
npx firebase deploy \
  --project litterspot-v2-database \
  --config firebase.development.json \
  --only firestore:indexes
```

Wait until each index is enabled before cloud API testing.

Phase 12 frontend wiring and V1 retirement remain deferred.
