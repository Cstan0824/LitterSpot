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

**Confirmed current state** The isolated development project currently has zero Firebase Authentication users and zero Firestore collections. Initial bootstrap requires no deletion. Existing shared-production Auth users, Firestore data, and `data/media-store` files remain untouched and are not reused.

The reset/bootstrap tooling must:

- target only the isolated development Firebase project `litterspot-dev-jeremy` and database `(default)` after explicit validation;
- delete only an allowlisted set of LitterSpot application collections;
- support a dry run that reports document counts;
- bootstrap the new Site and Root Supervisor after the new identity schema exists;
- handle local media cleanup separately so Firestore reset cannot accidentally delete unrelated files.

**Confirmed environment isolation**:

- shared production Firebase project `litterspot` and named database `litterspot` are out of scope for this backend rebuild;
- persistent manual development uses `litterspot-dev-jeremy/(default)`;
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

- Persistent backend development uses separate project `litterspot-dev-jeremy` with `(default)` Firestore.
- The shared production Firebase project remains untouched.
- Automated tests remain emulator-backed.
- Backend startup fails closed on project/credential mismatch.
- Development media and personal Web configuration stay in ignored local paths.
