import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import {
  ALERT_WORKFLOW_VERSION,
  deterministicActiveAlertKey,
  deterministicConfirmationStateId,
  deterministicObservationId,
  evaluateAnalysisRunDetections,
  updateAlertStatus,
} from "../services/alertWorkflowService.js";
import { retryImageJob } from "../services/jobProcessingService.js";

type IssueType = "floor_litter" | "floor_spill" | "bin_overflow";

const testId = randomUUID();
const siteId = `smoke-site-${testId}`;
const zoneId = `smoke-zone-${testId}`;
const secondZoneId = `smoke-zone-2-${testId}`;
const thirdZoneId = `smoke-zone-3-${testId}`;
const horizonZoneId = `smoke-zone-horizon-${testId}`;
const cameraId = `smoke-camera-${testId}`;
const secondCameraId = `smoke-camera-2-${testId}`;
const createdRunIds: string[] = [];

function box(x: number, y: number, size = 0.02) {
  return { x1: x, y1: y, x2: x + size, y2: y + size };
}

function polygon(x: number, y: number, size = 0.02) {
  return [
    { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
  ];
}

async function seedRun(options: {
  sequence: string;
  offsetSeconds: number;
  zone?: string;
  camera?: string;
  isTest?: boolean;
  issue?: IssueType;
  positive?: boolean;
}) {
  const runId = `smoke-run-${testId}-${options.sequence}`;
  const runZoneId = options.zone ?? zoneId;
  const runCameraId = options.camera ?? cameraId;
  const capturedAt = Timestamp.fromMillis(Date.now() + options.offsetSeconds * 1_000);
  createdRunIds.push(runId);
  await firestore.collection("analysisRuns").doc(runId).set({
    alertWorkflowVersion: ALERT_WORKFLOW_VERSION,
    alertEvaluationStatus: "pending",
    jobId: `smoke-job-${runId}`,
    sourceType: "image_upload",
    siteId,
    siteName: "Phase 4 smoke site",
    zoneId: runZoneId,
    zoneName: "Phase 4 smoke zone",
    cameraId: runCameraId,
    cameraCode: "CAMERA-999",
    cameraName: "Phase 4 smoke camera",
    evidenceMediaId: null,
    capturedAt,
    focusRegionNormalized: [],
    isTest: Boolean(options.isTest),
    analyticsEligible: !options.isTest,
    createdAt: Timestamp.now(),
  });

  if (options.positive && options.issue) {
    const coordinates = options.issue === "floor_litter"
      ? [[0.05, 0.05], [0.45, 0.45], [0.80, 0.80]]
      : [[0.20, 0.20]];
    for (const [index, [x, y]] of coordinates.entries()) {
      const detectionId = `smoke-detection-${testId}-${options.sequence}-${index}`;
      await firestore.collection("detections").doc(detectionId).set({
        analysisRunId: runId,
        jobId: `smoke-job-${runId}`,
        siteId,
        zoneId: runZoneId,
        cameraId: runCameraId,
        issueType: options.issue,
        confidence: 0.90,
        bboxNormalized: box(x, y, options.issue === "floor_litter" ? 0.02 : 0.10),
        polygonNormalized: polygon(x, y, options.issue === "floor_litter" ? 0.02 : 0.10),
        capturedAt,
        isTest: Boolean(options.isTest),
        qualificationStatus: "pending_evaluation",
        createdAt: Timestamp.now(),
      });
    }
  }
  return evaluateAnalysisRunDetections(runId);
}

async function alertDocument(alertId: string) {
  const snapshot = await firestore.collection("alerts").doc(alertId).get();
  assert(snapshot.exists, `Expected alert ${alertId} to exist.`);
  return snapshot.data()!;
}

async function cleanup() {
  const collections = [
    "alerts",
    "activeAlertKeys",
    "alertConfirmationResets",
    "alertConfirmationStates",
    "flags",
    "issueObservations",
    "detections",
    "analysisRuns",
    "processingJobs",
  ];
  for (const collection of collections) {
    const snapshot = await firestore.collection(collection).where("siteId", "==", siteId).get();
    for (const document of snapshot.docs) await firestore.recursiveDelete(document.ref);
  }
}

async function main() {
  try {
    const excluded = await seedRun({ sequence: "excluded", offsetSeconds: 0, isTest: true, issue: "floor_litter", positive: true });
    assert.equal(excluded.flagIds.length, 0);
    assert.equal(excluded.excludedObservationCount, 3);

    const floorSequence = [true, false, true, false, true];
    let floorAlertId: string | null = null;
    for (const [index, positive] of floorSequence.entries()) {
      const outcome = await seedRun({ sequence: `floor-${index}`, offsetSeconds: 10 + index, issue: "floor_litter", positive });
      assert.equal(outcome.flagIds.length, positive ? 1 : 0, "A frame must create at most one grouped floor flag.");
      if (index < floorSequence.length - 1) assert.equal(outcome.alertIds.length, 0);
      else {
        assert.equal(outcome.alertIds.length, 1);
        floorAlertId = outcome.alertIds[0];
      }
    }
    assert(floorAlertId);
    assert.equal((await alertDocument(floorAlertId)).occurrenceCount, 3);

    const replay = await evaluateAnalysisRunDetections(createdRunIds.at(-1)!);
    assert.deepEqual(replay.alertIds, [floorAlertId]);
    assert(replay.outcomes.every((outcome) => outcome.alreadyEvaluated));
    assert.equal((await alertDocument(floorAlertId)).occurrenceCount, 3, "Replay must not duplicate occurrences.");
    const confirmationStateId = deterministicConfirmationStateId(zoneId, cameraId, "floor_litter");
    const replayedState = (await firestore.collection("alertConfirmationStates").doc(confirmationStateId).get()).data()!;
    const replayedIds = (replayedState.observations as Array<{ observationId: string }>).map((item) => item.observationId);
    assert.equal(new Set(replayedIds).size, replayedIds.length, "Replay must not duplicate confirmation-buffer entries.");

    const cleanDuringAlert = await seedRun({ sequence: "floor-clean-during-alert", offsetSeconds: 19, issue: "floor_litter", positive: false });
    assert.equal(cleanDuringAlert.alertIds.length, 0, "A negative observation must not claim attachment to an active alert.");
    const cleanObservationId = deterministicObservationId(createdRunIds.at(-1)!, "floor_litter");
    const cleanObservation = (await firestore.collection("issueObservations").doc(cleanObservationId).get()).data()!;
    assert.equal(cleanObservation.temporalStatus, "negative");
    assert.equal(cleanObservation.alertId, null);
    assert.equal((await alertDocument(floorAlertId)).occurrenceCount, 3);

    const secondCamera = await seedRun({
      sequence: "floor-second-camera",
      offsetSeconds: 20,
      camera: secondCameraId,
      issue: "floor_litter",
      positive: true,
    });
    assert.deepEqual(secondCamera.alertIds, [floorAlertId], "An active zone alert must deduplicate across cameras.");
    assert.equal((await alertDocument(floorAlertId)).occurrenceCount, 4);

    await updateAlertStatus(floorAlertId, "resolved", {
      uid: "smoke-supervisor",
      email: "smoke@example.invalid",
      displayName: "Smoke Test Supervisor",
    }, "Phase 4 automated smoke test");
    const activeKey = deterministicActiveAlertKey(zoneId, "floor_litter");
    assert.equal((await firestore.collection("activeAlertKeys").doc(activeKey).get()).exists, false);
    assert.equal((await firestore.collection("alertConfirmationResets").doc(activeKey).get()).data()?.generation, 1);

    let replacementAlertId: string | null = null;
    for (let index = 0; index < 3; index += 1) {
      const outcome = await seedRun({ sequence: `floor-after-resolution-${index}`, offsetSeconds: 30 + index, issue: "floor_litter", positive: true });
      if (index < 2) assert.equal(outcome.alertIds.length, 0, "Resolution must require a fresh confirmation sequence.");
      else replacementAlertId = outcome.alertIds[0] ?? null;
    }
    assert(replacementAlertId && replacementAlertId !== floorAlertId);

    const orphanKeyId = deterministicActiveAlertKey(thirdZoneId, "bin_overflow");
    const orphanFirst = await seedRun({ sequence: "orphan-overflow-0", offsetSeconds: 35, zone: thirdZoneId, issue: "bin_overflow", positive: true });
    assert.equal(orphanFirst.alertIds.length, 0);
    await firestore.collection("activeAlertKeys").doc(orphanKeyId).set({
      workflowVersion: ALERT_WORKFLOW_VERSION,
      alertId: `missing-alert-${testId}`,
      siteId,
      zoneId: thirdZoneId,
      issueType: "bin_overflow",
      updatedAt: Timestamp.now(),
    });
    const orphanSecond = await seedRun({ sequence: "orphan-overflow-1", offsetSeconds: 36, zone: thirdZoneId, issue: "bin_overflow", positive: true });
    assert.equal(orphanSecond.alertIds.length, 1, "A stale active key must be repaired during confirmation.");
    assert.equal((await firestore.collection("activeAlertKeys").doc(orphanKeyId).get()).data()?.alertId, orphanSecond.alertIds[0]);

    const firstOverflow = await seedRun({ sequence: "overflow-0", offsetSeconds: 40, zone: secondZoneId, issue: "bin_overflow", positive: true });
    assert.equal(firstOverflow.alertIds.length, 0);
    const secondOverflow = await seedRun({ sequence: "overflow-1", offsetSeconds: 41, zone: secondZoneId, issue: "bin_overflow", positive: true });
    assert.equal(secondOverflow.alertIds.length, 1, "Overflow must confirm after two of three observations.");

    const spillOne = await seedRun({ sequence: "spill-0", offsetSeconds: 50, zone: secondZoneId, issue: "floor_spill", positive: true });
    assert.equal(spillOne.alertIds.length, 0);
    await seedRun({ sequence: "spill-negative", offsetSeconds: 51, zone: secondZoneId, issue: "floor_spill", positive: false });
    const spillInterrupted = await seedRun({ sequence: "spill-1", offsetSeconds: 52, zone: secondZoneId, issue: "floor_spill", positive: true });
    assert.equal(spillInterrupted.alertIds.length, 0, "Interrupted spill observations must not confirm.");
    const spillConfirmed = await seedRun({ sequence: "spill-2", offsetSeconds: 53, zone: secondZoneId, issue: "floor_spill", positive: true });
    assert.equal(spillConfirmed.alertIds.length, 1, "Two consecutive spill observations must confirm.");

    const horizonOffsets = [70, 1_810, 3_550, 3_551];
    for (const [index, offsetSeconds] of horizonOffsets.entries()) {
      const outcome = await seedRun({
        sequence: `floor-horizon-${index}`,
        offsetSeconds,
        zone: horizonZoneId,
        issue: "floor_litter",
        positive: true,
      });
      if (index < 3) assert.equal(outcome.alertIds.length, 0, "Observations outside the total horizon must expire.");
      else assert.equal(outcome.alertIds.length, 1, "Three recent observations inside the horizon must confirm.");
    }

    await updateAlertStatus(replacementAlertId, "resolved", {
      uid: "smoke-supervisor",
      email: "smoke@example.invalid",
      displayName: "Smoke Test Supervisor",
    }, "Verify reset generation increments");
    assert.equal((await firestore.collection("alertConfirmationResets").doc(activeKey).get()).data()?.generation, 2);
    await evaluateAnalysisRunDetections(createdRunIds.find((runId) => runId.endsWith("floor-0"))!);
    const afterOldReplay = await seedRun({ sequence: "floor-after-second-resolution", offsetSeconds: 3_600, issue: "floor_litter", positive: true });
    assert.equal(afterOldReplay.alertIds.length, 0, "An old replay cannot repopulate a newly reset confirmation generation.");

    const resumeJobId = `smoke-resume-job-${testId}`;
    const resumeCapturedAt = Timestamp.fromMillis(Date.now() + 4_000_000);
    await firestore.collection("analysisRuns").doc(resumeJobId).set({
      alertWorkflowVersion: ALERT_WORKFLOW_VERSION,
      alertEvaluationStatus: "pending",
      jobId: resumeJobId,
      sourceType: "image_upload",
      siteId,
      siteName: "Phase 4 smoke site",
      zoneId: thirdZoneId,
      zoneName: "Phase 4 smoke zone",
      cameraId,
      cameraCode: "CAMERA-999",
      cameraName: "Phase 4 smoke camera",
      evidenceMediaId: null,
      capturedAt: resumeCapturedAt,
      focusRegionNormalized: [],
      isTest: false,
      analyticsEligible: false,
      createdAt: Timestamp.now(),
    });
    await firestore.collection("processingJobs").doc(resumeJobId).set({
      type: "image",
      status: "failed",
      siteId,
      zoneId: thirdZoneId,
      cameraId,
      sourceMediaId: `intentionally-missing-${testId}`,
      attemptCount: 1,
      summary: { analysisRunCount: 1, detectionCount: 0, flagCount: 0, alertIds: [] },
      error: { code: "SMOKE_PARTIAL", message: "Simulated alert-phase failure" },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const resumed = await retryImageJob(resumeJobId);
    assert.equal(resumed.job.status, "completed", "A retry must resume persisted inference without reading missing media or rerunning AI.");
    assert.equal((await firestore.collection("analysisRuns").doc(resumeJobId).get()).data()?.alertEvaluationStatus, "completed");

    console.log("Phase 4 Firestore smoke test passed: grouping, temporal horizons, zone deduplication, replay, stale-key repair, reset generations, and partial-job resume.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
