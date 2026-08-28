# LitterSpot system product requirements document

## Document control

| Field | Value |
| --- | --- |
| Product | LitterSpot AI Waste Operations System |
| Status | Draft for product and engineering review |
| Date | 2026-08-15 |
| Immediate engineering focus | vLLM-served vision pipeline |
| Related plan | [`VLLM_VISION_PIPELINE_IMPLEMENTATION_PLAN.md`](VLLM_VISION_PIPELINE_IMPLEMENTATION_PLAN.md) |
| Public solution research | [`VLLM_PUBLIC_SOLUTIONS_RESEARCH.md`](VLLM_PUBLIC_SOLUTIONS_RESEARCH.md) |
| Limited-hardware research | [`VLLM_LIMITED_HARDWARE_RESEARCH.md`](VLLM_LIMITED_HARDWARE_RESEARCH.md) |

## Product summary

LitterSpot monitors registered camera zones for overflowing bins, liquid spills,
litter or trash on the floor, and people-population conditions. Confirmed
conditions become operational incidents. Actionable cleaning incidents become
tasks, and an allocation LLM recommends an eligible cleaner. Cleaners sign in,
accept and update tasks, and complete the work. When a cleaner accepts a task,
the system starts collecting periodic snapshots from the relevant camera. The
snapshot session stops when the task is completed or otherwise terminated.

The product combines AI assistance with deterministic business rules:

- A VLM served by vLLM reports visible evidence.
- Temporal policy confirms or clears operational flags.
- Business modules create incidents and tasks.
- An allocation LLM ranks a prevalidated set of cleaners.
- Deterministic validation commits or rejects the recommendation.
- Human operators retain visibility, override, and audit controls.

## Problem statement

Theme parks, public venues, campuses, and similar facilities often discover
overflowing bins and floor hazards through manual patrols or visitor complaints.
Response is delayed, dispatch decisions are inconsistent, and there may be no
reliable evidence of when a condition began, who accepted it, or whether the
affected area was monitored during remediation.

The current LitterSpot MVP can analyze uploaded snapshots and show alerts, but
it does not provide a complete live operational workflow. It lacks durable task
assignment, cleaner identity, acceptance and completion tracking, allocation
logic, or acceptance-scoped snapshot capture.

## Product vision

Turn camera observations into accountable, timely, privacy-conscious operations
work without allowing an AI model to control business state directly.

## Goals

1. Detect and confirm bin overflow, liquid spills, and floor litter with a
   measurable false-alert rate.
2. Record people population and optionally flag configured crowd conditions.
3. Create one actionable incident and task per real condition, not one task per
   frame.
4. Recommend an eligible cleaner quickly and fairly.
5. Give cleaners a simple, mobile-first task workflow.
6. Capture task-linked evidence only from acceptance until completion or another
   terminal outcome.
7. Preserve a trustworthy audit history across detection, allocation, work, and
   evidence lifecycle.
8. Support gradual AI rollout, human approval, deterministic fallback, and
   rollback.

## Non-goals

- Facial recognition or identity inference from camera footage.
- Continuous employee surveillance or location tracking outside approved work
  policies.
- Letting model-generated text directly update users, assignments, or tasks.
- Using population analysis to infer protected characteristics.
- Replacing a venue's security, emergency, or workforce-management system in
  the initial product.
- Treating all crowd events as cleaner tasks.
- Recording continuous video when periodic task-scoped snapshots satisfy the
  requirement.
- Autonomous enforcement or disciplinary decisions about cleaners.

## Users and roles

### Cleaner

Needs to sign in, see current offers and accepted work, understand the location
and issue, accept or decline, start work, report a blocker, complete the task,
and see whether task-linked snapshot capture is active.

### Dispatcher

Needs to review incidents, approve AI recommendations during pilot operation,
assign or reassign work, monitor overdue tasks and failed capture sessions, and
inspect relevant evidence.

### Operations manager

Needs performance reporting, staffing and workload visibility, incident trends,
camera health, model-quality trends, and auditable overrides.

### Administrator

Needs to manage sites, zones, cameras, users, cleaner eligibility, task-routing
rules, model rollout, thresholds, snapshot cadence, and retention.

### Auditor or privacy reviewer

Needs read-only access to authorized histories, evidence-access logs, retention
status, and system/model version metadata.

## End-to-end workflow

```text
1. Camera frame sampled
        |
2. VLM analyzes frame through vLLM
        |
3. Output validated and stored as an observation
        |
4. Temporal policy confirms a flag
        |
5. System opens/deduplicates an incident
        |
6. Routing policy decides whether a cleaning task is required
        |
7. Task created with priority, skill, zone, and due time
        |
8. Eligible cleaners computed deterministically
        |
9. Allocation LLM ranks eligible cleaners
        |
10. Recommendation validated; offer created or dispatcher alerted
        |
11. Cleaner signs in and accepts offer
        |
12. Task becomes accepted; snapshot session starts asynchronously
        |
13. Cleaner starts work and may report blockers
        |
14. Cleaner completes task
        |
15. Task becomes completed; snapshot session stops
        |
16. Incident is resolved after policy/human verification
```

Exceptional flow:

- A declined or expired offer returns the task for reassignment.
- A cancelled task stops any active snapshot session.
- Camera or storage failure does not prevent the cleaner from completing urgent
  work; the failure is shown to dispatch and audited.
- A recurring condition after completion creates a new episode/task according
  to deduplication and reopening policy.

## Product scope

### Capability A — camera and zone management

The system shall:

- register sites, zones, and cameras;
- map each camera to one zone and optional fixed regions such as bins and floor
  areas;
- enable or disable analysis per camera;
- configure sampling cadence and camera health thresholds;
- keep camera credentials private to camera adapters;
- report online, stale, offline, and degraded status;
- support test uploads and recorded-camera adapters outside production.

### Capability B — VLM vision analysis

The system shall:

- analyze sampled frames with a pinned VLM served by a pinned vLLM deployment;
- produce a schema-validated observation for overflow, spill, floor litter, and
  people population;
- record frame, model, runtime, prompt, schema, and processing metadata;
- identify unusable frames rather than treating them as clear;
- confirm and clear findings through deterministic temporal policy;
- emit idempotent, versioned confirmed-flag events;
- run in shadow/canary/production mode by camera;
- support an approved fallback or rollback detector.

Detailed delivery requirements are in the focused vLLM implementation plan.

### Capability C — incident management

The system shall:

- create or update one incident from a confirmed flag episode;
- deduplicate repeated observations by camera, kind, time, and spatial key;
- attach supporting observations and representative evidence;
- distinguish `open`, `acknowledged`, `resolved`, and `dismissed` states;
- require an actor and reason for dismissal or manual resolution;
- preserve detection and policy versions;
- allow a cleared visual flag to inform but not silently falsify task completion;
- support incident reopening or a new episode under versioned policy.

### Capability D — task creation and lifecycle

The system shall convert actionable incidents into typed tasks. Initial task
types are:

| Incident | Task type | Default skill |
| --- | --- | --- |
| `bin_overflow` | `empty_bin` | general cleaning/waste handling |
| `liquid_spill` | `clean_spill` | spill response and safety equipment |
| `floor_litter` | `collect_litter` | general cleaning |
| `crowd_threshold_exceeded` | configurable; normally no cleaning task | dispatcher/security policy |

Each task shall include:

- stable task ID and incident ID;
- site, zone, camera, and optional spatial reference;
- type, severity, required skill/equipment, instructions, and due time;
- current state and version;
- current offer/assignment summary;
- creation and status-event history;
- first/representative evidence available under authorization;
- model-generated source clearly labeled as AI-generated.

Task states:

```text
unassigned -> offered -> accepted -> in_progress -> completed
     ^           |           |             |
     |           +-> declined+             +-> blocked -> in_progress
     |           +-> expired-+
     +---------------- reassignment

Any non-terminal state -> cancelled
```

Business rules:

- Only valid transitions are accepted.
- State changes use idempotency keys and optimistic concurrency.
- A task has at most one current accepted cleaner.
- A cleaner may accept only their own active, unexpired offer.
- Completion cannot be undone. A subsequent condition is a new work episode.
- `blocked` requires a reason and remains visible to dispatch.
- Cancellation and forced reassignment require reason and actor.
- Cleaner completion and visual incident clearance are separate facts.

### Capability E — LLM-assisted cleaner allocation

The system shall compute eligible cleaners before calling the allocation LLM.
Eligibility may include:

- active account;
- current shift and availability;
- approved site and zone;
- required skill/equipment;
- workload below configured limit;
- no conflicting accepted work;
- optional fresh location/travel estimate;
- decline cooldown and fairness rules.

The LLM shall receive only candidate IDs and necessary operational metadata. It
shall return a schema-constrained ranked recommendation with reason codes.

The system shall:

- reject a selected cleaner who is outside the candidate set;
- recheck eligibility inside the assignment transaction;
- use deterministic fallback on timeout, invalid output, model outage, or stale
  candidates;
- leave the task unassigned and escalate if no eligible cleaner exists;
- store model/prompt version, candidate snapshot, returned decision, validation,
  fallback, and final assignment;
- support recommendation-only, approval-required, and automatic modes by site;
- prohibit the allocation LLM from reading camera images, faces, credentials,
  passwords, contact details, or unrelated employee data;
- avoid exposing free-form hidden reasoning as an employment decision record.

### Capability F — cleaner authentication and application

The cleaner application shall be mobile-first and provide:

- secure login, logout, session refresh, and session-expired handling;
- offer, accepted, in-progress, blocked, and completed views;
- task details with location, type, priority, due time, instructions, and
  authorized evidence;
- accept, decline, start, report blocker, resume, and complete actions;
- optional completion note/photo according to task policy;
- clear snapshot-capture status from acceptance until terminal state;
- retry-safe actions and conflict messages when task state changed elsewhere;
- no visibility into other cleaners' tasks except explicitly shareable team
  work in a future release.

The backend shall derive cleaner identity from the authenticated session. It
shall not trust a cleaner ID supplied by the client.

### Capability G — task-scoped snapshot capture

The system shall:

- emit a durable event in the same transaction that accepts a task;
- idempotently start one logical capture session for the task and camera;
- capture periodic snapshots at the configured cadence;
- associate each snapshot with task, camera, time, hash, and storage metadata;
- show the cleaner and dispatcher whether capture is pending, active, failed,
  stopping, or stopped;
- stop scheduling new snapshots as soon as task completion/cancellation is
  committed;
- allow an in-flight snapshot write to finish, then record `stoppedAt`;
- reconcile accepted tasks without active capture and terminal tasks with active
  capture after a worker restart;
- enforce a maximum capture duration and alert dispatch when exceeded;
- prevent snapshots before acceptance and after terminal state;
- apply retention/deletion policy and audit evidence access.

Default capture behavior is periodic snapshots, not video. Cadence and maximum
duration are site configuration and require privacy approval.

### Capability H — dispatcher operations console

The console shall show separately:

- camera and inference health;
- confirmed incidents and evidence timeline;
- task state and overdue status;
- assignment recommendation, approval status, and fallback reason;
- cleaner offer and acceptance state;
- capture session health and snapshot gaps;
- manual assign, reassign, cancel, dismiss, resolve, and retry controls according
  to role;
- a complete, readable status timeline;
- whether a model is in shadow, canary, or production mode.

### Capability I — administration and reporting

Administrators shall manage:

- users, roles, cleaner profiles, skills, shifts, zones, and workload limits;
- cameras, camera-zone mapping, regions, and sampling policy;
- incident/task routing and priority rules;
- people thresholds and hysteresis;
- model/prompt/policy rollout mode;
- allocation mode and fallback scoring weights;
- snapshot cadence, maximum duration, storage, and retention;
- feature flags and rollback.

Reports shall include:

- detections and false/missed review outcomes;
- incidents/tasks by kind, site, zone, and camera;
- detection-to-task, task-to-offer, offer-to-accept, and accept-to-complete time;
- decline, expiry, reassignment, blocked, and overdue rates;
- cleaner workload/fairness indicators without unsupported performance scoring;
- model latency/error and false flags per camera-hour;
- snapshot completeness, failures, duration, and storage growth;
- evidence access and deletion audit.

## Priorities

### P0 — required for first operational pilot

- Registered camera sampling and health.
- vLLM/VLM observations and temporal confirmed flags.
- Incident deduplication.
- Cleaning task creation for the three cleaning conditions.
- Deterministic cleaner eligibility and assignment fallback.
- Cleaner login and own-task workflow.
- Acceptance-triggered and completion-triggered snapshot lifecycle.
- Dispatcher visibility and manual override.
- RBAC, audit history, idempotency, monitoring, and rollback.

### P1 — required before broad automatic rollout

- Allocation LLM in approval-required and automatic modes.
- Advanced fairness/reporting controls.
- Camera/site rollout management.
- Completion-photo policies.
- Automated retention jobs and privacy audit export.
- Load-tested multi-site capacity and disaster recovery.

### P2 — later enhancements

- Route/travel-time integration.
- Notifications outside the web application.
- Team tasks and multi-cleaner assignments.
- Shift-system integration.
- Active learning/review queues for model improvement.
- Floor-zone heatmaps and long-term population forecasting.

## Data model concepts

Production operational persistence belongs to the business backend. Core
entities are:

```text
Site -> Zone -> Camera
User -> CleanerProfile -> Skill/Shift/Availability
Camera -> VisionObservation -> Finding -> ConfirmedFlag
ConfirmedFlag -> Incident -> Task -> TaskStatusEvent
Task -> AssignmentAttempt -> TaskOffer -> Cleaner
Task -> CaptureSession -> Snapshot
All aggregates -> OutboxEvent / AuditEvent
```

Key constraints:

- unique frame observation per camera, frame hash, and prompt version;
- one open incident per versioned deduplication key;
- one non-terminal task per incident unless explicitly configured;
- one current active/accepted offer per task;
- one active capture session per task;
- task version increment and status event written atomically;
- immutable audit/event history with actor and correlation IDs.

Store images in approved object storage, not database binary columns. Store
hashes and metadata in the database.

## System interfaces

### Private inference interface

```text
POST /internal/vision/analyze-frame
GET  /internal/vision/health
GET  /internal/vision/model-info
```

### Cleaner interface

```text
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
GET  /api/cleaner/tasks
GET  /api/cleaner/tasks/:taskId
POST /api/cleaner/tasks/:taskId/accept
POST /api/cleaner/tasks/:taskId/decline
POST /api/cleaner/tasks/:taskId/start
POST /api/cleaner/tasks/:taskId/block
POST /api/cleaner/tasks/:taskId/complete
GET  /api/cleaner/tasks/:taskId/snapshots
```

### Dispatcher/admin interface

```text
GET  /api/incidents
POST /api/incidents/:incidentId/acknowledge
POST /api/incidents/:incidentId/dismiss
GET  /api/tasks
POST /api/tasks/:taskId/assign
POST /api/tasks/:taskId/reassign
POST /api/tasks/:taskId/cancel
GET  /api/assignment-attempts/:attemptId
GET  /api/capture-sessions/:sessionId
POST /api/capture-sessions/:sessionId/retry
```

All mutation requests require authorization, an idempotency key, and an
expected resource version where concurrency matters.

## Non-functional requirements

### Reliability

- Business-state changes and their outbox events must commit atomically.
- All asynchronous consumers must tolerate at-least-once delivery.
- Worker restart must reconcile capture and assignment work.
- Model outage must not corrupt task state.
- No model failure may be interpreted as a clear camera condition.
- Backlogs must have freshness limits and bounded storage.

### Performance

- UI task mutations should normally acknowledge within two seconds, excluding
  media upload.
- Allocation shall have a short deadline and deterministic fallback.
- Detection latency targets are set per sampling cadence and safety class.
- Capacity must be proven for expected cameras × sampling rate with headroom.
- Dashboard polling or realtime updates must not overload the operational store.

### Security

- Private model and camera endpoints are not browser-accessible.
- Credentials and camera secrets are stored in approved secret management.
- Passwords use a modern adaptive hash; sessions are revocable and rotated.
- Login endpoints use rate limits and lockout/backoff.
- Authorization is backend-enforced for every task and evidence request.
- Sensitive data is encrypted in transit and at rest where required.
- Privileged actions and evidence access are audited.
- Input limits and strict schema validation apply to uploads and model output.
- Camera imagery is treated as untrusted input, including text-based prompt
  injection attempts visible in the scene.

### Privacy

- No face recognition, demographic inference, or identity linking.
- Allocation receives operational metadata, not images.
- Snapshot capture is limited to an accepted task window.
- The cleaner application clearly indicates capture state.
- Retention is finite, configurable, and approved before production.
- Access is least-privilege and logged.
- Deletion jobs and legal holds, if required, are explicit and auditable.

### Accessibility and usability

- Cleaner actions are usable on common mobile screen sizes.
- Critical states do not rely on color alone.
- Task buttons have clear confirmation and retry/conflict feedback.
- Location, issue, priority, and due time are understandable without technical
  model terminology.
- The system distinguishes AI observation from confirmed business state.

### Observability

Metrics and alerts shall cover:

- camera freshness and frame-ingest failures;
- VLM/LLM readiness, identity, latency, error, invalid output, queue depth, and
  fallback rate;
- confirmed flags and false/missed review outcomes;
- unassigned tasks, stale offers, overdue tasks, and blocked tasks;
- active capture duration, snapshot gaps, storage errors, and reconciliation;
- authentication anomalies and authorization failures;
- outbox backlog and consumer failures.

Logs must carry correlation and causation IDs while avoiding credentials,
passwords, raw tokens, unrestricted model output, and unnecessary image data.

## Success metrics

### Vision

- Class-specific precision/recall and false flags per camera-hour.
- Population mean absolute error and signed bias by density band.
- Confirmed-event detection delay.
- Valid-output, timeout, and inference availability rates.

### Operations

- Median/p95 detection-to-task time.
- Median/p95 offer-to-accept time.
- Median/p95 accept-to-complete time.
- Percentage of actionable incidents with one and only one active task.
- Unassigned, declined, expired, reassigned, blocked, and overdue rates.
- Deterministic fallback success rate.

### Capture

- Percentage of accepted-task duration covered by scheduled snapshots.
- Sessions started within the approved delay after acceptance.
- Sessions stopped within the approved delay after terminal transition.
- Snapshot failure and reconciliation rates.
- Evidence retained/deleted according to policy.

### Trust and safety

- Zero assignments to ineligible cleaners caused by LLM output.
- Zero unauthorized cross-cleaner task/evidence access in security tests.
- Zero snapshots intentionally scheduled before acceptance or after terminal
  transition.
- All manual overrides and evidence access attributable to an authenticated
  actor.

Metric thresholds must be approved using deployment data. One combined AI
accuracy number is not sufficient.

## Pilot acceptance criteria

The first operational pilot is acceptable when:

1. The VLM passes class-specific held-out and live-shadow gates on pilot cameras.
2. Replaying the same frames creates one logical flag episode and one incident.
3. Each actionable incident creates at most one active cleaning task.
4. Cleaner eligibility is deterministic and tested; allocation LLM output
   cannot bypass it.
5. A cleaner can securely accept, start, block, resume, and complete only their
   own task.
6. Accepting a task creates one logical capture session despite retries.
7. Completing or cancelling stops scheduled capture despite retries or worker
   restart.
8. Camera/storage failure remains visible but does not block urgent completion.
9. Dispatcher override, cancellation, reassignment, and dismissal are audited.
10. Rollback from the new VLM to the approved existing detector has been tested.
11. Retention, privacy notice, and evidence authorization are approved.
12. Load and recovery tests pass at pilot camera and cleaner concurrency.

## Release strategy

### Release 1 — vision foundation

Deliver only the focused vLLM vision plan: complete the public-solution adoption
spike, adopt the approved stream/tracking workflow layer, add vLLM semantic
verification, validated observations, temporal flags, evidence metadata, shadow
comparison, canary, and durable handoff.

### Release 2 — incident and deterministic task workflow

Deliver incidents, task lifecycle, deterministic eligibility/allocation,
dispatcher workflow, cleaner authentication, and cleaner task application.

### Release 3 — task-scoped capture

Deliver acceptance-triggered capture, completion/cancellation stop, storage,
reconciliation, retention, and user-visible capture state.

### Release 4 — allocation LLM

Introduce recommendation-only allocation, then dispatcher approval, then
site-by-site automatic offers after safety and fairness gates.

This order allows the current engineering effort to focus on vLLM while the
whole-system workflow remains stable and specified.

## Dependencies

- Production camera protocols and access.
- Target GPU and capacity budget.
- Selected VLM, allocation LLM, and pinned runtime deployments.
- Permissioned labeled camera data.
- PostgreSQL and object storage deployment decision.
- Authentication/session and secret-management approach.
- Approved cleaner eligibility and workforce policies.
- Snapshot privacy notice, cadence, retention, and access rules.
- Operational owner for crowd events.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| VLM counts or localizes poorly | Camera-stratified evaluation; hybrid localization adapter; temporal policy; shadow mode |
| False flags create unnecessary work | Per-class thresholds, N-of-M confirmation, deduplication, pilot approval |
| Model output manipulates business state | Strict typed handoff; models never write state; deterministic validation |
| LLM selects an inappropriate cleaner | Precomputed eligible set, transactional recheck, deterministic fallback |
| Duplicate events create duplicate tasks/capture | Stable IDs, unique constraints, idempotency, outbox, reconciliation |
| Cleaner never completes a task | Overdue escalation, maximum capture duration, dispatcher control |
| Camera/storage outage leaves missing evidence | Visible degraded state, bounded retry, completion remains available |
| Snapshot behavior creates privacy concerns | Acceptance-scoped capture, visible indicator, finite retention, access audit |
| GPU capacity causes stale detections | Sampling budget, freshness deadline, queue backpressure, load tests |
| Prompt/model update silently changes behavior | Immutable revisions, prompt version, repeated gates, canary and rollback |
| Crowd alerts routed incorrectly | Explicit per-zone ownership; no default cleaner task |

## Open product decisions

1. Which sites and cameras form the pilot?
2. What VLM and vLLM deployment meet the target GPU constraints?
3. Must the VLM itself return precise geometry, or can a conventional detector
   provide localization while the VLM verifies semantics?
4. What class-specific precision, recall, delay, and false-alert gates are
   required?
5. Who owns crowd alerts, and in which zones are they enabled?
6. What exact skills/equipment make a cleaner eligible for each task type?
7. Does `accepted` automatically imply `in_progress`, or is Start explicit?
8. Are completion notes or photos mandatory by task type?
9. What snapshot cadence, maximum duration, retention, and access policy are
   approved?
10. Can overlapping tasks for one camera share stored snapshot objects while
    preserving separate task metadata?
11. Is dispatcher approval required for task creation, assignment, or both in
    the pilot?
12. Which notifications and external workforce systems, if any, are required
    after the web pilot?

## Requirement traceability summary

| Workflow stage | Owning capability | Immediate release? |
| --- | --- | --- |
| Frame analysis | VLM vision analysis | Yes |
| Temporal flag confirmation | VLM vision analysis | Yes |
| Flag handoff | VLM vision analysis | Yes |
| Incident creation/deduplication | Incident management | Later |
| Task creation/state | Task lifecycle | Later |
| Cleaner candidate filtering | Allocation | Later |
| LLM recommendation | Allocation | Later |
| Cleaner login/actions | Cleaner application | Later |
| Acceptance starts snapshots | Snapshot capture | Later |
| Completion stops snapshots | Snapshot capture | Later |
| Reporting/admin | Operations/admin | Incremental |

The handoff between the immediate and later scopes is the versioned,
idempotent `ConfirmedFlag` event defined by the focused implementation plan.
