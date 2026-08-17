import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import { DASHBOARD_FALLBACK_SCAN_LIMIT } from "./dashboardLimits.js";

export const DASHBOARD_SUMMARY_VERSION = "site-dashboard-summary-v1";

function isMissingIndexError(error: unknown) {
  return Boolean(error && typeof error === "object" && Number((error as { code?: unknown }).code) === 9);
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

async function latestDetectionForSite(siteId: string) {
  try {
    return await firestore.collection("detections").where("siteId", "==", siteId).orderBy("capturedAt", "desc").limit(1).get();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("detections")
      .where("siteId", "==", siteId)
      .limit(DASHBOARD_FALLBACK_SCAN_LIMIT + 1)
      .get();
    return { docs: snapshot.docs.slice(0, DASHBOARD_FALLBACK_SCAN_LIMIT)
      .sort((left, right) => timestampMillis(right.data().capturedAt) - timestampMillis(left.data().capturedAt)).slice(0, 1) };
  }
}

async function latestFailedJobForSite(siteId: string) {
  try {
    return await firestore.collection("processingJobs")
      .where("siteId", "==", siteId).where("status", "==", "failed")
      .orderBy("completedAt", "desc").limit(1).get();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("processingJobs")
      .where("siteId", "==", siteId).where("status", "==", "failed")
      .limit(DASHBOARD_FALLBACK_SCAN_LIMIT + 1).get();
    return { docs: snapshot.docs.slice(0, DASHBOARD_FALLBACK_SCAN_LIMIT)
      .sort((left, right) => timestampMillis(right.data().completedAt) - timestampMillis(left.data().completedAt)).slice(0, 1) };
  }
}

type SummaryBuildInput = {
  siteId: string;
  cameras: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  latestDetectionAt: unknown;
  latestJobFailureAt: unknown;
};

export function buildDashboardSummaryFields(input: SummaryBuildInput) {
  const currentAlerts = input.alerts.filter((alert) => alert.workflowVersion === ALERT_WORKFLOW_VERSION);
  const activeAlertCounts = { new: 0, acknowledged: 0, inProgress: 0, total: 0 };
  let resolvedAlertCount = 0;
  for (const alert of currentAlerts) {
    if (alert.status === "new") activeAlertCounts.new += 1;
    else if (alert.status === "acknowledged") activeAlertCounts.acknowledged += 1;
    else if (alert.status === "in_progress") activeAlertCounts.inProgress += 1;
    else if (alert.status === "resolved") resolvedAlertCount += 1;
  }
  activeAlertCounts.total = activeAlertCounts.new + activeAlertCounts.acknowledged + activeAlertCounts.inProgress;

  const activeCameras = input.cameras.filter((camera) => camera.status === "active");
  const availableCameraCount = activeCameras.filter((camera) => camera.availability === "available").length;
  const unavailableCameraCount = activeCameras.filter((camera) => camera.availability === "unavailable").length;

  return {
    version: DASHBOARD_SUMMARY_VERSION,
    workflowVersion: ALERT_WORKFLOW_VERSION,
    siteId: input.siteId,
    activeAlertCounts,
    resolvedAlertCount,
    configuredCameraCount: input.cameras.length,
    activeCameraCount: activeCameras.length,
    availableCameraCount,
    unavailableCameraCount,
    unknownCameraCount: activeCameras.length - availableCameraCount - unavailableCameraCount,
    latestDetectionAt: input.latestDetectionAt,
    latestJobFailureAt: input.latestJobFailureAt,
  };
}

function timestampJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(timestampJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestampJson(item)]));
  }
  return value;
}

function serializeSummary(snapshot: DocumentSnapshot): Record<string, unknown> & { id: string } {
  if (!snapshot.exists) throw new HttpError(404, "Dashboard summary has not been reconciled for this site.");
  return { id: snapshot.id, ...timestampJson(snapshot.data()) as Record<string, unknown> };
}

export async function getDashboardSummary(siteId: string) {
  const site = await firestore.collection("sites").doc(siteId).get();
  if (!site.exists) throw new HttpError(404, "Site not found.");
  return serializeSummary(await firestore.collection("dashboardSummaries").doc(siteId).get());
}

export async function reconcileDashboardSummary(siteId: string, actorUid: string) {
  const siteReference = firestore.collection("sites").doc(siteId);
  const site = await siteReference.get();
  if (!site.exists) throw new HttpError(404, "Site not found.");
  const [cameras, alerts, latestDetection, latestFailure] = await Promise.all([
    firestore.collection("cameras").where("siteId", "==", siteId).get(),
    firestore.collection("alerts").where("siteId", "==", siteId).get(),
    latestDetectionForSite(siteId),
    latestFailedJobForSite(siteId),
  ]);

  const latestDetectionAt = latestDetection.docs[0]?.data().capturedAt ?? null;
  const latestFailureData = latestFailure.docs[0]?.data();
  const latestJobFailureAt = latestFailureData?.error?.occurredAt ?? latestFailureData?.completedAt ?? null;
  const fields = buildDashboardSummaryFields({
    siteId,
    cameras: cameras.docs.map((snapshot) => snapshot.data()),
    alerts: alerts.docs.map((snapshot) => snapshot.data()),
    latestDetectionAt,
    latestJobFailureAt,
  });
  const summaryReference = firestore.collection("dashboardSummaries").doc(siteId);
  await summaryReference.set({
    ...fields,
    reconciledAt: FieldValue.serverTimestamp(),
    reconciledByUid: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return serializeSummary(await summaryReference.get());
}
