# Camera phase 5: sandbox verification

The plain API sandbox now uses `shared/cameraMonitoring.ts`, the same browser coordinator as the product. Open Monitor after authentication and press Connect Supervisor monitoring session. Each Camera has one Enable or Disable control and an exact analyzed frame with its boxes. The component remains mounted when another sandbox tab is selected.

Browser verification used Chrome and isolated Firebase Auth/Firestore emulators. Two enabled Cameras produced frames. Navigating to Connect and back advanced both sample sequences without changing episode IDs. Selecting a clean scene changed the displayed video and issue results while preserving the episode. No browser JavaScript errors were recorded.

The browser fixture substitutes deterministic inference responses to verify workflow mechanics. It is not a model-accuracy benchmark. The actual FastAPI model boundary was checked separately in phase 8.

Run the sandbox with `npm run dev:sandbox`. Use a Supervisor token from the same environment as Node. Do not start the old sandbox runtime in another tab while testing ownership; another open Supervisor console may already own the lease, in which case this sandbox becomes a viewer.
