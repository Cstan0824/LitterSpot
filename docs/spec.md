# LitterSpot technical specification

## 1. Status and authority

This specification describes the implemented system at the current repository head. Requirement IDs are stable references for tests and technical documents. It contains no deferred product scope.

## 2. Technology stack

| Layer | Implemented technology |
| --- | --- |
| Web application | React 19.1, TypeScript 5.8, Vite 6.4 |
| Charts | Chart.js 4.5, React Chart.js 2, annotation plugin 3.1 |
| Main API | Node.js 22, TypeScript 5.8, Express 5.1 |
| Validation and upload handling | Zod 3.24, Multer 1.4 |
| Security middleware | Firebase Admin 14.2, Helmet 8.3, CORS 2.8, in-process rate limiting |
| Authentication | Firebase Authentication email and password accounts |
| Application database | Cloud Firestore in Firebase project `litterspot`, database `(default)` |
| Local development database | Firebase Authentication and Firestore emulators |
| Media storage | Backend-host local filesystem under `MEDIA_STORAGE_ROOT` |
| AI service | Python 3.12-compatible FastAPI process with PyTorch, Ultralytics, Pillow, NumPy, and OpenCV dependencies |
| Assignment provider | Python adapter invoked by Node; Ollama is the default configured provider and Gemini is supported as a fallback adapter |
| Tests | Vitest, Supertest, Python `unittest`, Firebase Emulator Suite |
| CI | GitHub Actions on Node 22, Java 21, and Python 3.12 |

## 3. Runtime topology

- The React application signs in through Firebase Authentication and sends the ID token to Node.
- Node is the only public application backend and the only writer of business state.
- Node verifies identity and Site scope through Firebase Admin, then reads or writes Firestore.
- Node reads and writes media on its local filesystem and authorizes all media delivery.
- Node calls FastAPI over a private HTTP boundary using an optional shared token.
- FastAPI loads model files from local paths and returns stateless analysis results.
- The Orchestrator worker runs inside the Node process and calls a local Python assignment script.

## 4. Cross-cutting requirements

| ID | Requirement |
| --- | --- |
| SYS-001 | Every tenant-owned operational record must carry `siteId`, and Node must verify Site ownership before returning or mutating it. |
| SYS-002 | Firebase ID tokens must be verified before protected `/api` routes execute. |
| SYS-003 | Root-only, Supervisor-only, Cleaner-only, Superadmin-only, and internal Orchestrator boundaries must fail closed. |
| SYS-004 | Mutations that accept an expected revision must reject stale values with HTTP 409. |
| SYS-005 | Retriable create or command operations must use stable idempotency identities and reject changed request bodies under the same key. |
| SYS-006 | API errors must return safe messages and a request ID without credentials, raw provider output, or stack traces. |
| SYS-007 | Firestore quota errors must return HTTP 503 with code `firestore_quota_exceeded`. |
| SYS-008 | Browser origins must match `CORS_ORIGINS`; non-browser clients without an Origin header are allowed. |
| SYS-009 | Public health endpoints must expose service readiness without model paths or sensitive internals. |
| SYS-010 | Production database inspection may run only against the exact configured Firebase project. Production reset, bootstrap, and seed commands must remain blocked. |
| SYS-011 | The primary structural UI and Site Map and Camera workflow routes must enforce Root authority. Generic location compatibility routes remain Supervisor-gated and may read or mutate records beyond the authenticated Site; consumers must not treat those routes as a tenant-safe structural administration boundary. |

## 5. Site and spatial administration

| ID | Requirement |
| --- | --- |
| SITE-001 | A Site must be the tenant boundary and hold one active Site Map Revision pointer. |
| SITE-002 | Site creation must create the Site, initial map, Root account, Supervisor profile, Orchestrator configuration, and audit data as one recoverable identity workflow. |
| SITE-003 | Only a Superadmin may create, deactivate, reactivate, or recover the Root account of a Site. |
| SITE-004 | Root authority must be enforced for Supervisor accounts, Site Map publication, Camera Creation, Physical Camera Move, and Camera Removal through the primary product workflows. |
| SITE-005 | A Site Map point must use `xMeters` and `yMeters` inside the configured width and height. |
| SITE-006 | A Zone must be a valid polygon fully inside the boundary and must not overlap, cross, share an edge with, or touch another active Zone. |
| SITE-007 | An active Camera Placement must fall inside exactly one active Zone. |
| SITE-008 | A Cleaner Station Point must remain inside the Site boundary and may be unzoned. |
| SITE-009 | Publishing a map draft must create an immutable revision and atomically update `activeMapRevisionId`. |
| SITE-010 | Map Position Correction must remain inside the current Zone and preserve the Camera Registration. |
| SITE-011 | Physical Camera Move must require a new reference and Registration, and may target the same Zone, another Zone, or a provisional new Zone. |
| SITE-012 | Camera Removal must remove the active placement and operation while preserving published Camera history. |
| SITE-013 | Site deactivation must block Site access and complete cleanup through a recoverable bounded Site operation. |

## 6. Camera monitoring and AI

| ID | Requirement |
| --- | --- |
| CAM-001 | Camera Creation must remain a draft until placement, source, reference, walkable floor, Registration validation, and publication succeed. |
| CAM-002 | A published Camera must begin structurally active with monitoring disabled. |
| CAM-003 | Camera sources must be `laptop_camera` or `looped_video`; no more than one laptop Camera may be enabled in a Site. |
| CAM-004 | One lease-protected Monitoring Session must own capture for a Site. A different browser may claim after release or expiry. |
| CAM-005 | Samples must carry the current session, token, episode, Camera, sequence, capture time, source time, and playback generation. |
| CAM-006 | Node must serialize inference per Camera and reject a result if ownership or Camera configuration changes during inference. |
| CAM-007 | Adaptive target intervals must be 500 ms for Camera Detail, 1,000 ms for visible cards, positive bursts, or Verification, and 4,000 ms offscreen. The scheduler processes one due sample at a time and prevents background starvation beyond four seconds. |
| CAM-008 | Operational analytics admission must remain separately throttled from presentation sampling. |
| CAM-009 | Camera Detail delayed playback must cap output at 1280×720 without upscaling smaller sources. |
| CAM-010 | Initial playback must require at least 5,000 ms buffered footage, at least 2,000 ms analysis lead, and continuous recent analysis. |
| CAM-011 | Playback must rebuffer below 750 ms analysis lead and fail after 30,000 ms without sufficient coverage. |
| CAM-012 | A rebuffer gap over 2,000 ms may skip to the newest safely analyzed delayed position. Shorter gaps resume from the frozen position. |
| CAM-013 | Person overlays must expire after 350 ms, floor-issue overlays after 700 ms, and registered-bin overlays after 1,000 ms. |
| CAM-014 | Camera grids and non-owner browsers must display exact analyzed snapshots, not delayed raw footage. |
| CAM-015 | FastAPI must accept JPEG, PNG, or WebP up to 10 MiB and must not persist application state. |

## 7. Alert and evidence management

| ID | Requirement |
| --- | --- |
| ALERT-001 | Supported operational issue types must be `floor_litter`, `floor_spill`, and `bin_service`. |
| ALERT-002 | Floor litter must require three positive observations among the latest five within 30 minutes. |
| ALERT-003 | Bin service must require two positive observations among the latest three within 15 minutes. |
| ALERT-004 | Floor spill must qualify from the latest positive observation. |
| ALERT-005 | One active key must deduplicate Alerts by Site, Camera, and issue type. |
| ALERT-006 | Full and overflow results must update one bin-service Alert; overflow must produce critical severity. |
| ALERT-007 | Priority must begin at 40 for warning or 80 for critical, rise by 10 for each 15 minutes unresolved, and cap at 100. |
| ALERT-008 | Alert Evidence must retain the highest-confidence qualifying frame and all geometry required to reconstruct overlays. |
| ALERT-009 | A Supervisor may dismiss an unresolved Alert only when it has no linked Work, with a reason and current revision. |
| ALERT-010 | Ordinary negative observations must not resolve an Alert. |

## 8. Cleaner and Work operations

| ID | Requirement |
| --- | --- |
| WORK-001 | Cleaner availability must require active Site, account, and profile; no unavailable override; no active Work; a valid Station Point; and a matching Site-local schedule. |
| WORK-002 | A schedule range with equal start and end must represent all day. Overnight ranges must continue into the following day. |
| WORK-003 | Alert assignment and Manual Work creation must reserve one Cleaner and create one Work Order atomically. |
| WORK-004 | Manual Work must be assigned at creation and target either a Camera or a coordinate inside the Site boundary. |
| WORK-005 | Work status transitions must be `assigned → in_progress → awaiting_review → resolved`, with dismissal allowed from active states and failed review returning to `in_progress`. |
| WORK-006 | Manual Work must require Cleaner Completion Evidence before submission. |
| WORK-007 | Alert-driven Camera Work must use fresh Camera Verification and must not require a Cleaner completion photo. |
| WORK-008 | Passed Verification must resolve Work and linked Alert and release the Cleaner. Failed Verification must return the same Work and Cleaner to rework. Inconclusive Verification must keep Work awaiting review. |
| WORK-009 | Manual origin or manual management mode must require a Supervisor decision. |
| WORK-010 | Supervisor takeover must stop later automated mutation for that Work. |
| WORK-011 | Reassignment must release the previous Cleaner and reserve an eligible replacement in one transaction. |
| WORK-012 | Notifications must be durable Firestore records targeted to one user and delivered through Firestore listeners. |

## 9. Orchestration and operational intelligence

| ID | Requirement |
| --- | --- |
| OPS-001 | Assignment and review work must enter a Firestore outbox through deterministic trigger identities. |
| OPS-002 | Only one active Orchestrator Run may hold the relevant Site or Work lease. |
| OPS-003 | Assignment context must include at most ten waiting Alerts, validated available Cleaners, and only backend-approved pairs. |
| OPS-004 | The provider may select only a supplied Alert and Cleaner pair. Node must revalidate the pair before commit. |
| OPS-005 | Provider, malformed-response, and candidate failures must be recorded without deterministic fallback assignment. |
| OPS-006 | Pausing the Orchestrator must stop automatic assignment and review mutation without stopping monitoring, Alert creation, or Supervisor actions. |
| OPS-007 | Automated review may resolve passed orchestrated Work or request rework for failed orchestrated Work. It must leave inconclusive or manually managed Work for a Supervisor. |
| OPS-008 | The System view must expose configuration, worker status, backlog, safe system events, control history, and structured Run history without raw provider output. |
| OPS-009 | Minute analytics must persist bounded summaries rather than every sampled frame. |
| OPS-010 | Daily analytics must use Site-local calendar periods and expose partial or missing coverage. |
| OPS-011 | Bin-placement recommendations must be replaceable snapshots. Marking one implemented must create an immutable Intervention used for before-and-after comparison. |
| OPS-012 | Audit events must record privileged mutations and failures; ordinary reads must not create audit events. |

## 10. HTTP and storage contracts

- The canonical HTTP contract is [api-reference.md](api-reference.md).
- The canonical Firestore contract is [data-model/README.md](data-model/README.md).
- Media content and overlays must be served through authenticated Node routes and support byte ranges for video playback.
- Firestore document version remains `schemaVersion: 2`; this is a persisted contract value, not a product label.
- Deterministic record keys preserve their existing schema-version namespace through `recordKeyHash`.

## 11. Operational limits

- JSON request bodies are limited to 1 MiB.
- Uploaded analysis images are limited to 10 MiB by FastAPI.
- Camera and completion-evidence upload limits are enforced by Multer and environment settings.
- Video size defaults to 250 MiB and duration defaults to 600 seconds.
- General API rate limit defaults to 300 requests per minute per process namespace and actor or address.
- The Orchestrator lease defaults to 300 seconds.
- Runtime maps, leases, temporal observations, evidence candidates, and minute accumulators are process-local and are rebuilt or recovered as defined by their services.
