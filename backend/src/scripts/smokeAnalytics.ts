import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import {
  analyticsReportCsv,
  applyAlertIncidentAnalytics,
  applyAnalysisRunAnalytics,
  generateAnalyticsReport,
  listAnalyticsReports,
  reconcileSiteAnalytics,
} from "../services/analyticsService.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";

const suffix = randomUUID();
const siteId = `smoke-analytics-site-${suffix}`;
const zoneA = `smoke-analytics-zone-a-${suffix}`;
const zoneB = `smoke-analytics-zone-b-${suffix}`;
const cameraA = `smoke-analytics-camera-a-${suffix}`;
const cameraB = `smoke-analytics-camera-b-${suffix}`;
const collections = [
  "analyticsReports",
  "analyticsSampleApplications",
  "analyticsIncidentApplications",
  "analyticsPersistenceStates",
  "analyticsBuckets",
  "analyticsReconciliationLocks",
  "analyticsSites",
  "alerts",
  "issueObservations",
  "analysisRuns",
  "cameras",
  "zones",
];

function observationId(runId: string, issueType: string) {
  return `${runId}-${issueType}`;
}

async function cleanup() {
  for (const collection of collections) {
    const snapshot = await firestore.collection(collection).where("siteId", "==", siteId).get();
    for (const document of snapshot.docs) await firestore.recursiveDelete(document.ref);
  }
  await firestore.collection("sites").doc(siteId).delete();
}

async function seedRun(options: {
  id: string;
  zoneId: string;
  cameraId: string;
  capturedAt: string;
  positiveIssue: "floor_litter" | "floor_spill" | "bin_overflow";
  peopleCount: number;
  isTest?: boolean;
}) {
  const capturedAt = Timestamp.fromDate(new Date(options.capturedAt));
  const batch = firestore.batch();
  batch.set(firestore.collection("analysisRuns").doc(options.id), {
    jobId: `${options.id}-job`,
    siteId,
    siteName: "Analytics smoke site",
    zoneId: options.zoneId,
    zoneName: options.zoneId === zoneA ? "Main Stairs" : "Food Court",
    cameraId: options.cameraId,
    cameraCode: options.cameraId === cameraA ? "CAMERA-901" : "CAMERA-902",
    cameraName: "Analytics smoke camera",
    capturedAt,
    peopleCount: options.peopleCount,
    modelVersions: { floorHazard: "floor-v1", people: "people-v1", binState: "bin-v1" },
    analyticsEligible: !options.isTest,
    isTest: Boolean(options.isTest),
    alertWorkflowVersion: ALERT_WORKFLOW_VERSION,
    alertEvaluationStatus: "completed",
    analyticsAppliedAt: null,
  });
  for (const issueType of ["floor_litter", "floor_spill", "bin_overflow"] as const) {
    const positive = issueType === options.positiveIssue;
    batch.set(firestore.collection("issueObservations").doc(observationId(options.id, issueType)), {
      workflowVersion: ALERT_WORKFLOW_VERSION,
      analysisRunId: options.id,
      jobId: `${options.id}-job`,
      sourceType: "image_upload",
      siteId,
      zoneId: options.zoneId,
      cameraId: options.cameraId,
      issueType,
      capturedAt,
      positive,
      excluded: Boolean(options.isTest),
      eligibleDetectionIds: positive ? [`${options.id}-${issueType}-detection-1`] : [],
    });
  }
  await batch.commit();
}

async function seed() {
  const now = Timestamp.now();
  await Promise.all([
    firestore.collection("sites").doc(siteId).set({
      name: "Analytics smoke site", timezone: "Asia/Kuala_Lumpur", status: "active", createdAt: now, updatedAt: now,
    }),
    firestore.collection("zones").doc(zoneA).set({ siteId, name: "Main Stairs", status: "active", createdAt: now }),
    firestore.collection("zones").doc(zoneB).set({ siteId, name: "Food Court", status: "active", createdAt: now }),
    firestore.collection("cameras").doc(cameraA).set({ siteId, zoneId: zoneA, code: "CAMERA-901", status: "active" }),
    firestore.collection("cameras").doc(cameraB).set({ siteId, zoneId: zoneB, code: "CAMERA-902", status: "active" }),
  ]);
  const starts = [
    "2026-07-31T16:00:00.000Z", "2026-07-31T17:00:00.000Z", "2026-07-31T18:00:00.000Z",
    "2026-07-31T19:00:00.000Z", "2026-07-31T20:00:00.000Z", "2026-07-31T21:00:00.000Z",
    "2026-07-31T22:00:00.000Z", "2026-08-01T16:00:00.000Z",
  ];
  for (const [index, capturedAt] of starts.entries()) {
    await seedRun({
      id: `smoke-a-${index}-${suffix}`, zoneId: zoneA, cameraId: cameraA, capturedAt,
      positiveIssue: "floor_litter", peopleCount: 3,
    });
    await seedRun({
      id: `smoke-b-${index}-${suffix}`, zoneId: zoneB, cameraId: cameraB, capturedAt,
      positiveIssue: "bin_overflow", peopleCount: 8,
    });
  }
  await seedRun({
    id: `smoke-test-${suffix}`, zoneId: zoneA, cameraId: cameraA, capturedAt: "2026-08-01T17:00:00.000Z",
    positiveIssue: "floor_litter", peopleCount: 999, isTest: true,
  });
  const historicalRun = `smoke-a-0-${suffix}`;
  await firestore.collection("alerts").doc(`smoke-historical-alert-${suffix}`).set({
    workflowVersion: ALERT_WORKFLOW_VERSION,
    siteId,
    zoneId: zoneA,
    issueType: "floor_litter",
    firstObservationId: observationId(historicalRun, "floor_litter"),
    status: "resolved",
    createdAt: now,
  });
}

async function main() {
  try {
    await seed();
    const reconciliation = await reconcileSiteAnalytics(siteId, "smoke-supervisor");
    assert.equal(reconciliation.includedRunCount, 16);
    assert.equal(reconciliation.excludedRunCount, 1);
    assert.equal(reconciliation.includedIncidentCount, 1);
    assert.equal(reconciliation.bucketCount, 16);

    const liveRunId = `smoke-live-${suffix}`;
    await seedRun({
      id: liveRunId,
      zoneId: zoneB,
      cameraId: cameraB,
      capturedAt: "2026-08-01T16:10:00.000Z",
      positiveIssue: "bin_overflow",
      peopleCount: 10,
    });
    const firstApplication = await applyAnalysisRunAnalytics(liveRunId);
    const repeatedApplication = await applyAnalysisRunAnalytics(liveRunId);
    assert.equal(firstApplication.status, "applied");
    assert.equal(repeatedApplication.status, "already_applied");
    assert.deepEqual(firstApplication.persistenceOutOfOrderIssueTypes, []);

    const liveAlertId = `smoke-live-alert-${suffix}`;
    await firestore.collection("alerts").doc(liveAlertId).set({
      workflowVersion: ALERT_WORKFLOW_VERSION,
      siteId,
      zoneId: zoneB,
      issueType: "bin_overflow",
      firstObservationId: observationId(liveRunId, "bin_overflow"),
      status: "new",
      createdAt: Timestamp.now(),
    });
    assert.equal((await applyAlertIncidentAnalytics(liveAlertId)).status, "applied");
    assert.equal((await applyAlertIncidentAnalytics(liveAlertId)).status, "already_applied");

    const detail = await generateAnalyticsReport({
      siteId,
      periodStart: "2026-07-31T16:00:00.000Z",
      periodEnd: "2026-08-02T00:00:00.000Z",
    }, "smoke-supervisor");
    assert.equal(detail.report.status, "completed");
    assert.equal(detail.zoneResults.length, 2);
    assert.equal(detail.zoneResults.every((zone) => zone.priorityBand !== "insufficient_data"), true);
    const zoneBResult = detail.zoneResults.find((zone) => zone.zoneId === zoneB)!;
    assert.equal((zoneBResult.evidence as Record<string, unknown>).overflowIncidents, 1);
    assert.equal((zoneBResult.coverage as Record<string, unknown>).successfulSampleCount, 9);

    const listed = await listAnalyticsReports({ siteId, status: "all", limit: 20 });
    assert.equal(listed.reports.some((report) => report.id === detail.report.id), true);
    const csv = await analyticsReportCsv(detail.report.id);
    assert.match(csv, /priorityBand/);
    assert.match(csv, /Food Court/);
    console.log("Phase 7 Firestore smoke test passed: generation-safe rebuild, test exclusion, exactly-once samples and incidents, persistence, reports, ranking, list/detail, and CSV.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

