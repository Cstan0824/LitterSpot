import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { createV2NotificationInTransaction } from "./v2NotificationService.js";
import { canonicalHash } from "./v2Persistence.js";
import type { AuditActor } from "./v2AuditService.js";

const ACTIVE_ALERT_STATUSES = new Set(["waiting_for_cleaner", "assigned", "in_progress", "awaiting_review"]);
const ACTIVE_WORK_STATUSES = new Set(["assigned", "in_progress", "awaiting_review"]);

const humanActor = (actor: AuditActor) => ({
  type: "human",
  uid: actor.uid,
  role: actor.role,
  authority: actor.authority ?? null,
  displayNameSnapshot: actor.displayName,
});

const systemActor = {
  type: "system",
  serviceId: "camera-configuration",
  displayNameSnapshot: "Camera configuration",
};

function isCurrent(document: DocumentSnapshot, siteId: string, cameraId: string, statuses: Set<string>) {
  const data = document.data();
  return document.exists && data?.schemaVersion === V2_SCHEMA_VERSION && data.siteId === siteId && data.cameraId === cameraId && statuses.has(String(data.status));
}

async function readCurrentOperations(transaction: Transaction, siteId: string, cameraId: string) {
  const [alerts, work] = await Promise.all([
    transaction.get(firestore.collection("alerts").where("siteId", "==", siteId).where("cameraId", "==", cameraId).where("status", "in", [...ACTIVE_ALERT_STATUSES]).limit(51)),
    transaction.get(firestore.collection("workOrders").where("siteId", "==", siteId).where("cameraId", "==", cameraId).where("status", "in", [...ACTIVE_WORK_STATUSES]).limit(51)),
  ]);
  if (alerts.size > 50 || work.size > 50) throw new HttpError(413, "This Camera has too many operational records to move safely in one publication.", { code: "camera_move_operation_limit" });
  const currentAlerts = alerts.docs.filter((document) => isCurrent(document, siteId, cameraId, ACTIVE_ALERT_STATUSES));
  const currentWork = work.docs.filter((document) => isCurrent(document, siteId, cameraId, ACTIVE_WORK_STATUSES));
  const cleanerIds = [...new Set(currentWork.map((document) => String(document.data()?.assignedCleanerId ?? "")).filter(Boolean))];
  const cleaners = await Promise.all(cleanerIds.map((cleanerId) => transaction.get(firestore.collection("cleaners").doc(cleanerId))));
  return { alerts: currentAlerts, work: currentWork, cleaners: new Map(cleaners.map((document) => [document.id, document])) };
}

export async function retargetActiveCameraOperations(transaction: Transaction, input: {
  siteId: string;
  cameraId: string;
  cameraName: string;
  mapRevisionId: string;
  zoneId: string;
  zoneName: string;
  point: { xMeters: number; yMeters: number };
  reason: string;
  actor: AuditActor;
  requestId: string;
}) {
  const current = await readCurrentOperations(transaction, input.siteId, input.cameraId);
  for (const alert of current.alerts) {
    const data = alert.data()!;
    transaction.update(alert.ref, { mapRevisionId: input.mapRevisionId, zoneId: input.zoneId, zoneNameSnapshot: input.zoneName, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    transaction.create(alert.ref.collection("events").doc(canonicalHash("camera-location-corrected", input.mapRevisionId, alert.id)), {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, alertId: alert.id, type: "location_corrected",
      fromStatus: data.status, toStatus: data.status, fromSeverity: data.severity ?? null, toSeverity: data.severity ?? null,
      workOrderId: data.activeWorkOrderId ?? null, actor: humanActor(input.actor), reasonCode: "camera_map_position_corrected",
      note: input.reason, requestId: input.requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null,
      previousMapRevisionId: data.mapRevisionId, mapRevisionId: input.mapRevisionId,
    });
  }
  for (const work of current.work) {
    const data = work.data()!;
    const target = data.target?.type === "camera" ? { ...data.target, mapRevisionId: input.mapRevisionId, zoneId: input.zoneId, zoneNameSnapshot: input.zoneName, point: input.point, cameraNameSnapshot: input.cameraName } : data.target;
    transaction.update(work.ref, { target, mapRevisionId: input.mapRevisionId, zoneId: input.zoneId, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    const eventId = canonicalHash("work-location-corrected", input.mapRevisionId, work.id);
    transaction.create(work.ref.collection("events").doc(eventId), {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: work.id, type: "location_corrected",
      fromStatus: data.status, toStatus: data.status, cleanerId: data.assignedCleanerId, previousCleanerId: null,
      actor: humanActor(input.actor), reasonCode: "camera_map_position_corrected", note: input.reason, evidenceMediaIds: [],
      requestId: input.requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null,
      previousTarget: data.target ?? null, target,
    });
    const cleaner = current.cleaners.get(String(data.assignedCleanerId));
    const recipientUid = cleaner?.data()?.authUid;
    if (typeof recipientUid === "string" && recipientUid) createV2NotificationInTransaction(transaction, {
      siteId: input.siteId, recipientUid, recipientRole: "cleaner", type: "work_location_corrected", eventKey: eventId,
      title: "Work location updated", body: "The recorded Camera position was corrected. Open the task map to view the new location.",
      entityType: "work_order", entityId: work.id, cameraId: input.cameraId, alertId: data.alertId ?? null, workOrderId: work.id,
      severity: data.severity ?? null, isSimulation: Boolean(data.isSimulation),
    });
  }
  return { alertCount: current.alerts.length, workCount: current.work.length };
}

export async function dismissActiveCameraOperations(transaction: Transaction, input: {
  siteId: string;
  cameraId: string;
  publicationKey: string;
  requestId: string;
}) {
  const current = await readCurrentOperations(transaction, input.siteId, input.cameraId);
  for (const alert of current.alerts) {
    const data = alert.data()!;
    transaction.update(alert.ref, { status: "dismissed", activeWorkOrderId: null, dismissedAt: FieldValue.serverTimestamp(), dismissedBy: systemActor, dismissReason: "camera_physically_moved", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    transaction.delete(firestore.collection("activeAlertKeys").doc(canonicalHash("v2-active-alert", input.siteId, input.cameraId, data.issueType)));
    transaction.create(alert.ref.collection("events").doc(canonicalHash("camera-physically-moved", input.publicationKey, alert.id)), {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, alertId: alert.id, type: "dismissed",
      fromStatus: data.status, toStatus: "dismissed", fromSeverity: data.severity ?? null, toSeverity: data.severity ?? null,
      workOrderId: data.activeWorkOrderId ?? null, actor: systemActor, reasonCode: "camera_physically_moved", note: null,
      requestId: input.requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null,
    });
  }
  for (const work of current.work) {
    const data = work.data()!;
    transaction.update(work.ref, { status: "dismissed", dismissedAt: FieldValue.serverTimestamp(), dismissedBy: systemActor, dismissReason: "camera_physically_moved", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    const eventId = canonicalHash("camera-physically-moved", input.publicationKey, work.id);
    transaction.create(work.ref.collection("events").doc(eventId), {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: work.id, type: "dismissed",
      fromStatus: data.status, toStatus: "dismissed", cleanerId: data.assignedCleanerId, previousCleanerId: null,
      actor: systemActor, reasonCode: "camera_physically_moved", note: null, evidenceMediaIds: [], requestId: input.requestId,
      occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null,
    });
    transaction.delete(firestore.collection("activeWorkOrderKeys").doc(canonicalHash("v2-active-work", input.siteId, data.alertId ?? work.id)));
    transaction.delete(firestore.collection("activeWorkOrderKeys").doc(canonicalHash("v2-active-manual-work", input.siteId, work.id)));
    const cleaner = current.cleaners.get(String(data.assignedCleanerId));
    if (cleaner?.exists && cleaner.data()?.activeWorkOrderId === work.id) transaction.update(cleaner.ref, { activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    const recipientUid = cleaner?.data()?.authUid;
    if (typeof recipientUid === "string" && recipientUid) createV2NotificationInTransaction(transaction, {
      siteId: input.siteId, recipientUid, recipientRole: "cleaner", type: "work_dismissed", eventKey: eventId,
      title: "Cleaning task dismissed", body: "This task was dismissed because its Camera was physically moved.",
      entityType: "work_order", entityId: work.id, cameraId: input.cameraId, alertId: data.alertId ?? null, workOrderId: work.id,
      severity: data.severity ?? null, isSimulation: Boolean(data.isSimulation),
    });
  }
  return { alertCount: current.alerts.length, workCount: current.work.length };
}
