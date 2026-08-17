# LitterSpot requirements baseline

## 1. Document purpose

This document is the working requirements reference for the LitterSpot prototype. It consolidates the initial PDF requirements and later decisions made by the project owner so that routine design and implementation work does not require rereading every PDF.

The source PDFs remain the base documents and should be used to cross-check this summary when:

- a requirement is unclear;
- a use-case flow needs its original wording or diagram;
- a requirement changes;
- a conflict is discovered between this file and another project document.

This baseline is intentionally changeable. When a requirement changes, update this file and add an entry to the change log instead of silently replacing the old decision.

### Requirement status labels

- **Implemented**: present in the current repository/runtime baseline.
- **Approved target**: explicitly approved for future implementation but not
  yet available in the current runtime.
- **Confirmed**: explicitly approved for the current prototype.
- **Source requirement**: present in the supplied PDFs but not yet refined into a final implementation decision.
- **Proposed**: recommended design that still requires project-owner approval.
- **Deferred**: outside the first prototype but expected in a later version.
- **Optional**: may be included when practical but is not required for the first prototype.

## 2. Source documents

The following PDFs were reviewed on 2026-08-11. They were outside the repository in `/Users/jeremychin/Downloads/` when this baseline was created.

1. `LitterSpot overall initial requirements.pdf`
2. `User Management Module.pdf`
3. `Detection Module Requirements.pdf`
4. `Flag and Alert Module.pdf`
5. `Dashboard Module Requirements.pdf`
6. `Bin Placement Analysis module.pdf`

The dashboard and bin-placement documents currently contain use-case and activity diagrams but do not yet contain detailed textual use-case descriptions.

## 3. Confirmed prototype architecture and ownership

The complete architecture decision, component boundaries, and request flows are documented in [architecture.md](./architecture.md).

The planned backend migration and Firestore design are documented in
[backend-build-and-migration-plan.md](./backend-build-and-migration-plan.md) and
[firestore-data-model.md](./firestore-data-model.md). The approved Cleaner,
autonomous-orchestrator, and Option A deployment extension is specified in
[autonomous-orchestrator-and-cleaner-plan.md](./autonomous-orchestrator-and-cleaner-plan.md).

### 3.1 Technology boundaries

- **React frontend**: the browser user interface.
- **Node.js/Express backend**: the main application backend and owner of business workflows.
- **Firebase Authentication**: currently Supervisor authentication; approved
  target adds Cleaner authentication and role-aware access.
- **Cloud Firestore**: primary application database.
- **FastAPI AI service**: private inference service called by Node.js.
- **Local filesystem**: snapshot and uploaded-media storage during prototype development.

The Node.js backend is the only public application API. The React frontend should not call the private AI service directly.

### 3.2 Team ownership

- The application-backend owner builds Node.js/Express, Firebase integration, business rules, and the integration contract with FastAPI and React.
- The model-training teammates provide trained model weights and Python inference code.
- Packaging the inference code and weights behind FastAPI is part of application integration; the model-training teammates are not assumed to deliver a complete inference service.
- The frontend teammates build the React layer against the Node.js API contract.

### 3.3 Authoritative state

FastAPI performs model inference but does not own Supervisor profiles, cleaner records, cameras, zones, detections, flags, alerts, status history, or analytics state. Node.js validates inference responses and persists the authoritative business records in Firestore.

## 4. Actors and access control

### 4.1 Implemented actor baseline

**Implemented:** the current backend has one authenticated system-user role,
`Supervisor`.

Cleaners begin as personnel records maintained by a Supervisor. Phase 10 can
explicitly provision a linked Firebase Authentication identity without
changing the Cleaner business document ID. Provisioned active Cleaners are
system actors only within their own mobile profile, presence, work queue, and
notification inbox.

The Supervisor is an all-powerful authenticated user who may:

- log in and log out;
- create, view, edit, and deactivate cleaner personnel records;
- register cameras and assign them to monitored locations;
- upload images and videos for processing;
- view detections, evidence, alerts, status history, dashboard information, and analytics;
- update alert status;
- view and export bin-placement analysis.

The Supervisor permissions remain implemented. The Phase 10-11 Cleaner role
split described below is now implemented at the backend boundary.

### 4.2 Automated system actor

Requirements diagrams sometimes show the `System` as an actor. It represents automatic processing rather than a human or an external user. Its responsibilities include inference coordination, detection validation, flag and alert creation, persistence, analytics, and failure reporting.

### 4.3 Extended actors

The next version adds two actors without deleting the current Supervisor role:

1. **Cleaner:** a Firebase-authenticated mobile-web/PWA user. The Supervisor
   provisions the account and assigns permitted sites/zones. The Cleaner may
   publish availability/location, receive and accept/reject their own work,
   start it, and mark it ready for review. The Cleaner cannot browse the whole
   system or resolve an alert directly.
2. **Autonomous AI Supervisor:** a private LangGraph/LLM orchestrator that
   receives alert events, gathers operational facts, chooses and reassigns
   Cleaners, issues instructions, requests fresh evidence, reviews completed
   work, and resolves or reopens work without routine human approval.

The human Supervisor becomes the oversight, reporting, configuration, override,
and emergency-stop actor. The normal assignment and review path must operate
without a human approval step.

The LLM owns operational reasoning and selection. Node.js owns typed tools,
authorisation, state-machine validation, idempotency, hard invariants, and
Firestore commits. The orchestrator must not write Firestore directly.

## 5. Confirmed detection scope and input roadmap

### 5.1 Required AI capabilities

The first prototype must support:

1. floor-litter detection;
2. overflowing-bin detection;
3. people counting.

Liquid-spill detection is **optional** for the first prototype. Existing model support may be integrated, but low model accuracy must not block the required prototype workflow.

### 5.2 Input phases

**Confirmed first prototype:**

- uploaded image files;
- uploaded video files.

**Deferred:** live CCTV/IP-camera streams. Camera registration and the data model should still be compatible with a later stream source.

Uploaded media must include or be assigned the relevant site, zone, and capture time. Without location and time metadata, the media can demonstrate inference but should not be treated as reliable historical analytics data.

## 6. Core business workflow

```text
Uploaded image/video
  -> Node validates upload and location metadata
  -> Node sends media or sampled frame to private FastAPI service
  -> FastAPI returns detections and people count
  -> Node validates and stores raw detections and people observations
  -> Node creates one grouped issue observation per run and cleanliness issue
  -> a positive grouped issue observation creates at most one flag
  -> repeated flags are confirmed by the issue-specific temporal rule
  -> a confirmed condition creates or updates one active zone/issue alert
  -> Supervisor reviews alert and updates its status
  -> detections, observations, alerts, and histories feed dashboard and analytics
```

The intended traceability chain is:

```text
media/frame -> inference result -> raw detections -> grouped issue observation
            -> optional flag -> temporally confirmed alert -> status history
```

Every evaluated run creates a positive or negative issue observation for floor
litter, bin overflow, and optional floor spill. People-count observations feed
analytics but do not create cleanliness flags or alerts by themselves.

### 6.1 Approved autonomous continuation after alert creation

```text
confirmed alert
  -> create/resume one durable orchestrator run for the alert
  -> LLM retrieves eligible Cleaners, live status, workload, location, and evidence
  -> LLM chooses a Cleaner and instructions
  -> Node validates and persists the work order
  -> Cleaner receives FCM/in-app notification and performs the work
  -> Cleaner marks the work ready for review
  -> orchestrator requests fresh evidence and reviews the result
  -> clean: complete work order and resolve alert
  -> not clean: request rework or reassign
  -> uncertain: collect more evidence or raise a visible exception
```

Alert, work order, and review must remain separate records. The current Phase 4
alert rules remain the trigger and are not replaced by the LLM.

## 7. User Management Module

The original module name is retained, but it contains three concerns:

1. Supervisor authentication and the current Supervisor's own profile/session.
2. Cleaner-directory CRUD and site/zone/capability permissions.
3. Explicit Cleaner Firebase Auth provisioning, role access, disablement, and
   reconciliation while preserving the Cleaner business ID.

Creating and administering additional Supervisor login accounts is outside the current User Management screen. The first Supervisor account is provisioned through a controlled bootstrap process. The data design may support more than one Supervisor account with the same role later, but that administration workflow is not currently required.

Existing personnel records remain valid and the implemented idempotent
migration adds default permissions/account fields before a Supervisor
provisions Firebase Authentication. The following requirements are now part of
the backend baseline:

| ID | Target requirement | Status |
| --- | --- | --- |
| UMM-FR-07 | Allow a Supervisor to provision/invite a Cleaner login and assign permitted sites/zones. | **Backend implemented** |
| UMM-FR-08 | Allow an active Cleaner to authenticate and access only their own profile, notifications, and work orders. | **Backend implemented** |
| UMM-FR-09 | Allow a Cleaner to publish online/offline/busy/break availability and consented device-location heartbeats. | **Backend implemented** |
| UMM-FR-10 | Disabling a Cleaner must prevent login and future assignment while preserving history. | **Backend implemented** |
| UMM-FR-11 | Enforce role-specific Node.js authorisation for Supervisor, Cleaner, and private orchestrator tools. | **Supervisor/Cleaner backend implemented; private orchestrator tools remain Phase 12** |

### 7.1 Cleaner mobile operations and work orders

| ID | Requirement | Status |
| --- | --- | --- |
| CMO-FR-01 | Allow a Cleaner to give/revoke location consent and publish online, break, or offline heartbeats. | **Backend implemented** |
| CMO-FR-02 | Derive fresh/stale/unavailable location status; never trust a client-supplied freshness label. | **Backend implemented: five-minute freshness** |
| CMO-FR-03 | Retain idempotent detailed location history for a short privacy window. | **Backend implemented: seven-day dry-run-first cleanup** |
| CMO-FR-04 | Allow only a linked, active, permitted, capable, freshly online Cleaner with no active work to receive normal assignment. | **Backend implemented; explicit Supervisor availability override audited** |
| CMO-FR-05 | Enforce one active work order per alert and one primary Cleaner per work order. | **Backend implemented** |
| CMO-FR-06 | Allow the assigned Cleaner to accept/reject, start, and submit work for review. | **Backend implemented** |
| CMO-FR-07 | Allow Supervisor reassignment, rework, completion, and cancellation overrides with immutable history. | **Backend implemented** |
| CMO-FR-08 | Persist assignment/reassignment/rework/cancellation notifications even when FCM cannot deliver push. | **Backend implemented** |
| CMO-FR-09 | Make create, heartbeat, reassignment, transition, notification, and replay operations semantically idempotent. | **Backend implemented** |
| CMO-FR-10 | Prevent Cleaner submission from directly resolving the cleanliness alert. | **Backend implemented; Phase 14 will connect review-to-alert resolution** |

### 7.2 Original functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| UMM-FR-01 | Allow an authorised Supervisor to log in with valid credentials. | Source requirement |
| UMM-FR-02 | Allow a logged-in Supervisor to log out securely. | Source requirement |
| UMM-FR-03 | Allow an authenticated Supervisor to create a cleaner personnel record. | **Confirmed interpretation of source requirement** |
| UMM-FR-04 | Allow an authenticated Supervisor to view cleaner information and the cleaner directory. | **Confirmed interpretation of source requirement** |
| UMM-FR-05 | Allow an authenticated Supervisor to update cleaner information and zone assignment. | **Confirmed interpretation of source requirement** |
| UMM-FR-06 | Allow an authenticated Supervisor to deactivate a cleaner record. | **Confirmed; deactivation replaces permanent deletion** |

### 7.2 Use-case summary

#### UMM-UC-01 - User Login

- Requires a registered, active account.
- Accepts email and password.
- Rejects missing fields and invalid credentials.
- On success, authenticates the Supervisor, retrieves account information, and redirects to the dashboard.

#### UMM-UC-02 - User Logout

- Terminates the authenticated session and prevents further restricted access.
- Redirects to the login page.
- An expired session also redirects to login.

#### UMM-UC-03 - Create Cleaner Record

- Collects a unique staff ID, full name, phone number, assigned cleaning zone, and active status.
- Validates required fields, staff-ID format/uniqueness, phone formatting, and that the assigned zone exists.
- Supports cancellation without creating a record.
- Does not request an email/password for authentication and does not create a Firebase Authentication identity.

#### UMM-UC-04 - View Cleaner Record

- Displays the cleaner directory and allows search and selection.
- Handles an empty list and no matching search result.

#### UMM-UC-05 - Edit Cleaner Record

- Supports edits to name, phone number, assigned zone, status, and other agreed personnel fields.
- Validates required fields, formatting, and referenced zones.
- Handles no-op saves and cancellation.

#### UMM-UC-06 - Deactivate Cleaner Record

- **Confirmed change from the detailed PDF:** do not permanently delete the cleaner record.
- Mark the cleaner inactive so the person is excluded from active assignment choices.
- Preserve the personnel record and historical assignment references.
- In the implemented baseline, no login access change occurs because the record
  is not authenticated. After target migration, deactivation must also disable
  the linked Firebase Authentication identity.
- Requires confirmation and supports cancellation.

#### UMM-UC-07 - View Cleaner Directory

- Retrieves and displays cleaner personnel records on the Cleaner Management page.

## 8. Detection Module

### 8.1 Functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| DM-FR-01 | Allow a Supervisor to register a camera and assign it to a monitoring zone. | Source requirement; camera streams deferred |
| DM-FR-02 | Receive visual input from registered cameras or uploaded images. | **Confirmed initially as uploaded images and videos** |
| DM-FR-03 | Detect floor litter, liquid spills, overflowing bins, and people. | **Confirmed except spills are optional** |
| DM-FR-04 | Record issue type, confidence, camera zone, timestamp, and snapshot evidence. | Source requirement |

### 8.2 DM-UC-01 - Register Camera Zone

- The Supervisor supplies camera name, source, physical location, and monitoring zone.
- The system validates required fields and formatting.
- Duplicate camera sources are rejected.
- The source document expects a camera-connection check and an unavailable-source error.
- For the upload-first prototype, a camera may be registered as metadata without an active stream. Live connection validation becomes required when streaming is implemented.
- Cancellation leaves no camera record.

### 8.3 DM-UC-02 - Detect Cleanliness Issues

- Receives an uploaded image or a sampled video frame associated with a registered location.
- Invokes the appropriate models through FastAPI.
- Required outputs cover floor litter, bin overflow, and people count; spill results are optional.
- Valid cleanliness detections are stored with evidence and grouped by run and issue type before the flag workflow.
- People-count observations are stored for analytics but do not enter the flag workflow.
- Invalid frames are rejected, a processing error is recorded, and subsequent frames continue.
- Service or source failures are recorded and surfaced to the Supervisor.
- Low-confidence detections are retained for review but do not create a flag.
- A processed frame with no supported cleanliness issue may still produce an observation record for people count, model health, and analytics coverage.

### 8.4 Minimum inference response information

The integration contract must eventually standardise at least:

- inference request/frame identifier;
- model name and version;
- media type and original upload identifier;
- frame timestamp or video offset;
- image dimensions;
- issue class;
- confidence score;
- bounding box or segmentation information when available;
- people count and, when available, person bounding boxes;
- processing time;
- error or warning information.

Node.js adds trusted application context such as Supervisor, site, zone, camera, and server timestamps rather than trusting those values from FastAPI.

## 9. Flag and Alert Module

### 9.1 Functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| FAM-FR-01 | Automatically create a cleanliness flag when a qualifying issue is detected. | Source requirement |
| FAM-FR-02 | Automatically generate an alert from a valid cleanliness flag. | Source requirement |
| FAM-FR-03 | Let a Supervisor view issue type, zone, severity, timestamp, confidence, and snapshot evidence. | Source requirement |
| FAM-FR-04 | Track current status and status history for every alert. | Source requirement |
| FAM-FR-05 | Let a Supervisor update status as New, Acknowledged, In Progress, or Resolved. | Source requirement with confirmed transition policy |

### 9.2 Flags and alerts

**Confirmed:** flags and alerts are separate records.

- A **detection** is a model result plus its application context.
- An **issue observation** is the grouped result for one analysis run and one cleanliness issue. It exists for both positive and negative samples.
- A **flag** is the optional internal record created when a grouped issue observation passes the configured per-sample business criteria. One group creates at most one flag even when it contains many detections.
- An **alert** is the Supervisor-facing work item generated only after the relevant sequence of flags satisfies its temporal confirmation rule.

This separation preserves traceability and allows detections and negative
observations to be retained even when no flag or alert is created. Test uploads
still calculate and store grouping metrics, but their observations are marked
excluded and never enter confirmation, flags, alerts, or analytics.

### 9.3 FAM-UC-01 - Create Cleanliness Flag

- Validate the analysis run and its raw detection data.
- Group detections by issue type and create one deterministic issue observation for each supported issue, including negative observations.
- Calculate confidence and issue-specific magnitude metrics from the group and snapshot evidence.
- Create at most one deterministic flag for a positive grouped observation and link all eligible member detections.
- Forward the grouped flag to per-camera temporal confirmation.
- Reject incomplete detections and record validation errors.
- Retain below-confidence and below-dirty-magnitude detections and observations for review without creating a flag.
- Record persistence failures and support retry when the database becomes available.

### 9.4 FAM-UC-02 - Generate or Update Alert

- New valid flags enter a confirmation buffer scoped to the same camera, zone, and issue type.
- Floor litter confirms when at least three of the latest five observations are positive within 30 minutes.
- Bin overflow confirms when at least two of the latest three observations are positive within 15 minutes.
- Floor spill confirms after two consecutive positive observations within 10 minutes.
- **Confirmed:** maintain one active alert per zone and issue type. Confirmation signals from different cameras do not combine, but a confirmed camera signal attaches to the shared zone alert.
- If no matching active alert exists and the temporal rule confirms, create an alert linked to the supporting grouped flags with initial status `New`.
- If a matching active alert exists, do not create another alert. Attach each new positive grouped flag as an occurrence and update last-seen information.
- Negative observations do not attach to an alert and do not resolve it automatically.
- Resolving an alert releases its active key and advances the zone/issue reset generation. A later incident must satisfy a fresh post-resolution confirmation sequence.
- Storage failures must be recorded and retried safely without creating duplicates.

### 9.5 FAM-UC-03 - View Alert Details

Display:

- issue type;
- site, zone, and camera;
- severity;
- first-detected and latest-detected timestamps;
- confidence information;
- current status;
- snapshot evidence and later occurrences.

If evidence is unavailable, display the remaining details and an image-unavailable message. Handle missing alerts, no available alerts, and database unavailability.

### 9.6 FAM-UC-04 - View Alert Status and History

- Display current status and chronological history.
- Each history record contains previous status, new status, update timestamp, and responsible Supervisor.
- An untouched alert displays `New` and indicates that no previous changes exist.
- Incomplete history should not hide valid remaining entries.

### 9.7 FAM-UC-05 - Update Alert Status

The normal progression is:

```text
New -> Acknowledged -> In Progress -> Resolved
```

**Confirmed:** forward stages may be skipped. The allowed first-version transitions are:

| Current | Allowed next status |
| --- | --- |
| New | Acknowledged, In Progress, Resolved |
| Acknowledged | In Progress, Resolved |
| In Progress | Resolved |
| Resolved | None |

Backward transitions and reopening a resolved alert are not part of the first version. Every successful change must atomically update the alert and append its status-history record. Cancellation or a failed write preserves the current status.

### 9.8 Provisional policy and calibration

- The implemented temporal rules are the prototype defaults recorded above.
- Floor-litter grouping considers merged-region count, mask coverage, and spatial distribution rather than treating each model box as a separate dirty-place alert.
- Confidence floors, floor-litter magnitude weights/thresholds, severity mapping, and time windows remain provisional and must be configurable/calibrated with representative attraction footage.
- Absence does not automatically resolve a Supervisor work item in the first version.

Changing a policy version must not silently mix old pending confirmation samples with the new policy.

## 10. Dashboard Module

### 10.1 Functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| DB-FR-01 | Display active alerts, cleanliness issues, zone information, and summary statistics. | Source requirement |
| DB-FR-02 | Display a live detection view with camera input, bounding boxes, issue types, and confidence scores. | Source requirement; true live stream deferred |

### 10.2 Diagram-derived functions

The current dashboard diagrams require:

- dashboard overview;
- latest or recent alerts;
- detection history;
- a detection visualisation view;
- a clear data-unavailable state.

For uploaded images and videos, "live detection" initially means viewing the latest processed upload or video frame with its overlays. It becomes a true live camera view in the streaming phase.

Detailed dashboard use cases, filters, pagination, chart definitions, refresh behaviour, and empty/error states remain to be written.

## 11. Bin Placement Analytics Module

### 11.1 Source functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| BPA-FR-01 | Generate heatmaps for frequent litter, spills, bin overflow, or high visitor density. | Source requirement; spill optional |
| BPA-FR-02 | Analyse historical detections, visitor counts, issue frequency, camera zones, and detection times. | Source requirement |
| BPA-FR-03 | Generate bin-placement recommendations and reports from the analysed data. | Source requirement |

**Confirmed output scope:** the prototype ranks **priority zones** for bin placement. It does not need to recommend an exact physical point or coordinate inside a zone.

### 11.2 Diagram-derived functions

- View a heatmap.
- Filter the heatmap.
- Detect and display insufficient-data conditions.
- Analyse relevant factors.
- Generate a bin-placement recommendation with reasons.
- View, export, or print the analysis report.

Detailed use-case descriptions are still pending and may change.

## 12. Confirmed tourist-attraction location model

**Status: Confirmed for the prototype.**

Use the deliberately simple hierarchy:

```text
site -> cleaning zone -> camera
```

### 12.1 Meaning of each level

- **Site**: one tourist attraction or managed property, such as Batu Caves or Sunway Lagoon.
- **Cleaning zone**: the smallest location for which a Supervisor can assign and resolve a cleaning issue, such as Stair Section A, Food Court Row 2, or Water Park Entrance Queue.
- **Camera**: a physical or logical visual source assigned to exactly one primary cleaning zone for the first version.

A zone may have multiple cameras. Future versions may allow one camera to cover multiple zones, but that requires field-of-view mapping and should not complicate the prototype.

### 12.2 Recommended location fields

- stable ID and human-readable name;
- parent ID;
- active/inactive status;
- optional description;
- optional map image reference;
- optional latitude/longitude or local map coordinates;
- optional zone polygon or centroid;
- timezone and scheduled operating hours at site level.

Zones may be named broadly or narrowly enough to represent the operational sections needed by each attraction. A separate area layer is intentionally excluded from the prototype; it can be introduced later only if real reporting or navigation requirements justify it.

## 13. Bin-placement priority-zone analytics

**Output scope: Confirmed. Implementation method: Proposed and intentionally provisional.** The prototype must rank priority zones. The scoring method may change when the detailed use cases are written.

### 13.1 Analysis approach

The priority-zone analysis does **not** require another trained AI or machine-learning model for the first version.

The trained vision models already perform the machine-learning task of converting images and video frames into measurements:

- litter detections;
- overflow detections;
- people counts;
- optional spill detections.

Node.js can aggregate those measurements by zone and time, apply an explainable configurable score, and rank the zones. This is a statistics and business-rules problem rather than a new computer-vision problem.

A separate trained analytics model would only become useful after the project has enough reliable historical outcome data, such as previous bin-placement decisions and measured before-and-after cleanliness results. The prototype does not have labelled ground truth for a "correct priority zone," so training a model now would add complexity without a trustworthy learning target.

### 13.2 Data to retain

For each processed time sample or video interval, retain:

- site, zone, and camera;
- capture timestamp and processing timestamp;
- model and model version;
- processed-frame count and service success/failure;
- people count;
- floor-litter detections and confidence;
- overflow detections and confidence;
- optional spill detections;
- links to deduplicated alerts;
- camera or source availability.

For each alert, retain first seen, last seen, occurrence count, resolved time, status history, and evidence references.

### 13.3 Aggregation

Aggregate raw observations into configurable time buckets, initially hourly, by camera and zone. From those buckets derive:

- average and peak people count;
- visitor exposure over time;
- new litter-incident count;
- new overflow-incident count;
- repeat occurrence count;
- issue persistence duration;
- alert resolution duration;
- camera/data coverage percentage.

Counts used for recommendation scoring should be based on deduplicated incidents or time buckets, not every video frame. Otherwise one persistent piece of litter would be counted hundreds of times.

### 13.4 Prototype scoring

Normalise each factor to a 0-100 value within the selected site and time range. A first configurable heuristic may be:

```text
zone priority =
    35% litter burden
  + 30% visitor pressure
  + 25% overflow burden
  + 10% issue persistence
```

The initial weights are an explainable prototype heuristic, not a scientifically validated optimisation model. Store them as configuration so the team can change them without rewriting the analytics pipeline.

Use both absolute burden and a visitor-normalised rate. A high-traffic zone may have many incidents because it has many visitors, while a low-traffic zone with a high incident-per-visitor rate may indicate poor bin coverage or placement.

### 13.5 Priority output

The prototype should rank zones and assign an explainable band:

1. **High priority** - sustained issue burden and visitor pressure justify attention.
2. **Medium priority** - meaningful pressure exists but is below the high-priority group.
3. **Low priority** - issue pressure remains low with adequate data coverage.
4. **Insufficient data** - the system cannot produce a reliable ranking for the zone.

Each ranked zone should show its reasons and evidence, for example:

```text
Food Court East is a high-priority zone because it is in the top 10% for
visitor pressure, recorded 14 deduplicated litter incidents, and had 3
overflow alerts during the selected period.
```

### 13.6 Heatmaps

The first version should support a categorical zone heatmap on a simple site map or zone grid. Filters should include:

- site;
- date and time range;
- issue type;
- visitor pressure;
- camera or zone;
- day of week and operating-hour range.

Image-pixel heatmaps may be useful for inspecting one camera, but the required analytics output remains a zone ranking.

### 13.7 Data-sufficiency gate

The module must not present weak data as a confident recommendation. Initial configurable checks should include:

- a minimum number of valid observation buckets;
- observations across multiple operating days;
- minimum camera/data coverage;
- valid site/zone and capture timestamps;
- successful outputs from the required models.

Until real operating data exists, thresholds may be relaxed for demonstrations, but reports must label results as demo or insufficient-data results.

### 13.8 Report output

The first report can contain:

- selected site, filters, and analysis period;
- data coverage and limitations;
- zone heatmap;
- ranked zones;
- factor breakdown per zone;
- recommendations with plain-language reasons;
- supporting incident and visitor summaries;
- model versions used.

CSV export of aggregated data is useful for validation. A formatted PDF report can be added after the detailed use case is approved.

## 14. Non-functional requirements

### 14.1 Performance and efficiency

| ID | Requirement |
| --- | --- |
| NFR-PE-01 | Load the main dashboard within three seconds under normal operating conditions. |
| NFR-PE-02 | Display a new alert on the dashboard within five seconds after the cleanliness issue is detected. |
| NFR-PE-03 | Support multiple registered camera zones without major dashboard delay. |

For uploaded video, the five-second target needs a clarified starting point because inference time depends on file size and sampling. Measure separately from upload completion and from the time a qualifying frame finishes inference.

### 14.2 Reliability

| ID | Requirement |
| --- | --- |
| NFR-RL-01 | Maintain at least 99% availability during scheduled operating periods. |
| NFR-RL-02 | Preserve detections, alerts, status histories, and analytics data during unexpected errors. |
| NFR-RL-03 | Notify the Supervisor when a registered camera or detection service becomes unavailable. |

For the upload-first prototype, service-unavailable notification applies to the FastAPI service and upload-processing pipeline. Camera availability monitoring becomes applicable with live streams.

### 14.3 Maintainability

| ID | Requirement |
| --- | --- |
| NFR-MT-01 | Keep user management, detection, alerts, dashboard functions, and analytics modular. |
| NFR-MT-02 | Use consistent coding standards and appropriate documentation. |
| NFR-MT-03 | Permit modules to change without major unrelated changes. |

## 15. Deferred or unresolved decisions

- Detailed FastAPI request and response contract.
- Final calibration of confidence floors, dirty-magnitude thresholds, temporal windows, and severity mapping.
- Detailed dashboard use-case descriptions.
- Detailed bin-placement use-case descriptions.
- Final analytics formula and data-sufficiency thresholds.
- Optional site-map representation for the zone heatmap.
- Cloud object storage provider and migration from local files.
- Live camera protocols, credentials, connection checks, frame rate, and reconnection behaviour.
- Field calibration of the implemented five-minute location freshness and
  seven-day history retention.
- Work-order acceptance timeout and automatic reassignment policy; Phase 11
  currently uses one primary Cleaner and manual Supervisor reassignment.
- Exact FCM support/fallback expectations for the target Cleaner phones.
- Exact review evidence and confidence policy for clean, rework, more evidence,
  or Supervisor exception.
- Initial local LLM/VLM, prompts, evaluation dataset, and Option A host sizing.
- Whether manually resolved alerts can later be reopened outside the autonomous
  rework path.

## 16. Change log

### 2026-08-18 - Cleaner identity and work-order backend implemented

- Implemented explicit Cleaner Auth provisioning/linking, role isolation,
  permissions/capabilities, migration/reconciliation, and disablement.
- Implemented consented location heartbeats, derived freshness, seven-day
  retention, one-primary-Cleaner work orders, immutable transitions,
  rejection/reassignment/rework, and Supervisor overrides.
- Implemented durable Cleaner notifications with best-effort FCM and reliable
  inbox fallback; Cleaner submission remains separate from alert resolution.

### 2026-08-17 - Cleaner actor and autonomous AI Supervisor

- Approved Cleaner as a Firebase-authenticated mobile-web/PWA actor while
  retaining the current non-login Cleaner directory as the migration baseline.
- Approved Supervisor-managed site/zone access, Cleaner availability/location,
  assignment notifications, accept/reject, work progress, and ready-for-review.
- Approved an LLM-driven LangGraph orchestrator to make assignment,
  reassignment, and verification decisions without routine human approval.
- Kept Node.js as the only business execution/persistence authority through
  typed tools and hard invariant checks.
- Separated alert, work-order, and review lifecycles and added
  `awaiting_verification`/rework to the target alert lifecycle.
- Selected Option A self-hosting with Caddy, Docker Compose, PostgreSQL,
  Ollama, local FastAPI/media, and cloud Firebase Auth, Firestore, and FCM.

### 2026-08-13 - Grouped temporal cleanliness workflow

- Replaced per-detection immediate alerting with one issue observation per analysis run and issue type.
- Confirmed at most one grouped flag per positive issue observation and retained negative observations for temporal evidence.
- Adopted provisional per-camera confirmation rules: floor litter 3-of-5 within 30 minutes, bin overflow 2-of-3 within 15 minutes, and floor spill two consecutive within 10 minutes.
- Changed active-alert uniqueness to one alert per zone and issue type while keeping confirmation buffers camera-specific.
- Required a fresh confirmation sequence after resolution and kept test uploads scored but excluded from flags, alerts, confirmation, and analytics.

### 2026-08-11 - Location hierarchy simplified

- Confirmed `site -> cleaning zone -> camera` as the prototype hierarchy.
- Removed the separate area level from upload metadata, alerts, analytics filters, and planned persistence.

### 2026-08-11 - Supervisor and cleaner identity clarification

- Confirmed that Supervisor is the only authenticated system-user role.
- Reinterpreted User Management CRUD as cleaner personnel-record management.
- Confirmed that cleaners never log in and have no Firebase Authentication identity or password.
- Retained deactivation as a soft personnel-status change rather than permanent deletion.

### 2026-08-11 - Initial consolidated baseline

- Consolidated the six initial requirements PDFs.
- Confirmed React, Node.js/Express, Firebase, and private FastAPI boundaries.
- Confirmed floor-litter, overflowing-bin, and people-counting scope.
- Marked liquid-spill detection optional.
- Confirmed uploaded images and videos before live streams.
- Confirmed model teammates provide weights and inference code rather than a complete FastAPI service.
- Confirmed one all-powerful Supervisor role for the first version.
- Replaced permanent user deletion with deactivation.
- Kept cleanliness flags and alerts as separate records.
- Allowed forward alert-status stages to be skipped.
- Initially recorded camera-level alert deduplication; the 2026-08-13 grouped-temporal decision supersedes it with zone/issue deduplication.
- Selected local filesystem storage for prototype media and evidence.
- Initially proposed a site/area/zone/camera hierarchy for tourist attractions.
- Proposed a provisional, zone-level bin-placement analytics method.

### 2026-08-11 - Priority-zone analytics clarification

- Confirmed that bin-placement analytics only needs to identify and rank priority zones, not exact physical placement points.
- Recorded deterministic aggregation and configurable scoring as the recommended first-version approach.
- Confirmed that training another analytics model is not required for the prototype.

### 2026-08-11 - Architecture documentation

- Added a dedicated architecture record for the confirmed React, Node.js/Express, Firebase, and private FastAPI stack.
- Recorded component ownership, authoritative data stores, request flows, security boundaries, and prototype-to-future evolution.
