import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { firestore } from "../config/firebase.js";
import {
  listSystemEvents,
  recordSystemEventOccurrence,
  recoverSystemEvent,
} from "../services/systemEventService.js";

const suffix = randomUUID();
const jobId = `smoke-system-event-job-${suffix}`;
const identity = {
  dependency: "video_processing" as const,
  eventCode: "job_failed",
  scope: { type: "job" as const, id: jobId },
};

async function main() {
  let eventKey: string | null = null;
  try {
    const first = await recordSystemEventOccurrence({
      occurrenceId: `attempt-1-${suffix}`,
      identity,
      severity: "warning",
      occurredAt: "2026-08-13T00:00:00.000Z",
      safeDetails: { operation: "process_video_job", reasonCode: "processing_failed", jobId },
    });
    eventKey = first.event.eventKey;
    assert.equal(first.action, "opened");
    assert.equal(first.event.generation, 1);

    const duplicate = await recordSystemEventOccurrence({
      occurrenceId: `attempt-1-${suffix}`,
      identity,
      severity: "warning",
      occurredAt: "2026-08-13T00:00:00.000Z",
      safeDetails: { operation: "process_video_job", reasonCode: "processing_failed", jobId },
    });
    assert.equal(duplicate.action, "duplicate");
    assert.equal(duplicate.event.lifetimeOccurrenceCount, 1);

    const resolved = await recoverSystemEvent(eventKey, {
      recoveryId: `recovery-1-${suffix}`,
      expectedGeneration: 1,
      recoveredAt: "2026-08-13T00:01:00.000Z",
      safeDetails: { operation: "process_video_job", jobId },
    });
    assert.equal(resolved.action, "resolved");
    assert.equal(resolved.event.status, "resolved");

    const reopened = await recordSystemEventOccurrence({
      occurrenceId: `attempt-2-${suffix}`,
      identity,
      severity: "critical",
      occurredAt: "2026-08-13T00:02:00.000Z",
      safeDetails: { operation: "process_video_job", reasonCode: "processing_failed", jobId },
    });
    assert.equal(reopened.action, "reopened");
    assert.equal(reopened.event.generation, 2);
    assert.equal(reopened.event.status, "open");

    const listed = await listSystemEvents({ status: "open", scopeType: "job", scopeId: jobId, limit: 1 });
    assert.equal(listed.events.length, 1);
    assert.equal(listed.events[0].eventKey, eventKey);
    assert.equal(listed.page.hasMore, false);
    console.log("Phase 9 system-event smoke test passed: idempotent occurrence, recovery, generation-safe reopening, safe presentation, and filtered listing.");
  } finally {
    if (eventKey) await firestore.recursiveDelete(firestore.collection("systemEvents").doc(eventKey));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
