# Firestore V2 and backend migration plan

## Goal

Replace the V1 business model with the clarified V2 model in [`README.md`](README.md) and its field dictionaries, while preserving the useful Node/Express, Firebase, FastAPI and Orchestrator foundations.

This migration covers database schema, backend modules, tests, Postman contracts, seed/reset tooling and the later frontend handoff boundary. It does not modify the current product frontend.

## Environment policy

| Environment | Project/database | Migration policy |
| --- | --- | --- |
| Automated tests | `demo-litterspot` emulators | Recreate for every test run |
| Persistent development | `litterspot-dev-jeremy/(default)` | Target for V2 bootstrap and manual API testing |
| Shared production/team project | `litterspot/litterspot` | Never read, reset, write or migrate during this rebuild |

The persistent development project is currently empty. Therefore this is a schema and code migration followed by clean bootstrap, not a V1 document transformation.

If the team later asks to preserve shared-project data, that becomes a separate approved export/transform/import project. Nothing in this plan grants permission to run against it.

## Cutover strategy

Use a clean V2 cutover, not dual writes.

Reasons:

- the development database has no data to preserve;
- the replacement frontend is not integrated yet;
- V1 and V2 disagree on core meanings such as roles, Zone assignment, Alert keys, Work statuses and Cleaner availability;
- dual writes would hide errors by making two incompatible models appear temporarily consistent;
- replay/model-test APIs can remain available without preserving V1 operational workflow.

During implementation, old services and tests may coexist in source control until their V2 replacements pass. Runtime routes switch by completed domain slice. No endpoint may write both V1 and V2 collections.

## Code and collection disposition

### Keep with small extensions

| Current asset | V2 use |
| --- | --- |
| Firebase Admin initialization and target safety | Keep. Add V2 bootstrap/schema checks. |
| Authentication token verification | Keep. Replace role-only checks with `userAccounts` Site and authority loading. |
| Request IDs, safe errors, rate limits, cursor pagination | Keep. |
| Local media storage and integrity checks | Keep. Add purposes, relative keys and V2 retention classes. |
| FastAPI `/analyze/frame` and model loaders | Keep. Node remains the business owner. |
| Camera Registration geometry, preview and revision logic | Keep and adapt to Camera Draft publication/source revisions. |
| Processing Jobs, Analysis Runs and Detections | Keep for replay and model testing, not live operations. |
| Deterministic hashes, idempotency and Firestore transaction patterns | Keep and generalize. |
| Orchestrator outbox, lease and recovery concepts | Keep. Replace data/tool contracts. |
| Structured LLM provider adapters and ID validation | Keep. Extend output from Cleaner-only selection to an Alert and Cleaner pair, then validate both against the Node-supplied context. |
| System-event aggregation | Keep with V2 Site and safety fields. |
| Emulator, unit-test and Postman harnesses | Keep. Replace obsolete scenarios. |

### Keep the collection name but replace its schema

| Collection | Required change |
| --- | --- |
| `userAccounts` | Add Superadmin, Site, authority, profile and active status contract. |
| `supervisors` | Add Site/authority and Root rules. |
| `cleaners` | Remove Zone/capability/GPS presence model. Add schedule, override and atomic active Work pointer. |
| `sites` | Make Site the tenant, add Root, active map pointer and policy settings. |
| `zones` | Keep stable identity only; move geometry into map revisions. |
| `cameras` | Add source/Registration pointers, monitoring control and simulation marker. Remove unregistered active creation. |
| `cameraRegistrations` | Change to active pointer/summary. |
| `cameraRegistrationRevisions` | Add Site/source linkage and immutable V2 metadata. |
| `mediaAssets` | Add purpose, owner, retention and safe storage key. |
| `processingJobs`, `analysisRuns`, `detections` | Mark replay/test boundary and align V2 metadata. |
| `flags` | Persist qualifying live groups with Camera/issue V2 semantics. |
| `alerts` | Camera-scoped key, `bin_service`, new lifecycle, priority/evidence/mode. |
| `activeAlertKeys` | Change natural key from Zone/issue to Camera/issue. |
| `workOrders` | New lifecycle, nullable Alert, target union and Cleaner lock semantics. |
| `activeWorkOrderKeys` | Keep only for one active Work per Alert. |
| `notifications` | Remove push/read/delivery state. Make immutable recipient events. |
| `orchestratorRuns`, `orchestratorOutbox` | New assignment/review episodes, tools and candidate retries. |
| `systemEvents` | Retain safe aggregate health with V2 Site scope. |
| `dashboardSummaries` | Replace old Dashboard contract with V2 metrics/rankings. |

### Add

```text
siteMapDrafts and geometry subcollections
siteMapRevisions and geometry subcollections
identityOperations
siteOperations
cameraDrafts
cameraSourceRevisions
cameraRuntimeStates
monitoringSessions
monitoringEpisodes
orchestratorConfigs
orchestratorRuns/{runId}/attempts
orchestratorRuns/{runId}/actions
auditEvents
operationKeys
analyticsMinuteBuckets
analyticsDailySummaries
binPlacementSnapshots
binPlacementInterventions
workOrders/{workOrderId}/verifications
alerts/{alertId}/events
workOrders/{workOrderId}/events
```

### Retire after replacement tests pass

| V1 collection/concept | V2 replacement or reason |
| --- | --- |
| `cleanerPresence` | Availability derived from schedule, override, account, Station Point and active Work. |
| `cleaners/*/locationHistory` | GPS removed. |
| `cleanerPushTokens` | No FCM/browser push. |
| `cleanerStaffCodes` | Replace with Site-scoped `cleanerStaffCodeKeys`. |
| `cameraCodes` | Camera name and stable ID are sufficient for clarified product. |
| `issueObservations` operational persistence | Live AI Observation stays in memory; qualifying Flags persist. |
| `alertConfirmationStates` / `alertConfirmationResets` | Live temporal windows are bounded in-memory state. |
| V1 Alert `statusHistory` | V2 `events` with explicit event types. |
| V1 Work `statusHistory` / `assignmentAttempts` | V2 Work events and Orchestrator Run attempts. |
| `workOrderDecisions` | `operationKeys`, Run actions and Work events. |
| V1 `reviewRequests` / `reviews` | One V2 `verifications` subcollection. |
| `orchestratorDecisions` | Structured Run, attempts and actions. |
| `analyticsSites`, `generations`, `analyticsReconciliationLocks` | Simpler deterministic minute/daily rebuild flow. |
| `analyticsBuckets` | `analyticsMinuteBuckets`. |
| `analyticsSampleApplications`, `analyticsIncidentApplications`, `analyticsPersistenceStates` | Deterministic buckets and event application fields. |
| `analyticsReports` / `zoneResults` | Live range calculations, daily summaries and replaceable snapshots. |
| `binReplacementRecommendations` / `evaluations` | `binPlacementSnapshots` and `binPlacementInterventions`. |
| public Flag product routes | Flags remain internal traceability under Alert details. |
| Cleaner accept/reject/problem APIs | Not part of V2. |
| notification mark-read and push-token APIs | Not part of V2. |

Retirement means remove runtime writes and public routes first, then remove obsolete indexes and code. Data deletion happens only in the isolated development project after a validated dry run and explicit approval.

## Planned migration tooling

Add scripts under `backend/src/scripts/v2/` during implementation:

| Script | Purpose |
| --- | --- |
| `inspectTarget` | Print project ID, database ID, emulator state, Auth user count, allowlisted collection counts and media root. No writes. |
| `validateSchema` | Check V2 required fields, references, enums, singleton documents and active invariants. |
| `resetApplicationData` | Dry-run by default; delete only allowlisted LitterSpot collections from the isolated target. Media cleanup is a separate flag and path check. |
| `bootstrapDevelopmentSite` | Create Sunway Theme Park, initial map revision, Root account and default configs idempotently. |
| `reconcileAuthProfiles` | Find Auth users without Firestore profiles and profiles without valid Auth users. Repair only with an explicit mode. |
| `rebuildDailyAnalytics` | Recreate selected Site/date daily summaries from retained events/minute data. |
| `verifyCutover` | Run reference, uniqueness, Site isolation, active-key, Cleaner-lock, media and count checks. |

Every mutating script must require:

- exact `APP_ENV`;
- exact expected Firebase project and database;
- matching service-account project;
- explicit `--apply` after a dry run;
- an allowlisted collection set;
- a run ID, progress checkpoint and final report;
- refusal to run against `litterspot/litterspot`.

## Implementation phases

### Phase 0: freeze and safety baseline

Build:

- treat these V2 documents as the contract;
- record current Git status and preserve all teammate/uncommitted work;
- add schema version constants and target-environment guards;
- add `inspectTarget`, `validateSchema` skeleton and collection allowlist;
- snapshot current unit/emulator/Postman results;
- define route deprecation list and V2 API naming.

Tests:

- target guard rejects shared production credentials/database;
- dry-run makes zero writes;
- emulator and existing tests still run before domain changes.

Exit gate:

- exact target is visible in every migration command;
- no migration command can point to shared production accidentally.

### Phase 1: V2 persistence foundation

Build:

- shared timestamps, actor snapshots, points, revisions, idempotency and schema validators;
- Site-scoped repository helpers that require `siteId`;
- transaction retry/conflict helpers;
- common audit-event writer;
- V2 error redaction and Firestore serializers;
- initial V2 indexes in emulator only.

Tests:

- cross-Site resource lookup fails;
- serializer round-trips every embedded type;
- stale revisions and idempotency-key body mismatch fail;
- audit safe maps reject forbidden keys.

Exit gate:

- no new service can query a tenant collection without Site scope.

### Phase 2: identity, Site and Superadmin foundation

Build:

- V2 `userAccounts`, `supervisors`, email reservations and `sites`;
- authenticated principal loader with role, Site and authority;
- Superadmin Site-create plus first-Root saga;
- Root-created Regular Supervisor accounts;
- account deactivation and Root recovery;
- active-Site access gate;
- Superadmin and Root audit queries;
- development bootstrap command.

Reuse:

- Firebase Admin user creation, disable/reconcile and normalized-email patterns from Cleaner V1.

Tests:

- each role/authority capability boundary;
- one Root per Site and self-deactivation protection;
- failed Auth/Firestore saga recovery;
- inactive Site blocks Supervisor/Cleaner APIs;
- every Superadmin mutation records success/failure audit.

Manual test:

- bootstrap Sunway Theme Park and sign in as Root in the API sandbox/Postman auth helper.

Exit gate:

- all later endpoints receive a trusted V2 principal and Site.

### Phase 3: Site Map, Zone identity and Station Points

Build:

- initial empty published map during Site setup;
- map-draft create/read/update/delete/validate/publish;
- polygon bounds, self-intersection, overlap and point containment;
- stable Zone identity;
- map-revision staging, hash verification and pointer switch;
- historical map read model;
- Root/Superadmin permission enforcement.

Tests:

- overlapping/out-of-bounds/self-intersecting Zones fail;
- every point resolves to exactly one Zone;
- stale draft publication fails;
- readers see old or new complete revision, never a mixed map;
- historical Work target remains renderable after dimension change.

Sandbox need:

- create `api-sandbox/` only for map drawing and geometry validation. Do not edit `frontend/`.

Exit gate:

- a Root can publish a valid Sunway Theme Park grid with at least one Zone.

### Phase 4: Cleaner V2

Build:

- direct email/password Cleaner creation saga;
- Cleaner CRUD/deactivation;
- Station Point editing through map revision workflow;
- weekly schedule with overnight ranges;
- Availability Override;
- derived availability service;
- Cleaner self profile/schedule/Station read model;
- remove V1 GPS/presence/capability/Zone assignment runtime dependencies.

Tests:

- schedule boundary, timezone, overnight and daylight-change behavior;
- invalid/missing Station Point makes Cleaner ineligible;
- override and Site/account status exclusions;
- active Work remains assigned after schedule end or override;
- one Cleaner profile per Auth UID and unique Site staff code.

Exit gate:

- available Cleaner candidates come entirely from V2 data and include Station distance inputs.

### Phase 5: composite Camera Creation and Registration

Build:

- Camera Draft create/reconfigure flows;
- first-laptop and one-laptop-per-Site rules;
- looped-video upload/source revision;
- reference capture/media ownership;
- reuse Registration plotting/preview validation;
- atomic publish of Camera, source, Registration and placement revision;
- monitoring enable/disable and structural deactivation;
- source replacement that keeps old source active until publish.

Tests:

- incomplete Camera never becomes operational;
- first Camera rejects looped video and second rejects laptop source;
- looped Camera publishes active but monitoring disabled;
- replacement switches source and Registration together;
- failed publish leaves old source/Registration/map active;
- deactivated/invalid Registration Camera cannot sample.

Sandbox need:

- browser webcam capture, video-frame selection, floor/bin plotting and validation.

Exit gate:

- Sunway Theme Park has one working laptop Camera and a validated optional simulation Camera.

### Phase 6: Monitoring Session and live inference

Build:

- claim/heartbeat/release/failover lease;
- per-Camera Monitoring Episode and sample sequence;
- browser live-sample endpoint;
- sequential/small-queue FastAPI calls;
- Camera Runtime State and safe source errors;
- in-memory observation, temporal, evidence-candidate and minute-aggregate buffers;
- clear simulation memory and restart at video time zero on enable;
- propagate source, map, Registration and simulation metadata.

Tests:

- two browsers cannot submit concurrently;
- lease expiry permits failover;
- stale lease token, sequence, source revision or Registration revision fails;
- hidden Camera visibility does not stop sampling;
- offline timeout and recovery work;
- normal live frames and two-second observations create no Firestore documents;
- replay jobs remain isolated.

Sandbox need:

- multi-Camera loop, ownership indicator, overlays and Camera Runtime State.

Exit gate:

- repeated live samples reach FastAPI and only the planned aggregate/runtime data persists.

### Phase 7: Flag and Alert V2

Build:

- configurable issue gates and temporal windows;
- `bin_service` full/overflow combination;
- Camera-scoped active key;
- highest-confidence evidence retention;
- new Alert lifecycle, priority and severity aging;
- occurrence/event histories;
- paused-Orchestrator Supervisor notifications trigger;
- internal Alert trace endpoint that includes Flags without a public Flag page.

Tests:

- litter 3-of-5, spill 1, bin 2-of-3 defaults;
- full warning escalates same Alert to overflow critical;
- one active Alert per Camera/issue under concurrency;
- different Cameras in one Zone create separate Alerts;
- evidence selection/replacement and media cleanup;
- warning escalates at 15 minutes and priority ordering ages correctly;
- ordinary negative observation never resolves an Alert;
- `isTest` excluded and simulation included with marker.

Exit gate:

- operational Camera samples reliably produce explainable Alerts with retained evidence.

### Phase 8: Work Order and Verification V2

Build:

- atomic Alert assignment and Cleaner reservation;
- manual Camera/coordinate Work creation;
- simplified Cleaner actions;
- Supervisor replacement/takeover/dismissal;
- Completion Evidence upload;
- deterministic Camera Verification collection/application;
- coordinate Supervisor review;
- Alert/Work/Camera/notification state synchronization.

Tests:

- one active Work per Alert and Cleaner under concurrency;
- no unassigned Work document;
- assigned counts as accepted;
- coordinate submit rejects missing photo;
- passed resolves and releases; failed returns same Cleaner to in progress; inconclusive waits;
- Supervisor override requires reason;
- manual takeover blocks stale Orchestrator actions;
- cancel/dismiss linked flow updates both Alert and Work;
- Cleaner authorization exposes only own Work and last five terminal records.

Exit gate:

- full manual workflow works before LLM integration.

### Phase 9: Orchestrator integration

Build:

- V2 Site config, outbox and run model;
- Node scheduler loads at most the top 10 waiting Alerts and the LLM selects one Alert–Cleaner pair;
- five approved private tools;
- context with available Cleaners, Station Point distances, and fresh Recent Work Location distances;
- provider technical retries and candidate exclusion/reservation loop;
- structured Run attempts/actions/decision summary;
- assignment failure and review notifications;
- dev-only rotated raw output files;
- lease recovery and manual/inactive/paused guards.

Reuse:

- teammate Ollama/Gemini adapters, JSON validation and eligible-ID checks;
- existing Node outbox/lease recovery concepts.

Tests:

- no candidates leaves Alert waiting and creates no Work;
- model-selected Alert and Cleaner must both belong to the supplied context;
- pair selection can allocate Cleaners across competing Alerts rather than following nearest-Cleaner-only behavior;
- a fresh resolved Work target is supplied as uncertain returning-to-station context, while stale/different-map history is ignored;
- far Cleaner remains eligible;
- stale selected Cleaner is excluded and another call can succeed;
- each Cleaner reservation is attempted once per Run;
- transport/malformed response follows 1/2/4 second configured retry sequence;
- exhaustion notifies Supervisors with no deterministic fallback;
- paused/manual/inactive state stops mutation;
- review passed/failed actions obey deterministic outcome guardrails;
- live provider smoke test uses an installed pinned model.

Exit gate:

- the teammate agent can assign and review only through Node tools against V2 data.

### Phase 10: notifications, audit, deactivation and system view

Build:

- immutable notification writer and recipient query;
- Firestore recipient-only `onSnapshot` rules;
- remove push tokens, FCM and mark-read endpoints;
- complete administrative audit coverage;
- Site-deactivation operation/reconciliation;
- V2 system event and Orchestrator status read models.

Tests:

- user can read own notifications and cannot read another UID/Site;
- clients cannot write any notification;
- disconnected inbox persists and connected emulator listener receives immediately;
- Site deactivation blocks access immediately, eventually dismisses all active Work/Alerts, releases Cleaners and cannot reopen on reactivation;
- audit maps contain no secrets and Root sees only Site events.

Exit gate:

- real-time delivery and privileged-accountability requirements pass emulator tests.

### Phase 11: analytics, Dashboard and Bin Placement

Build:

- minute accumulator/flush and 90-day expiry;
- daily summary finalization/rebuild;
- operational event application;
- Dashboard counts, top Alerts, Busy Zones, available Cleaners and assigned Work;
- daily/manual Bin Placement snapshot;
- Intervention creation and two-full-day exclusion;
- arbitrary minimum-two-day partial before/after comparison;
- replace V1 hourly reports and bin-replacement policy.

Tests:

- minute merge is idempotent and Site-wide;
- Site-local daily boundaries and overnight timezone cases;
- Dashboard top-three tie rules and resolved fallback excluding dismissed;
- Busy Zone equal 50/50 normalization and tie order;
- Bin Placement equal-thirds ranking;
- requested 30 days with only 7 available reports honest partial coverage;
- Intervention timestamp splits before/after and exclusion spans two complete local days;
- 90-day minute cleanup leaves daily summaries and operational history intact.

Exit gate:

- all Supervisor data screens can be backed by stable API contracts.

### Phase 12: first full frontend integration and atomic V2 cutover

This phase starts only after the frontend team identifies one commit as its complete first-version UI delivery. Until then, `main` may continue using hardcoded data and V1 APIs without being forced onto a partially compatible backend.

Build:

- freeze the Phase 9–11 V2 API contracts before touching page components;
- merge the frontend team's latest `main` into the integration branch;
- inventory every delivered page, modal, hardcoded data source and V1 endpoint;
- add one typed frontend V2 service layer rather than scattering direct `fetch()` calls through components;
- wire every delivered Supervisor, Cleaner and Superadmin surface that has a V2 backend contract;
- preserve the frontend team's visual components and interaction structure while replacing its data wiring;
- remove hardcoded operational data from integrated pages;
- stop every V1 operational collection write after the final frontend consumer moves to V2;
- remove obsolete V1 routes, services, schemas, tests and Postman folders only after replacement coverage exists;
- reorganize the repository at the end of integration, when active and obsolete files can be identified safely;
- replace Firestore indexes and rules with the final validated V2 versions;
- update API examples, setup, runbook, database dictionary and team handoff;
- prepare one combined PR containing V2 backend, Firebase configuration, wired frontend and tests.

Repository organization rules for this phase:

- keep unit tests beside their owning module;
- group backend cross-module integration tests under one consistent integration-test location;
- keep migration, bootstrap, retention and verification scripts under clear `scripts/v2` ownership;
- keep `api-sandbox/` isolated as developer tooling, never as product frontend code;
- move historical V1 plans/dictionaries to a clearly marked documentation archive instead of leaving multiple apparent authorities;
- remove generated build files and local runtime artifacts from tracked paths;
- avoid broad file movement until frontend integration is functionally complete, because early reorganization would create unnecessary merge conflicts with the frontend team.

Verification:

- every delivered page has a documented V2 endpoint/data-source mapping;
- no integrated product page reads hardcoded operational data or calls V1 APIs;
- TypeScript builds for backend, frontend and sandbox;
- full Auth/Firestore emulator suite;
- FastAPI contract/model smoke suite;
- isolated and live installed-model Orchestrator tests;
- V2 Postman end-to-end workflows;
- browser E2E workflows for Superadmin, Root/Regular Supervisor and Cleaner;
- Camera Registration, monitoring, Alert, Work, Verification, analytics and Site-deactivation journeys;
- `verifyCutover` reports zero V2 invariant violations;
- persistent development project contains only expected V2 application state.

Cutover rule:

- do not merge the V2 backend into `main` alone;
- merge only the combined backend and integrated first-version frontend;
- tag or retain the last V1-compatible `main` commit as the rollback point;
- frontend teammates resume new UI work from the first wired V2 commit after the combined PR lands.

Exit gate:

- `main` receives one working V2 system rather than a backend-only breaking change.

### Phase 13: frontend completion iteration

This phase is primarily owned by the frontend team after the first wired V2 release reaches `main`.

Build:

- implement pages, modals and controls omitted from the frontend team's first delivery but already supported by V2;
- wire each new component directly through the frozen V2 service layer;
- add Cleaner mobile and Superadmin surfaces if they were not part of the first delivery;
- add remaining states such as loading, empty, error, offline, inconclusive Verification and no-available-Cleaner;
- keep backend business contracts stable; backend changes are limited to defects or explicitly approved new requirements.

Working model:

- frontend teammates build, wire and test at the same time against the real V2 backend in `main`;
- the backend owner provides contract clarification and fixes integration defects;
- new feature requests are separate changes, not silent alterations to frozen Phase 12 contracts.

Exit gate:

- every approved product surface exists and uses real V2 data.

### Phase 14: final acceptance and release

Build and verify:

- run role-based end-to-end acceptance across the final frontend;
- run extended monitoring demonstrations using laptop and looped-video Cameras;
- calibrate provisional Alert thresholds without changing workflow semantics accidentally;
- complete accessibility, responsive and failure-state checks;
- rerun data-retention, index, rule and environment-isolation checks;
- remove temporary compatibility adapters and obsolete sandbox-only workarounds;
- perform a final small repository cleanup for files introduced during Phase 13;
- publish final setup, demonstration, testing and recovery instructions.

Exit gate:

- the team can demonstrate and test the complete system from a clean setup without relying on undocumented V1 behavior or hardcoded operational data.

## End-to-end acceptance scenarios

### Automated Alert workflow

```text
Root publishes Site Map and Camera Registration
-> Monitoring Session samples Camera
-> FastAPI returns observations
-> Node persists qualifying Flags
-> temporal policy opens Camera-scoped Alert and evidence
-> scheduler loads up to 10 waiting Alerts and all currently available Cleaners
-> Node supplies eligibility, Station distances and fresh Recent Work distances
-> LLM selects one Alert and Cleaner pair
-> Node revalidates both selections
-> Node atomically reserves Cleaner and creates assigned Work
-> Cleaner starts and submits
-> fresh Camera samples create Verification
-> passed resolves Alert/Work and releases Cleaner
-> Dashboard, histories, notifications and analytics agree
```

### Failed cleaning and rework

```text
Cleaner submits
-> Verification fails
-> Orchestrator request_rework
-> same Work returns to in_progress
-> same Cleaner remains busy
-> Cleaner receives rework notification
-> second Verification passes or Supervisor overrides with reason
```

### No Cleaner available

```text
Alert qualifies
-> no Work exists
-> Alert remains waiting_for_cleaner and ages
-> schedule/override/Work resolution makes Cleaner available
-> durable trigger prompts assignment again
```

### Manual coordinate Work

```text
Supervisor chooses map point, Cleaner, title, instructions and severity
-> backend derives Zone and creates assigned manual Work
-> Cleaner starts and uploads one completion photo
-> Supervisor reviews and resolves or returns same Work to in_progress
```

### Site deactivation

```text
Superadmin supplies reason
-> Site access, monitoring and automation stop immediately
-> reconciliation dismisses active Alerts/Work and releases Cleaners
-> immutable audit and workflow histories remain
-> reactivation starts clean and does not reopen prior work
```

## Rollback strategy

Before each phase:

- commit the last passing phase;
- keep migration code idempotent;
- record emulator and persistent-dev validation output;
- avoid destructive cleanup until V2 replacement tests pass.

If a phase fails before development cutover, revert that phase's code and clear/reseed only the emulator. If the persistent development project has been bootstrapped, use the allowlisted dry-run reset and explicit approval before reseeding. Rollback never switches credentials to shared production and never relies on V1/V2 dual-write recovery.

## Definition of migration complete

Migration is complete only when:

- every target collection and field has an implemented schema and repository;
- all authorization uses role, Site and Supervisor authority correctly;
- map publication, Camera Creation, Alert/Work and assignment invariants pass concurrency tests;
- all direct frontend Firestore access is denied except own notifications;
- no runtime code writes retired V1 collections;
- V2 indexes and rules deploy to the isolated development project;
- Sunway Theme Park bootstraps from zero with one Root account;
- automated Alert, manual Work, rework, no-Cleaner and Site-deactivation acceptance scenarios pass;
- Postman, API reference, data dictionary and frontend handoff reflect the same contracts;
- shared production Firebase and current teammate frontend remain untouched.

## First implementation sequence

Start with Phases 0 through 2. Do not build Camera or workflow code before the V2 principal, Site boundary, audit writer and bootstrap are working. Then implement the Site Map and Cleaner model before composite Camera Creation, because both Camera Placement and Cleaner assignment depend on published geometry.
