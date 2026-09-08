# Camera phase 1 completion

Implemented Camera source selection independent of creation order. All new Cameras publish disabled. The monitoring mutation reserves the enabled laptop Camera in a Site transaction and returns a named 409 conflict when another laptop Camera is enabled. Existing registered Cameras are checked, so the transition needs no destructive data reset. Added Root-only structural deactivation through the same control service and transaction audit.

Changing source type on an enabled Camera requires disabling it first. Reconfiguration with the same type preserves deliberate monitoring state.

Validation: backend TypeScript build passed; 9 policy and Camera workflow tests passed against isolated Firebase emulators, including simultaneous laptop enablement.

Test through `PATCH /api/camera-creation/cameras/:cameraId/monitoring` with `monitoringEnabled` and the current `expectedRevision`. Register two laptop Cameras, race enable requests, and expect one 200 and one 409. Disable the winner and enable the other. Product source selection is wired in Camera phase 7.
