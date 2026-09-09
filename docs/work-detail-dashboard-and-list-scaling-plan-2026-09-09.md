# Work detail, Dashboard, and list scaling plan

Status: implemented and verified on 2026-09-09.

Date: 2026-09-09

## Purpose

This update will make Work details behave consistently wherever they are opened, correct the selected-Zone Dashboard information, and prevent large record lists from loading an entire collection at once.

The Camera grid is an explicit exception. It will continue to show every Camera without pagination.

## 1. Work detail navigation

Work details will use one reusable modal that can open over different pages without forcing unrelated navigation.

### Work page

- Clicking any Work list row opens the Work detail modal over the Work page.
- Camera-linked Work no longer routes directly to Camera detail from the row.
- Closing the modal leaves the current Work filters, sorting, loaded pages, and scroll position intact.

### Camera detail page

- Clicking `Open Work detail` opens the same Work detail modal over Camera detail.
- Opening the modal does not route to the Work page.
- Closing it reveals the same Camera detail page and preserves its state.

### Dashboard

- Clicking an Active Work entry routes to the Work page with the selected Zone filter applied and that Work detail modal open.
- The route carries stable `zoneId` and `workId` values.
- Closing the modal leaves the Supervisor on the Zone-filtered Work page.
- Browser Back returns to the Dashboard.

### Camera monitoring from Work detail

- Active Camera-linked Work shows a `Monitor Camera` action.
- Resolved and dismissed Work do not show this action.
- Clicking it opens the linked Camera detail page.
- Work opened from a deep link must load directly by `workId`, even when it is outside the currently loaded Work page.

## 2. Work detail modal

### Form and responsive behavior

- Replace the narrow portrait modal with a landscape modal close to a 3:2 proportion on desktop.
- Use three vertical columns on wide screens.
- Stack the same sections in this order on narrow screens: Work details, Assigned Cleaner, Supervisor action.
- Keep the modal keyboard-contained, restore focus to the opening control, and let Escape close it when no action is pending.

### Column 1: Work details and evidence

Show:

- issue name;
- current status and priority;
- `Automated Camera Alert` or `Manual Work` origin;
- Zone name;
- Camera name or map point;
- created or detected time;
- clear Work instructions;
- `Monitor Camera` for active Camera-linked Work;
- one reserved evidence box.

The evidence box remains in the layout for every relevant Work state:

- show retained Alert evidence when available;
- otherwise show a clear placeholder explaining that no Alert image is available;
- never collapse the layout because evidence is missing.

Remove from the normal Supervisor view:

- Work Order ID;
- Alert ID;
- Camera ID;
- Zone ID;
- the standalone `Detection context` section;
- status values styled as disabled buttons.

The old Detection context attempted to show Alert provenance, detection time, and a Camera link. Its useful information moves into the Work details column. Internal identifiers remain available in backend records and developer diagnostics.

### Column 2: Assigned Cleaner

Show:

- current assigned Cleaner;
- current assignment state;
- a visible `Reassign Cleaner` action.

Activating reassignment reveals available Cleaner choices. Each choice should show the facts that help the Supervisor decide, including availability and calculated distance when available. Confirming reassignment requires a reason.

The Cleaner search or selection interface must not look like passive text. The action and selectable rows need explicit labels and interaction states.

### Column 3: Supervisor action

Show only actions allowed by the current Work state and Management Mode:

- take over automated Work;
- dismiss Work;
- resolve or request rework when a Supervisor decision is permitted;
- inspect submitted completion evidence when relevant.

Action buttons remain clickable before a reason is entered. If the Supervisor selects an action without a reason:

- retain the selected action;
- focus the Reason field;
- show `Enter a reason to continue` beside the field;
- do not send a backend mutation.

Consequential actions use a confirmation state that names the action and consequence. This should be a protected state within the Work detail experience, not an unexplained disabled button.

Taking over automated Work changes its Management Mode to manual. After a successful takeover, the modal cues the Supervisor to review the assigned Cleaner and optionally open reassignment. It must not reassign automatically.

## 3. Selected-Zone Dashboard panel

### Correct the Cleaner concept

A Cleaner Station Point does not assign a Cleaner to a Zone. Cleaners may receive Work anywhere on the Site. The Station Point is an assignment-distance origin, and a nearest Zone is display context only.

Remove the misleading text `No Cleaner assigned to this Zone`.

Rename `Cleaner task` to `Active Work`.

### Active Work states

The section reflects actual Work and Alert state:

- no active Work: `No active Work in this Zone`;
- waiting Alert without Work: `Waiting for Cleaner`;
- assigned Work: Cleaner name and `Assigned`;
- started Work: Cleaner name and `In progress`;
- submitted Work: Cleaner name and `Awaiting review`;
- failed verification: Cleaner name and `Rework required`.

Remove the unsupported progression:

```text
Assigned -> Travelling -> Clean -> Verify
```

`Travelling` is not tracked, and `Clean` does not name a stored Work state. If a progression is useful for an actual Work Order, use the real lifecycle:

```text
Assigned -> In progress -> Awaiting review -> Resolved
```

Do not show a progression when no Work Order exists.

### Bounded Dashboard previews

For the selected Zone, show:

- up to three registered Cameras and the total Camera count;
- up to three unresolved Alerts and the total unresolved count;
- up to three active Work Orders and the total active count.

Navigation behavior:

- clicking a Camera name opens that Camera detail;
- clicking an Alert name opens that Alert detail;
- clicking an Active Work entry opens the Work page with the Zone filter and Work modal applied;
- `Open cameras` opens the Camera page filtered to the selected Zone;
- `Review alerts` opens the Alerts page filtered to the selected Zone;
- `Track work` opens the Work page filtered to the selected Zone.

The current `Track work` behavior is incomplete because it drops the selected Zone filter.

## 4. Backend-driven list scaling

Large record lists must use backend filtering, sorting, and cursor pagination. The frontend must not fetch an entire collection and filter it locally.

### Camera grid exception

- The Camera grid loads and displays all Cameras.
- Zone and monitoring-state filters may remain client-side for this grid.
- No Camera pagination or `Load more` control will be added.

### Lists that require pagination

Apply pagination where the record count can grow, including:

- Alerts;
- Work Orders;
- Cleaners;
- Supervisors;
- Superadmin Sites;
- audit records;
- System decision activity;
- notifications;
- record histories and other growing operational ledgers.

Small structural option lists, such as the active Zones used by a Site filter, do not need the same treatment unless their expected size changes materially.

### Backend query contract

Each list endpoint exposes only relevant, allowlisted query fields. Depending on the resource, these may include:

- `limit`;
- `cursor`;
- `sort`;
- `direction`;
- `status`;
- `zoneId`;
- `cameraId`;
- `cleanerId`;
- `severity`;
- `origin`;
- bounded search text where useful.

Each response provides:

```text
items
nextCursor
hasMore
totalCount
```

Cursors must be opaque to the client and tied to a stable, deterministic sort. The backend validates limits, filters, sort fields, tenant ownership, and cursor compatibility.

### Frontend loading behavior

- Load the first page when a list is opened.
- `Load more` appends the next matching page.
- Changing filters or sorting cancels the old request, clears its cursor, and loads the first matching page.
- A deep-linked record is fetched directly by ID instead of loading pages until it appears.
- Simultaneous requests for the same resource, filters, sort, and cursor share one pending request.
- Reopening a recently viewed list reuses fresh cached pages.
- A successful mutation invalidates only affected lists, counts, details, and Dashboard summaries.
- Page navigation alone does not force a fresh read.
- Protected evidence media uses a separate cache.
- The client never joins every page merely to calculate a total.

### Initial page sizes

Use these as starting defaults:

| Surface | Initial amount |
| --- | ---: |
| Dashboard embedded preview | 3 |
| Camera grid | All Cameras |
| Alerts | 25 |
| Work Orders | 25 |
| Cleaners | 25 |
| Supervisors | 25 |
| Superadmin Sites | 25 |
| Audit records | 25 |
| System decision activity | 20 |
| Notifications and histories | 20 |

### Default sorting

- Alerts: unresolved first, then severity, priority, and newest.
- Work Orders: active first, then urgency and latest update.
- Cleaners: available first, then name.
- Supervisors: active first, then name.
- Superadmin Sites: active first, then name.
- System activity, notifications, audit records, and histories: newest first.

Expose a sorting control only when another ordering helps the user complete the task.

## 5. Implementation boundaries

- Node and Firestore remain responsible for query filtering, tenant isolation, sorting, pagination, counts, and mutation validation.
- React owns modal presentation, URL state, focus behavior, validation guidance, confirmation states, and progressive loading controls.
- Internal IDs remain stored and may remain in URLs, but ordinary Supervisor content uses human-readable names.
- Existing role permissions, Work transitions, Orchestrator authority, evidence security, and Camera monitoring behavior remain unchanged.
- Superadmin Site View uses the same read-only data shapes and list pagination without exposing mutation controls.

## 6. Smooth analyzed Camera playback

### User-facing behavior

- Smooth analyzed video is the default Camera Detail presentation in the capture-owner browser. Camera grid cards and secondary browsers show exact analyzed snapshots with matching overlays.
- Enabling or opening a Camera first shows `Connecting to Camera...` while capture, processing, and a real compressed playback buffer start together.
- Once playback is ready, the interface shows `Live monitoring`.
- Do not expose buffer duration, playback delay, or delayed-view terminology to Supervisors.
- Replace the current immediate-video concept with `Original video`.
- `Original video` hides AI overlays without changing the playback timeline.
- Returning to the analyzed view restores overlays on the same footage without jumping forward or backward.

### Internal playback behavior

- Capture and adaptive inference start immediately when monitoring begins. Camera Detail waits until both compressed footage and successful analysis coverage are ready.
- The capture-owner Camera Detail plays continuous source footage from a measured internal delay so inference results can be matched to the correct displayed moment.
- Every sampled frame keeps its actual capture timestamp, source time, playback generation, and result.
- Alerts, evidence, analytics, and Verification use actual capture time rather than displayed playback time.
- Overlay results have short, issue-appropriate display lifetimes and are never held indefinitely.
- If analysis coverage falls behind, Camera Detail freezes the last valid frame, removes expired overlays, and shows `Rebuffering analysis` while capture and inference continue.
- A short interruption resumes from the frozen position. When the player falls more than two seconds behind its intended delayed position, it skips the missed presentation segment behind the loading state and resumes at the newest safely analyzed delayed position.
- If safe playback cannot start or recover within thirty seconds, show `Camera analysis unavailable` with Retry.
- The player never silently continues as raw footage while presenting an analyzed state.
- Disabling, reconfiguring, or replacing a Camera source clears its prior buffer and pending display results.
- Development scene switching clears the earlier scene buffer and never mixes footage or results across playback generations.
- Ordinary Alert and Verification timing remains independent from any higher presentation sampling cadence.

### Starting buffer decision

- Begin measurement with a five-second minimum delay, but let actual readiness depend on buffered footage, successful analysis coverage, and measured queue latency.
- A Camera may remain connecting for ten seconds or longer when needed, up to the thirty-second failure boundary.
- Once playback begins, keep one fixed delayed position until a rebuffer event deliberately resumes or skips forward under the two-second catch-up rule.
- Cap Camera Detail presentation at 1280 × 720 while preserving aspect ratio and never upscaling a smaller source.
- Use compressed buffering. Do not retain a rolling window of decoded RGBA or ImageBitmap frames.

### Laptop Camera limitation

- The browser that owns the physical laptop Camera can provide smooth buffered playback.
- Other Supervisor browsers cannot receive that continuous laptop Camera stream under the current browser-owned capture architecture. They may continue receiving analyzed snapshots.
- This limitation is accepted for the current version.
- A later multi-viewer laptop Camera design would require a continuous relay such as WebRTC. That relay is outside this update.

### Camera grid performance

- The Camera grid still lists every Camera.
- Enabled Camera cards show exact analyzed snapshots with their matching overlays rather than continuous delayed video.
- Visible cards receive a higher snapshot cadence than enabled Cameras with no visible consumer when Site capacity permits.
- Enabled Cameras with no visible card or Detail view continue minimal operational inference for Alerts and Verification.
- A first positive result or active Camera Verification temporarily raises that Camera's sampling priority.
- Opening Camera Detail reserves Site-wide inference capacity for that Camera without starving operational monitoring on the others.

## 7. Bin Placement graph demo fixture

The shared Firebase emulator fixture needs enough deterministic historical data to render and test the Bin Placement Intervention comparison graphs immediately.

### Fixture purpose

- Exercise the real Bin Placement backend and frontend rather than supplying hardcoded graph arrays.
- Give the team one understandable example where cleaning and overflow frequency decrease after a recorded bin placement.
- Keep the fixture isolated to emulator development and out of production Firebase.
- Avoid creating active Alerts, active Work, Cleaner reservations, or notifications.

### Required records

Create one completed historical Intervention for `Wave Pool & Lazy River`, or another stable existing Zone if that Zone is unavailable when the fixture is generated.

Populate at least seven completed Site-local calendar days before the Intervention and seven completed Site-local calendar days after it. Each required day needs:

- final daily analytics coverage for the selected Zone;
- successful monitoring coverage so the day is observed rather than missing;
- historical resolved Work facts used by `cleaningFrequency`;
- historical overflow facts used by `binOverflowFrequency`;
- stable Zone, Site Map revision, and timezone snapshots;
- one valid `binPlacementIntervention` record between the two periods.

Use deterministic example values such as:

| Relative period | Resolved Work per day | Overflow events per day |
| --- | --- | --- |
| Seven days before | 4, 5, 3, 6, 5, 4, 5 | 3, 2, 4, 3, 3, 2, 3 |
| Seven days after | 2, 2, 1, 2, 1, 1, 1 | 1, 1, 0, 1, 0, 0, 1 |

These values are demonstration data, not model-performance claims.

### Seeding behavior

- Use stable deterministic document IDs so rerunning the seed does not duplicate facts, daily summaries, or Interventions.
- Preserve the user's current Zones, Cameras, Cleaner accounts, Station Points, Camera Registrations, and active operational records.
- Mark generated historical records as emulator demonstration data where the schema permits it.
- Do not call Ollama, FastAPI inference, monitoring capture, or the Orchestrator while seeding.
- Add the completed fixture data to the shared emulator snapshot so teammates receive the same graph after their first launch or an explicit fixture reset.
- Provide a focused command for rebuilding or verifying the Bin Placement graph data without resetting unrelated emulator configuration.

### Fixture verification

- The Intervention history endpoint returns the seeded Intervention.
- A seven-day comparison returns seven available before-days and seven available after-days.
- Cleaning and overflow series contain the expected daily values in calendar order.
- The Insights page selects the latest Intervention and renders both graphs without manual setup.
- Missing dates remain gaps if a separate missing-coverage test case is added. The main demonstration comparison should have complete coverage.
- Re-running the seed leaves record counts and graph values unchanged.
- No Cleaner becomes busy and no active Alert or Work Order is created.

## 8. Implementation phases

Implementation proceeds from small, isolated changes to the largest runtime change. Complete and verify each phase before starting the next.

### Phase 1: Dashboard corrections, navigation, and graph fixture

Relative size: small to medium.

Build the independent changes that improve the current system without replacing a major shared component:

- rename the selected-Zone `Cleaner task` section to `Active Work`;
- replace the unsupported travelling progression with actual Alert and Work states;
- show up to three Cameras, three unresolved Alerts, and three active Work Orders with their total counts;
- hide the Work progression when no Work exists;
- make Camera and Alert names open their specific detail views;
- make `Open cameras`, `Review alerts`, and `Track work` preserve the selected Zone;
- make a Dashboard Active Work entry open the Zone-filtered Work page with its Work detail selected;
- preserve the Camera grid exception so every Camera remains visible;
- add the idempotent seven-day before-and-after Bin Placement graph fixture;
- add focused commands to seed and verify the graph data;
- update the shared emulator fixture after verification.

Phase 1 exit checks:

- Dashboard links and filters survive navigation and Browser Back;
- Dashboard terminology matches the domain model;
- the Bin Placement page displays both comparison graphs from real emulator records;
- reseeding does not duplicate data or create active operational work;
- focused backend, frontend, and browser checks pass.

### Phase 2: Reusable Work detail experience

Relative size: medium.

Replace the current route-coupled Work drawer with one reusable Work detail modal:

- open Work rows over the Work page instead of routing Camera-linked Work directly to Camera detail;
- open Work detail over Camera detail without leaving the Camera page;
- support Dashboard and direct-link entry through `zoneId` and `workId`;
- preserve the page underneath, its filters, loaded data, and scroll position;
- implement the landscape three-column desktop layout and stacked narrow layout;
- reserve the Alert evidence area and show a placeholder when no evidence exists;
- remove ordinary user-facing Work, Alert, Camera, and Zone IDs;
- remove the standalone Detection context section and move useful provenance into Work details;
- show `Monitor Camera` only for active Camera-linked Work;
- make reassignment discoverable and show useful eligible-Cleaner facts;
- keep Supervisor actions clickable, then guide missing-reason recovery;
- add protected confirmation states for takeover, reassignment, dismissal, resolution, and rework;
- after takeover, change Management Mode to manual and cue optional reassignment;
- implement focus containment, Escape behavior, focus restoration, and Browser Back behavior.

Phase 2 exit checks:

- the same modal works from Work, Camera detail, Dashboard, and direct URLs;
- closing always returns to the correct underlying page;
- action permissions and Work transitions remain backend-enforced;
- evidence, reassignment, reason validation, confirmation, responsive, and keyboard scenarios pass.

### Phase 3: Backend-driven list scaling

Relative size: large.

Migrate growing record lists from full-collection reads and client filtering to bounded server queries:

- define reusable opaque cursor and stable sort contracts;
- add allowlisted backend filters and sorting per resource;
- add total counts without loading all matching documents;
- add or update required Firestore composite indexes;
- paginate Alerts, Work Orders, Cleaners, Supervisors, Superadmin Sites, audit records, System activity, notifications, and histories;
- leave the Camera grid unpaginated;
- make direct record endpoints independent from list pagination;
- add frontend `Load more` behavior;
- reset cursors and cancel stale requests when filters or sorting change;
- preserve filters in URLs where navigation depends on them;
- cache fresh pages, share duplicate pending requests, and invalidate only affected queries after mutations;
- retain separate protected-evidence caching;
- migrate Superadmin Site View to the same bounded read contracts.

Phase 3 exit checks:

- initial page loads read only their configured limits;
- filters and sorting are applied by the backend;
- deep-linked records open when absent from the first page;
- mutations refresh affected lists and totals without refreshing unrelated pages;
- repeated navigation does not multiply Firestore reads;
- cursor isolation, tenant isolation, indexes, empty pages, last pages, and concurrent mutation cases pass.

### Phase 4: Smooth analyzed Camera playback

Relative size: largest and highest risk.

Build the time-synchronized playback path after the UI and data-access changes are stable:

- add a measured detail-only compressed playback buffer with a five-second minimum readiness target;
- start capture and inference while the buffer fills;
- make smooth delayed analyzed playback the default in capture-owner Camera Detail while keeping exact analyzed snapshots on Camera cards and secondary browsers;
- align overlays using capture time, source time, Registration revision, and playback generation;
- make `Original video` hide overlays without changing the playback timeline;
- freeze and rebuffer when analyzed coverage becomes unsafe, then resume from the frozen point or skip to the newest safe delayed point under the two-second catch-up rule;
- show user-facing connecting, monitoring, rebuffering, and retryable unavailable states without exposing the internal delay;
- clear buffered footage and pending results on disablement, reconfiguration, source replacement, ownership change, and development scene switching;
- implement the looped-video playback path;
- implement browser-owner laptop Camera buffering while accepting snapshot-only secondary browsers;
- allocate Site-wide sampling adaptively among Detail, visible-card, offscreen, positive-burst, and Verification states;
- measure latency, dropped samples, buffer underruns, CPU use, and memory use with several enabled Cameras.

Phase 4 exit checks:

- analyzed and Original video stay on the same timeline;
- normal playback stays smooth while analysis remains ahead, and an analysis shortfall produces an explicit rebuffer instead of raw footage;
- overlays never appear on the wrong frame or playback generation;
- loop boundaries and scene switches do not mix old and new results;
- Camera cards remain usable with the complete Camera grid visible;
- laptop-owner, secondary-browser limitation, failover, reconfiguration, and degraded-inference scenarios pass.

## 9. Acceptance checks

The update is complete when:

1. Work details open over the correct originating page and close without unexpected navigation.
2. Work rows open the modal, while `Monitor Camera` is the explicit route to Camera detail.
3. Dashboard Active Work links open a Zone-filtered Work page with the selected Work modal visible.
4. No normal Work modal exposes Work, Alert, Camera, or Zone IDs.
5. Alert evidence or its placeholder always occupies the reserved evidence area.
6. Reassignment is visibly discoverable and lists only eligible available Cleaners.
7. Missing reasons produce focused, accessible guidance instead of unexplained disabled actions.
8. Takeover changes Management Mode to manual and then offers reassignment without forcing it.
9. Dashboard uses actual Work states and never implies that a Cleaner belongs to a Zone.
10. Camera, Alert, and Work names navigate to their matching detail views.
11. `Open cameras`, `Review alerts`, and `Track work` preserve the selected Zone.
12. Growing lists read only one backend-filtered page at a time and can progressively load more.
13. Deep links work even when the selected record is outside the first page.
14. The Camera grid continues to show every Camera.
15. An enabled Camera Detail transitions from connecting to smooth delayed analyzed playback only after footage and analysis coverage are ready, without exposing the internal delay.
16. `Original video` changes only overlay visibility and never changes the playback position.
17. Late inference never draws an overlay on the wrong moment or silently leaves raw footage playing; insufficient coverage produces explicit rebuffering and bounded catch-up.
18. Camera disablement, reconfiguration, source replacement, and development scene switching clear incompatible buffered data.
19. The accepted secondary-browser limitation for laptop Cameras is preserved and accurately tested.
20. The shared emulator fixture displays a complete seven-day before-and-after Bin Placement comparison without creating active operational work.
21. Re-running the graph fixture seed is idempotent and leaves its values unchanged.
22. Relevant backend, frontend, accessibility, responsive, and browser tests pass.
