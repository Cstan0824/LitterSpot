# Camera phase 3 completion

Development scene upload and selection live under `/api/development/cameras/:cameraId/scenes`. Both require an authenticated Supervisor and `CAMERA_DEMO_SCENES_ENABLED=true` in a development environment. Production rejects the route even if the flag is set.

Upload validates actual video content and exact Registration dimensions. Scene keys are immutable; use a new key to replace a clip. The same physical view and bin arrangement must be maintained by the operator.

Selection changes `demoPlayback` only. Source and Registration revisions, Camera revision, monitoring episode, sequence, and business state remain unchanged. The scene test passed against Firestore emulators and checks continuity, development gating, and rejection after reconfiguration.

Set `LITTERSPOT_DEMO_TOKEN` to a Supervisor Firebase ID token in a terminal. Register with `npm run demo:camera-scene -- --camera <id> --scene clean --upload <path>`. Select with the same command without `--upload`. Use another key such as dirty for the second scene. Product UI contains no scene selection control.
