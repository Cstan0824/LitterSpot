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

### 2.2 Source types

**Confirmed** The first Camera created for a Site is forced to use the laptop webcam source. Later prototype Cameras use looped simulation videos.

**Confirmed** The prototype assumes operation on one laptop. The product does not enforce a designated-device identity. If the laptop or webcam view changes, a Supervisor reconfigures the reference and replots the Camera Registration.

### 2.3 Camera status and monitoring control

**Confirmed** Completing laptop Camera Creation automatically activates that Camera.

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

### 2.6 Monitoring ownership

**Confirmed** One lease-protected browser Monitoring Session owns Site Camera capture and frame submission. Other Supervisor browsers are viewers and do not submit duplicate frames.

**Confirmed** If the owner disappears, another open browser may claim the expired lease. The prototype assumes those browser sessions run on the same laptop. Device identity enforcement is out of scope.

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

- Laptop Camera activates automatically after complete Camera Creation.
- Looped-video Cameras are structurally active but start with monitoring disabled until a Root or Regular Supervisor enables them for a demonstration.
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
