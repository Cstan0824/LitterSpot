# Phase 12.6 completed brief — V2 live monitoring

Status: implemented locally. Frontend and backend builds pass, and the V2 monitoring request contracts are covered by frontend tests. The full Firebase emulator suite was not run because an unrelated Docker process already owns port 8080; no process was stopped.

## What is wired

- The existing Camera detail preview now hosts the V2 live-monitoring control rather than showing a separate competing panel. Overlay labels include the detected class and confidence.
- Every enabled V2 looped-video Camera now uses its authenticated source in the Camera wall; laptop Camera cards direct the Supervisor to open the detail view and start the owner session.
- A Supervisor can deliberately enable or disable a Camera's monitoring state. Looped-video Cameras remain disabled until explicitly enabled.
- Starting monitoring claims the Site-wide V2 Monitoring Session, starts one Camera Episode, and heartbeats the 30-second lease every 10 seconds.
- The owner browser captures one JPEG frame per second from either the laptop Camera or an authenticated looped-video source.
- Samples are submitted sequentially. A slow inference cannot overlap a later submission or break the required sequence number.
- Returned people, bin-state, litter, spill, and bin-service boxes render over the live source.
- Stopping monitoring, leaving the Camera view, unmounting the component, or losing the lease stops timers and webcam tracks, releases the lease, and releases authenticated media object URLs.
- A second browser cannot claim the active lease and therefore cannot submit duplicate samples.

## Remaining monitoring scope

The current browser owner starts one selected Camera Episode from the detail view. The Camera wall displays every enabled source, but it does not yet start and submit frames for every enabled Camera in one Site-wide session. That multi-Camera owner runtime should be added when the final Camera wall UI is delivered, so it can share one lease without creating competing per-card controls.

## Manual browser test

1. Sign in as a Supervisor and open a published V2 Camera in **Cameras**.
2. For a looped-video Camera, click **Enable**, then **Start monitoring**. For a laptop Camera, click **Start monitoring** and allow browser Camera permission.
3. Confirm the panel says `Owner session active` and its status updates once per second.
4. Confirm returned people/bin/issue boxes appear over the source when the model finds them.
5. Open the same Camera from a second Supervisor browser session and attempt to start monitoring. It must report that another browser owns the session.
6. Return to the owner browser and click **Stop monitoring**. Confirm the panel stops and the other browser can then claim monitoring.
7. For a looped-video Camera, click **Disable** and confirm Start is disabled again.

## Verification performed

```text
npm --prefix frontend run build
Passed

npm --prefix frontend test -- --run
37 tests passed

npm --prefix backend run build
Passed
```

The existing backend emulator test suite includes `v2Monitoring.integration.test.ts`, covering lease ownership, episode start, sample processing, alert evaluation, and evidence retention. The current run could not start because port 8080 is owned by Docker, not because the tests failed.
