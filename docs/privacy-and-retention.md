# LitterSpot privacy and retention

## 1. Data categories

| Category | Examples | Storage |
| --- | --- | --- |
| Identity | email, display name, Firebase UID, role | Firebase Authentication and Firestore profiles |
| Cleaner personnel | staff code, phone, schedule, Station Point, status | Firestore |
| Site structure | dimensions, background metadata, Zones, Camera Placements | Firestore; background bytes in local media |
| Camera configuration | source revision, reference image, floor and bin polygons | Firestore metadata; media bytes locally |
| Operational evidence | Alert Evidence and Completion Evidence | Firestore metadata; media bytes locally |
| Operational history | Alerts, Work, Verification, notifications, audit events, Runs | Firestore |
| Derived analytics | minute buckets, daily summaries, dashboard, bin-placement results | Firestore |
| Runtime data | frame snapshots, delayed buffers, temporal samples | browser or Node memory |
| Developer diagnostics | optional structured provider-bridge output | private local filesystem |

## 2. Site and spatial administration

- Published Site Map Revisions remain immutable so historic operations retain their spatial context.
- A new active revision replaces the current projection without deleting old geometry.
- Site deactivation preserves Site, account, map, Camera, and operational history.
- Camera Removal removes active operation and placement but preserves published configuration and evidence history.

## 3. Camera monitoring and AI

- Continuous source footage is not uploaded to Firestore.
- The capture-owner browser holds source playback, exact snapshots, and delayed analyzed footage in memory.
- Node receives sampled JPEG frames for analysis.
- FastAPI processes one frame and does not persist it.
- Node retains a candidate frame in memory only while qualifying an issue and expires stale candidates after 30 seconds.
- A qualifying Alert may persist one highest-confidence evidence frame.
- Looped source, reference, and demo-scene media use the local media store.

## 4. Alert and evidence management

- Alert Evidence is retained as operational evidence and includes the observation geometry required to reproduce overlays.
- New higher-confidence evidence may replace the Alert's selected evidence reference while history records occurrences and transitions.
- Alert dismissal does not erase the evidence or history.
- Raw Detection Signals in Node memory are not a durable history.

## 5. Cleaner and Work operations

- Manual Work requires Completion Evidence before review.
- Completion Evidence remains linked to its Work Order.
- Work dismissal or resolution does not erase history.
- Cleaner notifications are immutable records with a 90-day `expiresAt` value.
- Resolved Work may leave a recent target snapshot on the Cleaner record for assignment context; it is not live location tracking.

## 6. Orchestration and operational intelligence

- Structured Runs, attempts, actions, decisions, and safe errors remain in Firestore.
- The structured JSON emitted by the provider bridge is written only when `ORCHESTRATOR_DEBUG_OUTPUT=true` and never in `production-cloud`.
- Diagnostic files are capped at 64 KiB, correlated by Run ID, and unavailable through application APIs. They do not contain hidden provider reasoning.
- Minute analytics are retained long enough to produce daily summaries, then the cleanup operation may delete expired minute data after daily preservation.
- Bin-placement snapshots are replaceable derived views. Interventions are immutable records.

## 7. Local media retention service

Media metadata assigns retention classes such as configuration or operational evidence. The backend retention command evaluates Firestore references before deleting eligible local bytes. It records storage status and deletion time instead of exposing missing files as successful content.

The retention service must not delete:

- active Camera sources or references;
- evidence still referenced by active operational records;
- media whose storage provider is unsupported;
- paths outside the configured media root.

## 8. Backup boundary

Firestore and local media must be backed up as a coordinated pair because Firestore stores metadata and local paths, not the bytes themselves. The Spark plan does not provide managed scheduled Firestore exports. Current backup and recovery procedures are documented in the [operations runbook](operations-runbook.md).

## 9. Data not collected

The implemented system does not collect GPS location, live Cleaner tracking, microphone audio, payment data, or hidden model reasoning. It does not copy application media into Firebase Storage.
