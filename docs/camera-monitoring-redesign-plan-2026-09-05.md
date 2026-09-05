# Camera monitoring redesign plan

Status: planning baseline. No runtime implementation is included in this document.

This plan supersedes the Camera source and monitoring assumptions recorded in Phase 12.5 and Phase 12.6. Camera Creation and Registration remain valid. The redesign begins after publication and covers Camera enablement, continuous browser-owned monitoring, live overlays, evidence, reconfiguration access, and development-only Demo Source Scenes.

## Confirmed product behavior

- Every newly published Camera is structurally active with monitoring disabled.
- A Root or Regular Supervisor deliberately enables monitoring.
- Any Camera may use a laptop-webcam or looped-video source. Creation order does not choose the source.
- Multiple Cameras may retain laptop-source configuration, but at most one laptop-source Camera per Site may be enabled at a time.
- One Supervisor console owns Site capture and frame submission. Monitoring continues across Supervisor page navigation while at least one Supervisor console remains connected.
- Cleaner mobile sessions never own monitoring and never keep it alive.
- Every enabled Camera participates in periodic inference, analytics, Flag qualification, Alert creation, and Camera Verification. Opening Camera Details is not required.
- Camera list and Camera Details consume the same live state. Camera Details does not start a separate monitoring process.
- Camera Details has one Enable or Disable control. There is no separate Start or Stop Monitoring action.
- Alert Evidence retains one selected frame and enough data to reconstruct every model overlay from that frame.
- Demo Source Scene switching is a development-only operation. It does not appear in the Supervisor System page or normal product UI.
- The selected scene is visible in the normal Camera wall and Camera Details. Only the scene-selection control and developer diagnostics remain hidden from the product UI.
- A scene switch mimics a continuous Camera view changing between clean and issue conditions. It does not restart the Camera, Monitoring Episode, Alert evaluation, Work, Verification, or analytics timeline.

## Terms that must remain separate

### Camera lifecycle status

`active` means the Camera remains a valid configured Site resource. `inactive` means the Root Supervisor structurally deactivated it.

### Monitoring enabled

`monitoringEnabled=true` means the Site Monitoring Coordinator should run this Camera whenever a Supervisor monitoring owner exists. It is deliberate operational control, not proof that frames are arriving.

### Runtime connection

`online` means the backend recently accepted a sample. `offline` means samples stopped or the source failed. This is derived runtime state, not a Supervisor setting.

### Camera reconfiguration

Reconfiguration replaces a Camera source or Registration because its physical view or plotted regions changed. It creates new immutable source and Registration revisions and requires validation before atomic publication.

### Demo Source Scene

A Demo Source Scene is another prerecorded condition from the same position, angle, framing, and registered-bin arrangement. Selecting a scene changes only the developer-controlled playback input beneath the published looped-video source configuration.

## Existing foundation to retain

- Composite four-page Camera Creation and Registration Draft flow.
- Immutable Camera Source and Registration revisions.
- Existing source remains active while a replacement Draft is incomplete.
- Site-wide lease with claim, heartbeat, expiry, and failover.
- One Monitoring Episode per enabled Camera under the owner session.
- Sequential per-Camera sample numbering and duplicate rejection.
- Node to FastAPI inference path.
- Existing issue-specific Alert qualification rules.
- Camera Verification accepts only observations captured after the Cleaner submits for review.
- Raw sampled frames remain transient unless selected as Alert Evidence.

## Current gaps

- Backend policy still forces the first Camera to use the laptop source and permits only one registered laptop Camera.
- Newly published laptop Cameras currently start monitoring automatically.
- The monitoring toggle does not enforce one enabled laptop Camera transactionally.
- Capture and sampling belong to the Camera Details component and stop when it unmounts.
- The current Site lease is claimed separately by page components instead of one application coordinator.
- Camera wall cards do not all submit enabled Camera frames for inference.
- A result is drawn over a continuously moving video without matching it to the captured source time.
- Other Supervisor sessions have no complete ephemeral live-frame and overlay channel.
- Alert Evidence currently stores only detections matching the Alert issue type.
- The evidence candidate buffer is not explicitly bounded to the relevant rolling window or Alert lifecycle.
- Camera reconfiguration exists in backend and wizard code but Camera list/detail has no current entry action.
- Demo Source Scenes and a development-only switching control do not exist.

## Delivery sequence

### Camera phase 1: backend Camera policy and state

Change the authoritative Camera rules before touching product UI.

Build:

- remove the first-Camera laptop requirement;
- allow more than one Camera to retain `sourceType=laptop_camera`;
- publish every new Camera with `monitoringEnabled=false`;
- replace the old Site-level registered-laptop meaning with an enabled-laptop reservation;
- enforce that reservation inside the same Firestore transaction that enables or disables monitoring;
- reject laptop enablement with `409` when another laptop Camera owns the reservation;
- release the reservation only when the matching Camera is disabled or deactivated;
- keep looped-video Camera enablement independent;
- audit monitoring enable and disable mutations;
- update V2 read models so clients receive structural status, desired monitoring state, derived runtime connection, and conflict details separately.

Tests:

- the first Camera may be looped video;
- all new Cameras publish monitoring disabled;
- two laptop-source Cameras may be registered;
- enabling one laptop Camera succeeds;
- enabling a second laptop Camera fails atomically;
- disabling the first releases the reservation;
- concurrent enable requests cannot both succeed;
- multiple looped Cameras may be enabled.

Exit: Camera state and policy are correct without requiring a browser.

### Camera phase 2: backend monitoring continuity

Adapt monitoring to one Site owner and many enabled Camera episodes.

Build:

- let one Site Monitoring Session own multiple active Camera Episodes;
- start an episode when an enabled Camera joins the owner runtime;
- end an episode only for disablement, structural deactivation, formal source or Registration reconfiguration, source failure, or session loss;
- keep episodes and sample sequences alive across Supervisor route changes;
- preserve rolling temporal qualification across ordinary frames and Demo Source Scene changes;
- use a bounded, latest-frame-first inference queue so slow processing does not create an ever-growing stale backlog;
- expose honest runtime state, including last accepted frame, last successful inference, latency, skipped samples, and source error;
- keep the configured target interval at one sample per second per Camera, while reporting when available compute cannot sustain it.

Tests:

- one lease owns multiple Camera episodes;
- route-independent heartbeats preserve ownership;
- a second browser cannot submit duplicate frames;
- a scene change does not change episode ID or reset sequence;
- clean observations followed by issue observations qualify through the existing rolling rules;
- source loss marks only the affected Camera offline;
- disabling one Camera does not stop other enabled Cameras.

Exit: Postman and automated tests can exercise multi-Camera lifecycle and sample continuity.

### Camera phase 3: development-only Demo Source Scenes

Add underground source control without changing product-facing Camera configuration.

Build:

- attach multiple same-view video assets to one published looped-video source configuration;
- store an internal scene identifier and playback generation without changing `activeSourceRevisionId` or `activeRegistrationRevisionId`;
- require matching Camera, Site, video media type, and compatible frame dimensions;
- provide a development-only command or endpoint to select a scene;
- make development controls unavailable when the required development environment flag is absent;
- make the selected scene immediately replace the visible Camera feed in the normal Camera wall and Camera Details;
- start the selected video at zero while preserving episode, sequence, temporal windows, Alerts, Work, Verification, and analytics;
- record scene changes in developer diagnostics without exposing them in Supervisor product history.

Primary operator path:

```text
npm run demo:camera-scene -- --camera <camera-id> --scene <scene-key>
```

A small Postman folder may call the same protected development service. No System-page control is added.

Tests:

- switching clean to dirty can qualify an Alert through normal rolling observations;
- switching dirty to clean does not resolve an Alert by itself;
- Verification ignores pre-submission observations;
- clear post-submission observations can pass Camera Verification;
- old evidence candidates expire instead of leaking into a later Alert;
- non-development environments reject scene administration.

Exit: a developer can run a repeatable clean, dirty, clean demonstration without re-registering the Camera.

### Camera phase 4: live observation and evidence contract

Give the existing UI enough backend data to render accurate monitoring and evidence.

Build:

- identify every sampled frame with Camera ID, episode ID, sequence, captured time, source playback time when applicable, scene generation, and image dimensions;
- return normalized or pixel geometry under one documented coordinate convention;
- expose the latest ephemeral analyzed frame and complete observation to connected Supervisor viewers without persisting ordinary frames in Firestore;
- broadcast current runtime and observation updates through one Site-scoped real-time channel;
- retain the selected Alert Evidence frame with all people, bin, and floor-issue detections from that same frame;
- keep Alert Evidence selection issue-specific while retaining the complete frame overlay payload;
- bound evidence candidates by the rolling evaluation period and active Alert lifecycle;
- preserve model versions and Registration revision in evidence.

Tests:

- every overlay belongs to the returned frame ID and dimensions;
- an Alert caused by litter may still display people and bin overlays from its evidence frame;
- an ordinary sample leaves no retained image asset;
- evidence media and metadata refer to the same captured frame;
- multiple viewers receive current results but cannot become duplicate submitters.

Exit: backend contracts support both an exact analyzed-frame renderer and a timestamp-synchronized smooth renderer.

### Camera phase 5: isolated browser verification

Before changing product pages, extend the existing API sandbox only enough to verify browser-owned behavior.

Verify:

- one Supervisor session claims the lease;
- every enabled looped Camera plays and samples;
- one enabled laptop Camera captures after permission is granted;
- navigation inside the test shell does not stop monitoring;
- Camera enablement conflicts have clear messages;
- scene switching preserves continuity;
- overlay geometry matches the exact analyzed frame;
- Alert Evidence contains the expected complete overlay payload.

The sandbox remains plain and separate from the presentation frontend.

Exit: backend and browser contracts work before Melissa's Camera UI is changed.

### Camera phase 6: application-level frontend coordinator

Move source ownership above route-level pages.

Build:

- mount one `SiteMonitoringCoordinator` inside the authenticated Supervisor shell;
- do not mount it for Cleaner mobile sessions;
- claim and maintain the Site lease independently of the selected route;
- create one source driver per enabled Camera;
- support laptop and looped-video drivers behind the same interface;
- maintain one shared in-memory Camera live store;
- stop sources, timers, media objects, and the lease on Supervisor logout or final owner shutdown;
- let another Supervisor console take over after lease expiry;
- consume backend runtime and observation events for non-owner viewing;
- prevent sampling work from blocking enable, disable, navigation, or UI controls.

Exit: changing pages never stops enabled Camera processing.

### Camera phase 7: wire the delivered Camera wall and details

Preserve Melissa's page structure and visual language.

Camera wall:

- show every active Camera;
- show actual source or latest analyzed frame for every enabled Camera;
- render compact overlays and derived online, offline, clear, watch, and action states;
- filter only what the user sees, never what the coordinator processes;
- keep the existing grid selector and Zone filtering;
- show a clear disabled state without silently starting a Camera.

Camera Details:

- consume the same coordinator feed rather than starting another monitor;
- provide one Enable or Disable action;
- size the video stage from source dimensions so video and overlay use one coordinate space;
- render full labels and confidence at detail size;
- retain current assignment, recent history, evidence, and structured Orchestrator trace;
- add a Reconfigure Camera action that opens the existing four-page replacement flow;
- automatically resume with the newly published source and Registration through a new episode after formal reconfiguration.

No Demo Source Scene selector appears in either page.

Exit: Camera wall, Camera Details, Alerts, Work, and evidence all read the same backend-owned Camera state.

### Camera phase 8: performance and acceptance

Run the realistic local demonstration rather than testing one Camera in isolation.

Verify:

- one, two, and the intended demonstration number of enabled Cameras;
- smooth navigation while inference runs;
- no unbounded frame queue;
- actual sample interval, inference latency, and skipped-sample counts;
- correct overlays at every grid size and Camera Details size;
- laptop enable conflict and recovery;
- clean to dirty to Alert to Work to clean to Verification workflow;
- browser-owner loss and takeover;
- Camera reconfiguration while the old source remains operational until publication;
- no ordinary frame retention outside Alert Evidence;
- Firebase read and write usage remains bounded.

If local compute cannot sustain one inference per second for every enabled Camera, keep every Camera active but use fair round-robin admission and drop stale unsent frames. Never build a backlog that makes the displayed state several minutes old.

## Frontend rendering decision kept open

The backend contract will support both presentations:

1. exact analyzed frames with exact overlays at the inference update rate;
2. smooth video with timestamp-matched overlays and a small display delay.

The product UI can test both after Phase 5. Alert Evidence always uses the exact retained frame and its matching overlay payload.

## Deferred source type

Phone browser Cameras remain feasible but are outside this redesign. The coordinator and source-driver boundary should permit a later `phone_browser` or WebRTC source without changing Alert, Work, Verification, or evidence semantics.

## Completion documentation

Each Camera phase receives `docs/camera-phase-<number>-completed-brief.md` with:

- code and data changes;
- API contracts;
- automated test results;
- manual verification steps;
- known limitations and deferred work.
