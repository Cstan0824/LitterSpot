# LitterSpot product requirements

## 1. Product definition

LitterSpot is a web-based cleanliness operations system for one physical venue per client Site. It combines configured Camera views, local vision inference, structured Alerts, Cleaner assignment, Work tracking, Verification, and Site-level operational reporting.

The product is an operational prototype. It uses cloud Firebase Authentication and Firestore, while Camera media and retained evidence are stored on the machine running the Node backend.

## 2. Users

| User | Product responsibility |
| --- | --- |
| LitterSpot Superadmin | Creates Sites and first Root Supervisor accounts, changes Site status, recovers Root access, views Site operations, and reviews Superadmin audit history |
| Root Supervisor | Controls Supervisor accounts, Site Map structure, Camera Placement, Camera Creation, Camera movement, and Camera removal; also performs daily Supervisor operations |
| Regular Supervisor | Monitors Cameras, manages Cleaner records, Alerts, Work Orders, Verification, Camera Registration, and Orchestrator controls within one Site |
| Cleaner | Views one Site-scoped mobile workspace, performs assigned Work, uploads required Completion Evidence, and submits Work for review |
| Orchestrator | Automated service actor that selects validated Alert and Cleaner pairs and applies deterministic review outcomes through Node-controlled operations |

## 3. Product outcomes

LitterSpot must:

- turn qualifying Camera observations into one durable cleanup Alert per Camera and issue type;
- assign Work only to an eligible Cleaner;
- preserve evidence and state history for operational review;
- keep Site data isolated between clients;
- give Supervisors current Camera, Alert, Work, Cleaner, and system status;
- support manual operational control when automation is paused or unsuitable;
- preserve published spatial, Camera, Alert, and Work history when configuration changes.

## 4. Product modules

### 4.1 Site and spatial administration

The module provides:

- Site creation, activation, deactivation, and Root Supervisor recovery;
- Root and Regular Supervisor account management;
- one active Site Map with real-metre width, height, grid size, and optional aligned background;
- non-overlapping Zone polygons;
- Camera Placements inside exactly one Zone;
- Cleaner Station Points anywhere inside the Site boundary, including unzoned areas;
- immutable published map revisions and one editable draft;
- distinct workflows for Map Position Correction, Physical Camera Move, and Camera Removal.

Superadmin Site View reuses operational pages without granting Supervisor mutation controls.

### 4.2 Camera monitoring and AI

The module provides:

- guided Camera Creation with placement, source, reference image, walkable-floor polygon, optional registered-bin polygons, validation, and publication;
- laptop-camera and looped-video sources;
- deliberate monitoring enablement after publication;
- one browser-owned Monitoring Session per Site;
- automatic ownership transfer after lease expiry;
- adaptive sampling based on Camera Detail, visible grid cards, positive observations, and Verification needs;
- private FastAPI analysis of people, registered or localized bins, floor litter, and floor spills;
- delayed analyzed playback for the capture-owner Camera Detail view;
- exact analyzed snapshots for grids and secondary Supervisor browsers.

### 4.3 Alert and evidence management

The module provides:

- issue qualification for floor litter, floor spill, and bin service;
- durable Flags after qualification;
- one active Alert key per Site, Camera, and issue type;
- warning and critical severity with age-based priority;
- highest-confidence qualifying Alert Evidence with complete overlay geometry;
- Supervisor assignment and dismissal controls;
- Alert linkage to one active Work Order;
- immutable occurrences and transition events.

Ordinary negative observations do not resolve Alerts. Resolution occurs through explicit Work Verification.

### 4.4 Cleaner and Work operations

The module provides:

- Cleaner account provisioning, weekly schedules, Station Points, activation state, and Supervisor availability override;
- calculated availability based on Site, account, Cleaner, schedule, Station Point, and active Work state;
- Alert-driven and Supervisor-created Manual Work Orders;
- Camera or coordinate targets;
- assigned, in-progress, awaiting-review, resolved, and dismissed states;
- Cleaner mobile access to current Work, map context, evidence, schedule, notifications, and profile;
- required Completion Evidence for Manual Work;
- passed, failed, and inconclusive Verification outcomes;
- Supervisor takeover, reassignment, dismissal, review, and override controls;
- durable in-app notifications.

### 4.5 Orchestration and operational intelligence

The module provides:

- outbox-triggered assignment and review processing;
- a bounded, Node-validated assignment context;
- Alert and Cleaner pair selection by the configured assignment provider;
- lease-protected and idempotent Orchestrator Runs;
- automatic application of passed and failed Camera Verification outcomes for orchestrated Work;
- pause and resume controls without stopping Camera monitoring;
- dashboard summaries, busy-Zone rankings, daily analytics, and bin-placement recommendations;
- structured system status, safe failure events, audit history, and decision traces.

## 5. Product constraints

- Each Site is both a tenant and one physical venue.
- The system has no separate organization entity.
- Site locations use an approximate two-dimensional metre coordinate plane, not GPS or an external map provider.
- Monitoring capture is browser-owned and stops when no authenticated Supervisor console maintains the lease.
- Only one laptop-camera source may be enabled per Site at a time.
- Delayed playback depends on browser `MediaRecorder` and `MediaSource` support.
- Inference is sampled, not performed on every displayed video frame.
- Media remains local to the backend host and is not stored in Firebase Storage.
- Multiple Node instances do not share in-memory monitoring state or the local media directory.
- Model outputs are operational inputs, not guaranteed physical ground truth.
- The primary product UI and current Site Map and Camera workflows enforce Root-only structural control. The mounted generic `/api/sites`, `/api/zones`, and `/api/cameras` compatibility routes remain Supervisor-gated and are not fully Site-scoped; this is an implemented security limitation.

## 6. Product boundaries

The implemented product does not include:

- GPS Cleaner tracking;
- Firebase Storage media persistence;
- email, SMS, or browser push notifications;
- per-frame inference at source frame rate;
- direct model or Python writes to Firestore;
- multi-device synchronization of local media;
- Superadmin performance of daily Supervisor mutations;
- automatic Alert resolution from ordinary monitoring;
- hard deletion of published Camera history.

## 7. Acceptance basis

The product is accepted against the current automated suites and explicit manual Camera/demo checks documented in [testing](testing.md). The authoritative behavior is the committed code and its passing tests, not superseded planning records.
