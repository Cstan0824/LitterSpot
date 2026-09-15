# LitterSpot operations runbook

## 1. Scope

This runbook covers the implemented production-connected local stack, cloud Firebase, local media, runtime workers, backups, and incident response.

## 2. Start, health, and stop

Start:

```bash
npm start
```

Health endpoints:

- Node liveness: `/api/health/live`
- Node readiness: `/api/health/ready`
- FastAPI detail: `http://127.0.0.1:8000/health`

Stop:

```bash
npm stop
```

The launcher records child process IDs in `.local/local-services.json`. If stop reports no recorded services but ports remain occupied, inspect the listeners before terminating them.

## 3. Logs and request tracing

Node writes structured JSON request logs with timestamp, level, event, request ID, method, path, status, latency, and safe actor fields. Unhandled errors log only a safe error name. Use the response `requestId` to correlate a frontend failure with Node logs.

FastAPI logs startup and HTTP status through Uvicorn. Do not expose FastAPI directly to untrusted networks.

## 4. Module health checks

### Site and spatial administration

- Confirm `/api/me` returns the intended role and Site.
- Confirm active map and selected Site records carry the expected `activeMapRevisionId`.
- For incomplete Site deactivation, inspect `siteOperations` and use the Superadmin reconcile operation.

### Camera monitoring and AI

- Confirm Node readiness and FastAPI model readiness.
- Check Camera monitoring enablement, active source and Registration IDs, lease ownership, and current episode.
- If Camera Detail re-buffers, inspect inference latency and sample cadence before changing thresholds.
- If local evidence is missing, compare `mediaAssets.storageKey` with `MEDIA_STORAGE_ROOT`.

### Alert and evidence management

- Check active-key documents for the Site, Camera, and issue type.
- Confirm Alert Evidence media metadata and local bytes exist.
- Do not manually resolve an Alert by editing Firestore; use Work Verification or supported dismissal.

### Cleaner and Work operations

- Check Site, account, and Cleaner status, schedule timezone, availability override, Station Point, and active Work.
- Check Work and Cleaner revisions before diagnosing a 409.
- For missing Completion Evidence, inspect both the media record and local storage status.

### Orchestration and operational intelligence

- Check Orchestrator configuration, worker-enabled flag, waiting backlog, outbox status, active Run, attempts, and system events.
- A paused Orchestrator does not stop monitoring or Alert creation.
- For missing analytics, inspect admitted samples, completed minute buckets, daily coverage, and worker enablement.

## 5. Firebase rules and indexes

Deploy from the repository root after verifying project `litterspot`:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project litterspot
```

An index may remain building after deployment. Query errors include the required index information; add indexes only for implemented queries.

## 6. Database safety

Read-only checks:

```bash
npm --workspace=backend run database:inspect-target
npm --workspace=backend run database:validate-schema
```

They require an exact expected project match. Mutating reset, bootstrap, and seed commands reject `production-cloud`.

## 7. Coordinated backup

Firestore stores metadata while media bytes stay local. A recoverable backup must capture both at one operational point.

1. Stop or quiesce Camera monitoring and other writes.
2. Record the Git commit and `systemMetadata/schema` values.
3. Export Firestore using an approved Firebase or Google Cloud method when billing and permissions support it.
4. Copy `MEDIA_STORAGE_ROOT` while preserving relative paths and file metadata.
5. Hash and store the Firestore export and media archive together.
6. Protect service-account credentials separately; never include them in the application backup.

The Firebase Spark plan does not provide managed scheduled Firestore exports. The repository therefore has no automatic production Firestore backup job.

## 8. Restore rehearsal

Use an isolated Firebase project and separate media root. Restore Firestore metadata and media paths, validate schema, start the stack, then test authorized Site Map backgrounds, Camera sources, Alert Evidence, Completion Evidence, and video byte ranges. Never rehearse against production.

## 9. Media retention

Run the backend retention command only after reviewing the configured project and media root:

```bash
npm --workspace=backend run media:retention
```

The service validates references and confines deletion to the local media root. Review storage-status changes and filesystem results together.

## 10. Incident response

### Firestore quota exhausted

Symptoms include HTTP 503 with `firestore_quota_exceeded`. Stop repeated manual refreshes. Monitoring automatically backs off sample retry for ten minutes on this code. Keep the Orchestrator paused if repeated writes would worsen the incident, then resume after quota recovery.

### AI service unavailable

Check model paths, hashes, Python dependencies, device selection, and FastAPI `/health`. Node readiness remains degraded until required models load. No valid observation is created from a failed inference request.

### Monitoring owner lost

Wait for lease expiry or release, then allow another authenticated Supervisor browser to claim. Node ends stale episodes during its ten-second sweep.

### Orchestrator failure

Inspect the Run result, attempts, action records, and safe system event. The Alert or Work should remain in a valid state. Correct provider or configuration failure, then resume or allow scheduled retry. Do not edit leases manually unless performing a controlled recovery.

### Site operation incomplete

Use the Superadmin operation detail and reconcile endpoint. Cleanup is paged and idempotent. Reactivation remains blocked until completion.

### Local media missing

Do not replace evidence with unrelated bytes. Restore the exact storage key from the coordinated backup or mark the operational incident. Firestore metadata alone cannot reconstruct the media.

## 11. Operational limitations

- One backend host owns local media.
- Monitoring runtime is not shared across Node instances.
- In-process rate limits reset on restart.
- Vite provides the current web serving layer without TLS.
- Raw provider diagnostics are unavailable in production because the writer is disabled there.
