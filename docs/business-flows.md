# LitterSpot business flows

## 1. Purpose

This document records implemented actor and system flows. Exact validations and state rules are defined in the [technical specification](spec.md).

## 2. Site and spatial administration

### 2.1 Create a Site

1. A Superadmin enters Site identity, timezone, initial map dimensions, and Root Supervisor credentials.
2. Node validates the request and reserves the Root email and identity operation.
3. Firebase Authentication creates the Root identity.
4. One transaction creates the Site, initial Site Map Revision, Root account and Supervisor profile, Orchestrator configuration, and audit records.
5. The Site becomes available in the Superadmin Site list.
6. A repeated idempotent request returns the existing result. A partial identity failure is compensated or left as a recoverable identity operation.

### 2.2 Publish a Site Map

1. A Root Supervisor starts or opens the Site's single draft.
2. The Root changes dimensions, background alignment, Zones, Camera Placements, or Cleaner Station Points.
3. Node validates boundary limits, polygon shape, Zone separation, and point containment.
4. Publication creates an immutable Site Map Revision and switches the Site's `activeMapRevisionId` atomically.
5. Active projections use the new revision. Historical operations keep their stored map and location snapshots.

### 2.3 Correct or move a Camera

**Map Position Correction**

1. A Root Supervisor places a corrected point inside the Camera's current Zone and supplies a reason.
2. Publication creates a new active map revision.
3. The Camera Registration remains valid.
4. Active Camera-linked Alerts and Work move to the corrected point and map revision. Assigned Cleaners receive a notification.

**Physical Camera Move**

1. A Root Supervisor selects a point in the same Zone, another Zone, or a provisional new Zone and supplies a reason.
2. Node creates a physical-move Camera Draft.
3. The Supervisor provides a new reference and replots floor and bin regions.
4. Publication dismisses active operations tied to the old view and publishes the new placement, source, Registration, and optional Zone together.

### 2.4 Remove a Camera

1. A Root Supervisor chooses Remove from Site, supplies a reason, and confirms the terminal action.
2. Node verifies the expected Camera and Site Map revisions.
3. One transaction publishes a replacement Site Map without the placement, marks the Camera removed, stops runtime state, dismisses active linked operations, and discards unfinished drafts.
4. Published source, Registration, evidence, audit, and operational history remain readable.

### 2.5 Deactivate a Site

1. A Superadmin supplies a reason and changes the Site to inactive.
2. Site access, new monitoring, and Orchestrator activity stop immediately.
3. A recoverable Site operation dismisses active Alerts and Work, releases Cleaners, and stops pending Runs in bounded pages.
4. Reactivation is blocked until cleanup finishes and does not reopen dismissed operations.

## 3. Camera monitoring and AI

### 3.1 Create and enable a Camera

1. A Root Supervisor chooses a placement and may draw a provisional Zone.
2. The Supervisor selects laptop camera or looped video, provides the source, captures or uploads a reference, plots walkable floor, and optionally plots physical bins.
3. Node validates the draft against the active Site Map and source dimensions.
4. Publication creates the active Camera, source revision, Registration revision, and placement. Monitoring starts disabled.
5. A Supervisor enables monitoring. Node rejects a second enabled laptop-camera source in the same Site.

### 3.2 Own and maintain capture

1. An authenticated Supervisor frontend loads enabled Camera configuration.
2. If no valid Site lease exists, the browser claims one Monitoring Session.
3. The owner browser opens Camera sources, starts episodes, maintains heartbeats, and submits ordered samples.
4. Other Supervisor browsers receive analyzed snapshots through the live event stream but do not capture.
5. When the owner releases or its lease expires, another browser may claim ownership.

### 3.3 Analyze a frame

1. The owner browser captures a JPEG sample and submits Camera, episode, sequence, source-time, and playback-generation context.
2. Node checks the lease, sequence, Camera, active source, Registration, and sample time.
3. Node sends the frame, Registration, floor polygon, registered bins, reference image, and thresholds to private FastAPI.
4. FastAPI runs people and scene detection, registered-bin classification, generic bin localization in shadow mode, and floor-hazard segmentation.
5. FastAPI returns a stateless AI Observation.
6. Node verifies that the lease and Camera configuration did not change during inference, then updates runtime state, temporal qualification memory, analytics accumulators, and live presentation.
7. An inference failure records safe runtime status. It does not create unverified operational state.

### 3.4 Present Camera Detail

1. The capture-owner browser records a 1280×720 maximum local buffer from the Camera source.
2. The screen remains at Connecting to Camera until at least five seconds of footage and continuous analysis coverage exist.
3. Playback starts behind capture so matching analyzed observations are ready.
4. If analysis lead falls below the safety threshold, playback pauses and shows Rebuffering analysis.
5. A short interruption resumes from the frozen point. A longer gap skips forward to the newest safe delayed point.
6. Failure to build or recover coverage within 30 seconds shows Camera analysis unavailable with Retry.
7. The grid and secondary browsers continue to use exact analyzed snapshots.

## 4. Alert and evidence management

### 4.1 Qualify an Alert

1. Node places each AI Observation into Camera and issue-specific temporal memory.
2. Floor spill qualifies from the latest positive observation.
3. Floor litter requires three positive observations among the latest five within 30 minutes.
4. Bin service requires two positive observations among the latest three within 15 minutes.
5. Qualification creates a Flag and creates or updates one active Alert for the Site, Camera, and issue type.
6. Full and overflow share one bin-service Alert; overflow raises severity.
7. The highest-confidence qualifying frame becomes Alert Evidence.

### 4.2 Handle an Alert

1. An Alert begins `waiting_for_cleaner` if no Work exists.
2. A Supervisor may assign an available Cleaner manually, causing one linked Work Order to be created.
3. A Supervisor may dismiss an Alert only while it has no linked Work, and must provide a reason.
4. Once Work exists, its lifecycle drives the Alert through assigned, in progress, awaiting review, resolved, or dismissed.
5. Ordinary clean samples do not close the Alert.

## 5. Cleaner and Work operations

### 5.1 Determine Cleaner availability

1. Node reads the Site, account, Cleaner profile, active map Station Point, weekly schedule, availability override, and active Work reference.
2. A Cleaner is available only when the Site, account, and profile are active; the schedule contains the current Site-local time; the Station Point is valid; no override excludes the Cleaner; and no active Work exists.
3. Schedule or availability changes enqueue another attempt for waiting Alerts.

### 5.2 Create Work

**Alert-driven Work** is created only with an eligible Cleaner and remains linked to its Alert.

**Manual Work** is created by a Supervisor, already assigned to an eligible Cleaner, and targets either a Camera or any coordinate inside the Site boundary. It has no Alert.

Both flows reserve the Cleaner and create Work atomically.

### 5.3 Complete and review Work

1. The Cleaner starts assigned Work, changing it to `in_progress`.
2. Manual Work requires Completion Evidence before submission. Alert-driven Camera Work uses fresh Camera Verification and does not require a Cleaner photo.
3. The Cleaner submits Work, changing it to `awaiting_review`.
4. A passed Verification resolves Work and any linked Alert, releases the Cleaner, and records recent resolved location context.
5. A failed Verification returns Work and any linked Alert to `in_progress` with the same Cleaner.
6. An inconclusive Verification leaves Work awaiting review.
7. Manual management always requires a Supervisor decision, even when Camera Verification is available.

### 5.4 Supervisor intervention

A Supervisor may take over orchestrated Work, reassign it to another eligible Cleaner, dismiss it, apply review, or override a stored Verification. Each decision requires the current revision where applicable and creates history and audit records.

## 6. Orchestration and operational intelligence

### 6.1 Assign waiting Alerts

1. Alert creation, Cleaner release, availability change, resume, or the scheduled retry creates or coalesces an outbox trigger.
2. The Node worker claims the trigger and starts one leased assignment Run for the Site.
3. Node builds a bounded context of up to ten waiting Alerts, available Cleaners, eligible pairs, priority, Station Point distance, and recent Work distance.
4. The Python provider adapter asks the configured model to select one allowed pair.
5. Node rejects any selection outside the supplied pair list or any pair that changed before commit.
6. A successful commit reserves the Cleaner, creates Work, links the Alert, records attempts and actions, and sends notifications.
7. Exhausted candidates or provider failure leaves the Alert waiting and records a safe failure.

### 6.2 Apply automated review

1. Fresh ordered Camera samples complete a pending Verification for orchestrated Camera Work.
2. A review trigger starts a leased review Run.
3. Node reads the stored deterministic Verification outcome.
4. Passed Work is resolved. Failed Work returns to rework. Inconclusive Work remains for Supervisor action.
5. Manual management mode excludes Work from automated review mutation.

### 6.3 Produce operational intelligence

1. Admitted monitoring samples accumulate minute metrics in Node memory.
2. Completed minute buckets are written to Firestore.
3. Daily summaries aggregate completed Site-local days.
4. The dashboard combines active records and derived summaries.
5. Bin-placement analysis ranks Zones using observed cleaning and bin-service factors and stores replaceable snapshots.
6. A Supervisor may record that a recommendation was implemented, which creates an Intervention for before-and-after comparison.
