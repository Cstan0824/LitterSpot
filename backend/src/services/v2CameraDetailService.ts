import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { listV2AuditEvents } from "./v2AuditService.js";
import { listV2OrchestratorRuns } from "./v2OrchestratorService.js";
import { v2Json } from "./v2Presentation.js";

const activeWorkStatuses = new Set(["assigned", "in_progress", "awaiting_review"]);

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function mediaSnapshot(mediaId: unknown) {
  const id = typeof mediaId === "string" && mediaId ? mediaId : null;
  return id ? { mediaId: id, contentUrl: `/api/media/${id}/content` } : null;
}

async function cameraWorkDocuments(siteId: string, cameraId: string) {
  try {
    return (await firestore.collection("workOrders").where("siteId", "==", siteId).where("cameraId", "==", cameraId).limit(100).get()).docs;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : null;
    if (code !== 9) throw error;
    const fallback = await firestore.collection("workOrders").where("siteId", "==", siteId).limit(501).get();
    if (fallback.size > 500) throw new HttpError(503, "Camera Work history requires its Firestore index to finish building.");
    return fallback.docs.filter((document) => document.data()?.cameraId === cameraId);
  }
}

async function cameraAlertDocuments(siteId: string, cameraId: string) {
  try {
    return (await firestore.collection("alerts").where("siteId", "==", siteId).where("cameraId", "==", cameraId).limit(100).get()).docs;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : null;
    if (code !== 9) throw error;
    const fallback = await firestore.collection("alerts").where("siteId", "==", siteId).limit(501).get();
    if (fallback.size > 500) throw new HttpError(503, "Camera Alert history requires its Firestore index to finish building.");
    return fallback.docs.filter((document) => document.data()?.cameraId === cameraId);
  }
}

export async function getV2CameraDetail(siteId: string, cameraId: string) {
  const [site, camera] = await Promise.all([
    firestore.collection("sites").doc(siteId).get(),
    firestore.collection("cameras").doc(cameraId).get(),
  ]);
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (!camera.exists || camera.data()?.schemaVersion !== 2 || camera.data()?.siteId !== siteId) throw new HttpError(404, "Camera not found.");

  const activeMapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
  const [placement, runtime, source, registration, workDocuments, alertDocuments] = await Promise.all([
    firestore.collection("siteMapRevisions").doc(activeMapRevisionId).collection("cameraPlacements").doc(cameraId).get(),
    firestore.collection("cameraRuntimeStates").doc(cameraId).get(),
    firestore.collection("cameraSourceRevisions").doc(String(camera.data()?.activeSourceRevisionId ?? "")).get(),
    firestore.collection("cameraRegistrationRevisions").doc(String(camera.data()?.activeRegistrationRevisionId ?? "")).get(),
    cameraWorkDocuments(siteId, cameraId),
    cameraAlertDocuments(siteId, cameraId),
  ]);

  const workOrders = workDocuments
    .filter((document) => document.data()?.schemaVersion === 2)
    .map((document) => v2Json({ id: document.id, ...document.data() }));
  const alerts = alertDocuments
    .filter((document) => document.data()?.schemaVersion === 2)
    .map((document) => v2Json({ id: document.id, ...document.data() }));
  const alertIds = new Set(alerts.map((alert) => String(alert.id)));
  const workIds = new Set(workOrders.map((work) => String(work.id)));

  const [runs, auditEvents] = await Promise.all([
    listV2OrchestratorRuns(siteId, 100),
    listV2AuditEvents({ siteId, limit: 100 }),
  ]);
  const orchestratorTrace = runs
    .filter((run) => run.type === "assignment" || run.type === "review")
    .filter((run) => alertIds.has(String(run.alertId ?? ""))
      || alertIds.has(String(run.selectedAlertId ?? ""))
      || workIds.has(String(run.workOrderId ?? "")))
    .map((run) => ({
      id: run.id,
      type: run.type,
      status: run.status,
      resultCode: run.resultCode ?? null,
      alertId: run.alertId ?? run.selectedAlertId ?? null,
      workOrderId: run.workOrderId ?? null,
      selectedCleanerId: run.selectedCleanerId ?? null,
      decisionSummary: run.decisionSummary ?? null,
      decisionFactors: run.decisionFactors ?? {},
      provider: run.provider ?? null,
      model: run.model ?? null,
      errorCode: run.errorCode ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      createdAt: run.createdAt ?? null,
    }));
  const relevantAuditEvents = auditEvents.filter((event) => {
    const resourceId = (event as Record<string, unknown>).resourceId;
    return resourceId === cameraId || workIds.has(String(resourceId ?? "")) || alertIds.has(String(resourceId ?? ""));
  });

  const recentHistory = [
    ...alerts.map((alert) => ({
      type: "alert" as const,
      id: alert.id,
      status: alert.status,
      severity: alert.severity,
      issueType: alert.issueType,
      assignedCleanerName: null,
      occurredAt: alert.resolvedAt ?? alert.dismissedAt ?? alert.lastDetectedAt ?? alert.createdAt ?? null,
      snapshot: mediaSnapshot(alert.evidence?.mediaId),
    })),
    ...workOrders.map((work) => ({
      type: "work" as const,
      id: work.id,
      status: work.status,
      severity: work.severity,
      issueType: work.issueType,
      assignedCleanerName: work.cleanerNameSnapshot ?? null,
      occurredAt: work.resolvedAt ?? work.dismissedAt ?? work.updatedAt ?? work.createdAt ?? null,
      snapshot: mediaSnapshot(work.completionEvidenceMediaId ?? work.creationEvidenceMediaId),
    })),
  ].sort((left, right) => String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? ""))).slice(0, 30);

  return {
    camera: v2Json({
      id: camera.id,
      ...camera.data(),
      placement: placement.exists ? placement.data() : null,
      runtime: runtime.exists ? runtime.data() : null,
      source: source.exists ? { ...source.data(), contentUrl: source.data()?.sourceMediaId ? `/api/media/${source.data()?.sourceMediaId}/content` : null } : null,
      registration: registration.exists ? registration.data() : null,
      activeMapRevisionId,
    }),
    currentAssignments: workOrders.filter((work) => activeWorkStatuses.has(String(work.status))),
    recentHistory,
    orchestratorTrace,
    auditEvents: relevantAuditEvents,
  };
}
