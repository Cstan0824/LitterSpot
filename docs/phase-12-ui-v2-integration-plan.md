# Phase 12 UI integration with V2

Status: execution-ready plan, updated 2026-09-01 after the full frontend source audit. No frontend runtime code changed for this update.

## Baseline and scope

- Working branch: `jeremy`.
- Current integration HEAD: `78d6157`, including frontend delivery `0dce9d8` and its Cleaner calendar update.
- Canonical cloud target: `litterspot-v2-database/(default)`.
- Rules and 62 indexes are deployed and ready. The V2 bootstrap and controlled Phase 11 seed are complete.
- Phase 11 cloud acceptance passed for Dashboard, daily summaries, recommendations, Intervention listing and retention cleanup. Manual Implement/comparison remain available for the user to exercise.
- Phase 11/backend changes remain uncommitted. Preserve them and create a passing checkpoint before broad frontend edits.

Use the teammates' delivered screens and styling. Replace their data flow and actions with V2. Do not assume a visible control works because it updates React state. Keep changes on the integration branch until a wired first version and V2 backend can reach main together.

This plan refines Phase 12 in `remaining-phases-and-frontend-cutover-plan.md`. Phase 13 remains the frontend team's work on missing screens and subsequent changes. Phase 14 remains final acceptance.

## What is currently delivered

This is a source-level inventory, not a browser acceptance claim. Recheck it after the new main changes arrive.

| Screen or flow | Current local implementation | V2 integration needed |
| --- | --- | --- |
| Login and routing | `src/main.tsx` signs in with Firebase, assumes `/api/me` returns a Supervisor, and allows an unauthenticated Cleaner demo | Use the role-discriminated response, root/regular authority and Site context. Separate Superadmin, Supervisor and Cleaner routes. Remove demo bypass from operational login. |
| Dashboard | `GeographicOperationsDashboard.tsx` receives mixed live/demo inputs; computes its own scores, availability and map anchors | `/api/dashboard/v2` plus the published Site Map. Use backend top Alerts, busy Zones, availability and Work, not local substitute rules. |
| Zone/Camera management | `CameraOperationsPage.tsx` has a wall, details and creation modal; `OperationsConsole.tsx` calls older location APIs | Map revisions and V2 Camera Draft flow. Real published geometry, Camera IDs and runtime. Creation and registration become one flow. |
| Floor/bin plotting | `CameraRegistrationPrototype.tsx` already provides reference and drawing interactions | Reuse drawing/source handling where compatible, replace persistence with `/api/camera-creation`, and verify coordinate/shape schemas. Do not discard useful plotting code. |
| Alert list/detail | `AlertManagementPage.tsx` receives `demoAlerts`; evidence is `/mock/spill.jpg`, status changes are local | `/api/alerts`, actual evidence, V2 lifecycle, manual assignment/dismissal and linked Work. |
| Work list/create/detail | `WorkManagementPage.tsx` creates Work from every Alert, picks Cleaners by array position, keeps edits in state | `/api/work-orders` is authoritative. Waiting Alerts have no Work. Use assignment, coordinate/camera manual creation, reassignment, takeover, review and dismissal endpoints. |
| Cleaner management | `TeamManagementPage.tsx` starts from older Cleaner records, invents station/schedule defaults, and edits local roster state | Account/profile APIs, actual Station Points, structured recurring schedule and availability override. Remove assigned-Zone restrictions. |
| Cleaner mobile | `CleanerMobileApp.tsx` uses `cleanerMobileMock.ts`, demo dates, notifications and Work | Real Cleaner login and `/api/cleaner/*`, start/submit-for-review, evidence where required, limited history and recipient notifications. |
| Bin Analysis | `OperationsConsole.tsx` calls the older ten-minute `/api/bin-replacement` logic | Phase 11 daily priority ranking, implementation records and before/after series. The existing replacement cards are not the approved analytics workflow. |
| System | `#/status` renders `DashboardPage.tsx`, a service-health sample | `/api/operations/v2/system`, Orchestrator config/status and structured Run history. Health-only UI is not the complete System page. |
| Superadmin and Supervisor account management | No dedicated routed Superadmin area found in this baseline | Confirm latest delivery. Map `/api/superadmin/*` and `/api/supervisors` to delivered account/site controls, otherwise record missing UI. |

## Execution phases based on the delivered frontend

Phase 12 wires the UI that already exists. Phase 13 adds product screens or substantial controls that the first delivery omitted. This boundary prevents backend integration from quietly turning into an unbounded frontend redesign.

Every completed subphase gets its own `docs/phase-12-<number>-completed-brief.md` containing changed screens, endpoints, automated tests, manual browser checks and remaining gaps.

### Phase 12.0: checkpoint and integration harness

Purpose: establish a recoverable baseline before replacing any data flow.

Work:

- finish or explicitly defer the two data-mutating Phase 11 Postman checks;
- run the complete backend/Phase 11 verification and frontend build;
- record the frontend baseline hash and current Firebase target;
- preserve `api-sandbox/` as a developer tool, separate from the product frontend;
- add frontend test support for service modules and role routing if the current setup cannot exercise them;
- create a page/action contract matrix that labels each current action `real`, `local-only`, `V1`, `mock`, or `missing`.

Exit:

- the repository has one known passing checkpoint;
- no product component has been partly migrated;
- the next change can be reverted without losing Phase 0-11 work.

### Phase 12.1: V2 frontend foundation and role routing

Purpose: make authentication, errors, media and routing correct once for every later page.

Reuse:

- Firebase sign-in from `src/config/firebase.ts`;
- authenticated request foundation from `src/services/apiClient.ts`;
- `LoginPage`, `FieldStationNavigation` and `FieldStationShell` visual structure.

Build:

- a discriminated `/api/me` session model for `superadmin`, `supervisor` and `cleaner`;
- role-aware routing with separate Supervisor, Cleaner and Superadmin entry points;
- root-versus-regular Supervisor capability checks for hiding/disabling controls;
- one typed V2 request helper with request cancellation, structured `400/401/403/409/503` errors and safe retry rules;
- one idempotency-key helper for user mutations;
- one authenticated media loader that creates and revokes object URLs;
- session cleanup that removes account-scoped caches, listeners and object URLs on logout/account change;
- removal of the unauthenticated “Try Cleaner mobile demo” path from the operational login flow.

Do not integrate business pages in this phase.

Exit:

- all three account types reach the correct shell or an explicit not-yet-delivered page;
- invalid/expired login and Firestore quota errors have different UI states;
- no component handles raw Firebase tokens itself;
- no secret enters committed frontend source.

### Phase 12.2: Supervisor read-only V2 pages

Purpose: replace invented lists with backend-owned state before enabling mutations.

Wire:

- `GeographicOperationsDashboard` to `/api/dashboard/v2` and `/api/site-map`;
- `AlertManagementPage` to Alert list/detail and authenticated evidence;
- `WorkManagementPage` to Work list/detail/history/verifications;
- `TeamManagementPage` to Cleaner list/detail and real availability;
- `CameraOperationsPage` to `/api/camera-creation/cameras` and Camera runtime/placement/registration data.

Rules:

- keep all mutation controls disabled or clearly marked unavailable until their phase;
- use opaque V2 string IDs, never numeric demo IDs or display codes as identity;
- render actual `xMeters`/`yMeters` and Zone polygons from the Active Map Revision;
- remove local Busy Zone, assignment and Work-generation calculations;
- add loading, empty, partial, forbidden, stale and dependency-failure states;
- replace hardcoded `Batu Caves` labels with the authenticated Site name.

Exit:

- browser lists match Postman/API results for the same Root account;
- a page reload preserves backend state rather than recreating demo records;
- no read-only screen imports `demoAlerts`, `cleanerMobileMock`, `binReplacementAPI`, V1 `locationAPI`, or V1 Alert types.

### Phase 12.3: Supervisor Alert and Work actions

Purpose: connect the core operational workflow without involving Cleaner mobile yet.

Reuse:

- Alert detail drawer, filters and evidence layout;
- Work list, Work detail drawer, manual Work modal and Camera navigation;
- coordinate picker visual interaction after conversion to Site Map metres.

Wire:

- Alert dismissal and manual Cleaner assignment;
- Manual Work creation for Camera or coordinate targets;
- Work takeover, reassignment and dismissal;
- Work history and Verification display;
- Supervisor Verification and override actions;
- `expectedRevision` conflict refresh and explicit reason capture;
- backend availability as the only source for selectable Cleaners.

Contract corrections:

- use Alert statuses `waiting_for_cleaner`, `assigned`, `in_progress`, `awaiting_review`, `resolved`, `dismissed`;
- use Work statuses `assigned`, `in_progress`, `awaiting_review`, `resolved`, `dismissed`;
- use only `warning` and `critical`, replacing the current Low/Medium/High selector;
- do not generate one Work Order per Alert in React;
- do not let a Supervisor click arbitrary Work statuses as if they were local tabs.

Exit:

- waiting Alert has no Work until assignment succeeds;
- manual and Alert-driven Work survive reload;
- concurrent revisions return a visible refresh/review flow rather than silent overwrite;
- Camera-linked Work navigates to Camera detail, while coordinate Work opens its own map detail.

### Phase 12.4: Cleaner management and Cleaner mobile

Purpose: connect account creation, availability and the real Cleaner journey.

Reuse:

- four-step Cleaner wizard;
- Station Point picker and weekly roster editor;
- Cleaner mobile Home, Work, Schedule, Updates and Profile views;
- Camera-versus-coordinate evidence presentation.

Wire Supervisor side:

- Cleaner Auth/account creation with email/password;
- profile edits, deactivate, schedule and availability override;
- Station Point persistence using Site Map metres;
- account status separately from calculated availability;
- real Cleaner metrics and filters, with no assigned-Zone restriction.

Wire Cleaner side:

- `/api/cleaner/me` role session;
- active plus five recent terminal Work Orders;
- Work detail, start, completion photo upload and submit-for-review;
- Camera-linked Work without Cleaner completion photo;
- coordinate Work requiring exactly one completion photo;
- recipient-only notification inbox and Firestore realtime listener;
- event-driven API refresh after assignment, rework, resolution or dismissal.

Exit:

- Cleaner login cannot enter Supervisor pages;
- creating a Cleaner produces a usable Firebase login;
- availability follows schedule, override and active Work;
- the complete assignment to review/rework/resolution journey survives page reloads;
- `cleanerMobileMock.ts` has no runtime consumer.

### Phase 12.5: V2 Camera Draft and Registration adaptation

Purpose: reuse the advanced plotting UI with the composite V2 Camera lifecycle.

Reuse:

- `CameraRegistrationPrototype` step navigation;
- reference image/video capture;
- walkable-floor and physical-bin polygon drawing;
- sequential video validation and result overlay;
- the Camera management modal’s Zone polygon interaction.

Replace:

- legacy “create Camera, then register” calls with one Camera Draft;
- percentage/fake latitude-longitude readouts with Active Map Revision metres;
- legacy registration workspace persistence with Draft reference, source video, registration, validate and publish endpoints;
- independent Zone creation calls with Site Map Draft validation/publication where applicable.

Required UI addition inside the existing flow:

- a Camera Placement point inside exactly one active Zone;
- source selection between required first laptop Camera and later looped-video Cameras;
- looped source upload and initial `monitoringEnabled=false` state;
- reconfiguration warning that source replacement requires new floor/bin plotting.

Exit:

- the first Camera is forced to laptop source;
- one Camera Draft carries identity, placement, source, reference and Registration;
- invalid geometry/source cannot publish;
- published placement and normalized Camera-view polygons round-trip correctly;
- webcam/video resources can be stopped without leaving device capture active.

### Phase 12.6: V2 live monitoring and Camera detail

Purpose: turn the Camera wall/detail page into the prototype’s browser-owned monitoring runtime.

Build:

- a shared Monitoring Session owner above individual Camera components;
- claim, 30-second lease heartbeat and release;
- Camera Episode start and two-second frame sampling;
- laptop Camera capture and looped-video playback;
- local live preview with returned people/bin/litter/spill overlays;
- source/runtime/offline/conflict error presentation;
- page-hide, logout and unmount cleanup for webcam tracks, timers, object URLs and leases;
- Camera detail history, current cleanliness/connection status and linked active Work.

Do not reuse the legacy pipeline’s one-second temporal business logic. It remains a developer analysis tool until retired.

Exit:

- only one browser owns the Site Monitoring Session;
- operational samples create V2 observations/Flags/Alerts through Node;
- leaving monitoring stops sampling and eventually marks the Camera offline;
- simulation video does not start monitoring automatically;
- only Alert Evidence is retained as imagery.

### Phase 12.7: Dashboard completion, Bin Analysis and System

Purpose: wire the remaining delivered routes after operational data is real.

Dashboard:

- display Phase 11 counts, Top Alerts, Busy Zones, available Cleaners and assigned Work;
- preserve the one-minute cache and explicit refresh;
- use actual map geometry and navigation targets.

Bin Analysis:

- replace `/api/bin-replacement` cards with V2 recommendation ranking;
- add Supervisor-selected whole-number lookback of at least two days;
- show all three equal factors, rank, score and honest coverage;
- wire refresh, snapshot-aware Implement and Intervention history;
- render cleaning-frequency and bin-overflow before/after series with missing/partial dates.

System:

- replace the health-only sample with `/api/operations/v2/system`;
- wire Orchestrator status, pause/resume, structured Run list/detail and safe failures;
- keep raw provider output outside the product UI.

Exit:

- Dashboard and Bin Analysis match Postman for the same Site;
- stale recommendation Implement returns a review-refresh flow;
- partial analytics never render fabricated zero days;
- all Supervisors can pause/resume, and the action is audited.

### Phase 12.8: V1/mock retirement and first atomic cutover

Purpose: deliver one coherent V2 frontend/backend checkpoint to `main`.

Work:

- search all product runtime imports and requests for V1 endpoints, demo arrays and hardcoded Site data;
- remove confirmed dead product consumers, then retire their compatibility routes;
- retain inference playgrounds only under a clearly marked developer-tools route;
- keep `api-sandbox/` separate;
- consolidate typed V2 services and tests;
- run role, browser, backend, Firebase emulator, FastAPI and Postman verification;
- organize repository/docs only after functional acceptance;
- prepare the atomic V2 backend plus wired frontend PR.

Exit:

- no primary product page relies on mock/V1 data;
- Supervisor and Cleaner required journeys pass against `litterspot-v2-database`;
- missing UI is listed precisely for Phase 13;
- teammates can pull `main`, sign in and work against one V2 contract.

## Phase 13 UI backlog identified by the source audit

These are not mere API wiring tasks. They require screens or substantial controls absent from the first frontend delivery.

1. Full Root-controlled Site Map configuration page: dimensions, grid size, optional background plan, Zone polygon editing, validation, publication and revision history.
2. Separate Superadmin application area: Site list/create/status, first Root creation/recovery, selected-Site read access and Superadmin audit history.
3. Root Supervisor account-management page for Regular Supervisor creation/edit/deactivation.
4. Final Bin Analysis ranking table and before/after chart components if the frontend team does not supply them before Phase 12.7.
5. Final System/Orchestrator Run-detail presentation if the health sample is not replaced by the frontend team.

The minimal Camera Placement control required by the delivered Camera wizard belongs to Phase 12.5. The full Site Map administration experience remains Phase 13 unless the frontend team delivers it sooner.

## Contract changes that must not be hidden by adapters

- IDs are opaque strings. Existing numeric Alert IDs and Camera codes are not interchangeable with V2 document IDs.
- Alert status is `waiting_for_cleaner`, `assigned`, `in_progress`, `awaiting_review`, `resolved` or `dismissed`. Do not flatten all open stages into `active` for actions.
- Work status is `assigned`, `in_progress`, `awaiting_review`, `resolved` or `dismissed`. Assigning already means acceptance. No Cleaner accept/reject or problem-report flow.
- Cleaner account status and current availability are separate. The UI cannot label all active accounts as available or assign Work based on array order.
- Manual Work uses `warning` or `critical` severity. Existing Low/Medium/High controls need explicit adjustment, not a silent ambiguous mapping.
- Site positions use `xMeters`/`yMeters` in the active Map Revision. Reference-image polygons use normalized coordinates. The existing percentage-based decorative maps cannot supply operational distance without conversion.
- A Camera must belong inside an active Zone. A manual coordinate task can be outside Camera coverage. Do not invent a Camera or identify a Zone only by its display name.
- Phase 11 owns analytics calculations. The UI displays their coverage and rankings, not a second scoring algorithm.
- Evidence endpoints require authentication. Fetch authorized media and manage object URLs or an appropriate supported media delivery mechanism. Plain `<img src>` cannot attach an API Bearer header.
- Notifications are recipient-only and read-only. Subscribe through Firebase using the same project/account and the deployed rules. No FCM setup or read receipts.
- Destructive/competing actions must use the backend's revisions and idempotency keys. A 409 needs refreshed state and user review, not repeated blind retries.

## Build sequence and exit checks

### 12.1 Freeze the baseline and list gaps

1. Finish Phase 11 cloud acceptance, clearly recording data-dependent tests not exercised.
2. Commit a recoverable backend checkpoint before the UI merge. The user controls commit/push unless separately requested.
3. Fetch/review the newer main changes, then merge after approval. Record the exact final UI baseline hash.
4. Inventory every page, modal, mutation and missing requirement against V2 endpoint/body/response/permission contracts.
5. Separate wiring work from missing UI. Confirm ownership of any missing System, Bin Analysis, Superadmin or account-management screens before building them.

Exit: one agreed baseline and a page/action checklist. No backend-only push that breaks teammates' main.

### 12.2 Shared API, authentication and media layer

Keep the existing Firebase sign-in and authenticated fetch foundations where useful. Add typed V2 service modules and a role-aware session context. Centralize errors, media loading, request cancellation and idempotency handling. Clear Site/user data and listeners on logout or account change.

Configure the frontend for `litterspot-v2-database/(default)`. The current Vite proxy reads the backend port, now 3000. Check port ownership before starting Vite and avoid an automatic fallback onto another project's port.

Exit: all three account types route correctly; regular/root controls match backend permissions; unauthorized operations cannot leak data. No token, secret or demo account password enters committed source.

### 12.3 Site Map and Cleaner setup

Wire published map reads, draft edits, validation and publishing. Reuse the grid/drawing UI but render actual geometry. Keep historical revision context separate from the active map. Connect Cleaner account creation/profile, Station Points, recurring schedules and overrides. Add Supervisor account controls only where delivered.

Exit: configuration survives reload, overlapping Zones are rejected, Station Points round-trip in metres, and availability follows the backend. Missing visual controls are recorded explicitly.

### 12.4 Camera creation, plotting and monitoring

Wire one Camera creation journey: start Draft, place Camera, obtain reference image/source video, plot floor and bins, save registration, validate, publish. Display validation failures without claiming success. Preserve laptop-first and looped-video monitoring-off defaults.

Use V2 monitoring claim, heartbeat, Camera start, sample and release routes. Own the monitoring session above page-level components if monitoring must survive navigation. Clean up webcam tracks, timers, media URLs and leases on stop/logout. Display local video plus the returned frame overlays; only alerted evidence is persisted by the business workflow.

The current agreed backend samples periodically, initially every two seconds. The user's preference for the richer registration preview should be investigated separately. Do not silently increase inference rate, change alert qualification or make a new per-frame processing commitment during wiring.

Exit: real reference capture and plotting, validation/publish, loop playback and laptop stop all work. Monitoring creates real V2 observations and handles offline/conflicting-session responses.

### 12.5 Alert, Work and Cleaner end-to-end journey

Replace demo Alerts and generated Work with actual reads. Wire evidence/details/history, manual assignment, Work creation, reassignment, takeover, dismissal and verification. Keep camera-linked navigation; preserve a useful target view when manual Work has no Camera.

Wire Cleaner mobile profile/schedule, assigned Work, start and submit-for-review. Completion is not resolution. Apply the actual verification/rework/manual-takeover behavior. Wire recipient-only realtime notifications and refresh affected API data when events arrive. Do not expose Orchestrator internal credentials/tools in the browser.

Exit: Alert waits with no available Cleaner and no Work; assignment creates one real Work; the selected Cleaner receives it; starting, review, rework and resolution update both roles correctly. Repeat with manual coordinate Work and Supervisor intervention. Reloading never invents an assignment.

### 12.6 Dashboard, analytics and System

Wire Phase 11 Dashboard after the operational flows produce meaningful data. Respect its cache and 15-minute window. Bind Bin Analysis to the three equal factors, per-Zone sufficiency, refresh, snapshot-aware implementation and selected-intervention comparison. Show missing/partial dates honestly.

Wire System to Phase 10 status and Phase 9 pause/resume and structured Runs. Distinguish Site configuration from local worker enablement and dependency health. Raw provider reasoning remains developer-only outside the application database.

Exit: UI matches Postman for the same account/data, insufficient analytics do not become fake charts, stale implementations are handled, and regular Supervisors can pause/resume within the existing contract.

### 12.7 Superadmin and cross-role acceptance

Wire delivered separate Superadmin controls for Site creation, first-root setup/recovery, status changes and audit viewing. Do not disguise a Superadmin as a client Supervisor to bypass scoped endpoints. Missing controls remain explicit Phase 13 work unless the scope is expanded.

Exit: cross-Site access is isolated, root/regular differences hold, inactive Site behavior is clear, and supported mutations appear in audit history.

### 12.8 Cutover and handoff

Run backend verification, frontend build, Postman validation and browser journeys. Check empty/loading/error states, double submission, expired sessions, concurrent assignment and camera cleanup. Search runtime frontend imports/network paths for V1 and mock dependencies before removing compatibility endpoints.

Organize tests/docs/scripts and archive legacy material near the end. Keep product UI, API sandbox, inference, training and Orchestrator code separate. Remove files only after confirming they are unused; do not wipe teammate assets or cloud data as cleanup.

The main PR includes the wired delivered UI, V2 backend, deployment/bootstrap instructions, rules/indexes, tests, and a precise Phase 13 UI backlog. A missing feature is not marked complete merely because its API exists.

## Operating rules during integration

- Development project only; no mutation of teammates' shared Firebase without a coordinated cutover.
- Do not merge, commit or push automatically during this planning task.
- Deploy changed development indexes/rules and restart only owned LitterSpot services when implementation requires it. Check ports before touching processes.
- Write a completed brief for each implemented integration step with tests performed, remaining gaps and manual guidance.
- Postman remains the reference for backend behavior. Browser testing proves the frontend uses it correctly.
