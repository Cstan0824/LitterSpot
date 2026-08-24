import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { getDashboard } from "../services/dashboardService.js";
import { getDashboardSummary, reconcileDashboardSummary } from "../services/dashboardSummary.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";

const id = randomUUID();
const siteId = `smoke-dashboard-site-${id}`;
const zoneId = `smoke-dashboard-zone-${id}`;
const cameraId = `smoke-dashboard-camera-${id}`;
const runId = `smoke-dashboard-run-${id}`;
const mediaId = `smoke-dashboard-media-${id}`;
const alertId = `smoke-dashboard-alert-${id}`;
const detectionId = `smoke-dashboard-detection-${id}`;
const failedJobId = `smoke-dashboard-job-${id}`;

async function cleanup() {
  for (const collection of [
    "dashboardSummaries",
    "activeAlertKeys",
    "alerts",
    "detections",
    "processingJobs",
    "analysisRuns",
    "mediaAssets",
    "cameras",
    "zones",
  ]) {
    const snapshot = await firestore.collection(collection).where("siteId", "==", siteId).get();
    for (const document of snapshot.docs) await firestore.recursiveDelete(document.ref);
  }
  await firestore.collection("sites").doc(siteId).delete();
}

async function seed() {
  const capturedAt = Timestamp.now();
  await Promise.all([
    firestore.collection("sites").doc(siteId).set({
      name: "Dashboard smoke site", timezone: "Asia/Kuala_Lumpur", status: "active", createdAt: capturedAt, updatedAt: capturedAt,
    }),
    firestore.collection("zones").doc(zoneId).set({
      siteId, siteNameSnapshot: "Dashboard smoke site", name: "Dashboard smoke zone", status: "active", createdAt: capturedAt,
    }),
    firestore.collection("cameras").doc(cameraId).set({
      siteId, zoneId, zoneNameSnapshot: "Dashboard smoke zone", code: "CAMERA-999", name: "Dashboard smoke camera",
      status: "active", availability: "available", sourceMode: "upload", latestAnalysisRunId: runId, latestAnalysisAt: capturedAt,
    }),
    firestore.collection("mediaAssets").doc(mediaId).set({ siteId, zoneId, cameraId, storageStatus: "available", capturedAt }),
    firestore.collection("analysisRuns").doc(runId).set({
      siteId, zoneId, cameraId, evidenceMediaId: mediaId, sourceType: "image_upload", capturedAt,
      peopleCount: 7, issueKinds: ["floor_litter"], issueCounts: { floorLitter: 3, binOverflow: 0, floorSpill: 0 },
      image: { width: 1920, height: 1080 }, processingTimeMs: 120, isTest: false,
      alertWorkflowVersion: ALERT_WORKFLOW_VERSION, alertEvaluationStatus: "completed",
    }),
    firestore.collection("alerts").doc(alertId).set({
      workflowVersion: ALERT_WORKFLOW_VERSION, siteId, zoneId, zoneNameSnapshot: "Dashboard smoke zone", issueType: "floor_litter",
      severity: "warning", status: "new", cameraIds: [cameraId], triggerCameraId: cameraId, latestCameraId: cameraId,
      occurrenceCount: 3, firstDetectedAt: capturedAt, lastDetectedAt: capturedAt, latestConfidence: 0.9,
      latestMagnitudeScore: 0.6, latestEvidenceMediaId: mediaId,
    }),
    firestore.collection("activeAlertKeys").doc(`smoke-dashboard-key-${id}`).set({
      workflowVersion: ALERT_WORKFLOW_VERSION, alertId, siteId, zoneId, issueType: "floor_litter", updatedAt: capturedAt,
    }),
    firestore.collection("detections").doc(detectionId).set({
      siteId, zoneId, zoneName: "Dashboard smoke zone", cameraId, cameraCode: "CAMERA-999", cameraName: "Dashboard smoke camera",
      analysisRunId: runId, issueType: "floor_litter", confidence: 0.9, capturedAt, qualificationStatus: "qualified",
      qualifiedForFlag: true, evidenceMediaId: mediaId, isTest: false,
    }),
    firestore.collection("processingJobs").doc(failedJobId).set({
      type: "image", status: "failed", sourceType: "image_upload", siteId, zoneId, cameraId, sourceMediaId: mediaId,
      requestedAt: capturedAt, completedAt: capturedAt, attemptCount: 1, isTest: false, analyticsEligible: true,
      error: { code: "SMOKE_FAILURE", message: "Expected smoke failure record", occurredAt: capturedAt },
    }),
  ]);
}

async function main() {
  try {
    await seed();
    const dashboard = await getDashboard({ siteId, alertLimit: 10, detectionLimit: 10, failedJobLimit: 10 });
    assert.equal(dashboard.contractVersion, "site-dashboard-v1");
    assert.equal(dashboard.summary.configuredCameraCount, 1);
    assert.equal(dashboard.summary.activeAlertCounts.total, 1);
    assert.equal(dashboard.cameras[0]?.latestRun?.id, runId);
    assert.equal(dashboard.activeAlerts[0]?.id, alertId);
    assert.equal(dashboard.recentDetections[0]?.id, detectionId);
    assert.equal(dashboard.recentFailedJobs[0]?.id, failedJobId);

    const reconciled = await reconcileDashboardSummary(siteId, "smoke-supervisor");
    assert.equal(reconciled["activeAlertCounts"] && (reconciled["activeAlertCounts"] as Record<string, unknown>).total, 1);
    assert.equal(reconciled["configuredCameraCount"], 1);
    const reread = await getDashboardSummary(siteId);
    assert.equal(reread["latestDetectionAt"] !== null, true);
    assert.equal(reread["latestJobFailureAt"] !== null, true);

    console.log("Phase 5 Firestore smoke test passed: site dashboard, current alerts, camera latest evidence, recent feeds, and summary reconciliation.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

