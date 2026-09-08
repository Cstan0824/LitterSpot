# Superadmin Phase 3 completed brief

## Delivered behavior

A Superadmin can open any registered Site at `#/superadmin/sites/:siteId/view/:page`. The authenticated identity remains the Superadmin. Site View never creates a Supervisor session or borrows a Supervisor tenant claim.

Site View includes:

- Dashboard with the interactive Site Map and selected-Zone inspector;
- Camera list and Camera detail, including retained history and source state;
- Alert list, retained evidence, response status, and journey;
- Work list and completion evidence;
- Cleaner and Supervisor directories;
- stored daily analytics and the latest bin-placement snapshot;
- Orchestrator state, workload, Runs, issues, and control history;
- published Site Map, Zones, Camera points, and Station Points.

Filters, map navigation, evidence toggles, record expansion, and detail navigation remain available. Site View omits Camera monitoring, Camera registration, Camera movement, Alert assignment or dismissal, Work creation or decisions, Cleaner or Supervisor management, analytics implementation, Orchestrator pause or resume, and Site Map draft controls.

The UI does not repeat a read-only label. An inactive Site receives one factual status strip because that state changes how its data should be interpreted.

## Navigation and account controls

The Supervisor page links now route within the selected Superadmin Site View. This includes Dashboard map markers, Camera history, Alert evidence, Work context, Team, Insights, System, and Site Map.

The navigation collapses into the existing mobile drawer below the established breakpoint. The Superadmin account modal shows the current Site and provides:

- Exit Site, returning to the selected Site's Superadmin register;
- Sign out.

## Backend boundary

Selected-Site data and evidence remain under `/api/superadmin/sites/:siteId/view/*`. The new System Run detail endpoint validates both the Site and Run before returning a trace. Media URLs are rewritten to the selected-Site media route.

All Site View routes are GET-only. Direct mutation attempts continue to fail with `403`.

## Verification

- Frontend production build passes.
- Backend TypeScript build passes.
- Frontend suite passes with 127 tests.
- Backend unit suite passes with 265 tests.
- Superadmin identity and Site emulator suite passes with 8 tests.
- Emulator coverage includes inactive Site reads, missing resources, scoped media, scoped System Runs, and mutation rejection.
- Desktop and 390 × 844 responsive browser passes completed across Dashboard, Cameras, Alerts, Work, Team, Insights, System, Site Map, account controls, and Exit Site.
- The Impeccable detector returned advisory-only design-token findings and no blocking findings.
