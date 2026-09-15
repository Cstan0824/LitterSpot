# LitterSpot development guide

## 1. Prerequisites

- Node.js 22 and npm
- Python 3.12 or a compatible local Python used by the checked-in virtual environment
- Java 21 for Firebase Emulator Suite tests
- FFmpeg and FFprobe on `PATH`
- local model artifacts at the paths in [model-card.md](model-card.md)

## 2. Install dependencies

From the repository root:

```bash
npm ci
python -m venv .venv
```

macOS or Linux:

```bash
.venv/bin/python -m pip install -r ai-service/requirements.txt
```

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

## 3. Production-connected local development

1. Copy `backend/.env.example` to `backend/.env` and configure the Firebase service-account path.
2. Copy `frontend/.env.example` to `frontend/.env.local` and configure the Firebase web application values.
3. Keep `APP_ENV=production-cloud`, `FIREBASE_PROJECT_ID=litterspot`, `EXPECTED_FIREBASE_PROJECT_ID=litterspot`, and `FIREBASE_DATABASE_ID=(default)` aligned.
4. Start the full application:

```bash
npm start
```

This starts FastAPI on port 8000, Node on the configured backend port, and Vite on port 5173. It opens the browser after Vite responds.

Stop all recorded processes:

```bash
npm stop
```

Start Node and FastAPI without Vite:

```bash
npm run start:api
```

## 4. Emulator development

Start the isolated stack:

```bash
npm run start:emulator
```

| Service | Address |
| --- | --- |
| Web application | `http://127.0.0.1:5173` |
| Node API | `http://127.0.0.1:3000` |
| FastAPI | `http://127.0.0.1:8000` |
| Firestore emulator | `127.0.0.1:8180` |
| Authentication emulator | `127.0.0.1:9199` |
| Emulator UI | `http://127.0.0.1:4100` |

Local fixture credentials are printed by the launcher. They are development-only.

The launcher imports `.local/firebase-emulator-data` when present. On first use it copies the shared fixture. `npm stop` exports the current emulator state before stopping services.

## 5. Fixture management

```bash
npm run fixture:emulator:verify
npm run fixture:emulator:reset
```

The reset requires the stack to be stopped and moves current local state into `.local/backups`. Publish a deliberately revised baseline only after stopping the stack:

```bash
npm run fixture:emulator:update
```

Review every Firestore and media change before committing. Never import the fixture into production.

## 6. Module development map

### Site and spatial administration

- Frontend: Superadmin, Team, Site Administration, Site Map Viewer
- Backend: identity, Superadmin, Site Map, geometry, Site operation services

### Camera monitoring and AI

- Frontend: Camera pages, Site Monitoring Provider, shared monitoring and delayed playback
- Backend: Camera Creation, monitoring, runtime registry, local media
- Python: `ai-service/app`

### Alert and evidence management

- Frontend: Alert Management and evidence components
- Backend: Alert policy and service, media authorization

### Cleaner and Work operations

- Frontend: Cleaner mobile, Team Management, Work Management
- Backend: Cleaner availability, Cleaner service, Work service, notifications

### Orchestration and operational intelligence

- Frontend: Dashboard, Bin Analysis, System page
- Backend: Orchestrator, analytics, bin placement, audit and system services
- Python: `task-assignment-llm`

## 7. Development rules

- Do not edit generated `backend/dist`.
- Backend build cleans `dist` before compiling.
- Keep Vitest at one worker through the package scripts.
- Do not point emulator commands at a cloud project.
- Production reset, bootstrap, and seed commands are blocked by safety guards.
- Keep service accounts, `.env` files, `.local`, media, and provider diagnostics out of Git.
