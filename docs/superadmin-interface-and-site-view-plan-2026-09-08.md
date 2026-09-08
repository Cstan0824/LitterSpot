# Superadmin interface and Site View plan

## Decision

An authenticated LitterSpot Superadmin enters a separate Superadmin interface. This area owns Site creation, Site lifecycle, Root Supervisor recovery, operation recovery, and Superadmin audit history.

A Superadmin may open a selected Site in **Site View**. Site View reuses the existing Supervisor pages and navigation, but it does not impersonate a Site Supervisor. The interface omits actions the Superadmin cannot perform in this context. It does not repeatedly label pages as read-only and does not show a persistent read-only banner.

The Superadmin account modal in Site View shows the selected Site and provides **Exit Site**. Exit Site returns to that Site's Superadmin detail page. Sign out remains available separately.

This decision supersedes older wording that granted Root-equivalent mutations inside reused Supervisor pages. Site lifecycle and Root recovery remain available only through the separate Superadmin interface.

## Authority boundary

| Context | Responsibilities |
| --- | --- |
| Superadmin interface | List and create Sites, inspect Site details, activate or deactivate Sites, recover Root access, reconcile Site operations, inspect Superadmin audit history |
| Superadmin Site View | Read selected-Site Dashboard, Cameras, Alerts, Work, Team, Insights, System, Site Map, detail records, and evidence |
| Root Supervisor interface | Existing Root operational, account, and structural controls |
| Regular Supervisor interface | Existing Regular operational controls |

Site View does not expose Camera monitoring or registration controls, Alert or Work actions, Cleaner or Supervisor management, analytics implementation controls, Orchestrator controls, Site Map drafts, or analysis playgrounds. Backend routes expose only GET requests for Site View. Direct mutation attempts cannot use the Site View route family.

## Navigation and routing

- Superadmin landing route: `#/superadmin/sites`
- Site detail route: `#/superadmin/sites/:siteId`
- Site View route: `#/superadmin/sites/:siteId/view/:page`
- Site View pages: Dashboard, Cameras, Alerts, Work, Team, Insights, System, Site
- Exit Site returns to `#/superadmin/sites/:siteId`
- Unknown or malformed Superadmin routes return to the Site list

The authenticated role remains `superadmin` throughout Site View. The selected Site ID comes from the route and every backend read validates that the Site exists before accessing tenant data.

## Delivery phases

### Phase 1: backend and routing foundation

- Add bounded Site list and Site detail projections.
- Add selected-Site operational read endpoints for the shared interface.
- Add selected-Site detail reads for Camera, Alert, Work, history, Verification, System, Site audit, and evidence media.
- Add frontend Superadmin route parsing and Site View deep links.
- Test cross-Site isolation, inactive Site reads, missing resources, media scope, and rejection of mutation methods.

### Phase 2: Superadmin management interface

- Build the Superadmin shell, Sites list, Site detail, and account controls.
- Build Site creation with initial map setup and first Root Supervisor.
- Build Site activation/deactivation, Root recovery, operation recovery, and audit history.

**Completed 2026-09-08.** Superadmin authentication now enters the separate interface. Site creation provisions the first published empty map revision and Root account through the existing recoverable identity operation. The Site register exposes lifecycle, Root recovery, operation recovery, and Superadmin-only audit controls. Site View remains a Phase 3 integration.

### Phase 3: Site View

- Reuse Supervisor pages with a Superadmin-selected Site read model.
- Omit mutation controls and monitoring-session ownership.
- Add selected-Site context and Exit Site to the Superadmin account modal.
- Verify Root, Regular, Superadmin, active-Site, inactive-Site, deep-link, and direct-API behavior.

**Completed 2026-09-08.** Site View now reuses the Supervisor Dashboard, Cameras, Alerts, Work, Team, System, and Site Map presentation with a Superadmin-selected Site read model. Insights uses the same stored analytics records in a dedicated non-mutating ledger. All action controls are omitted, selected-Site evidence uses scoped media routes, mobile navigation remains available, and the account modal provides Exit Site and Sign out.

## Required states

The implementation covers no Sites, loading, failed load with retry, active and inactive Sites, missing Root reference, pending and failed Site operations, empty operational history, inaccessible or missing evidence, malformed Site View routes, and a Site becoming inactive while open.
