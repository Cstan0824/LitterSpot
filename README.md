# LitterSpot

LitterSpot is a web-based cleanliness operations system for tourist attractions and similar venues. It connects configured Camera views, local vision inference, qualified Alerts, Cleaner assignment, Work tracking, Verification, and Site-level reporting.

## Business modules

1. Site and spatial administration
2. Camera monitoring and AI
3. Alert and evidence management
4. Cleaner and Work operations
5. Orchestration and operational intelligence

See the [product requirements](docs/PRD.md), [business flows](docs/business-flows.md), [technical specification](docs/spec.md), and [architecture](docs/architecture.md).

## Technology

- React 19, TypeScript, and Vite
- Node.js 22, TypeScript, and Express 5
- Firebase Authentication and Cloud Firestore
- Python FastAPI with local PyTorch and Ultralytics model artifacts
- backend-host local media storage
- Firebase Emulator Suite, Vitest, Supertest, and Python `unittest`

## Install

```bash
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r ai-service/requirements.txt
```

On Windows, use `.\.venv\Scripts\python.exe` instead of `.venv/bin/python`.

Copy and configure:

- `backend/.env.example` → `backend/.env`
- `frontend/.env.example` → `frontend/.env.local`

The complete variable reference is in [configuration](docs/configuration.md).

## Run

Production-connected local stack:

```bash
npm start
```

Isolated emulator stack:

```bash
npm run start:emulator
```

Stop either stack:

```bash
npm stop
```

The web application runs at `http://127.0.0.1:5173`, Node normally runs at `http://127.0.0.1:3000`, and FastAPI runs at `http://127.0.0.1:8000`.

## Test

```bash
npm --workspace=backend run build
npm --workspace=frontend run build
npm --workspace=backend run test
npm --workspace=frontend run test
.venv/bin/python -m unittest discover -s ai-service/tests -p 'test_*.py'
npm run test:assignment
npm run fixture:emulator:verify
npm run test:emulator
```

Vitest is intentionally limited to one worker. See [testing](docs/testing.md) and the [release checklist](docs/release-checklist.md).

## Demo

With the emulator stack running:

```bash
npm run demo:scene:dirty
npm run demo:scene:clean
```

See the [demo guide](docs/demo-guide.md) for the full walkthrough and reset procedure.

## Documentation

The [documentation index](docs/README.md) links product, technical, security, data, development, deployment, operation, AI, Camera, Orchestrator, and design references. Canonical business terminology is defined in [CONTEXT.md](CONTEXT.md).

## Storage boundary

Firebase stores identities and application records. Media bytes stay in `MEDIA_STORAGE_ROOT` on the Node host and are served only through authorized API routes. The Firebase Storage bucket value appears in web configuration but is not used for LitterSpot application media.
