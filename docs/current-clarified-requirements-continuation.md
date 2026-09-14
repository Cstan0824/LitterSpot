# LitterSpot clarified requirements continuation

## 1. Purpose and authority

This compact document continues [`current-clarified-requirements.md`](current-clarified-requirements.md) from 2026-08-30 onward. Read both documents as one requirements record.

New decisions belong here. Do not keep expanding or repeatedly loading the original long document during the active discussion.

Labels:

- **Confirmed**: explicitly agreed.
- **Proposed**: recommended and awaiting a decision.
- **Open**: unresolved.

## 2. Camera Creation and activation

### 2.1 Composite creation flow

**Confirmed** Camera Creation includes Camera identity, Site Map placement, source configuration, reference capture, walkable-floor plotting, optional physical-bin plotting, validation, and initial Camera Registration publication in one guided flow.

An incomplete creation is a non-operational draft. Cancelling it creates no operational Camera.

**Confirmed** A Zone drawn inside Camera Creation remains provisional inside the Camera Draft. It is not added to the Active Site Map until Page 4 publishes the Camera. Cancelling the flow deletes the Camera Draft, its draft-owned reference/source media, and the provisional Zone.

### 2.2 Source types

**Superseded 2026-09-05** Camera source type is no longer chosen by creation order. The first Camera does not have to use the laptop webcam.

**Confirmed** Any Camera may be registered with a laptop webcam or looped-video source. Multiple Cameras may retain laptop-source configuration, but at most one laptop-source Camera per Site may have monitoring enabled at a time. Enabling one must be rejected if another laptop-source Camera is already enabled.

**Confirmed** The prototype assumes operation on one laptop. The product does not enforce a designated-device identity. If the laptop or webcam view changes, a Supervisor reconfigures the reference and replots the Camera Registration.

### 2.3 Camera status and monitoring control

**Superseded 2026-09-05** A newly published laptop Camera no longer starts monitoring automatically.

**Confirmed** Completing Camera Creation publishes the Camera as structurally active with `monitoringEnabled=false`, regardless of source type. A Root or Regular Supervisor deliberately enables monitoring afterward.

**Confirmed** Structural Camera status and temporary monitoring control are separate:

```text
status = active | inactive
monitoringEnabled = true | false
```

Structural status belongs to the Camera lifecycle and remains Root-controlled. `monitoringEnabled` is a reversible daily/demo control available to Root and Regular Supervisors.

**Confirmed** Completing looped-video Camera Creation creates an active Camera record with `monitoringEnabled=false`. A Supervisor deliberately turns monitoring on for a demonstration.

Reason: a looped simulation containing a cleanliness issue would repeatedly generate artificial observations, Flags, and Alerts if left active outside a demo.

A looped Camera with monitoring disabled retains its source and valid Camera Registration, but it does not:

- submit live samples;
- affect analytics;
- create Flags;
- create or update Alerts;
- participate in Camera online/offline operational monitoring.

**Confirmed** Turning monitoring off stops new playback sampling, observations, analytics input, Flags, and Alert updates from that Camera. Existing Alerts, Work Orders, histories, and retained evidence remain unchanged.

**Confirmed demo-start behavior** Enabling a looped-video Camera:

- starts playback from time zero;
- clears that Camera's previous in-memory temporal samples, tracking history, candidate evidence buffer, and partial Flag sequence;
- starts a fresh monitoring episode without deleting persisted historical records or active Alerts/Work Orders.

This makes demonstrations repeatable and prevents pre-enable samples from contributing immediately to a new Flag.

### 2.4 Simulation traceability

**Confirmed** Every record derived from a looped-video Camera carries `isSimulation=true`, including:

- AI Observations and minute/daily analytics contributions;
- detections and internal Flags;
- Alerts and Alert Evidence;
- Work Orders, Verification records, and histories;
- Orchestrator Runs and notifications.

Simulation records participate in the normal prototype workflow and analytics. The marker is internal traceability for backend debugging and data inspection only.

**Confirmed** The product UI does not show a Simulation label on Cameras, Alerts, Work Orders, evidence, notifications, Dashboard cards, or analytics.

**Confirmed** The product UI does not provide a simulation include/exclude filter. Simulation data is included by default in prototype Dashboard, history, and analytics results.

### 2.5 Source replacement

**Confirmed** Replacing a looped simulation video requires a new reference, floor plotting, bin plotting, validation, and Camera Registration revision.

**Confirmed** The existing source and Registration remain operational while the replacement stays in draft. Publishing the validated replacement switches source and Registration atomically.

Source replacement preserves both structural `status` and `monitoringEnabled`. Replacement never silently enables a simulation Camera.

**Confirmed 2026-09-05** Looped-video Cameras may have developer-configured Demo Source Scenes that use the same physical viewpoint and Camera Registration. This supports switching between clean and issue videos during a demonstration without running Camera reconfiguration each time.

Demo Source Scene selection is not shown in the Supervisor product UI or the System page. A developer operates it through a separate development-only control.

**Confirmed 2026-09-05** The selected scene itself is visible everywhere the Camera feed is normally shown. Camera wall and Camera Details update to the new video and continue showing the real inference overlays and Camera state. Only the scene-selection control and developer diagnostics remain outside the product UI.

**Corrected 2026-09-05** A scene switch represents the same Camera view changing in real time. It does not end the Monitoring Episode, reset sample sequence, clear temporal qualification windows, clear current workflow state, or mark the Camera offline. The selected video starts from time zero and subsequent frames continue through the same monitoring and evaluation flow. Existing clean or positive observations leave rolling windows naturally as new observations arrive.

Alert Evidence candidates must be time-bounded by the normal rolling evaluation window or Alert lifecycle rather than cleared because a scene changed. This prevents an old dirty frame from becoming evidence for a later unrelated Alert while preserving realistic continuity.

### 2.6 Monitoring ownership

**Confirmed** One lease-protected browser Monitoring Session owns Site Camera capture and frame submission. Other Supervisor browsers are viewers and do not submit duplicate frames.

**Confirmed** If the owner disappears, another open browser may claim the expired lease. The prototype assumes those browser sessions run on the same laptop. Device identity enforcement is out of scope.

**Confirmed 2026-09-05** Monitoring is owned at the authenticated application-session level, not by the Camera list or Camera detail page. Enabled Cameras keep playing and sampling while the user navigates anywhere in LitterSpot. Monitoring may stop after the final connected client/browser session closes.

Only authenticated Supervisor console sessions count toward that lifecycle. Cleaner mobile sessions neither own monitoring nor keep Site Camera processing alive.

### 2.7 Alert Evidence overlays

**Confirmed 2026-09-05** Continue retaining one selected Alert Evidence frame rather than ordinary sampled frames or continuous footage. For now, retain the complete set of model detections belonging to that selected frame so its annotated snapshot can show people, registered-bin results, and floor issues, even when only one issue type caused the Alert.

## 3. Open decisions

1. Practical validation of the finalized model's full-bin output.

## 4. Data reset and clean bootstrap

**Confirmed** Existing Firestore prototype data does not need to be migrated into the clarified schema. The team may clear application data and restart from a clean baseline.

**Confirmed** The clean baseline uses one Site named **Sunway Theme Park**. Batu Caves and Postman Test Site do not need to be preserved as tenants.

**Confirmed** No destructive reset has been executed yet. Reset requires an explicit implementation-time approval and exact target validation.

**Updated 2026-09-01** The current isolated development target is `litterspot-v2-database/(default)`. It began empty and was clean-bootstrapped for Phase 11 testing. The previous `litterspot-dev-jeremy/(default)` project is retained but no longer used after exhausting its Spark read quota. Existing shared-production Auth users, Firestore data, and `data/media-store` files remain untouched and are not reused.

The reset/bootstrap tooling must:

- require the configured cloud project to exactly match `EXPECTED_FIREBASE_PROJECT_ID` and database `(default)` after explicit validation;
- delete only an allowlisted set of LitterSpot application collections;
- support a dry run that reports document counts;
- bootstrap the new Site and Root Supervisor after the new identity schema exists;
- handle local media cleanup separately so Firestore reset cannot accidentally delete unrelated files.

**Confirmed environment isolation**:

- shared production Firebase project `litterspot` and named database `litterspot` are out of scope for this backend rebuild;
- persistent manual development uses `litterspot-v2-database/(default)`;
- automated tests continue using Firebase Auth and Firestore emulators under demo project `demo-litterspot`;
- the backend verifies `APP_ENV`, configured project ID, expected project ID, service-account project ID, and emulator-host consistency before connecting;
- development-cloud media uses a separate ignored local directory under `.local/dev-cloud-media`;
- the personal Web App configuration is ignored at `config/firebase-web.dev.json`, with only a placeholder example tracked.

## 5. Delivery and testing strategy

**Confirmed** Continue backend development API-first. Build and verify Node/Express, Firebase, FastAPI, and Orchestrator contracts before integrating the product frontend.

**Confirmed** The current repository `frontend/` is not the target of new product integration or product acceptance testing. Wait for the frontend teammates' replacement files before wiring product APIs into their interface.

Primary verification methods:

- backend and AI automated tests;
- Firestore emulator integration tests where relevant;
- Postman collection and scripted API workflows;
- contract and schema validation.

**Confirmed** Create a separate isolated API sandbox UI only when a workflow is impractical to verify through tests or Postman, such as browser Camera capture, Site Map plotting, Camera Registration geometry, video overlays, or Firestore real-time notification behavior.

The sandbox:

- lives outside `frontend/`;
- is not product UI;
- uses minimal styling and no teammate frontend components;
- may use hardcoded controls solely to exercise real APIs;
- can be replaced or removed after product frontend integration.

## 6. Decision log

### 2026-08-30 — Camera activation and replacement

- **Superseded 2026-09-05:** Laptop Camera monitoring no longer starts automatically after Camera Creation.
- Every newly published Camera is structurally active but starts with monitoring disabled until a Root or Regular Supervisor enables it.
- Monitoring-disabled simulation Cameras do not sample or generate repeated artificial Alerts.
- Turning monitoring off leaves existing Alerts and Work Orders unchanged.
- Enabling a simulation Camera restarts its video at time zero and clears only in-memory temporal state for a fresh demo episode.
- All downstream simulation records carry `isSimulation=true` while remaining part of the normal prototype workflow and analytics.
- Simulation traceability is internal only; there is no visible label or user-facing filter.
- Validated source replacement switches atomically and preserves both structural status and monitoring-enabled state.
- The prototype assumes one laptop and requires Camera re-registration if that laptop Camera view changes.

### 2026-08-30 — API-first delivery

- Backend APIs and service contracts are built and tested before product frontend integration.
- Current `frontend/` is excluded from new product integration and acceptance testing.
- Automated tests and Postman remain the default verification methods.
- A separate disposable sandbox UI is allowed only for browser-native or geometry-heavy API workflows.

### 2026-08-30 — Clean data restart

- Existing Firestore test data will not be migrated.
- The clarified backend starts from one clean Site named Sunway Theme Park.
- Batu Caves and Postman Test Site do not need to be retained.
- Destructive reset waits for explicit approval and uses validated, allowlisted tooling.
- The new development project began empty, so the first bootstrap needs no destructive reset.

### 2026-08-30 — Isolated development Firebase

- Persistent backend development and the prototype use the canonical project `litterspot-v2-database` with `(default)` Firestore.
- The shared production Firebase project remains untouched.
- Automated tests remain emulator-backed.
- Backend startup fails closed on project/credential mismatch.
- Development media and personal Web configuration stay in ignored local paths.

## 7. Phase 9 assignment revision

### 7.1 Alert–Cleaner pair selection

**Confirmed** The Orchestrator LLM chooses both the waiting Alert and the Cleaner as one Assignment Pair.

Node supplies a bounded backlog containing at most the top 10 waiting Alerts and every backend-validated available Cleaner. Node calculates facts and enforces constraints, but it does not preselect one Alert before asking the LLM.

The LLM returns:

```json
{
  "alertId": "alert-id",
  "cleanerId": "cleaner-id",
  "rationaleSummary": "Short structured explanation"
}
```

Node validates that both IDs were present in the trusted context and atomically reserves the Cleaner and creates Work for that Alert. A reservation conflict excludes only the failed pair/Cleaner as appropriate, refreshes the context and allows another model decision.

Node continues to calculate:

- Alert status, priority, severity and age;
- Cleaner account, schedule and Availability Override state;
- one-active-Work constraint;
- Site and map ownership;
- all map distances;
- recent-location freshness;
- Firestore transaction validity.

The LLM reasons across the valid combinations. It does not calculate geometry or override backend eligibility.

### 7.2 Returning-to-station location assumption

**Confirmed direction** An available Cleaner normally returns toward their Station Point after resolving Work. The Station Point remains the canonical home base and long-term assignment origin.

**Confirmed direction** The target of the most recently **resolved** Work Order may temporarily supplement the Station Point as a Recent Work Location. This is an approximate operational hint, not GPS or a claim about the Cleaner's exact current position.

Do not use dismissed Work as a location signal because dismissal does not prove that the Cleaner reached or completed the target.

The assignment context may include:

- current Station Point;
- distance from Station Point to each waiting Alert;
- most recent resolved Work target;
- resolution timestamp and minutes since resolution;
- distance from the Recent Work Location to each waiting Alert;
- an explicit `returning_to_station` uncertainty label.

Do not interpolate an invented position between the Work target and Station Point. LitterSpot has no route, walking-speed or live-location evidence to support that precision.

Ignore the Recent Work Location when its `mapRevisionId` differs from the Active Map Revision.

**Provisional freshness defaults awaiting calibration**:

```text
0–5 minutes after resolution: strong recent-location signal
>5–15 minutes: weak recent-location signal; consider both locations
>15 minutes: ignore recent location and use Station Point
```

The 15-minute window remains configurable and can later become Site-specific.

### 2026-08-30 — Assignment Pair and recent Work context

- Replaced Node-preselected single-Alert assignment with LLM-selected Alert–Cleaner pairs from the top 10 waiting Alerts.
- Node still validates all facts, eligibility, distances, versions and transactions.
- Station Point remains the canonical home base.
- Most recent resolved Work may act as a short-lived approximate location signal while the Cleaner returns to Station.
- Dismissed Work never updates the Recent Work Location.
- Recent Work is ignored across incompatible Site Map revisions.
- Exact walking-position interpolation remains out of scope.

## 8. 2026-09-03 — Cleaner Station Point and nearest-Zone revision

**Confirmed** A Cleaner Station Point may be anywhere inside the active Site Map boundary. It does not need to be inside a Zone.

**Confirmed** Zone membership does not restrict Cleaner assignment. Every available Cleaner remains eligible for Work anywhere in the Site; the Orchestrator receives validated straight-line distances to the Work target.

**Confirmed** Supervisor UI shows a derived **Nearest Zone** label for each Station Point. It is the active Zone with the shortest distance from the point to the Zone boundary. A Station Point inside a Zone has distance `0 m`. The value is display context only and is not stored as an assigned-Zone or eligibility rule.

The backend continues to require a valid, in-boundary Station Point. Missing, malformed, or out-of-bound points still make a Cleaner ineligible for automated assignment.

## 9. 2026-09-03 — Monitoring sample interval

**Confirmed** The prototype monitoring default is one sampled frame per second. This is the Site default for newly created Cameras and the default interval for uploaded-video processing when no interval is supplied.

The interval remains configurable. Existing Camera source revisions retain their recorded interval; changing the default does not rewrite published history.

## 10. 2026-09-04 — Read-first Cleaner details

**Confirmed** Clicking a Cleaner row opens a read-only Cleaner detail modal. It does not open the edit wizard directly.

The detail modal shows the Cleaner profile, effective availability and reason, current Work Order, read-only Station Point map with nearest Zone and metre coordinates, and all seven recurring schedule days.

**Confirmed** **Edit Cleaner** replaces the detail modal with the existing four-page edit wizard. The UI never stacks both modals. Saving returns to the refreshed detail view.

**Confirmed** Availability Override is a separate operational control in the detail modal. An active Cleaner without active Work can be marked unavailable or returned to schedule. Active Work continues to control busy availability and cannot be bypassed from this modal.

## 11. 2026-09-04 — Supervisor Work queue columns

**Confirmed** The Supervisor Work queue does not display the internal Work Order UUID. IDs remain available to API routing, audit logs, and developer tools.

The table uses that space for a **Next action** column derived from Work status and management mode. It shows who or what the Work is waiting for, plus the latest activity time. The Work title and instruction remain the primary row identity.

## 12. 2026-09-06 — Quota-safe live monitoring persistence

**Confirmed** Continuous development uses local Firebase Auth and Firestore emulators. The canonical cloud project is reserved for bounded acceptance runs after automated verification. Creating replacement cloud projects is not the development strategy.

**Confirmed** Per-frame AI Observations and Detection Signals are transient. Node evaluates confidence, magnitude, and rolling issue rules in memory. A persisted Flag represents the transition where an issue becomes confirmed; a continuing unchanged condition does not create a new Flag for every frame.

**Confirmed** Monitoring leases, live Camera frames, current overlays, rolling issue windows, evidence candidates, current runtime freshness, and active Camera Verification collectors live in the single Node prototype runtime. Node reloads durable configuration and unfinished Verification state during recovery.

Firestore remains authoritative for Camera configuration and Registration, confirmed Flags, Alerts and Alert Evidence, Work Orders, Verification outcomes, accounts, audit events, and compact analytics summaries.

Ordinary monitoring frames must perform no Firestore read or write after their runtime context is warm. Firestore changes occur for configuration and workflow transitions, bounded recovery/checkpoints, evidence replacement, and minute/daily analytics summaries.

**Accepted recovery trade-off** A Node crash may discard an unconfirmed rolling observation window, the current transient frame, and the unfinished minute accumulator. It must not lose an existing Alert, retained evidence, Work Order, Verification request/outcome, or configuration revision.

## 13. 2026-09-06 — Camera wall controls and return navigation

**Confirmed** The Camera wall removes the separate availability and unresolved-Alert summary strip. Zone filters remain the primary list scope. A separate right-aligned filter shows both, enabled-only, or disabled-only Cameras.

**Confirmed** A Camera card remains one large target that opens Camera Details. Its footer also contains a separate Enable or Disable button. Using that button changes monitoring without opening Camera Details. The adjacent condition badge shows Clear, Watch, or Action, while the video-stage badge independently shows Disabled, Offline, or Online.

**Confirmed** Zone indicator precedence is critical Alert, warning Alert, no enabled Camera online, then healthy. These render red, amber, grey, and green respectively. Only unresolved Alerts affect the first two states.

**Confirmed** Camera Details preserves its navigation origin. A Camera opened from a filtered Camera wall returns to the same Zone and monitoring-state filters. A Camera opened from Work returns to Work. Direct Camera links return to the unfiltered Camera wall.

**Deferred** Keep exact analyzed-frame overlays as the current rendering mode. Smooth live video with synchronized overlays may be reconsidered later and is not part of this update.

## 14. 2026-09-07 — Supervisor visibility, Camera reconfiguration, and Site entry

**Confirmed** Supervisor accounts use the structural lifecycle labels `active` and `disabled`. Cleaner availability language does not apply to Supervisor accounts.

**Confirmed** A Regular Supervisor may see the names and authority of other active Supervisors on the Team page. They do not see peer email addresses, disabled Supervisor accounts, or peer account-management controls. The Root Supervisor may see all Supervisor accounts, including disabled accounts, with name, email, authority, and lifecycle status.

**Confirmed** The signed-in Supervisor opens personal account controls from the header avatar. The account modal shows Supervisor name, email, Root or Regular authority, and Sign out. The Active Site header control is reserved for Site administration.

**Confirmed** Zone and structural Site Map administration remains Root-only. A Regular Supervisor cannot create, rename, reshape, or deactivate Zones; change Site dimensions or background; move a Camera; change its Zone placement; create a Camera; or change its structural lifecycle.

**Confirmed** Root and Regular Supervisors may control Camera monitoring and reconfigure the operational Camera view. Camera-view reconfiguration covers source replacement, reference replacement, and floor/bin Registration. Camera identity, Site Map placement, Zone assignment, creation, and structural activation or deactivation remain Root-only.

**Confirmed** The current `Reconfigure Camera` label is conceptually `Reconfigure Camera View`. The product should use clearer wording when that workflow is refined so it is not confused with Root-only structural placement.

**Confirmed** Camera-view reconfiguration begins with the active configuration visible. It shows the current reference image, current source metadata, the existing looped video when applicable, and the active floor and bin geometry. Keeping the source prepopulates the current reference and geometry for editing. Replacing the source keeps the old configuration visible for comparison but requires a new reference and fresh floor/bin plotting. Cancelling preserves the active configuration, and publishing replaces the source and Registration atomically.

**Confirmed** Site administration is entered through the Active Site control in the Supervisor header. It owns Site dimensions and background, Site Map drafts and publication, Zones, structural Camera placement and lifecycle, and Site-level audit history. Regular Supervisors may receive a read-only Site view, while Root Supervisors receive the mutation controls.

**Confirmed** Active Zones must be spatially disjoint. A newly created, moved, or reshaped Zone is invalid if its interior or boundary overlaps another active Zone, crosses another Zone edge, shares an edge or vertex, or touches another Zone at a single point. Near but separate Zones remain valid; the rule does not introduce a product-level minimum corridor width.

The frontend must run the same geometry rule while plotting and editing, identify the conflicting Zones, and block completion before submission. The backend remains authoritative and must validate the complete proposed Site Map again when a draft is saved, validated, and published. Direct API requests cannot bypass the rule.

## 15. 2026-09-07 — Site Map viewer, structural editing, and placement accuracy

**Confirmed** The Root Supervisor controls the Site Map Boundary by entering its real width and height in metres. The Site is not constrained to a fixed aspect ratio. Changing the boundary must revalidate every Zone, Camera Placement, Cleaner Station Point, and other retained Site coordinate before publication.

**Confirmed** The Map Viewer is a fixed-size window and preserves the Site Map Boundary's aspect ratio without stretching it. `Fit to Site` shows the complete boundary. Zooming and panning change only the view transform; they never change Site dimensions or stored metre coordinates. The viewer shows a zoom level, a scale indicator that follows zoom, and pointer coordinates in metres.

**Confirmed** Point and polygon workflows reuse the same Map Viewer and coordinate conversion rules. This includes Zone creation and reshaping, Camera Creation, Camera movement, Cleaner Station Point creation and editing, Manual Work coordinate placement, and read-only Cleaner map views. Desktop supports explicit placement mode, wheel or button zoom, and drag-to-pan. Touch layouts support pinch-to-zoom, one-finger pan, and an explicit placement action before a tap records a point.

**Confirmed** Site coordinates remain stable at every zoom level. The viewer converts screen coordinates through the current pan and zoom transform into Site metres before validation or persistence. Stored point precision is independent of display zoom; the interface must not imply meaningful sub-centimetre accuracy.

**Confirmed** One uploaded image represents the complete Site background. The product renders it once beneath one transparent grid and all Zone, Camera, Station Point, and Work overlays. It must not repeat the image inside grid cells. Root may scale and position the background inside the Site Map Boundary. The image must not be stretched to a mismatched aspect ratio, and the Site Map Boundary remains authoritative.

**Confirmed** The Root Site page contains Overview, Map & Zones, and Site audit history. It does not duplicate the Camera list or full Camera administration. Camera markers appear in the map workspace because Camera Placement belongs to the Site Map Revision. A selected marker shows structural context and links to Camera Details.

**Confirmed** The Camera page owns Camera identity, monitoring control, source media, reference capture, floor/bin Camera Registration, operational history, and the entry point for Root-only Camera movement. `Move Camera` opens the Site Map in placement mode with that Camera selected.

**Confirmed** A Root moving a Camera distinguishes two cases. A Map Position Correction changes only an inaccurate recorded coordinate and retains the active Camera Registration. A Physical Camera Move changes the real installation position or view and requires a new reference plus fresh floor/bin plotting. The replacement placement and Registration become operational atomically.

**Confirmed** A Camera Placement must resolve to exactly one active Zone. Reshaping or deactivating a Zone cannot publish while it leaves an active Camera outside every active Zone or inside more than one Zone. Root must move the Camera, restore valid Zone geometry, or structurally deactivate the Camera before publication.

**Confirmed** Camera Creation retains the Root-only option to create a provisional Zone. The workflow displays every active Zone and applies the same strict spatial-disjointness checks used by Site administration. The provisional Zone must be valid before Camera placement or continuation. The backend validates the complete proposed geometry, and publication commits the Zone, Camera Placement, source, and initial Camera Registration together. Cancelling discards the provisional Zone.

**Confirmed** The frontend gives immediate geometry feedback while a Zone is drawn or edited. It identifies the conflicting Zone, highlights invalid geometry, and blocks save, continuation, and publication. The backend independently rejects containment, area overlap, crossing edges, shared edges, shared vertices, single-point contact, self-intersection, zero-area polygons, fewer than three valid points, and out-of-bounds geometry. Automated coverage must include each invalid case and a valid case with a small positive gap.

**Confirmed** Root performs Site Map mutations through drafts. The active revision remains operational while Root edits, validates, reviews, publishes, or discards a replacement draft. Site audit history records successful and failed boundary, background, draft, Zone, Camera Placement, and structural Camera lifecycle actions with the real actor identity and authority. Site activation and deactivation remain Superadmin responsibilities.

**Confirmed delivery direction** The hardcoded Site page was an interaction prototype only. The next Site implementation replaces prototype records and simulated mutations with real frontend state, backend contracts, authorization, validation, revision publication, media storage, and audit persistence. The hardcoded data is not a fallback production mode.

**Confirmed** Resizing the Site Map Boundary preserves all existing Zone vertices, Camera Placements, Cleaner Station Points, and other coordinates as absolute metre values. The system does not scale them proportionally. Anything outside the replacement boundary becomes a blocking validation error that Root must correct before publication.

**Confirmed** Site Map coordinates use the existing image-aligned convention: `(0, 0)` is the top-left corner, X increases to the right, and Y increases downward. Background alignment, grid rendering, pointer conversion, geometry validation, and every point-placement workflow use this same convention.

**Confirmed** A Root choosing Map Position Correction must confirm that the physical Camera and its view did not move, provide a short reason, and receive a warning that Physical Camera Move requires fresh Camera Registration. The audit event records the reason and both old and new coordinates. A Physical Camera Move cannot use the correction path to retain stale Registration.

## 16. 2026-09-10 — Camera movement and active operations

**Confirmed** Map Position Correction is limited to another point inside the Camera's current active Zone. The frontend prevents placement in another Zone, and the backend independently rejects a correction whose derived Zone differs from the current Camera Placement.

**Confirmed** Publishing a Map Position Correction retains the active Camera source and Registration. Unresolved Camera Alerts and active Camera-targeted Work remain active. Their current point, Zone snapshot and `mapRevisionId` move to the corrected placement, while append-only events retain the old and new targets. An assigned Cleaner receives an immediate durable location-update notification. Waiting Alerts remain eligible for Orchestrator assignment on the replacement Active Map Revision.

**Confirmed** A Physical Camera Move may target another point in the current Zone, a different active Zone, or a valid provisional new Zone. A provisional Zone follows the same strict geometry rules as Camera Creation and remains non-operational until the Physical Camera Move publishes. Cancelling the draft discards the provisional Zone.

**Confirmed** Starting a Physical Camera Move creates a Root-only Camera Draft and continues directly into Camera Registration. The existing source may remain selected, but the old reference, walkable-floor polygon and bin regions cannot satisfy the draft. Root must capture a fresh reference and plot fresh floor/bin geometry before validation.

**Confirmed** Final Physical Camera Move publication atomically activates any provisional Zone, the new Camera Placement, source revision and Camera Registration. It dismisses every unresolved Alert and active Work Order tied to that Camera with system reason `camera_physically_moved`, releases affected Cleaners, removes active workflow locks, stops stale automated assignment or review through normal revision checks, notifies affected Cleaners, and preserves evidence and event history. Cancelling an unfinished move changes none of the active operations.

**Confirmed** If a Root encounters an existing unfinished Physical Camera Move while reopening Move Camera or Camera View reconfiguration, the product recovers that draft and returns to its fresh-reference step instead of leaving the Camera behind an unrecoverable draft-lock error.

## 17. 2026-09-12 — Camera removal

**Confirmed** Remove from Site is a Root-only terminal Camera lifecycle action. It is distinct from reversible monitoring disablement and does not hard-delete published Camera history.

**Confirmed** Camera removal stops monitoring, publishes a replacement Active Map Revision without the Camera Placement, dismisses unresolved Camera Alerts and active Camera Work with system reason `camera_removed`, releases and notifies affected Cleaners, removes active workflow locks, and requests a fresh Orchestrator assignment cycle when Work was dismissed.

**Confirmed** Removal automatically discards unfinished configuration or Physical Camera Move drafts and their draft-owned media. A separate Site Map draft blocks removal until Root publishes or discards that draft.

**Confirmed** The Camera record enters terminal status `removed`. Published source revisions, Camera Registration revisions, retained evidence, Alerts, Work, and audit history remain available. Returning the physical device to operations requires Camera Creation with a new Camera identity and Registration.
