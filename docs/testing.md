# LitterSpot testing guide

## 1. Test policy

Automated tests run sequentially or with one Vitest worker to control CPU and memory use. Emulator integration tests run one file at a time against an isolated demo Firebase project.

## 2. Core commands

| Command | Coverage |
| --- | --- |
| `npm --workspace=backend run test` | Backend unit tests; integration files skip without emulator hosts |
| `npm --workspace=frontend run test` | Frontend services, policies, presentation helpers, and rendered component behavior |
| `npm --workspace=backend run build` | Clean TypeScript backend build |
| `npm --workspace=frontend run build` | TypeScript and Vite production build |
| `.venv/bin/python -m unittest discover -s ai-service/tests -p 'test_*.py'` | FastAPI schemas, pipeline policies, model wrappers, and device behavior |
| `npm run test:assignment` | Isolated assignment provider and tool contracts |
| `npm run test:emulator` | Full Authentication and Firestore integration suite |
| `npm run fixture:emulator:verify` | Shared Firebase export and media manifest |

Current verified totals are 142 backend unit tests, 149 frontend tests, 25 AI-service tests, 12 assignment tests, and 181 emulator integration tests. Counts may change as tests are added.

## 3. Module coverage

### Site and spatial administration

Target safety, identity compensation, Supervisor projections, map geometry and publication, Superadmin operations, Camera movement, removal, and Site cleanup.

### Camera monitoring and AI

Monitoring leases and sequences, Camera Creation and Registration, adaptive sampling, delayed playback, inference schemas and safeguards, demo scenes, and Firestore write budgets.

### Alert and evidence management

Qualification, active-key deduplication, priority, evidence, transitions, media delivery, dismissal, and Site isolation.

### Cleaner and Work operations

Schedules, availability, Cleaner self-service, atomic assignment, Manual Work, Completion Evidence, Verification, rework, takeover, reassignment, dismissal, and notifications.

### Orchestration and operational intelligence

Provider schema and timeouts, eligible-pair validation, outbox and Run leases, retries, recovery, analytics, dashboard, bin placement, audit, and System events.

## 4. Emulator suite

`npm run test:emulator` creates temporary configuration under `.local`, uses ports 8280 and 9299, clears cloud credentials, and uses a temporary media root. It runs all backend integration files in a fixed order and writes a sentinel only after every suite and smoke command passes.

## 5. Browser Camera checks

The repository includes:

- `npm run test:camera:browser`
- `npm run test:camera:buffer-timeout`
- `npm run test:camera:fixture`

These cover browser media APIs that Vitest cannot fully reproduce. They require the dedicated Camera browser fixture.

## 6. Manual acceptance

After Camera or UI changes, verify:

1. All four human roles enter the correct application area.
2. Site Map background, Zones, Camera markers, and Station Points load.
3. Camera Detail buffers before playback and never continues without analysis.
4. Grid cards show exact snapshots.
5. Clean and dirty demo commands switch the current Camera source.
6. Alert, assignment, Cleaner progress, Verification, and rework state remain coherent.
7. Superadmin Site View exposes no Supervisor mutations.

## 7. CI

GitHub Actions runs Node 22 and Java 21 for `npm ci`, backend tests, backend build, frontend build, and emulator tests. A separate Python 3.12 job installs CPU-only dependencies and runs the AI `unittest` suite.

The workflow does not currently run frontend Vitest or isolated assignment tests. Run both locally before release.
