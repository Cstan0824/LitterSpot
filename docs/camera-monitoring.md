# Camera monitoring

## 1. Responsibility

Camera monitoring owns browser capture, Site-level ownership, ordered samples, private inference calls, exact snapshot distribution, delayed analyzed Camera Detail playback, and bounded analytics admission.

## 2. Camera configuration

A monitorable Camera must be active, enabled, placed in the active Site Map, and linked to an active source and Registration revision. Its source is either:

- `laptop_camera`, opened with `getUserMedia`; or
- `looped_video`, fetched through an authenticated media URL and played in a hidden video element.

Only one laptop Camera may be enabled in a Site. Enabling or disabling monitoring is separate from structural Camera status.

## 3. Monitoring ownership

### Site and spatial administration

The active map supplies Camera Zone and point context. A source or Registration change invalidates an existing driver and episode.

### Camera monitoring and AI

One browser owns capture for the Site:

1. `SiteCameraMonitoring` loads `/api/monitoring/live/config`.
2. If an enabled Camera exists and no valid lease is held, the browser claims a Monitoring Session.
3. The browser heartbeats the session during its 10-second maintenance tick.
4. Node stores the authoritative lease in process memory and a bounded session record in Firestore.
5. Page hide, sign-out, no enabled Cameras, explicit release, or lease failure stops drivers.
6. Another browser may claim after release or expiry.

The lease token is required on heartbeat, episode, sample, stop, and release operations. Samples must have the next expected sequence.

## 4. Adaptive sampling

| Camera interest | Target interval |
| --- | ---: |
| Open in Camera Detail | 500 ms |
| Visible Camera card | 1,000 ms |
| Positive-observation burst | 1,000 ms for 10 seconds |
| Awaiting Camera Verification | 1,000 ms |
| Enabled but offscreen | 4,000 ms |

The browser has one sample scheduler. It selects one due Camera at a time by urgency and gives a background Camera priority if it has waited at least four seconds. Node also serializes inference per Camera.

The target interval is not a guaranteed inference rate. Slow capture, encoding, network, queueing, or models reduce the achieved rate without allowing parallel requests for the same Camera.

## 5. Sample contract

Each sample includes:

- JPEG frame at quality 0.82;
- Monitoring Session token;
- episode ID and ordered sequence;
- capture timestamp;
- source playback time;
- playback generation.

Node rejects samples outside the current lease or episode and samples more than two minutes late or ten seconds in the future. After inference, Node checks ownership and Camera configuration again before accepting the result.

## 6. Presentation modes

### Exact analyzed snapshots

Camera cards and secondary browsers show the JPEG that produced a successful AI Observation. Its overlay is therefore exact for that image. Node distributes snapshots and observations through a server-sent event stream. The owner also updates directly from its sample response.

### Delayed analyzed Camera Detail

Only the capture-owner browser builds delayed footage:

- source frames are drawn to a canvas at 30 FPS;
- dimensions are capped at 1280×720 without upscaling;
- `MediaRecorder` emits 250 ms WebM chunks at a target 4 Mbps;
- `MediaSource` appends the chunks to a hidden playback element;
- the screen draws the delayed video to a visible canvas and selects overlays by capture timestamp.

Startup requires:

- at least 5 seconds of buffered video;
- at least 2 seconds of analysis lead;
- at least three observations with no gap above 2 seconds and at least 1 second of covered time.

Until then, the UI shows `Connecting to Camera...`.

## 7. Overlay timing

The newest observation at or before the displayed frame may be used for at most one second:

| Overlay | Maximum age |
| --- | ---: |
| Person | 350 ms |
| Floor litter or spill | 700 ms |
| Registered bin | 1,000 ms |

This avoids holding moving boxes indefinitely while giving stationary registered bins slightly more presentation time.

## 8. Rebuffering

Playback pauses when analysis lead falls below 750 ms. The UI removes expired overlays and shows `Rebuffering analysis`.

Playback resumes only after analysis lead returns to at least 2 seconds and continuous analysis exists. If the intended delayed position is more than 2 seconds ahead of the frozen frame, playback skips to the newest safe delayed position. Otherwise it resumes from the frozen position and accepts the increased delay.

Initial buffering or rebuffering fails after 30 seconds. The UI shows `Camera analysis unavailable` with Retry. It never continues as unanalyzed footage.

## 9. Runtime and persistence

### Alert and evidence management

Node keeps up to five recent observations per Camera and issue type plus the highest-confidence candidate frame. Candidate evidence expires after 30 seconds when it is no longer represented in temporal memory.

### Cleaner and Work operations

Awaiting Camera Verification raises the sampling cadence. Fresh observations feed the active Verification collector.

### Orchestration and operational intelligence

Admitted operational samples contribute numeric counts and latency to minute accumulators. Completed buckets are flushed to Firestore. Presentation sampling may be faster than operational analytics admission.

## 10. Failure behavior

- A source failure stops that Camera driver and marks a safe message.
- A 503 sample response backs off for 15 seconds, or 10 minutes for Firestore quota exhaustion.
- A 429 response waits without rebuilding the episode.
- An ambiguous non-rate-limit response attempts to resume the episode and recover the next sequence.
- Node marks an active Camera offline after ten seconds without an accepted sample.
- Episodes with lost sessions or 75 seconds of inactivity are ended by the runtime sweep.
- The live event receiver reconnects after 1.5 seconds and aborts a hung connection after 55 seconds.

## 11. Resource boundary

Video buffers, snapshots, source elements, lease ownership, and sampling queues live in browser or Node memory. They do not survive restarts and are not shared across backend hosts. Local media URLs remain authenticated Node routes.
