# Phase 8 completed brief

## Status

Canonical migration Phase 8 is complete. V2 Work Orders and Verification are the mounted Supervisor/Cleaner runtime for Site-scoped accounts.

## What was done

- Added atomic Alert assignment and Cleaner reservation.
- Enforced one active Work Order per Alert and one active Work Order per Cleaner.
- Removed unassigned Work documents. Waiting remains an Alert state.
- Assignment counts as acceptance; V2 Cleaner accept/reject routes return not found.
- Added manual Camera and coordinate Work creation.
- Added required title, instructions, severity, target and already-selected Cleaner for manual Work.
- Added deterministic Node instructions for Alert-driven Work.
- Added Cleaner `assigned -> in_progress -> awaiting_review` actions.
- Added coordinate Completion Evidence upload and validation.
- Camera-linked Work does not require a Cleaner photo.
- Added Verification documents with required sample counts.
- Connected Phase 6 live Camera samples to automated deterministic Verification for orchestrated Work.
- Floor litter resolves after three clear samples; spill and bin service use two.
- A positive issue sample returns the same Work and Cleaner to `in_progress`.
- Unknown/review bin evidence produces `inconclusive`, keeps Work awaiting review and notifies Supervisors.
- Added Supervisor Verification and required-reason override.
- Added manual coordinate final Supervisor review.
- Added Supervisor takeover, Cleaner replacement and linked dismissal.
- Takeover permanently switches the Work and linked Alert to manual management.
- Takeover, reassignment, dismissal and Verification override create Audit Events.
- Added Work events, Verification history, Camera cleanliness state and immutable Cleaner notifications.
- Added idempotency request fingerprints and conflict checks.
- Added active Firebase account checks during Cleaner assignment/reassignment.
- Cleaner Work list exposes active Work plus at most five terminal history items.
- Cleaner detail authorization returns not found for another Cleaner's Work.
- Completion Evidence validates both content signature and declared media type.

## Supervisor APIs

```text
GET  /api/work-orders
POST /api/work-orders
POST /api/work-orders/manual
GET  /api/work-orders/:workOrderId
GET  /api/work-orders/:workOrderId/history
GET  /api/work-orders/:workOrderId/verifications
POST /api/work-orders/:workOrderId/takeover
POST /api/work-orders/:workOrderId/reassign
POST /api/work-orders/:workOrderId/dismiss
POST /api/work-orders/:workOrderId/verification
POST /api/work-orders/:workOrderId/verification/override

POST /api/alerts/:alertId/manual-assignment
```

## Cleaner APIs

```text
GET  /api/cleaner/work-orders
GET  /api/cleaner/work-orders/:workOrderId
POST /api/cleaner/work-orders/:workOrderId/start
POST /api/cleaner/work-orders/:workOrderId/ready-for-review
POST /api/cleaner/work-orders/:workOrderId/completion-evidence
```

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm run test:backend
Result: 60 test files passed, 239 tests passed

npm run test:emulator
Result: passed

V2 Work Order integration
Result: 1 file passed, 4 tests passed

git diff --check
Result: passed
```

The emulator journey verifies:

- atomic Alert assignment and Cleaner lock;
- assignment-as-acceptance;
- removed accept/reject actions;
- failed then passed Verification;
- Cleaner remains busy for rework and is released on resolution;
- coordinate Work rejects submission without a photo;
- valid Completion Evidence and final Supervisor resolution;
- automated clear-sample resolution;
- inconclusive bin evidence and Supervisor override;
- Supervisor takeover;
- Cleaner replacement and lock transfer;
- linked Alert/Work dismissal;
- audit coverage for privileged interventions.

## Guidance to test manually

For an Alert-driven manual assignment:

1. Create an operational Alert through monitoring.
2. Select an available Cleaner.
3. Call `POST /api/alerts/:alertId/manual-assignment`.
4. Sign in as that Cleaner and call the start endpoint.
5. Submit ready for review.
6. Because Supervisor assignment sets manual mode, review through the Supervisor Verification endpoint.

For a manual coordinate job:

1. Call `POST /api/work-orders/manual` with a point inside one active Zone.
2. Cleaner starts the Work.
3. Cleaner uploads one Completion Evidence photo.
4. Cleaner submits with the returned media ID.
5. Supervisor applies passed or failed Verification.

## Cloud state

No Work Orders, Verification records, Completion Evidence or Work notifications were written to cloud Firebase. Automated tests used Firebase emulators and isolated emulator media storage.

## Known boundary

- Phase 8 supports the Orchestrator actor and automated Camera review contract, but LLM scheduling and tool integration remain Phase 9.
- V2 notification Security Rules exist, while complete product notification presentation and deactivation reconciliation remain Phase 10.
- Camera Verification treats missing/unknown registered-bin state as inconclusive rather than clean.

## Next phase

Phase 9 integrates the teammate assignment agent with Node's V2 data and controlled tools. Before that, the isolated API sandbox provides visual testing for Camera Creation, plotting, live monitoring and Alert output.
