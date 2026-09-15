# LitterSpot deployment guide

## 1. Implemented deployment shape

LitterSpot is not deployed as a hosted web service by this repository. The implemented production shape is one trusted workstation running Vite, Node, FastAPI, model weights, and local media while connecting to cloud Firebase project `litterspot`.

## 2. Required services

- Firebase Authentication with production accounts
- Cloud Firestore database `(default)`
- deployed `firestore.rules` and `firestore.indexes.json`
- Firebase service-account JSON available only on the backend host
- Node.js 22, a Python environment, FFprobe, and the model files
- a writable local media directory with sufficient capacity

## 3. Configure Firebase

Set `backend/.env` to use `production-cloud`, project `litterspot`, expected project `litterspot`, database `(default)`, and the absolute service-account path. Set `frontend/.env.local` from the Firebase web application configuration.

Validate without mutation:

```bash
npm --workspace=backend run database:inspect-target
npm --workspace=backend run database:validate-schema
```

## 4. Deploy Firestore configuration

After confirming Firebase CLI authentication and the selected project:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project litterspot
```

Review index status before depending on a newly added query.

## 5. Prepare models and media

Verify the hashes in [model-card.md](model-card.md). Ensure `MEDIA_STORAGE_ROOT` exists or allow the backend to use `data/media-store`.

## 6. Start and stop

```bash
npm start
```

The launcher rejects occupied ports, starts FastAPI, Node, and Vite, records process IDs under `.local`, waits for the web application, and opens it.

Health checks:

```text
GET http://127.0.0.1:3000/api/health/live
GET http://127.0.0.1:3000/api/health/ready
GET http://127.0.0.1:8000/health
```

Stop with:

```bash
npm stop
```

## 7. Module checks

### Site and spatial administration

Confirm Superadmin and Root sign-in, Site status, Site Map, Zones, Camera Placements, and audit reads.

### Camera monitoring and AI

Confirm AI readiness, enable one looped Camera, and verify buffering, analyzed playback, and snapshots.

### Alert and evidence management

Confirm retained Alert Evidence loads through authenticated media routes.

### Cleaner and Work operations

Confirm Cleaner login, current Work, map projection, and notifications.

### Orchestration and operational intelligence

Confirm System configuration, worker state, recent Runs, dashboard, and bin analysis.

## 8. Rollback

Code rollback means stopping the stack and checking out the prior tested commit. Firestore rollback is separate because records may have changed while newer code ran. Take a coordinated Firestore and local-media backup before risky releases.

Never import the shared emulator fixture into production.

## 9. Limitations

- Vite is the current web server; no reverse proxy or TLS termination is included.
- Local media is available only on the backend host.
- Monitoring and rate-limit state is process-local.
- Multiple Node instances are unsupported without shared coordination and media storage.
- Infrastructure provisioning and credential rotation are manual.
