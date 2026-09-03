# LitterSpot current clarified requirements

> Decisions after 2026-08-30 continue in [`current-clarified-requirements-continuation.md`](current-clarified-requirements-continuation.md) to keep the active discussion document compact.
>
> **Phase 9 scope notice:** Section 7 of the continuation supersedes this document's earlier single-Alert assignment rules. The LLM now selects one Alert and one Cleaner together from a bounded Node-validated context. A fresh resolved Work target may temporarily supplement the Cleaner Station Point while the Cleaner returns.

## 1. Document purpose and authority

This is the living requirements record for the product clarification started on 2026-08-29. Update it as decisions are made.

When this document conflicts with older proposal, PRD, baseline, architecture, or implementation-plan documents, this document represents the newer product requirement. Older documents remain useful for source history and current-code assessment.

Requirement labels:

- **Confirmed**: explicitly agreed during the current clarification.
- **Proposed**: recommended direction that still needs confirmation.
- **Open**: unresolved question.
- **Existing**: current implementation fact, not automatically a product requirement.

This document describes required product behaviour. A later backend gap analysis will compare it with the implemented system and decide what to keep, change, retire, or build.

## 2. Product boundary

**Confirmed** LitterSpot is a multi-client cleanliness-operations platform for tourist attractions and similar venues.

**Confirmed** Each client is represented by exactly one Site. The Site is both the tenant boundary and the physical venue; there is no separate Client Organization entity in the first version.

Commercially related venues with separate operational teams are separate Sites and tenants. For example, Sunway Lagoon and Lost World of Tambun are separate Sites even if both are commercially associated with Sunway Group.

**Confirmed** The system has three human user types:

1. LitterSpot Superadmin.
2. Client Supervisor.
3. Cleaner.

**Confirmed** The Orchestrator is a service actor, not a fourth human user type.

## 3. Tenancy and account requirements

### 3.1 Site tenant boundary

**Confirmed** Creating a client means creating a Site.

**Confirmed** All tenant-owned operational records use `siteId` and remain isolated from every other Site. This includes Supervisors, Cleaners, maps, Zones, Cameras, registrations, observations, Flags, Alerts, Work Orders, analytics, notifications, and Orchestrator configuration. A separate `clientId` is not required.

### 3.2 LitterSpot Superadmin

**Confirmed** The LitterSpot Superadmin:

- creates Sites;
- creates the first Client Supervisor account;
- can recover a client that has lost access to its root account.

**Confirmed** Creating a Site is one setup workflow containing:

- Site/client name;
- Site timezone;
- initial Site Map dimensions and optional background;
- first Root Supervisor email and password.

**Confirmed** The Superadmin can access all operational data and Root Supervisor capabilities for any selected Site.

The Superadmin interface has a Site selector. After selecting a Site, the Superadmin can enter the same operational pages and perform the same actions as that Site's Root Supervisor. Superadmin actions retain the Superadmin actor identity in audit history.

**Confirmed** The Superadmin can deactivate an entire Site. Deactivation blocks all Site Supervisor and Cleaner access, stops new monitoring and Orchestrator actions, and preserves historical records.

**Confirmed** Site deactivation is allowed even when active Alerts or Work Orders exist. The backend does not block deactivation on unfinished operations.

**Confirmed** Deactivating a Site atomically changes its active Alerts and Work Orders to `dismissed` with system reason `site_deactivated`, releases busy Cleaners, stops pending Orchestrator runs, and records the transition history. Reactivation does not reopen those dismissed operations.

**Confirmed** An inactive Site can be reactivated by the Superadmin.

**Confirmed** The Superadmin can reset, replace, or recreate a Site's Root Supervisor account for recovery.

**Confirmed** The Superadmin uses a separate Superadmin application area containing Superadmin-specific navigation, pages, and controls. It is not the Client Supervisor UI with an elevated role applied.

The simple first-version Superadmin area includes:

- platform overview;
- Site list and active/inactive status;
- create Site workflow;
- selected Site administration;
- Root Supervisor recovery;
- Site activation/deactivation;
- Superadmin audit history.

**Confirmed** The separate Superadmin interface does not perform daily operational actions such as dismissing Alerts, manually assigning or replacing Cleaners, resolving Work Orders, or overriding Verification. Those actions remain in the Client Supervisor product area.

Superadmin Site administration may still perform structural changes that overlap Root authority, such as creating/deactivating Zones or Cameras, and those changes are audited as Superadmin actions.

**Confirmed Superadmin audit requirement** Every privileged Superadmin action performed against or on behalf of a Site must create an immutable Superadmin Audit Event.

Audit data includes:

- Superadmin Firebase UID and display snapshot;
- selected `siteId` and Site name snapshot;
- action name;
- affected resource type and ID;
- safe before/after summary for mutations;
- required reason where applicable;
- server timestamp and request ID;
- success or failure outcome.

Superadmin Audit Events cannot be edited or deleted through the application.

**Confirmed** Read operations are not audit events. Site selection, list/detail views, Dashboard refreshes, and Alert Evidence reads do not create Superadmin Audit Events.

**Confirmed** Every Superadmin mutation or operational/structural change is audited, including account changes, Site activation/deactivation, Site Map changes, Zone changes, Camera changes, Cleaner changes, and configuration changes.

**Confirmed** The Site's Root Supervisor can view Superadmin Audit Events affecting that Site. Regular Supervisors do not receive this audit view unless this permission is added later.

### 3.3 Client Supervisor authority

**Confirmed** The first Client Supervisor created by the Superadmin is the Root Supervisor.

**Confirmed** The Root Supervisor creates all additional Supervisor accounts. Regular Supervisors cannot create Supervisor accounts.

**Confirmed** A new Supervisor account is created with an email and password chosen during creation. There is no email-invitation flow and no forced first-login password change. The password remains valid until the account holder changes it.

**Confirmed** Plaintext passwords must never be stored in Firestore, application logs, or audit records.

**Confirmed** Only the Root Supervisor controls critical Site Map configuration, including Site dimension changes and map-draft publication or deletion.

**Confirmed** Regular Supervisors can perform Camera Registration and re-registration.

**Proposed** Root account protections:

- only one active Root Supervisor per Site;
- the Root Supervisor cannot deactivate itself;
- Regular Supervisors cannot modify or deactivate the Root Supervisor;
- root transfer or replacement is an audited Superadmin action;
- the final active Supervisor cannot be removed without recovery.

Confirmed capability matrix:

| Capability | Root Supervisor | Regular Supervisor |
| --- | ---: | ---: |
| View Site operations, Dashboard, history, and analytics | Yes | Yes |
| Create, edit, and deactivate Supervisor accounts | Yes | No |
| Configure Site dimensions or background | Yes | No |
| Create, edit, publish, or delete Site Map drafts/revisions | Yes | No |
| Create, reshape, or deactivate Zones | Yes | No |
| Add, move, or deactivate Cameras on the Site Map | Yes | No |
| Register or re-register Camera floor/bin geometry | Yes | Yes |
| Create, edit, or deactivate Cleaners | Yes | Yes |
| Plot or update Cleaner Station Points | Yes | Yes |
| Configure Cleaner recurring schedules | Yes | Yes |
| Set or clear Cleaner Availability Overrides | Yes | Yes |
| View and manage Alerts | Yes | Yes |
| Create manual Work Orders | Yes | Yes |
| Manually assign or replace Cleaners | Yes | Yes |
| Dismiss Alerts and related Work Orders | Yes | Yes |
| Override Verification with a required reason | Yes | Yes |
| View Orchestrator decisions and logs | Yes | Yes |
| Pause or resume the Orchestrator | Yes | Yes |

**Confirmed** Orchestrator pause/resume is a reversible daily operational control and does not require the Root Supervisor. All Supervisors can use it, and every change is audited.

### 3.4 Cleaner

**Confirmed** A Cleaner is a mobile-web user who signs in, receives assigned cleaning work, performs the physical work, updates progress, and submits the work for review.

**Confirmed** A Supervisor assigns each Cleaner one fixed Station Point on the Site Map when creating the Cleaner.

**Confirmed** The Orchestrator uses the Station Point for distance-based assignment. When a Cleaner is available, the system assumes that the Cleaner is near their Station Point.

**Confirmed** Cleaner GPS, continuous location tracking, phone coordinates, and location history are not required.

Cleaner Station Point rules:

- the point must lie inside the active Site Map boundary;
- the point may be inside a Zone or an unzoned part of the Site Map;
- the backend may derive the nearest active Zone and its shortest boundary distance as display context only;
- an invalid or missing Station Point makes the Cleaner ineligible for automated assignment;
- Station Point changes are audited.

**Confirmed** Cleaners have no assigned-Zone or allowed-Zone restrictions. Every on-duty available Cleaner in the Site can be considered for every Work Order.

**Confirmed** Distance from Station Point to Work target is a ranking factor, not an eligibility cutoff. If no nearby Cleaner is available, a farther available Cleaner must still be eligible for assignment.

**Confirmed** Cleaner availability is controlled by Supervisors through Cleaner scheduling. Cleaners do not manually set themselves online, offline, available, or unavailable.

**Confirmed** Schedules recur weekly and are configured per Cleaner rather than applying one fixed schedule to everyone.

**Confirmed** A schedule entry has no shift name or category. It stores only the working time range for that Cleaner and weekday.

**Confirmed** A Cleaner can have at most one working time range for each calendar day and may have different times on different recurring weekdays.

**Confirmed** Root and Regular Supervisors configure Cleaner working time ranges directly and can choose any valid start and end time.

**Confirmed schedule edge cases**:

- a working time range may cross midnight;
- an overnight range belongs to the weekday on which it starts;
- all schedule calculations use the Site timezone;
- Work assigned before scheduled time ends remains assigned after the schedule ends until it resolves or is dismissed;
- setting an Availability Override to unavailable while a Cleaner is busy prevents future assignments but does not change or cancel current Work.

**Confirmed** Leave does not require a leave workflow, reason type, or additional Cleaner status. A Supervisor uses an Availability Override to mark the Cleaner unavailable and later makes them available again.

**Confirmed** The system marks a Cleaner `busy` when a Work Order is assigned. When that Work Order resolves or is dismissed, the system recalculates availability from the Cleaner Schedule rather than always setting `available` blindly.

**Confirmed** One Cleaner can hold at most one active Work Order in the first version.

**Confirmed** The prototype requires durable in-app notifications with immediate delivery to connected LitterSpot clients through a Firestore real-time listener. Browser/operating-system push, SMS, and email are not required.

Initial Cleaner notification events include:

- Work Order assigned;
- rework required after failed Verification;
- Work Order resolved;
- Work Order dismissed.

**Confirmed** Immediate delivery and durable inbox storage are separate requirements. A connected client receives the event immediately; a disconnected client sees the persisted notification after signing in again.

**Confirmed** Notification read tracking is not required. The system does not need read receipts, unread state, acknowledgement, or proof that a Cleaner opened the notification. Delivery to a connected client or later availability in the durable inbox is sufficient.

**Confirmed notification trust boundary** Node creates notification documents through the Admin SDK. The frontend receives a narrowly scoped, read-only Firestore `onSnapshot` subscription for notification documents addressed to the signed-in user. Firebase Security Rules deny reads of another user's notifications and deny all direct frontend notification writes.

This is the only currently approved direct application-data Firestore read from the frontend. It does not grant frontend access to Alerts, Work Orders, Cleaners, Cameras, analytics, or other operational collections.

**Confirmed** Cleaners do not have a Report Problem, blocked, decline, reject, or cannot-find action in the first version.

The Cleaner-facing Work Order actions are limited to:

- view assigned Work Order;
- move `assigned` to `in_progress`;
- move `in_progress` to `awaiting_review` by submitting work as complete.

Cleaner Work Order Details shows:

- issue type, severity, instructions, Zone, and target position;
- annotated Alert Evidence for Camera-linked Work;
- Site Map target and Camera identity when available;
- current Work status and Verification result;
- actions allowed for the current status.

**Confirmed completion-evidence rules**:

- Camera-linked Alert Work does not require a Cleaner photo because fresh Camera Verification provides post-cleaning evidence;
- coordinate-targeted manual Work requires one Cleaner Completion Evidence photo when it is submitted for Supervisor review;
- the completion photo is stored with the Work Order and remains visible in its history;
- the Supervisor makes the final decision for coordinate-targeted manual Work.

**Confirmed** Cleaner mobile shows the Cleaner Schedule and Station Point as read-only information.

**Confirmed** Cleaner mobile shows only the latest five resolved or dismissed Work Orders. The full durable history remains available to Supervisors and backend audit APIs.

If the Cleaner cannot see the issue or believes it is already gone, they still submit the Work Order for review. For Alert-driven work, Camera Verification and the Orchestrator or Supervisor determine whether it resolves or returns for rework. For coordinate-only manual work, the Supervisor reviews it manually.

**Confirmed** Notification retention length is not a product requirement for the prototype. Choose a reasonable configurable implementation default later without affecting Work Order history.

## 4. Client Supervisor product area

### 4.1 Dashboard

**Confirmed** The Client Supervisor dashboard contains:

- number of Zones;
- number of Cameras;
- number of Cleaners;
- Alert counts;
- Work Order counts;
- Orchestrator status;
- top three Alerts;
- top three busy Zones;
- available Cleaners;
- currently assigned work.

**Confirmed Top Alerts ranking**:

1. When unresolved Alerts exist, show the three highest `priorityScore` values; use oldest creation time when scores tie.
2. When no unresolved Alerts exist, show the three most serious past Alerts as a historical fallback.

**Confirmed** Use resolved past Alerts for the fallback and exclude dismissed Alerts because dismissal may indicate a false or non-actionable detection. Sort by highest recorded severity, then most recently resolved.

**Confirmed Busy Zone meaning** A busy Zone combines:

- visitor pressure from Camera people counts;
- cleaning workload from Work Orders.

Busy Zone is not people count alone.

**Confirmed Busy Zone calculation**:

- visitor pressure uses the rolling average people count from online Zone Cameras over the latest 15 minutes;
- cleaning workload uses current Work Orders in `assigned`, `in_progress`, or `awaiting_review`;
- visitor pressure contributes 50 percent of the normalized score;
- active cleaning workload contributes 50 percent of the normalized score;
- warning Work Orders contribute 1 workload point and critical Work Orders contribute 2 workload points;
- rank the highest three Zones.

The 15-minute window means the current time minus 15 minutes and updates continuously while monitoring data arrives.

If two Zones have the same Busy Zone score, rank them by:

1. higher severity-weighted active Work Order points;
2. more qualifying cleanliness issues observed during the latest 15 minutes;
3. higher recent visitor pressure;
4. Zone name for a deterministic final order.

### 4.2 Zone and Camera management

**Confirmed** The page combines:

- Site Map viewing and configuration;
- Zone creation through polygon plotting;
- Camera placement inside Zones;
- Camera creation and configuration;
- live camera views filtered by Zone;
- navigation to Camera Details.

**Confirmed** Camera Creation is one guided workflow. It includes:

1. Camera name and metadata;
2. Site Map position and backend-derived Zone;
3. source configuration;
4. reference image or captured video frame;
5. walkable-floor plotting;
6. optional physical-bin plotting;
7. Registration validation;
8. final creation and initial Registration publication.

There is no user-facing workflow that creates an operational Camera first and asks the user to register it later. Until the final step succeeds, the work is a non-operational creation draft and cannot monitor, sample, affect analytics, create Flags, or create Alerts. Cancelling the draft creates no operational Camera.

### 4.3 Camera Details

**Confirmed** Camera Details contains:

- a large live-monitoring view;
- Camera name and Zone;
- Camera connection status;
- current cleanliness condition;
- active cleaning assignment when present;
- Alert and cleaning history;
- a **View assignment** action when cleaning is underway.

**Confirmed** Camera connection status and cleanliness condition are separate concepts.

Initial connection states:

- `online`;
- `offline`.

Initial cleanliness conditions:

- `clean`;
- `alerted`;
- `cleaning`;
- `awaiting_review`.

“Resolved” is an Alert or Work Order history outcome, not a current Camera connection status.

### 4.4 Alert management

**Confirmed** Alert Management contains:

- summary metric cards;
- status and severity filters;
- an Alert table;
- a small Alert Evidence thumbnail in each row;
- navigation from a row to Alert Details.

**Confirmed** Alert Details contains:

- the stored camera snapshot with AI geometry overlaid;
- Alert metadata;
- current status;
- Camera and Zone context;
- assigned Cleaner details when available;
- history and related work information.

Alert Details focuses on a retained incident snapshot. Camera Details focuses on the changing live view.

### 4.5 Work Order management

**Confirmed** Work Order Management contains:

- summary metric cards;
- status filters;
- a Work Order table;
- the assigned Cleaner thumbnail when available;
- navigation to detailed monitoring and history.

**Confirmed** Work Orders have two origins:

1. Alert-driven work created through the automated workflow.
2. Manually created work for a condition noticed by a Supervisor before any AI Alert exists.

### 4.5.1 Manual Work Order creation

**Confirmed** A manual Work Order has `origin=manual`, `managementMode=manual`, and no Flag or Alert relationship.

The Supervisor must provide:

- short title;
- instructions or description;
- severity: `warning` or `critical`;
- target: Camera or Site Map coordinate;
- one currently available Cleaner.

Manual Work Order creation and Cleaner reservation are atomic. If the selected Cleaner is no longer available, no Work Order is created and the Supervisor selects another Cleaner.

**Confirmed** Optional creation evidence can be:

- a Supervisor-uploaded photo;
- a snapshot captured from the selected Camera;
- no evidence.

Evidence is optional because manual Work can be created outside Camera coverage.

**Confirmed** Manual Work Orders can target a map coordinate without a Camera.

**Confirmed** A coordinate target must fall inside exactly one active Zone; the backend derives the Zone from the point.

**Confirmed** A manual coordinate-targeted Work Order has no Camera Verification. A Supervisor reviews and resolves it manually.

**Confirmed** A Camera-targeted manual Work Order may run deterministic Camera Verification as advisory decision support. The result never automatically resolves or returns the manual Work Order for rework; the Supervisor applies the final decision.

**Confirmed** Manual Work uses the same visible lifecycle:

```text
assigned
→ in_progress
→ awaiting_review
→ resolved
```

It may become `dismissed` by a Supervisor. It never enters Orchestrator assignment or automatic review.

**Confirmed navigation** There is no dedicated Work Order Details page in the first version.

- clicking Camera-targeted Work opens the related Camera Details page, which shows the active assignment, Cleaner, status, evidence, and Work history alongside live monitoring;
- clicking coordinate-targeted manual Work opens a compact inline or modal detail from the Work list, showing the Site Map target, Cleaner, evidence, status, history, and Supervisor actions.

**Confirmed** Work Orders do not have a separate due date or deadline. Alert age, severity, priority, and current status express operational urgency.

**Confirmed** Node generates Alert-driven Work titles and instructions deterministically from trusted Alert, Camera, Zone, and registered-bin data. The LLM does not write cleaning instructions.

Initial deterministic instruction patterns:

```text
floor_litter → Clean floor litter at {cameraName}, {zoneName}
floor_spill  → Clean floor spill at {cameraName}, {zoneName}
bin_service  → Service {affectedBinNames} at {cameraName}, {zoneName}
```

### 4.6 Cleaner management

**Confirmed** Cleaner Management contains:

- summary metric cards;
- Cleaner-status filters;
- a Cleaner table;
- Cleaner thumbnail;
- current availability;
- Supervisor-managed schedule;
- current Zone and assigned work;
- an editable details modal opened from a row.

### 4.7 Bin analysis

**Confirmed** Bin Analysis has two major sections.

The top section ranks Zones by priority for bin placement.

**Confirmed** A recommendation identifies only a priority Zone. It does not recommend an exact map coordinate because the available AI and operational data cannot support that precision.

**Confirmed** The Zone priority score uses three equally important normalized factors:

- people activity;
- cleaning frequency;
- bin-service Alert frequency.

Each factor contributes one third of the score. This is analytics logic and does not require another trained model.

**Confirmed** Cleaning frequency is the number of resolved Work Orders in the Zone during the selected ranking period. It includes both Alert-driven and manually created Work Orders.

**Confirmed** Recommendations are calculated output, not stored records with a `pending` status. The leaderboard keeps changing as new daily analytics become available and as the Supervisor requests a different ranking period.

**Confirmed** Clicking **Implement** is the persistence event. It creates one implemented Bin Placement Intervention containing:

- Zone identity and name snapshot;
- server-controlled implementation timestamp;
- selected ranking period in days;
- the three factor values, normalized values, equal weights, total score, and rank shown when implemented;
- Supervisor actor and Site Map revision.

There is no separate pending recommendation record.

**Confirmed update cadence** Rebuild the cached recommendation leaderboard once per Site local calendar day from completed aggregates. If the backend was offline at the scheduled time, recompute stale results when it starts or when the page next requests them.

**Confirmed** A Supervisor can manually refresh recommendations at any time. Refresh recalculates from currently available aggregates using the Supervisor's freely selected ranking period. It does not bypass data-sufficiency or post-implementation exclusion rules.

**Confirmed** After a Zone recommendation is implemented, exclude that Zone from new recommendations for two complete Site-local calendar days while initial after-data is collected. Manual refresh does not remove this exclusion.

**Confirmed** A Zone can have multiple Bin Placement Interventions over time. The comparison page selects the latest Intervention by default and allows Supervisors to view older Intervention history separately.

The bottom section contains two before-versus-after line-graph comparisons:

- cleaning frequency over time;
- bin-overflow frequency over time.

**Confirmed** When a Supervisor marks a recommendation as implemented, the backend automatically creates a Bin Placement Intervention using the authoritative server timestamp. The Supervisor does not manually enter the effective date.

The Intervention timestamp separates before and after data.

**Confirmed** The Supervisor enters any whole-number comparison range of at least 2 days. The UI does not force presets such as 7, 14, or 30 days. Examples include 3, 7, 9, 11, or 30 days.

For a requested range of `N` days:

- the before period requests up to `N` days ending immediately before the Intervention;
- the after period requests up to `N` days beginning at the Intervention;
- when fewer than `N` after-days exist, show all available after-data and clearly label the current coverage;
- the graph builds toward the requested range as new days become available;
- missing historical before-data is also shown as partial coverage rather than fabricated or silently padded.

Example:

```text
Requested comparison: 30 days
Intervention age: 7 days
Displayed coverage: up to 30 days before versus 7 available days after
```

### 4.8 System page

**Confirmed** The System page presents:

- Orchestrator current status;
- decision explanations;
- action and error logs;
- pause/resume control.

**Proposed** Store structured decision explanation, inputs, selected candidate, scoring factors, outcome, and tool actions rather than depending on raw hidden chain-of-thought text.

## 5. Site Map and location model

### 5.1 Map coordinate system

**Confirmed** The Site uses one two-dimensional map. Multiple floors or levels are out of scope.

**Confirmed** The Site Map is a grid-based coordinate plane created inside LitterSpot. It does not use Google Maps, another maps API, GPS coordinates, or external routing.

**Confirmed** The Root Supervisor or Superadmin chooses approximate Site width and height. Distances do not need survey-grade accuracy.

**Confirmed** Coordinates represent approximate real distance. The grid and all positions derive from the configured Site dimensions.

**Proposed** Store canonical coordinates in metres and use approximate Euclidean distance for nearest-Cleaner comparisons.

### 5.2 Background

**Confirmed** The grid background can be plain or use an uploaded floor-plan or Site image supplied by the client during Site Map configuration.

**Confirmed** The grid coordinate system remains authoritative; the background is visual guidance.

### 5.3 Site Map revisions

**Confirmed** Changing Site dimensions means reconfiguring all Zone geometry and Camera map positions.

**Confirmed** Historical operational data must retain the earlier map context.

**Agreed direction** Site Map changes use draft and immutable published revisions:

```text
Active revision
→ Root Supervisor starts a draft
→ dimensions/background configured
→ Zones redrawn
→ Cameras repositioned
→ Cleaner Station Points replotted
→ draft validated
→ Root Supervisor publishes
→ previous revision becomes historical
```

**Confirmed** Only the Root Supervisor can create critical map reconfiguration, publish a draft, or delete a draft.

**Confirmed** Existing Work Orders remain tied to the map revision and coordinate snapshot under which they were created.

**Confirmed** Changing map dimensions does not automatically invalidate the Camera's pixel-space floor and bin registration. Camera re-registration is required only when the physical Camera or view changes.

### 5.4 Zones

**Confirmed** A Zone is a polygon within one Site Map Revision.

Zone rules:

- polygons stay inside the Site boundary;
- active Zone polygons cannot overlap;
- a Camera point belongs inside exactly one active Zone;
- one Zone can contain multiple Cameras;
- Cleaner Station Points may be inside Zones or unzoned parts of the Site Map;
- coordinate-targeted Work Orders must fall inside exactly one active Zone;
- deactivated Zone geometry remains available for historical records;
- deactivated Zones cannot receive new Cameras, Cleaner assignments, or Work Orders.

### 5.5 Camera Placement and Camera Registration

**Confirmed** Camera Placement and Camera Registration are separate.

Camera Placement is the physical point on the Site Map and determines the containing Zone.

Camera Registration is the image-space configuration containing:

- a clean reference image or captured video frame;
- visible walkable-floor polygon;
- optional physical-bin polygons;
- stable physical-bin identifiers and bin types.

**Confirmed** Although Placement and Registration are different data concepts, initial Camera Placement and initial Camera Registration are completed together inside Camera Creation.

**Confirmed** Re-registration is a later workflow for an existing Camera when its physical view, source video, floor region, or visible bins change. Root and Regular Supervisors may re-register an existing Camera without changing its Site Map position.

**Confirmed** Replacing a looped Camera's simulation video requires a new reference and new floor/bin plotting. The old Registration cannot be applied to the replacement scene. The replacement is not published until the new Registration validates.

## 6. Prototype live monitoring

### 6.1 Sources

**Confirmed** The prototype uses:

- one hardcoded laptop webcam source;
- multiple fake Camera sources backed by local videos that loop continuously.

**Confirmed bootstrap rule** The first Camera created for a Site is forced to use the `laptop_camera` source. The first-version product permits only one laptop Camera per Site.

**Confirmed** Subsequent prototype Cameras use `looped_video`. The Root Supervisor selects or uploads the simulation video during Camera creation.

**Confirmed safe creation rule** A looped-video Camera does not exist operationally until its video is available and its initial Camera Registration validates. Completing Camera Creation publishes the Camera and Registration together; there is no temporary active, unregistered Camera.

**Confirmed** Monitoring is browser-driven and does not need to continue after the monitoring page or browser is closed.

The browser:

- opens the laptop webcam through browser media access;
- plays fake Camera videos in a loop;
- periodically captures JPEG frames;
- submits frames to Node for analysis.

**Confirmed** Zone filtering affects only which Camera cards are visible. Every active Camera source continues playing and sampling in the background while the owning Monitoring Session remains open.

### 6.2 Sampling

**Confirmed** AI analysis runs periodically rather than on every video frame.

**Confirmed** Start with a two-second interval and evaluate whether it works well enough. Keep the interval configurable.

**Proposed** Process sampled Camera frames sequentially or through a small queue to avoid concurrent GPU overload.

### 6.3 Monitoring lifecycle

**Confirmed** A browser Monitoring Session identifies the active page session and sends frame/heartbeat activity.

**Confirmed single-owner rule** Only one active Monitoring Session owns Camera capture and frame submission for a Site at a time. Other connected Supervisor browsers may view current results and statuses but do not submit duplicate Camera frames.

The owner renews a backend lease through heartbeats. If the owner closes, disconnects, or stops renewing, the lease expires and another open Supervisor browser automatically claims monitoring. Ownership changes are audited and do not create a second concurrent capture owner.

**Confirmed** When browser frame activity stops and a timeout expires, the affected Camera becomes `offline`.

**Confirmed** The laptop Camera becomes `offline` when browser Camera permission is denied, the device is unavailable, or capture stops. A looped-video Camera becomes `offline` when its configured video cannot load, decode, play, or provide frames. Camera Details shows a safe source error without exposing local filesystem paths.

AI-service availability and Orchestrator availability are System-page statuses, not additional Camera connection states.

## 7. AI observation and storage rules

### 7.1 Required model signals

**Confirmed** The current operational signals are:

- floor litter;
- floor spill;
- bin full;
- bin overflow;
- people count.

People count is analytics-only and does not create a cleaning Alert.

**Existing model capability** The current bin-state inference contract returns `normal`, `full`, `overflow`, or `unknown` and exposes separate fullness and overflow signals. The reliability of `full` on the team's finalized checkpoint still needs practical validation.

**Confirmed** The product requirement supports both full and overflowing bins because both require action. The full-bin condition must remain independently configurable so it can be disabled without disabling overflow if prototype validation shows that full-bin output is unreliable.

### 7.2 Media retention

**Confirmed** Do not persist normal sampled frames or continuous footage.

**Confirmed** Persist Alert Evidence only.

**Confirmed** When several qualifying frames contribute to an Alert, retain the highest-confidence qualifying frame.

**Proposed** Keep a small in-memory rolling frame buffer per Camera. Once an Alert is confirmed, persist the selected frame and release unnecessary buffered images.

**Confirmed** Persist lightweight numeric observation summaries needed for visitor, Zone, cleaning-frequency, overflow-frequency, and system-health analytics even when the image is discarded.

**Confirmed analytics write reduction** Individual two-second sample summaries are not persisted as separate Firestore documents. Node keeps current live sample data in memory and writes one Site-wide minute analytics bucket containing per-Zone aggregates.

**Confirmed** Minute analytics buckets are retained for 90 days and then automatically deleted. Alerts, Alert Evidence, Work Orders, histories, and audit records are separate operational records and are not deleted with expired minute buckets.

**Confirmed** Persist one compact Site-wide daily analytics summary containing per-Zone values for the full prototype lifetime. This supports long Supervisor-selected analysis ranges after minute buckets expire.

**Confirmed** Flags, Alerts, Alert Evidence, Work Orders, Completion Evidence, histories, and audit records are retained for the full prototype lifetime.

### 7.3 Alert Evidence

**Confirmed** Alert Evidence should retain enough information to reconstruct the annotated snapshot:

- original frame;
- image dimensions;
- normalized boxes and polygons;
- Camera Registration revision;
- model versions;
- capture time;
- issue type and confidence;
- affected registered-bin identities when applicable.

**Proposed** Store the original frame and structured geometry rather than a permanently rendered annotated copy. The frontend renders overlays for thumbnails and Alert Details.

## 8. Alert qualification

### 8.1 Meaning and scope

**Confirmed** An Alert means the condition has crossed a threshold where cleanup is needed. One model output does not automatically become an Alert.

**Confirmed** One active Alert is scoped by Camera and issue type.

**Confirmed** Alert qualification thresholds remain configurable because model behaviour will be calibrated during prototype testing.

**Confirmed internal qualification chain**:

```text
AI Observation
→ issue detections grouped for one Camera sample
→ confidence, magnitude, and issue-specific qualification
→ internal Flag persisted when the sample group qualifies
→ temporal Alert policy evaluates recent Flags
→ Alert created or updated when the required Flag pattern is satisfied
```

A Flag is an internal persisted policy and audit record. It contains the Camera, issue type, contributing detection references, qualification metrics, policy version, model versions, and capture time.

**Confirmed** There is no separate Flag page in the Client Supervisor frontend. Flag information appears only inside Alert details, technical traceability, and audit views when useful.

### 8.2 Current signal rules

**Confirmed** Floor litter initially requires repeated positive observations. The team may change it to one qualifying observation if repetition does not work well.

**Confirmed** Floor spill can create an Alert from one qualifying observation because of its safety significance.

**Confirmed** Bin full and bin overflow require qualification thresholds before becoming cleanup Alerts.

**Confirmed provisional prototype defaults**:

- floor litter: 3 positive samples in the latest 5, plus confidence and dirty-magnitude gates;
- floor spill: 1 qualifying observation;
- bin full: 2 matching samples in the latest 3;
- bin overflow: 2 matching samples in the latest 3.

These are calibration defaults, not permanent business rules. The team will test them with the two-second sampling interval and revise them when evidence shows that they are too sensitive or too slow.

**Confirmed** Represent full and overflow as one `bin_service` Alert issue with observed condition `full` or `overflow`. Escalate the same Alert from warning to critical instead of creating two Alerts as the condition worsens.

The initial severity mapping is full = warning and overflow = critical.

### 8.3 Resolution and visibility

**Confirmed concern** A normal or negative Camera observation does not prove that the Alert workflow is resolved. Occlusion, blur, lighting, model misses, or temporary movement can hide the issue.

**Confirmed** Separate current visibility from workflow resolution. Ordinary monitoring may record that an issue is not currently visible, but never silently resolves the Alert.

**Confirmed** Resolve only through explicit post-cleaning Verification, an audited Orchestrator decision, or a Supervisor override.

**Confirmed provisional Verification defaults**:

- floor litter: 3 consecutive fresh samples with no qualifying litter;
- floor spill: 2 consecutive fresh samples with no qualifying spill;
- bin service: 2 consecutive fresh samples where affected bins are normal.

Verification outcomes:

- `passed`;
- `failed`;
- `inconclusive`.

**Confirmed** Offline Camera, AI failure, occlusion, `unknown`, `review`, or insufficient samples produce `inconclusive`, not resolution.

**Confirmed** A Supervisor can dismiss a false detection or override Verification with a required reason and audit entry.

**Confirmed direction** The Orchestrator may decide whether verified cleaning resolves the Alert or requires rework. It must act through controlled backend tools, record its decision explanation and evidence references, and remain overridable by a Supervisor.

**Confirmed Orchestrator guardrails for the first version**:

- `passed` may resolve the Alert and complete the Work Order;
- `failed` returns the Work Order for rework;
- `inconclusive` remains awaiting review or escalates to a Supervisor;
- the Orchestrator cannot silently resolve an Alert from ordinary monitoring outside an explicit review request.
- the Orchestrator cannot override deterministic `failed` or `inconclusive` Verification;
- only a Supervisor can override `failed` or `inconclusive`, with a required reason and audit entry.

**Deferred** VLM-based post-cleaning review and VLM authority are not part of the near-term version. They can be reconsidered later without changing the initial deterministic Verification contract.

### 8.4 Alert-to-work creation

**Confirmed** An Alert does not immediately create a Work Order when no eligible Cleaner is available.

The Alert remains active in a waiting-for-Cleaner condition:

```text
Alert qualifies
→ eligible Cleaner query returns none
→ no Work Order is created
→ Alert waits
→ Cleaner availability changes
→ Orchestrator is prompted again
→ LLM selects from the newly eligible Cleaners
→ backend atomically reserves one Cleaner and creates the assigned Work Order
```

**Confirmed** There is no `unassigned` Work Order for this flow. Waiting belongs to the Alert.

**Proposed retry triggers**:

- a Cleaner enters a scheduled working period or becomes available;
- a Cleaner finishes or is released from another Work Order;
- a Supervisor changes a Cleaner Schedule or availability override;
- a bounded scheduled retry catches missed availability events.

**Confirmed** Cleaner assignment and Work Order creation must be one atomic backend operation. If the selected Cleaner is no longer available, no Work Order is created and the Orchestrator retries with current data.

**Confirmed** Candidate selection has no Zone restriction and no maximum-distance rejection. Distance helps the LLM rank candidates, but any available Cleaner can be selected when nearer Cleaners are busy or off duty.

**Confirmed** Cleaner assignment uses only:

- current backend-validated Cleaner availability;
- approximate distance from Cleaner Station Point to Work target.

Node filters out unavailable Cleaners and calculates distance before calling the LLM. The LLM receives only currently available candidates and selects one Cleaner.

**Confirmed** Assignment uses a bounded multi-attempt loop rather than escalating after the first failed selection:

```text
load current available candidates
→ call LLM
→ validate selected Cleaner
→ attempt atomic Cleaner reservation and Work creation
→ if that Cleaner is invalid or no longer available, exclude that Cleaner
→ refresh current candidates and call the LLM again
→ stop when one Cleaner is reserved or every available candidate has been tried
```

Each Cleaner is attempted at most once within one assignment run. Every LLM response, rejected selection, reservation conflict, and exclusion reason is audited.

**Confirmed** LLM transport failure, timeout, or malformed output is different from a Cleaner reservation conflict. Because no Cleaner was actually tried, Node retries the LLM call itself with bounded backoff. Repeating the same unavailable model call once per Cleaner would not test the Cleaners and is not required.

**Confirmed final-failure behaviour** When all Cleaner candidates have been tried, or the LLM service retry limit is exhausted:

- no Work Order is created;
- the Alert remains `waiting_for_cleaner`;
- Supervisors receive a durable real-time in-app notification;
- the failed assignment run and all attempts are audited;
- there is no deterministic automatic assignment fallback.

**Confirmed configurable technical default** The initial LLM request may be followed by up to three technical retries. Wait approximately 1 second before retry 1, 2 seconds before retry 2, and 4 seconds before retry 3. The retry count, request timeout, and delays remain configuration values that can be tuned after testing the teammate's LLM service.

### 8.5 Alert priority aging

**Confirmed** When multiple Alerts are waiting, Alert age increases urgency. The Orchestrator handles higher-priority Alerts before lower-priority Alerts when Cleaner capacity is limited.

**Confirmed** Priority starts from issue severity and grows as the Alert remains unresolved. This prevents an older warning from waiting forever behind newly created Alerts.

**Confirmed** Keep displayed severity and a calculated priority score as separate values. The priority score combines issue severity and Alert age for queue ordering. Configurable age bands can escalate displayed severity, and every severity transition is retained in history.

**Confirmed** Alert age is measured continuously from creation until the Alert becomes `resolved` or `dismissed`. Assignment does not reset or pause age because Cleaner travel, cleaning, and review still contribute to how long the condition has remained unresolved.

**Confirmed** Age has two status-dependent effects:

- while `waiting_for_cleaner`, age increases assignment `priorityScore` so older Alerts move ahead in the queue;
- while `assigned`, `in_progress`, or `awaiting_review`, the Alert no longer competes for a Cleaner, but age can continue escalating displayed severity and overdue indicators.

When an assigned Work Order returns for rework, it stays with the same Cleaner and does not re-enter the assignment queue unless a Supervisor manually replaces the Cleaner.

**Confirmed provisional aging default** A warning Alert escalates to critical after 15 minutes unresolved. The threshold is configurable and may be changed after prototype testing or later configured per Site.

Critical Alerts remain critical, but their age and priority score continue increasing until resolution or dismissal.

### 8.6 Alert and Work Order lifecycles

**Confirmed Alert direction**:

```text
waiting_for_cleaner
→ assigned
→ in_progress
→ awaiting_review
→ resolved
```

An Alert may also become `dismissed` through a Supervisor decision.

**Confirmed Work Order lifecycle**:

```text
assigned
→ in_progress
→ awaiting_review
→ resolved
```

There is no Cleaner acceptance step. Once assigned, the assignment is considered accepted.

**Confirmed** One Work Order has one Cleaner for the first version.

**Confirmed** For Alert-driven work, Supervisor dismissal affects the Alert and related Work Order together. A required reason and audit entry are retained.

**Confirmed** There is no independent cancellation that leaves the Alert active. Cancelling or dismissing the Alert-driven Work Order also dismisses the related Alert.

**Confirmed** Manual Work Orders have no related Alert. Dismissing a manual Work Order dismisses only that Work Order.

**Confirmed** Failed post-cleaning Verification returns the same Cleaner and Work Order to `in_progress` for rework while the Alert remains active. The Cleaner is notified that more cleaning is required.

### 8.7 Supervisor takeover

**Confirmed** A Supervisor can manually assign a waiting Alert or replace the Cleaner chosen by the Orchestrator.

**Confirmed** Manual takeover keeps the Work Order tied to its Alert and changes its Management Mode from `orchestrated` to `manual`.

**Confirmed** Assignment history retains the Orchestrator recommendation, previous Cleaner, replacement Cleaner, Supervisor actor, time, and reason.

**Confirmed** Once Management Mode becomes `manual`, all Orchestrator actions stop for that Work Order until it reaches a terminal state. The Orchestrator cannot assign, reassign, resolve, dismiss, or request rework.

Deterministic Camera Verification remains available as decision support, but the Supervisor makes the final resolution or rework decision.

## 9. Orchestrator boundary

### 9.1 Alert selection and assignment context

**Confirmed** Node, not the LLM, decides which waiting Alert is handled next. Node sorts by current `priorityScore`, uses oldest creation time for a tie, and selects the next eligible Alert.

**Confirmed** The LLM receives one selected Alert at a time and decides only which available Cleaner to assign.

The trusted assignment context supplied by Node includes:

- selected Alert identity, issue, severity, age, priority, and target position;
- backend-validated available Cleaner candidates;
- each candidate's Station Point and calculated distance to the target;
- exclusion history for the current assignment run.

The LLM does not calculate availability, distance, Alert priority, or tenant ownership from raw database records.

**Confirmed** The scheduler reads at most the top 10 waiting Alerts in one backlog batch and processes them in priority order. The LLM does not receive all 10 Alerts in one prompt.

**Confirmed prototype execution** Process the batch sequentially. Re-query priority and Cleaner availability before each Alert so earlier assignments can make Cleaners busy and change later candidates.

### 9.2 Pause and resume

**Confirmed** Pausing the Orchestrator stops automatic assignment and automatic review decisions only.

While paused, these continue:

- browser-driven Camera monitoring;
- periodic AI Observations;
- Alert qualification and creation;
- Alert priority aging;
- Camera and Dashboard updates;
- Supervisor manual assignment, management, review, dismissal, and overrides.

**Confirmed** While the Orchestrator is paused, Supervisors receive durable real-time in-app notifications when:

- a new Alert is created;
- an unresolved Alert escalates from warning to critical.

**Confirmed** Resuming the Orchestrator processes the waiting backlog by highest current priority first, in batches of at most 10.

**Confirmed** Resumed backlog processing skips any Alert that already has a Supervisor-assigned Work Order. Alerts with no Work Order remain eligible for Orchestrator assignment, even if a Supervisor has viewed them.

### 9.3 Automated review application

**Confirmed** For an orchestrated Work Order in `awaiting_review`, the Orchestrator applies deterministic Verification outcomes automatically:

- `passed`: resolve the Alert and Work Order, release the Cleaner, and send notifications;
- `failed`: return the same Alert and Work Order to `in_progress`, keep the same Cleaner busy, and send a rework notification;
- `inconclusive`: keep the Work Order `awaiting_review`, notify Supervisors, and wait for a Supervisor decision or enough later evidence for a new explicit Verification attempt.

**Confirmed** An Alert with Management Mode `manual` is excluded from automatic Orchestrator review. Camera Verification can still run, but the Supervisor applies the final decision.

### 9.4 Approved Node-controlled tools

**Confirmed** The first-version Orchestrator is limited to five private Node-controlled tools.

Assignment tools:

```text
get_assignment_context(alertId)
assign_cleaner(alertId, cleanerId)
```

Review tools:

```text
get_review_context(workOrderId)
resolve_verified_work(workOrderId)
request_rework(workOrderId)
```

The LLM never writes Firestore directly. Node validates Site ownership, selected Alert, candidate membership, current availability, exclusion history, Management Mode, Work status, Verification outcome, optimistic version, idempotency key, and Orchestrator run lease before applying a tool mutation.

**Confirmed** If the Orchestrator service remains unavailable after the configured technical retries, no fallback assignment or review mutation occurs. The Alert or Work Order remains in its current state, Supervisors receive a durable real-time notification, and the failed run is audited.

### 9.5 Run concurrency and idempotency

**Confirmed** Only one active Orchestrator Run may own one Alert or Work Order at a time.

Node uses a lease and resource version to prevent duplicate or stale workers from assigning two Cleaners or applying review twice. Replayed tool calls with the same idempotency key return the already committed result rather than creating another transition.

### 9.6 Supervisor-visible decision history

**Confirmed** Root and Regular Supervisors can view structured Orchestrator decision explanations and tool-call history for their Site.

**Confirmed** The normal System page separates a concise operational explanation from expandable technical details.

Main view fields:

- Orchestrator running, paused, or unavailable status;
- last successful activity;
- latest assignment and review runs;
- concise decision summary;
- related Alert or Work Order;
- selected Cleaner and main availability/distance factors;
- outcome, timestamp, and retry count;
- Supervisor takeover or override indicator.

Expandable technical fields:

- candidate Cleaner table and distances;
- excluded candidates and reasons;
- Verification result;
- ordered tool calls and safe responses;
- model/provider/version;
- latency and retry timings;
- structured error, resource versions, and run identifiers.

**Confirmed structured decision record**:

- run type: assignment or review;
- Alert or Work Order reference;
- status and timestamps;
- model/provider/version;
- concise decision summary;
- inputs used, such as Alert priority and candidate distances;
- selected Cleaner and stated selection factors;
- excluded or failed candidate attempts and reasons;
- Verification outcome for review runs;
- ordered tool calls and safe results;
- retry count, latency, and final error when applicable;
- whether a Supervisor later took over or overrode the outcome.

**Confirmed debug output retention** Store the raw response payload that the LLM service actually returns, including returned text, structured fields, and requested tool calls, so parser and decision failures can be investigated later.

Raw model output is not application-database data. It is stored in a private local developer filesystem directory such as:

```text
data/orchestrator-debug/YYYY-MM-DD/{orchestratorRunId}.json
```

The structured Orchestrator Run, decision explanation, tool calls, status, and errors remain in Firestore. The raw response file uses the Orchestrator Run ID for correlation but is not copied into Firestore or cloud application storage.

Raw output rules:

- it is debug data, not the user-facing explanation;
- persistence is controlled by a backend development configuration flag and may be disabled outside development;
- it is written atomically as one immutable file linked by Orchestrator Run ID;
- secrets, authentication headers, credentials, and unnecessary personal data are removed before persistence;
- the stored UTF-8 payload is capped at 64 KiB per Orchestrator Run;
- record the original byte size, stored byte size, truncation flag, and SHA-256 digest so truncated or changed output is diagnosable;
- hidden provider reasoning or reasoning tokens that were never returned cannot and should not be stored;
- if a local LLM explicitly emits reasoning-like text in its response, that emitted text is part of the stored raw output;
- raw output is developer-only and is not exposed through the Client Supervisor, Cleaner, or Superadmin frontend;
- the debug directory is excluded from Git and is never served by Node's public media or application APIs;
- files use restrictive local permissions where supported;
- developer access uses the local filesystem or a protected local diagnostic command, never a public application API;
- local raw-output retention and cleanup are developer-controlled and are not a product data-retention promise.

**Confirmed** Firestore Orchestrator Runs, structured explanations, and tool-call history are retained for the full prototype lifetime. Raw local debug files follow developer-controlled cleanup instead.

**Confirmed** In-app System-page viewing is sufficient. Orchestrator log export is not required.

Pause/resume changes, skipped automatic actions, backlog processing, and failures are audited.

## 10. End-to-end direction

The current clarified direction is:

```text
Root configures Client Site and Site Map
→ Zones are plotted
→ Cameras are placed inside Zones
→ Supervisor registers each Camera view
→ browser Monitoring Session starts Camera sources
→ frames are sampled periodically
→ FastAPI returns AI Observations
→ Node stores lightweight summaries and applies qualification policy
→ qualifying condition opens or updates one camera-scoped Alert
→ highest-confidence Alert Evidence is persisted
→ Alert waits when no Cleaner is available
→ availability change prompts the Orchestrator again
→ Orchestrator atomically reserves one Cleaner and creates an assigned Work Order
→ Cleaner performs work and submits for review
→ explicit Verification produces passed, failed, or inconclusive
→ Alert and Work Order are resolved or returned for rework
```

Manual work begins at Work Order creation and can target either a Camera or a coordinate inside an active Zone.

## 11. Decisions still open

1. Practical validation of the current model's full-bin output.

## 12. Decision log

### 2026-08-29 — Client and Site scope

- Three human user types: LitterSpot Superadmin, Client Supervisor, Cleaner.
- The Site is both the tenant boundary and physical venue; there is no separate Client Organization record.
- Creating a client means creating a Site and its first Root Supervisor in one setup workflow.
- Operationally separate venues are separate clients.
- The first Supervisor is the Root Supervisor.
- Root creates additional Supervisor accounts directly with a password.
- Root-only authority covers Supervisor accounts and structural Site Map, Zone, and Camera Placement changes.
- Root and Regular Supervisors both manage Cleaners, schedules, Station Points, Alerts, Work Orders, Verification overrides, and Camera Registration.
- Root and Regular Supervisors can pause or resume the Orchestrator with an audit record.

### 2026-08-29 — Site Map

- One 2D grid per Site with approximate real-distance dimensions.
- Optional plain or uploaded-image background.
- Zones are non-overlapping polygons.
- Cameras and coordinate-targeted Work Orders must fall inside exactly one active Zone; Cleaner Station Points must only remain inside the Site Map boundary.
- Dimension changes require Zone and Camera Placement reconfiguration while historical revisions remain available.

### 2026-08-29 — Camera monitoring and storage

- One laptop webcam and multiple looped-video fake Cameras.
- Browser-driven monitoring may stop when the browser closes.
- Start with two-second sampling.
- Persist only Alert Evidence images, selecting the highest-confidence qualifying frame.
- Persist lightweight numeric summaries for analytics.
- The first Site Camera is forced to use the single laptop webcam source.
- Camera Creation includes source setup, reference capture, floor/bin plotting, validation, and initial Registration publication in one workflow.
- Incomplete creation stays a non-operational draft; completing the workflow creates the Camera and Registration together.
- Zone filtering changes display only; hidden active Cameras continue sampling.
- Source permission, loading, decoding, or capture failure marks the affected Camera offline and shows a safe error.
- One lease-protected browser Monitoring Session owns Site frame submission; another open browser automatically takes over after owner expiry.

### 2026-08-29 — Alert direction

- Alert means cleanup is needed and requires qualification thresholds.
- One active Alert per Camera and issue type.
- Floor litter initially requires repetition.
- Floor spill can alert from one qualifying observation.
- Full and overflow combine into one `bin_service` Alert, with overflow escalating severity.
- The current model contract supports a `full` state, but its practical reliability still needs validation.
- Provisional Alert and Verification sample rules are accepted for prototype testing.
- Ordinary monitoring never auto-resolves an Alert.
- The Orchestrator may apply an audited post-cleaning review decision through backend tools.
- The Orchestrator follows deterministic Verification and cannot override `failed` or `inconclusive`; only a Supervisor can override those outcomes.
- VLM-based review is deferred.
- Supervisors may dismiss false detections or override Verification with a required reason.

### 2026-08-29 — Alert-driven Work Orders

- No Work Order is created while no eligible Cleaner is available.
- Cleaner availability changes prompt the Orchestrator to try assignment again.
- Assignment reserves one Cleaner and creates the Work Order atomically.
- Work Orders begin in `assigned`; assignment counts as acceptance.
- One Work Order has one Cleaner.
- Work progresses through `assigned`, `in_progress`, `awaiting_review`, and `resolved`.
- Supervisor dismissal applies to both an Alert-driven Work Order and its Alert.
- Coordinate-targeted manual Work Orders are reviewed and resolved by a Supervisor.
- Failed Verification returns the same Work Order and Cleaner to `in_progress` for rework.
- Dismissing a manual Work Order dismisses only that Work Order because no Alert exists.

### 2026-08-30 — Manual Work Orders

- Manual Work is created already assigned to one available Cleaner and has no Flag or Alert.
- Title, instructions, warning/critical severity, target, and Cleaner are required.
- Camera or uploaded-photo creation evidence is optional.
- Coordinate-targeted manual Work requires Cleaner Completion Evidence and Supervisor review.
- Camera-targeted manual Work may use advisory Camera Verification, but the Supervisor makes the final decision.
- Manual Work never enters Orchestrator assignment or automatic review.
- Camera-targeted Work opens Camera Details; coordinate-targeted manual Work uses compact inline/modal details from the Work list.
- Work Orders have no separate due date.
- Node generates Alert-driven titles and instructions deterministically; the LLM does not author them.

### 2026-08-29 — Cleaner Station Points

- Supervisors plot one fixed Station Point when creating a Cleaner.
- Available Cleaners are assumed to be near their Station Point.
- The Orchestrator compares Work Order targets with Station Points rather than live Cleaner locations.
- GPS, phone coordinates, continuous tracking, and location history are not used.
- Site Map dimension changes require active Cleaner Station Points to be replotted.
- Cleaners have no assigned-Zone restrictions.
- Distance ranks available Cleaners but never disqualifies a far Cleaner.
- Supervisors control availability through schedules; active Work makes a Cleaner busy.
- Only durable in-app notifications are required for the prototype; browser push is not required.

### 2026-08-29 — Cleaner schedules and real-time notifications

- Each Cleaner has an individual recurring weekly schedule.
- Schedule entries have no shift name; Root and Regular Supervisors directly configure one working time range per Cleaner and day.
- One Cleaner can hold at most one working time range per day.
- Working ranges may cross midnight and use the Site timezone.
- Active Work continues after scheduled time ends.
- An Availability Override on a busy Cleaner blocks future assignment without cancelling current Work.
- Supervisors can exclude a Cleaner through a simple Availability Override instead of a leave workflow.
- Assignment and rework events must appear immediately in connected clients through a read-only Firestore real-time listener.
- Notifications remain durable for users who were disconnected.
- Node owns notification writes; the frontend may read only notifications addressed to the signed-in user.
- Browser/operating-system push, SMS, and email are not required.
- Notification read receipts and unread tracking are not required.
- Cleaners do not report blocked work, reject assignments, or report that an issue cannot be found.
- Cleaners only start assigned work and submit it for review; the system or Supervisor evaluates completion.
- Cleaner Work Details includes annotated Alert Evidence.
- Camera-linked Work uses Camera Verification and does not require a Cleaner photo.
- Coordinate-targeted manual Work requires one Cleaner Completion Evidence photo and Supervisor review.
- Cleaner mobile shows read-only schedule and Station Point plus a small recent Work history.
- Cleaner mobile limits past Work history to the latest five resolved or dismissed items.

### 2026-08-29 — Dashboard rankings

- Top Alerts use unresolved `priorityScore`; when none exist, show serious resolved Alerts and exclude dismissed Alerts.
- Busy Zone score is 50 percent rolling 15-minute visitor pressure and 50 percent active cleaning workload.
- Warning Work Orders contribute 1 workload point and critical Work Orders contribute 2.
- Remaining ties use recent qualifying cleanliness issue count, visitor pressure, and then Zone name.

### 2026-08-29 — Bin Placement Analysis

- Recommendations rank priority Zones only and never claim an exact bin coordinate.
- People activity, cleaning frequency, and bin-service Alert frequency have equal one-third weights.
- No additional trained model is required for the ranking.
- Supervisor implementation creates a server-timestamped Bin Placement Intervention.
- Supervisors choose the before/after range; partial after-data is shown and grows until the requested range is complete.

### 2026-08-30 — Live Bin Placement recommendations

- The leaderboard is calculated output that updates as daily data changes; there is no pending recommendation record.
- Cleaning frequency counts resolved Alert-driven and manual Work Orders.
- **Implement** creates a timestamped implemented Intervention snapshot with the displayed factors, score, rank, period, actor, and map revision.
- Ranking and comparison periods accept any whole number of days with a minimum of 2; there are no forced presets.
- Recommendations rebuild daily with stale-result catch-up after backend downtime.
- Supervisors can refresh recommendations on demand for any selected period.
- Implemented Zones are excluded from recommendations for two complete Site-local days.
- Repeated Interventions are retained separately; comparisons default to the latest and allow older history.

### 2026-08-30 — Analytics and operational retention

- Two-second sample data stays in memory and is aggregated into one Site-wide minute bucket.
- Minute buckets are retained for 90 days and automatically deleted afterward.
- Compact Site-wide daily summaries with per-Zone analytics remain for the full prototype lifetime.
- Flags, Alerts, evidence, Work Orders, histories, and audits remain for the full prototype lifetime.
- Flags are persisted internal qualification records between AI Observations and Alerts; there is no standalone Flag page.

### 2026-08-30 — Superadmin and Site tenancy

- Site replaces the unnecessary one-to-one Client Organization entity and is both tenant boundary and venue.
- Creating a client means creating a Site, initial map configuration, and first Root Supervisor in one workflow.
- The Superadmin selects a Site and can access all of its operational data and Root Supervisor capabilities without impersonating that user.
- Superadmin actions retain Superadmin identity in audit history.
- The Superadmin can deactivate a Site and recover or replace its Root Supervisor.
- Site deactivation is allowed with active operations and the Site can later be reactivated.
- Inactive Sites block Supervisor/Cleaner access and stop monitoring and Orchestrator activity while preserving history.
- Site deactivation dismisses active Alerts and Work Orders with reason `site_deactivated`; reactivation does not reopen them.
- Superadmin uses a separate Superadmin-only application area.
- Every privileged Superadmin action against a Site creates an immutable Superadmin Audit Event.
- Reads are not audited; every mutation and operational/structural change is audited.
- Root Supervisors can view Superadmin Audit Events affecting their Site.
- Daily Alert, assignment, Work, and Verification operations stay in the Client Supervisor interface rather than the Superadmin interface.

### 2026-08-29 — Orchestrator assignment and Supervisor takeover

- Node supplies only available Cleaner candidates and their Station Point distance to the Work target.
- Invalid or unavailable Cleaner selections are excluded and the LLM retries until a Cleaner is reserved or every candidate has been attempted.
- LLM transport or malformed-response failures use a separate bounded technical retry with backoff.
- The configurable initial default is three technical retries after approximately 1, 2, and 4 seconds.
- Exhausted candidate or technical retries leave the Alert waiting and notify Supervisors; there is no deterministic automatic assignment fallback.
- Older waiting Alerts gain priority as they age.
- Displayed severity and calculated priority score are stored separately.
- Alert age continues after assignment until resolution or dismissal; after assignment it drives visible urgency rather than Cleaner queue order.
- Warning Alerts provisionally escalate to critical after 15 minutes unresolved.
- A Supervisor can manually assign or replace a Cleaner while keeping the Work Order tied to the Alert.
- Manual takeover is recorded through Work Order Management Mode and assignment history.
- Manual takeover stops all later Orchestrator actions for that Work Order; Camera Verification remains advisory to the Supervisor.
- Node selects the next Alert; the LLM only selects a Cleaner for one Alert at a time.
- Node loads at most the top 10 waiting Alerts per scheduler batch and processes them in current priority order.
- Backlog processing is sequential and revalidates Cleaner availability before every assignment.
- Pausing does not stop monitoring or Alert creation; Supervisors receive real-time notifications and can take over manually.
- Paused Supervisors are notified on new Alerts and warning-to-critical escalation.
- Resuming processes the waiting backlog by highest current priority.
- Resuming skips Alerts that already have Supervisor-assigned Work Orders.
- Orchestrated review automatically resolves passed Verification, requests rework after failed Verification, and escalates inconclusive Verification to Supervisors.
- The Orchestrator is limited to five Node-controlled assignment/review tools and never writes Firestore directly.
- One lease-protected Orchestrator Run may own an Alert or Work Order at a time; tool mutations are versioned and idempotent.
- All Supervisors can view structured decision and tool history; hidden provider reasoning is unavailable and is not claimed as part of the product explanation.
- The System page uses an approved concise main view with expandable technical details.
- Raw model response payloads are stored outside Firestore in a private local filesystem directory only when development diagnostics are enabled, after secret redaction and with a 64 KiB limit.
- Raw output is developer-only and never exposed in Supervisor, Cleaner, or Superadmin product interfaces.
- Orchestrator Run history and raw outputs remain for the full prototype lifetime; export is not required.
