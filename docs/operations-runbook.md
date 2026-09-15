# LitterSpot operations, backup, retention, and recovery runbook

Last updated: 2026-09-14

## Final cloud cutover and local recovery

The current cloud target is `litterspot/(default)` in `asia-southeast1`.
Authentication is cloud-backed; media is local under the configured
`MEDIA_STORAGE_ROOT`. Start the complete local-hosted cloud app using `npm
start` and stop it using `npm stop`. `npm run start:cloud` is an equivalent
explicit alias. Use `npm run start:emulator` only for isolated future
development.

The 2026-09-14 migration archive is stored in ignored local directory
`.local/firebase-migrations/litterspot-2026-09-14-001`. It contains typed source
and destination Firestore archives, Auth exports and hash configuration,
source media, previous local configuration and media, checkpoints, and
verification reports. The archive directory is private and sensitive. Emulator
Auth exports contain emulator-only password representations that must never
be published or committed.

Restore a failed cutover using the preserved destination document archive and
Auth records with the backed-up original scrypt configuration. Do not import
emulator fake password hashes directly into cloud Auth. Reverting only
frontend configuration is not a data rollback.

Before restoring or resetting, stop all application writers and inspect the
exact project/database targets. Retain the source emulator and media until
functional cloud acceptance is complete. Local backups provide recovery from
this cutover but are not an automated off-host disaster-recovery service.

Cutover acceptance completed on 2026-09-14. The verified baseline contains
10,716 Firestore documents, 9 Auth accounts, 2 Sites, 13 Cameras and 13 current
Camera Registrations. All 108 local media files matched the captured source by
checksum. The deployed rules and 86 composite indexes are ready, and 89 cloud
API, role, map, media, scene-switching, and notification-isolation checks
passed. The Orchestrator worker was enabled again after acceptance.

## 1. Scope

This runbook covers the hardened Node/Firebase/FastAPI prototype through Phase
11. Firestore is the business-data authority, Firebase Authentication owns identities, and the
configured `MEDIA_STORAGE_ROOT` owns uploaded and extracted media. A complete
recovery point therefore requires coordinated Firestore and local-media
copies. A Firestore export alone is not a complete LitterSpot backup.

Never copy, print, upload, or commit the Firebase Admin service-account JSON,
Firebase refresh tokens, Supervisor passwords, `AI_SERVICE_TOKEN`, or model
provider credentials.

## 2. Health and controlled startup/shutdown

- `GET /api/health/live` proves only that Node can answer HTTP.
- `GET /api/health/ready` proves that Node can reach a ready FastAPI inference
  dependency without exposing model paths or versions.
- `npm start` starts the local React, Node, and FastAPI services.
- `npm stop` stops services launched by the repository launcher.
- A standalone Node process handles `SIGINT`/`SIGTERM`, stops accepting new
  requests, and waits up to 20 seconds for the in-process video queue.

Do not kill the process or host during a media upload, analytics rebuild, or
retention execution. Video jobs use Firestore leases and startup recovery, but
local uploads still depend on one host and one media directory.

## 3. Logs and system events

Every Node response carries `X-Request-ID`. JSON request logs include the same
ID, HTTP method, path without query secrets, response status, latency, and
authenticated Supervisor UID. Unexpected errors return a generic response and
do not expose a stack or raw upstream payload.

Dependency failures are deduplicated in `systemEvents` by dependency, event
code, and scope. The current product provides authenticated Site visibility:

- `GET /api/operations/v2/system`

Only allowlisted safe details are persisted. There is intentionally no public
endpoint for creating, resolving, or deleting system events.

## 4. Firestore indexes

After changing `firestore.indexes.json`, authenticate the local Firebase CLI
and deploy the named-database indexes:

```bash
npx firebase login
npx firebase deploy --only firestore:indexes --project litterspot
```

Wait until the Firebase/Google Cloud console reports the indexes as ready.
The Emulator Suite does not prove production index availability. In cloud
smoke tests, dashboard and analytics responses should report `indexed`, not a
bounded fallback mode.

## 5. Repository verification

The current CI workflow runs backend tests, both production builds, the
Firebase emulator integration suite, and the Python inference tests directly.
Its authoritative command list is in `.github/workflows/ci.yml`; no
phase-specific verification wrapper remains.

Emulator tests use the demo project `demo-litterspot` and a temporary
`.local/firebase-emulator-media` directory. They must not contact the cloud
project.

## 6. Coordinated backup policy

### 6.1 Current Spark-plan limitation

Cloud Firestore managed scheduled backups, backup storage, restore operations,
and managed export/import require billing. The current Spark-plan prototype
therefore has no honest cloud disaster-recovery backup. Do not describe normal
Firestore replication as protection from accidental application deletion.

Until the team enables billing and chooses a Cloud Storage backup destination:

- retain soft-deletion semantics for business records;
- keep the retention command in dry-run mode;
- do not execute destructive media retention against irreplaceable evidence;
- recreate the single Supervisor identity with the bootstrap procedure if
  needed; Firebase Authentication identities are not contained in Firestore
  exports.

### 6.2 Coordinated backup after billing is approved

1. Announce a maintenance window and stop frontend/API write traffic.
2. Stop Camera monitoring sessions and ensure no analytics rebuild or Site
   cleanup operation is running.
3. Stop Node cleanly.
4. Export the named Firestore database to a versioned Cloud Storage prefix:

   ```bash
   gcloud firestore export gs://BACKUP_BUCKET/litterspot/YYYY-MM-DDTHHMMSSZ \
     --database=litterspot \
     --project=litterspot
   ```

5. Wait for the export operation to complete successfully. Do not treat a
   started or partially cancelled export as recoverable.
6. Export Firebase Authentication users to a separate encrypted, access-limited
   file. It may contain password hashes and salts and must be handled as a
   credential backup:

   ```bash
   npx firebase auth:export \
     /secure-backup/litterspot-auth-YYYY-MM-DDTHHMMSSZ.json \
     --format=json --project litterspot
   ```

   Verify that the operator has the permissions required to export password
   hashes; an identity list without usable password hashes is not a complete
   login recovery point.
7. Archive the entire configured media root while Node is stopped, for example:

   ```bash
   tar -C /absolute/path/to/LitterSpot/data \
     -czf /secure-backup/litterspot-media-YYYY-MM-DDTHHMMSSZ.tar.gz \
     media-store
   shasum -a 256 /secure-backup/litterspot-media-YYYY-MM-DDTHHMMSSZ.tar.gz
   ```

8. Record one manifest containing the Git commit, project ID, database ID,
   Firestore export URI, encrypted Auth export name/hash, media archive
   name/hash, media-root configuration, start/end time, and operator. Store no
   credentials or password-hash parameters in the manifest.
9. Restart services and verify liveness/readiness.

The Firestore export and media archive must share the same maintenance-window
identifier. Independent copies can leave Firestore references pointing at
missing files or restore unreferenced files.

### 6.3 Recovery rehearsal

Practice recovery in a separate project/database and an empty media root. A
managed Firestore import can overwrite documents with matching IDs, so never
rehearse against the live database.

```bash
gcloud firestore import gs://BACKUP_BUCKET/litterspot/EXPORT_PREFIX \
  --database=RESTORE_DATABASE \
  --project=RESTORE_PROJECT
```

Restore the matching media archive only while the restore Node service is
stopped, set `MEDIA_STORAGE_ROOT` to that restored directory, then verify:

1. Supervisor bootstrap/sign-in;
2. site/zone/camera reads;
3. a sample media content URL and SHA-256;
4. job, analysis, detection, alert, and history references;
5. dashboard, daily analytics, and bin-placement reads;
6. a Camera monitoring sample and its retained evidence.

Import the matching Auth export only into the separate restore project. Use the
Firebase project's sensitive SCRYPT hash parameters exactly as documented by
Firebase; importing without the correct parameters can preserve accounts while
making passwords unusable. Confirm both Supervisor and Cleaner sign-in and that
each UID matches `userAccounts/{uid}` before declaring recovery successful.

## 7. Media retention

The command is dry-run by default:

```bash
npm --workspace=backend run media:retention -- \
  --dry-run --cutoff-days 30 --page-size 50
```

It scans all alerts and jobs first, then reports eligible and skipped media.
It never selects active-alert evidence, in-flight job sources, recent files,
non-local files, unsupported media kinds, or malformed/unowned storage keys.
Unknown alert/job states stop the command rather than guessing.

Execution is allowed only after a coordinated backup and while Node is stopped:

```bash
npm --workspace=backend run media:retention -- \
  --execute --cutoff-days 30 --page-size 50
```

Execution removes only the owned local file. The Firestore `mediaAssets`
document and business history remain, with `storageStatus: "deleted"`,
`deletedAt`, `deletionReason`, and `retentionPolicyVersion`. File deletion is
idempotent so an interrupted metadata update can be retried.

## 8. Incident response

1. Capture the `X-Request-ID`, UTC timestamp, route, job/media ID, and visible
   HTTP status. Do not capture tokens or passwords.
2. Check `/api/health/live`, then `/api/health/ready`.
3. Inspect `GET /api/operations/v2/system` and the matching structured
   logs.
4. For failed jobs, inspect the persisted stable error code and retry only via
   the documented retry endpoint. Reusing the upload idempotency key with a
   different file or processing options correctly returns `409`.
5. If Firestore and local media diverge, stop writes. Do not manually delete
   documents or files. Restore the coordinated pair or use a purpose-built,
   dry-run-capable reconciliation procedure.

## 9. Known deployment boundary

The current queue and local media store are intentionally single-host. Do not
run multiple Node instances against one Firestore project until media becomes
shared/durable and the queue is replaced with a multi-worker lease/queue
design. Phase 15 will package the selected Option A host, HTTPS, private
services, persistent volumes, and coordinated backups.

## 10. Authoritative platform references

- [Firestore managed backups](https://firebase.google.com/docs/firestore/backups)
- [Firestore export and import](https://cloud.google.com/firestore/docs/manage-data/export-import)
- [Firestore pricing and billing-only features](https://firebase.google.com/docs/firestore/pricing)
- [Firebase Auth export and import](https://firebase.google.com/docs/cli/auth)
