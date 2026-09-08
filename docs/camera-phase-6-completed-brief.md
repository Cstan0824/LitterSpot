# Camera phase 6: Supervisor monitoring coordinator

`SiteMonitoringProvider` mounts once around the authenticated Supervisor routes. It survives Dashboard, Camera, Alert, Work, Team, Insights and System navigation. It never mounts for Cleaner or Superadmin sessions.

`shared/cameraMonitoring.ts` owns the lease, heartbeat, source video elements, media URLs, per-Camera episodes, and sequential sampling. Each enabled Camera receives a source driver. Normal route changes do not stop drivers. Disablement stops only the selected Camera. Closing or logging out releases ownership and capture; another Supervisor browser claims ownership after release or expiry.

The owner targets one frame per second per Camera, with one outstanding request per driver. Slow requests reduce effective cadence rather than create a growing backlog. Viewers receive exact analyzed frames through an authenticated event stream. Every stream reconnects periodically for access checks.

Validation: the product browser acceptance run processed six Cameras, navigated through System, connected a second viewer, closed the first browser, observed automatic takeover, and disabled/re-enabled one Camera. The run recorded 30 processed samples across all six Cameras and no JavaScript errors.

Manual test: open two separate Supervisor browser sessions, enable at least two Cameras, move between pages, and inspect frames in the second session. Closing the owner should allow the remaining session to take over within the lease interval plus its next ownership check, normally no more than about 40 seconds. A laptop source still needs browser Camera permission.
