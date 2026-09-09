# Camera monitoring testing guide

## Run the system

Use the existing Node/FastAPI setup and product frontend. Node listens on 3000, FastAPI on 8000, and the product frontend normally on 5173. `npm start` starts Node and FastAPI only. In a second terminal, run `npm run dev:frontend`.

For underground scenes, add `CAMERA_DEMO_SCENES_ENABLED=true` to `backend/.env` and restart Node. This flag only works for development environments. New Postman requests are under `25 - Camera Monitoring Redesign`.

## Camera policy

1. Sign in as Root and create a Camera using either Laptop Camera or Looped video.
2. Complete the reference, floor/bin plotting, and publish steps.
3. The Camera appears disabled. Open its Details and enable it.
4. Create another laptop-source Camera. Enabling it while the first laptop Camera is enabled returns a named conflict. Disable the first before enabling the second.

Existing enabled Cameras retain their state; this update does not silently disable your existing records. Only new publication defaults changed.

## Continuous monitoring

1. Enable two or more Cameras.
2. The wall shows analyzed frames and overlays from every enabled Camera.
3. Open a Camera detail, then go to Work, Alerts or System, then return. Monitoring continues.
4. Change the Zone filter. Hidden Cameras still process.
5. Open a second Supervisor browser. It receives results while the first owns capture.
6. Close the owner. The remaining browser takes over after release or lease expiry. Allow around 40 seconds for expiry plus retry.
7. Disable one Camera. Its feed stops and existing Alerts/Work remain. Other Cameras continue.

Camera cards show exact analyzed snapshots with their matching overlays. The capture-owner browser builds compressed delayed playback only after Camera Detail opens. Detail starts after at least five seconds of footage and sufficient successful analysis coverage, then displays at up to 1280 × 720. `Original video` hides overlays without changing the delayed playback position.

If analysis coverage becomes unsafe, Detail freezes the last valid frame and shows `Rebuffering analysis`. A short interruption resumes from the frozen point; an interruption that falls more than two seconds behind skips missed presentation footage and resumes at the newest safely analyzed delayed position. Failure to build or recover coverage within thirty seconds shows `Camera analysis unavailable` with Retry. It never silently continues as raw footage.

Sampling is adaptive. Camera Detail requests a two-frame-per-second target, visible cards and positive or Verification bursts request one frame per second, and enabled Cameras without a visible consumer request one frame every four seconds. The owner submits through one Site-wide scheduler so the selected Detail Camera receives reserved capacity while background Cameras retain fair operational monitoring. Node admits at most one observation per second per Camera into Alert, Verification, evidence-candidate, and analytics policy, so presentation cadence does not accelerate business decisions.

## Prepare clean and dirty scenes

Record both videos from the same fixed view, with identical pixel dimensions, orientation and bin positions. Register the Camera with that view first.

Set the terminal environment variable `LITTERSPOT_DEMO_TOKEN` to a current Supervisor Firebase ID token. Do not commit the token or paste it into project files. You can alternatively use the Postman folder with `v2RootToken`.

Register each clip once:

```sh
npm run demo:camera-scene -- --camera CAMERA_ID --scene dirty --upload '/absolute/path/dirty.mp4'
npm run demo:camera-scene -- --camera CAMERA_ID --scene clean --upload '/absolute/path/clean.mp4'
```

Switch while monitoring:

```sh
npm run demo:camera-scene -- --camera CAMERA_ID --scene dirty
npm run demo:camera-scene -- --camera CAMERA_ID --scene clean
```

The shared emulator fixture also includes `clean` and `dirty` scenes for
`WPLR CAM1`. Use these shortcuts from the repository root while
`npm run start:emulator` is running:

```sh
npm run demo:scene:dirty
npm run demo:scene:clean
```

These shortcuts authenticate only against the loopback Firebase Auth emulator
and refuse non-loopback API URLs. Use the generic command above for another
Camera or development environment.

Scene keys are immutable. Upload a replacement under a new key. After formal Camera reconfiguration, old scenes cannot be selected against the new Registration. Upload compatible scenes again.

The emulator media normalization command also covers development scenes. It converts browser-incompatible codecs such as HEVC to H.264, backs up the originals, and refreshes stored media metadata:

```sh
npm run media:compress:emulator:apply
npm run media:sync:emulator
```

The browser visibly changes clips. No scene control appears in the product. The Camera keeps its episode, sequence, qualification window, Alerts, Work, analytics and verification context. The new clip starts at video time zero, but capture timestamps continue using current time.

## Cleaning workflow

1. Select dirty. Let the existing issue-specific rules qualify an Alert.
2. Assign a Cleaner manually or run the Orchestrator with its existing controls.
3. Cleaner starts Work.
4. Select clean when physical cleaning is meant to be complete.
5. Cleaner submits for review. Verification uses new samples captured after submission.
6. For orchestrated Work, the existing Orchestrator review cycle applies the outcome. For manual Work, the Supervisor makes the final decision.

Switching to clean does not itself resolve an Alert. If you submit while the dirty clip is still playing, the first positive review sample can produce a failed verification. That is expected under the existing rules.

## Evidence and reconfiguration

Open a newly generated Alert and compare Original with AI overlay. The snapshot must stay fixed while the live Camera continues. All detections belong to the retained frame. Camera history and assigned Cleaner evidence use the same saved geometry.

Use Reconfigure Camera to capture a new reference and replot floor/bins or replace its source. The old configuration continues until publication. Cancelling leaves it unchanged. Publishing formal reconfiguration starts a new episode, unlike underground scene switching.

## Performance observations

Compare one Camera with your intended demo count. Check actual sequence progress and `processingTimeMs` in browser network responses. Queued processing may make each Camera update less often than once per second. Do not repeatedly click Enable/Disable while waiting for a source permission prompt; the Camera message will identify unavailable media or denied access.

Tests use isolated emulator data and controlled model responses for repeatable workflow checks. Manual confirmation with your actual dirty/clean clips is still needed to evaluate your models' detection quality.

## Repeatable browser acceptance fixture

The repository includes `scripts/camera-runtime-fixture.mts`, `scripts/test-camera-runtime-browser.mjs`, and `scripts/test-camera-buffer-timeout-browser.mjs`. The browser checks use isolated emulator Camera data to verify grid snapshots, compressed delayed Detail playback, adaptive sampling, bounded memory, rebuffer recovery, the thirty-second unavailable state and Retry, `Original video`, secondary-browser snapshots, ownership failover, and desktop/tablet rendering. The fixture refuses to start without both Firebase emulator host variables. It never connects to the canonical cloud database.

Install optional browser tooling into ignored local storage:

```sh
npm install --prefix .local/camera-browser --no-save --package-lock=false playwright
```

Use running Auth/Firestore emulators and set `APP_ENV=local-emulator`, `FIREBASE_PROJECT_ID=demo-litterspot`, `EXPECTED_FIREBASE_PROJECT_ID=demo-litterspot`, `FIREBASE_DATABASE_ID=(default)`, both emulator hosts, an ignored `MEDIA_STORAGE_ROOT`, `CAMERA_DEMO_SCENES_ENABLED=true`, and `CORS_ORIGINS=http://127.0.0.1:5193`. Run `npm run test:camera:fixture` on free port 3180.

Start a separate frontend on 5193 with Firebase web values for `demo-litterspot`, `VITE_FIREBASE_AUTH_EMULATOR_URL` pointing to the Auth emulator, and `VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:3180`. These are process environment overrides; do not replace the product `.env` files. Run `npm run test:camera:browser` and `npm run test:camera:buffer-timeout`. Chrome must be installed. Screenshots go under `.local/`.

The fixture uses visible red/green video clips and controlled model responses to test state transitions. It is separate from the normal Camera source clips used for your presentation.
