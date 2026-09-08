# Remaining phases and frontend cutover plan

## Current position

Canonical backend Phases 0 through 11 are implemented and locally verified. Phase 9's follow-up audit and the Phase 11 correctness review are resolved. Cloud acceptance testing remains a user-run step; the next build phase is the deferred frontend integration and cutover.

The current `main` frontend is intentionally transitional. Some pages use V1 APIs and some use hardcoded data. It may continue that way while the frontend team prepares its complete first-version page and modal set. The V2 backend must not be merged into `main` by itself.

## Phase overview

| Phase | Owner | Outcome |
| --- | --- | --- |
| 9 | Backend + Orchestrator teammate | Completed, including [follow-up automation hardening](phase-9-follow-up-audit.md) |
| 10 | Backend | Delivered: notifications, audit, Site deactivation reconciliation and System read model |
| 11 | Backend | Implemented and locally verified: Dashboard, daily analytics and Bin Placement APIs |
| 12 | Backend owner integrating frontend | Complete first frontend integration, V1 retirement, repository organization and atomic V2 cutover to `main` |
| 13 | Frontend team, supported by backend owner | Missing/new UI built and wired directly against stable V2 |
| 14 | Whole team | Final end-to-end acceptance, calibration, cleanup and release documentation |

## Phase 9: Orchestrator integration, completed

Deliver:

- top-10 bounded waiting-Alert context with LLM-selected Alert–Cleaner pair;
- five approved Node tools;
- Station Point distance, current availability, and fresh Recent Work Location context;
- LLM technical retry and Cleaner-conflict exclusion;
- Orchestrator Runs, attempts, actions and structured explanations;
- failure/exhaustion notification;
- pause, inactive-Site and manual-takeover guards;
- deterministic review outcome application;
- developer-only raw provider output outside Firestore.

Do not build frontend integration in this phase. Expose stable System-page and decision-history contracts for Phase 12.

## Phase 10 — platform operations

Deliver:

- immutable real-time recipient notifications;
- recipient-only Firestore listener rules;
- removal of FCM, push tokens and read-receipt behavior;
- complete Supervisor/Superadmin mutation audit coverage;
- resumable Site deactivation reconciliation;
- dismissal of active Alerts/Work and Cleaner release;
- Orchestrator/System status and safe error read models.

## Phase 11 — read models and analytics

Deliver:

- finalized Site-wide minute buckets and 90-day cleanup;
- daily Site summaries;
- complete Dashboard read model;
- top Alerts and 15-minute Busy Zones;
- available Cleaner and assigned Work summaries;
- Bin Placement equal-thirds ranking;
- daily/manual ranking refresh;
- Intervention records and two-full-day exclusion;
- arbitrary before/after ranges with honest partial coverage.

Phase 11 ends with a V2 API freeze. Every API needed by the delivered frontend must have stable request, response, error and empty-state examples.

## Frontend delivery checkpoint

Before Phase 12 begins, the frontend team provides one commit containing its complete first-version scope:

- all planned pages;
- all planned modals and guided flows;
- navigation and responsive structure;
- hardcoded or V1 data is acceptable at this checkpoint;
- visual behavior is ready enough that integration should not require redesigning every component.

Record this commit as the frontend integration baseline. Coordinate a short integration window so large frontend restructures do not land while the backend owner is replacing its data layer.

## Phase 12 — first wired V2 system

The source-based breakdown of the delivered UI and integration steps is in [Phase 12 UI integration plan](phase-12-ui-v2-integration-plan.md). The first delivery is already merged locally; newer main changes must be reviewed before the integration baseline is finalized. Phase 11 acceptance guidance is in [Phase 11 Postman testing](phase-11-postman-testing.md).

### 12.1 Merge and inventory

- merge the frontend baseline from `main` into the integration branch;
- list every page/modal and its current source: hardcoded, V1, V2 or missing;
- map each UI action to one V2 endpoint and permission;
- record UI capabilities the backend supports but the first frontend delivery omitted.

### 12.2 Shared frontend service layer

Use one integration boundary such as:

```text
frontend/src/services/v2/
  authAPI.ts
  dashboardAPI.ts
  siteMapAPI.ts
  cameraAPI.ts
  alertAPI.ts
  workAPI.ts
  cleanerAPI.ts
  analyticsAPI.ts
  orchestratorAPI.ts
  superadminAPI.ts
```

Components consume typed functions/read models from this layer. Do not place raw endpoint URLs and token handling throughout page components.

### 12.3 Integrate delivered surfaces

Wire the delivered versions of:

- authentication and role routing;
- Supervisor Dashboard;
- Site Map and Zone/Camera Management;
- Camera Creation/Registration and Camera Details;
- Alert list/detail and evidence;
- Work list, manual creation and review actions;
- Cleaner list/detail, schedule, override and Station Point;
- Bin Placement Analysis;
- System/Orchestrator view;
- Cleaner mobile pages;
- separate Superadmin area.

If a surface was not delivered, do not build an unrelated substitute in the integration branch. Add it to the Phase 13 UI backlog while preserving its V2 API contract.

### 12.4 Remove V1 and hardcoded dependencies

- replace hardcoded operational arrays with loading, empty, success and error states from V2;
- replace V1 API calls and old status vocabularies;
- remove compatibility routes only after usage searches and browser tests show no consumers;
- archive old Postman/docs rather than leaving them next to active V2 material without warnings.

### 12.5 Organize the repository

Do this near the end, not before functional integration:

- remove confirmed dead V1 files;
- choose one test placement convention and apply it consistently;
- group integration tests and scripts clearly;
- separate active documentation from archived V1 history;
- remove generated/local artifacts;
- keep product frontend, developer sandbox, model training and service code clearly separated;
- rerun imports, scripts and CI after every mechanical move batch.

### 12.6 Atomic cutover

The PR to `main` contains:

```text
V2 backend
+ Firebase rules/indexes
+ integrated first-version frontend
+ migration/bootstrap tooling
+ automated tests and Postman
+ setup/handoff documentation
```

Never submit a backend-only V2 PR to `main` while the current frontend still requires V1.

## Phase 13 — frontend team continuation

After the Phase 12 PR reaches `main`, the frontend team works from the wired system. They add UI omitted from their first delivery and implement later requests while calling real V2 APIs immediately.

The backend owner does not perform another broad migration. Their role is:

- clarify contracts;
- fix backend defects revealed by real UI use;
- review authorization and workflow correctness;
- avoid changing response meanings without coordination.

## Phase 14 — final acceptance

Run full journeys for:

- Superadmin Site setup and recovery;
- Root/Regular Supervisor permissions;
- Site Map, Cleaner and Camera configuration;
- live monitoring and Alert creation;
- no-Cleaner waiting and Orchestrator assignment;
- Cleaner work, rework and completion;
- manual coordinate Work with photo;
- Dashboard and Bin Placement analytics;
- pause/resume and dependency failures;
- Site deactivation/reactivation;
- retained history and notification isolation.

Complete final cleanup, calibration, setup rehearsal and demonstration documentation only after these journeys pass.

## Merge discipline while waiting for frontend delivery

- finish Phases 9–11 in the integration branch;
- merge `origin/main` only at passing backend checkpoints;
- resolve frontend changes without prematurely wiring incomplete pages;
- keep the frontend team's current `main` usable until the atomic Phase 12 cutover;
- commit before each merge so backend checkpoints remain recoverable.
