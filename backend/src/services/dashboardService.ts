import { Timestamp, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import { buildDashboardDto, type DashboardSource } from "./dashboardPresentation.js";
import { DASHBOARD_FALLBACK_SCAN_LIMIT } from "./dashboardLimits.js";
import type { DashboardQuery } from "../schemas/dashboard.js";

const MAX_CONFIGURED_CAMERAS = 200;
const ACTIVE_ALERT_STATUSES = ["new", "acknowledged", "in_progress"] as const;

function isMissingIndexError(error: unknown) {
  return Boolean(error && typeof error === "object" && Number((error as { code?: unknown }).code) === 9);
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function timestampJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(timestampJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestampJson(item)]));
  }
  return value;
}

function serialize(snapshot: DocumentSnapshot | QueryDocumentSnapshot): DashboardSource {
  return { id: snapshot.id, ...timestampJson(snapshot.data()) as Record<string, unknown> };
}

async function requireSite(siteId: string) {
  const snapshot = await firestore.collection("sites").doc(siteId).get();
  if (!snapshot.exists) throw new HttpError(404, "Site not found.");
  return serialize(snapshot);
}

async function getConfiguredCameras(siteId: string) {
  const snapshot = await firestore.collection("cameras").where("siteId", "==", siteId).limit(MAX_CONFIGURED_CAMERAS + 1).get();
  return {
    records: snapshot.docs.slice(0, MAX_CONFIGURED_CAMERAS).map(serialize),
    sourceTruncated: snapshot.size > MAX_CONFIGURED_CAMERAS,
  };
}

async function getLatestRuns(cameras: DashboardSource[]) {
  const runIds = [...new Set(cameras
    .map((camera) => camera.latestAnalysisRunId)
    .filter((value): value is string => typeof value === "string" && value.length > 0))];
  const snapshots = await Promise.all(runIds.map((runId) => firestore.collection("analysisRuns").doc(runId).get()));
  return snapshots.filter((snapshot) => snapshot.exists).map(serialize);
}

async function countActiveAlertsByStatus(siteId: string, status: typeof ACTIVE_ALERT_STATUSES[number]) {
  const snapshot = await firestore.collection("alerts")
    .where("siteId", "==", siteId)
    .where("workflowVersion", "==", ALERT_WORKFLOW_VERSION)
    .where("status", "==", status)
    .count()
    .get();
  return snapshot.data().count;
}

async function getActiveCurrentWorkflowAlerts(siteId: string, limit: number) {
  const alerts = firestore.collection("alerts")
    .where("siteId", "==", siteId)
    .where("workflowVersion", "==", ALERT_WORKFLOW_VERSION)
    .where("status", "in", [...ACTIVE_ALERT_STATUSES]);
  const [snapshot, newCount, acknowledgedCount, inProgressCount] = await Promise.all([
    alerts.orderBy("lastDetectedAt", "desc").limit(limit + 1).get(),
    countActiveAlertsByStatus(siteId, "new"),
    countActiveAlertsByStatus(siteId, "acknowledged"),
    countActiveAlertsByStatus(siteId, "in_progress"),
  ]);
  return {
    records: snapshot.docs.slice(0, limit).map(serialize),
    hasMore: snapshot.size > limit,
    counts: {
      new: newCount,
      acknowledged: acknowledgedCount,
      inProgress: inProgressCount,
      total: newCount + acknowledgedCount + inProgressCount,
    },
    queryMode: "indexed" as const,
  };
}

async function getRecentDetectionCandidates(siteId: string, limit: number) {
  try {
    const snapshot = await firestore.collection("detections")
      .where("siteId", "==", siteId)
      .orderBy("capturedAt", "desc")
      .limit(limit + 1)
      .get();
    return {
      records: snapshot.docs.slice(0, limit).map(serialize),
      sourceTruncated: snapshot.size > limit,
      queryMode: "indexed" as const,
    };
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("detections")
      .where("siteId", "==", siteId)
      .limit(DASHBOARD_FALLBACK_SCAN_LIMIT + 1)
      .get();
    const ordered = snapshot.docs.slice(0, DASHBOARD_FALLBACK_SCAN_LIMIT)
      .sort((left, right) => timestampMillis(right.data().capturedAt) - timestampMillis(left.data().capturedAt));
    return {
      records: ordered.slice(0, limit).map(serialize),
      sourceTruncated: true,
      queryMode: "fallback_bounded_scan" as const,
    };
  }
}

async function getRecentFailedJobCandidates(siteId: string, limit: number) {
  try {
    const snapshot = await firestore.collection("processingJobs")
      .where("siteId", "==", siteId)
      .where("status", "==", "failed")
      .orderBy("completedAt", "desc")
      .limit(limit + 1).get();
    return {
      records: snapshot.docs.slice(0, limit).map(serialize),
      sourceTruncated: snapshot.size > limit,
      queryMode: "indexed" as const,
    };
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("processingJobs")
      .where("siteId", "==", siteId)
      .where("status", "==", "failed")
      .limit(DASHBOARD_FALLBACK_SCAN_LIMIT + 1)
      .get();
    const ordered = snapshot.docs.slice(0, DASHBOARD_FALLBACK_SCAN_LIMIT)
      .sort((left, right) => timestampMillis(right.data().completedAt) - timestampMillis(left.data().completedAt));
    return {
      records: ordered.slice(0, limit).map(serialize),
      sourceTruncated: true,
      queryMode: "fallback_bounded_scan" as const,
    };
  }
}

export async function getDashboard(query: DashboardQuery) {
  const site = await requireSite(query.siteId);
  const [camerasResult, activeAlertsResult, detectionsResult, failedJobsResult] = await Promise.all([
    getConfiguredCameras(query.siteId),
    getActiveCurrentWorkflowAlerts(query.siteId, query.alertLimit),
    getRecentDetectionCandidates(query.siteId, query.detectionLimit),
    getRecentFailedJobCandidates(query.siteId, query.failedJobLimit),
  ]);
  const latestRuns = await getLatestRuns(camerasResult.records);

  return buildDashboardDto({
    site,
    cameras: camerasResult.records,
    latestRuns,
    activeAlerts: activeAlertsResult.records,
    activeAlertCounts: activeAlertsResult.counts,
    activeAlertsHasMore: activeAlertsResult.hasMore,
    recentDetections: detectionsResult.records,
    recentFailedJobs: failedJobsResult.records,
    limits: query,
    generatedAt: new Date().toISOString(),
    sourceTruncation: {
      cameras: camerasResult.sourceTruncated,
      detections: detectionsResult.sourceTruncated,
      failedJobs: failedJobsResult.sourceTruncated,
    },
    sourceQueryMode: {
      activeAlerts: activeAlertsResult.queryMode,
      detections: detectionsResult.queryMode,
      failedJobs: failedJobsResult.queryMode,
    },
  });
}
