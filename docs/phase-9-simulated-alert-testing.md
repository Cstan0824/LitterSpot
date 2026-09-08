# Phase 9 testing without vision detection

Use this helper to create a waiting Alert on demand. It bypasses AI inference and temporal qualification so Orchestrator assignment can be tested consistently.

This is development tooling, not a product feature. Only a Root Supervisor can call it. Production-cloud mode rejects it. No frontend changes are required.

## What it creates

`POST /api/test-support/v2/alerts` creates these records in one transaction:

- a synthetic Flag;
- a waiting Alert with `isSimulation: true` and `managementMode: orchestrated`;
- an occurrence and creation event;
- the active Camera-and-issue uniqueness key;
- an audit event identifying the Root Supervisor;
- a pending Orchestrator trigger;
- an alerted Camera runtime state.

The Camera must already be active and placed on the Site's current map. The helper does not create Cameras, maps or Cleaners. Camera monitoring can remain switched off during this test.

No photo, frame or model result is generated. `evidence` is null. Bin-service examples use a synthetic bin identifier, not a detected physical bin.

## Recommended first test: step through manually

1. Use the isolated development Firebase project, not the teammates' shared project.
2. Set `ORCHESTRATOR_WORKER_ENABLED=false` in the backend environment and restart Node. This disables the background worker, not the manual assignment-cycle endpoint.
3. Ensure Ollama is running with the model configured for your Site.
4. Ensure at least one Cleaner is active, on shift, has a valid Station Point, is not overridden unavailable, and has no active Work.
5. In Postman, open **22 - V2 Phase 9 Orchestrator**.
6. Send **01 V2 Phase 9 Root Login**.
7. Send **04 V2 Root - Phase 9 Resume Orchestrator** so the Site configuration is running. The environment switch still keeps the background worker disabled.
8. Send **05a V2 Root - Phase 9 List Test Cameras**. It saves the first active placed Camera as `v2TestCameraId`. Choose a different returned ID in the environment if desired.
9. Send **05b V2 Root - Phase 9 Create Simulated Alert**. It saves `v2AlertId` and returns the Flag and Alert.
10. Send **06 V2 Root - Phase 9 Trigger Real Assignment Cycle**.
11. Send **07 V2 Root - Phase 9 Get Run Details**.

Expected successful Run fields:

```json
{
  "status": "succeeded",
  "resultCode": "assigned",
  "selectedAlertId": "an-alert-id",
  "selectedCleanerId": "a-cleaner-id",
  "workOrderId": "a-work-order-id"
}
```

The Run includes the context, provider attempts, decision summary and tool actions. If other waiting Alerts exist, the model can legitimately select one of those instead. Use the selected IDs rather than assuming the newest fake Alert won.

The Cleaner should now be busy with an assigned Work Order. No Accept step is required.

## Automatic assignment test

Set `ORCHESTRATOR_WORKER_ENABLED=true` and restart Node. Create a new simulated Alert with request 05b. The worker should pick up its trigger on a subsequent poll, usually within about five seconds before model processing time.

Use **05 List Runs** followed by **07 Get Run Details**. Do not also send request 06 unless deliberately testing concurrent attempts.

Starting the worker can process existing waiting Alerts too.

## Test without calling the LLM

Keep the background worker disabled. After request 05b, use private requests **10, 11 and 12**. These let you exercise the Node assignment tools with a pair returned in the context. They require `orchestratorInternalToken` and do not test model reasoning.

## Choosing an issue

Edit the JSON body in 05b:

| Example | `issueType` | `condition` | Suggested `severity` |
| --- | --- | --- | --- |
| Floor rubbish | `floor_litter` | `litter` | `warning` |
| Liquid spill | `floor_spill` | `spill` | `critical` |
| Full bin | `bin_service` | `full` | `warning` |
| Overflowing bin | `bin_service` | `overflow` | `critical` |

Confidence defaults to 0.99 and is synthetic metadata. It does not prove detection quality.

## Repeating and comparing assignments

- Sending the same body and `v2TestAlertRequestId` returns the same Alert, even if it has since completed.
- Reusing that ID with changed fields returns `409`.
- To create another Alert for the same Camera and issue, resolve or dismiss the previous one and change `v2TestAlertRequestId`, for example to `phase9-fake-alert-002`.
- If Work has already been assigned, dismiss it through the Work workflow rather than dismissing only the Alert.
- To compare several Alerts, use different Cameras or issue types while keeping the background worker disabled. Create them before sending request 06. The LLM sees up to 10 waiting Alerts.
- To test no available Cleaner, use Supervisor availability controls. The Alert should stay waiting with no Work created.

## Limits and data effects

These are persisted development records, not a dry run. Work Orders, notifications and audit history are real, and downstream summaries may include them. `isSimulation` is traceability, not an automatic analytics-exclusion guarantee.

This helper tests Alert-to-assignment behavior. It does not simulate post-cleaning Camera samples or a passed/failed Verification. For review, use actual Camera samples, existing Supervisor review controls, or the automated emulator scenarios. Do not treat a fake Alert as proof that the vision pipeline works.

## Automated verification

```bash
npm --workspace=backend run build
npm run validate:postman
npm run test:emulator -- "npm --workspace=backend run test -- --run src/v2TestSupport.integration.test.ts src/v2Orchestrator.integration.test.ts"
```

The helper tests cover record creation, replay, changed-payload rejection, active-Alert conflict, inclusion in assignment context, invalid conditions, cross-Site isolation, authentication, Root-only access and production denial. They use the Firebase emulators, not cloud Firebase.
