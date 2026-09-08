# Camera quota-safe backend completed brief

## What changed

Ordinary Camera frames now complete without Firestore reads or writes after the Camera runtime is warm. Node keeps the live lease, sequence, runtime freshness, rolling issue windows, candidate evidence, and partial Camera Verification samples in memory.

Firestore now receives only bounded records:

- Monitoring Session claim and release;
- Monitoring Episode start and end;
- first online, offline, and changed error transitions;
- one Flag when an issue becomes confirmed, plus a new Flag only for a material escalation such as full to overflow;
- Alert, evidence, Work Order, and completed Verification changes;
- one compact analytics contribution per completed minute.

Camera list and live-config reads share one Site configuration snapshot. Camera controls, reconfiguration, scene selection, and map publication invalidate it. Runtime-only events reuse the snapshot. Camera Details no longer reloads its full history every 30 seconds; workflow events refresh it when data changes.

Unfinished Camera Verification requests survive a restart in Firestore. Node reloads their collectors during startup. Partial clear samples restart from zero, which is safe because the durable Verification request and any completed outcome remain intact.

## Automated verification

The focused quota regression test drives the real sample HTTP endpoint. After one warm-up frame it asserts:

```text
ordinary clear frame:        0 Firestore reads, 0 writes
continuing confirmed issue:  0 Firestore reads, 0 writes
monitoring heartbeat:        0 Firestore reads, 0 writes
repeated live config read:    0 Firestore reads
```

Run it against the local emulators:

```bash
APP_ENV=local-emulator \
EXPECTED_FIREBASE_PROJECT_ID=demo-litterspot \
FIREBASE_PROJECT_ID=demo-litterspot \
GCLOUD_PROJECT=demo-litterspot \
FIREBASE_DATABASE_ID='(default)' \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 \
MEDIA_STORAGE_ROOT=.local/test-media \
ORCHESTRATOR_INTERNAL_TOKEN=emulator-orchestrator-token \
npm --workspace=backend test -- --run src/services/v2MonitoringQuota.integration.test.ts
```

The existing V2 Monitoring, Work Order, and Orchestrator integration suites cover Alert qualification, Flag traceability, Camera Verification, lease failover, Work review, and runtime stop behavior.

## Manual check

Run `npm run start:emulator`, sign in as Root Supervisor, enable the two configured looped-video Cameras, and leave the Supervisor shell open. Both Cameras should keep updating while navigating between pages. A confirmed issue creates one Flag and Alert. Leaving the same issue on screen must not create a new Flag every second.
