# LitterSpot demo guide

## 1. Start

```bash
npm run start:emulator
```

Open `http://127.0.0.1:5173`. The launcher prints the Root and Superadmin fixture credentials. Emulator UI is at `http://127.0.0.1:4100`.

## 2. Walkthrough

### Site and spatial administration

1. Sign in as Root Supervisor.
2. Show Dashboard Zones, Camera points, and current Work context.
3. Open Site Administration to show dimensions, background, and revision editing without publishing.
4. Use a separate Superadmin session to show Site selection, Site View, status control, Root recovery, and audit history.

### Camera monitoring and AI

1. Open Cameras and enable WPLR CAM1 if disabled.
2. Open Camera Detail.
3. Explain `Connecting to Camera...` while footage and analysis coverage build.
4. Show delayed analyzed playback, overlays, processing latency, and Original Video.
5. Explain that grids and secondary browsers use exact analyzed snapshots.

### Alert and evidence management

Switch the source to dirty:

```bash
npm run demo:scene:dirty
```

Allow qualification samples to arrive, then open the Alert and show retained evidence, Camera, Zone, severity, and assignment.

### Cleaner and Work operations

Assign an available Cleaner manually or let the running Orchestrator assign one. Sign in as that Cleaner, start the Work, inspect map and evidence, and submit for review.

### Orchestration and operational intelligence

Show System status, backlog, Runs, attempts, and decision factors. Show Dashboard and Bin Analysis. Explain that Node validates and commits every mutation.

## 3. Restore clean footage

```bash
npm run demo:scene:clean
```

Both commands authenticate through the local emulator by default and select scene keys tied to the active Camera source and Registration.

## 4. Reset data

```bash
npm stop
npm run fixture:emulator:reset
npm run start:emulator
```

Reset moves the previous local state into `.local/backups`.

## 5. Failure recovery

| Symptom | Action |
| --- | --- |
| Port already in use | Run `npm stop`, then inspect the port if it remains occupied |
| Camera analysis unavailable | Retry and confirm FastAPI readiness and model paths |
| Scene does not match Registration | Restore the shared fixture; do not bypass Registration validation |
| No Alert after dirty scene | Confirm monitoring is enabled and wait for qualification samples |
| No Cleaner assignment | Check Orchestrator state, schedule, override, Station Point, and active Work |
| Site background unavailable | Confirm local media exists and use Retry |
| Unexpected emulator state | Stop and run `npm run fixture:emulator:reset` |

## 6. Stop

```bash
npm stop
```

The stop command exports emulator state before terminating services.
