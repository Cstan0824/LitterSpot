# Phase 12.2 completed brief

Status: implemented locally against `litterspot-v2-database/(default)`.

## What changed

The delivered Supervisor UI remains the presentation layer. This phase does not replace its pages, navigation, layout, or styling.

- `OperationsConsole` now loads the V2 Dashboard, Site Map, Alerts, Cleaners, Work Orders, and published Cameras through one authenticated V2 read client.
- A thin adapter converts those V2 records into the existing page props. No V1 location, Cleaner, Alert, or generated Work data is fetched for the rendered Supervisor operations route.
- Dashboard uses V2 Alert status, calculated Cleaner availability, Camera state, and backend busy-zone scores.
- Alert list/detail accepts opaque V2 IDs and the full V2 lifecycle states.
- Work list uses actual persisted Work Orders instead of generating one Work row per Alert.
- Cleaner Management shows backend-calculated availability rather than treating every active account as available.
- Camera Management shows V2-published Camera records and hides creation while the Camera Draft workflow is still deferred.
- Existing write controls are hidden or disabled. Their backend actions belong to later phases.
- `GET /api/site-map` now includes `siteName`, so the adapter has the authoritative display name available when needed.

## Not connected yet

- Alert assignment, dismissal, and other Alert actions: Phase 12.3.
- Manual Work creation, reassignment, takeover, dismissal, and verification: Phase 12.3.
- Cleaner account/profile/schedule/station edits and Cleaner mobile: Phase 12.4.
- Camera Draft creation, plotting, and publication: Phase 12.5.
- Browser-owned live monitoring: Phase 12.6.
- Bin Analysis and System: Phase 12.7.

## Verification

```text
npm --workspace=frontend run build
Passed

Root-authenticated V2 API contract check
Dashboard, Site Map, Alerts, Cleaners, Work Orders, and Cameras returned 200
```

## Browser checks

1. Start Node and FastAPI with `npm start` if needed.
2. Start Vite with `npm --workspace=frontend run dev -- --host 127.0.0.1`.
3. Sign in as the Root Supervisor.
4. Open Dashboard, Alerts, Work, Team, and Cameras. Reload each route and confirm its contents remain from the V2 database.
5. Check that Alerts use statuses such as `waiting_for_cleaner`, `assigned`, and `awaiting_review`.
6. Check that Work rows match the prepared fixture states, including assigned, in progress, awaiting review, resolved, dismissed, and rework.
7. Check that the Team page marks only backend-available Cleaners as available.
8. Confirm no Supervisor write action is available yet on these pages.
