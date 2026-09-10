import { createHash, randomUUID } from "node:crypto";
import { publishCameraWorkflow } from "./cameraLiveEvents.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { FieldValue, Timestamp, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { canonicalHash, assertExpectedRevision } from "./v2Persistence.js";
import { v2AuditEventData, type AuditActor } from "./v2AuditService.js";
import { deriveCleanerAvailability } from "./v2CleanerAvailability.js";
import { containingPolygon, pointInMapBounds, type MapPoint, type Polygon } from "./v2MapGeometry.js";
import { applyVerification, canTransitionWork, requiresCompletionEvidence } from "./v2WorkPolicy.js";
import { getV2LiveIssueState, clearV2EvidenceCandidate } from "./v2LiveMonitoringService.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { writeMedia } from "./localMediaStorage.js";
import type { V2LiveObservation } from "./v2LiveMonitoringService.js";
import { enqueueV2OrchestratorTriggerInTransaction } from "./v2OrchestratorTriggers.js";
import { readOrchestrationGuard, commitOrchestration, OrchestrationConflict, type OrchestrationCommand } from "./v2OrchestratorCommit.js";
import { v2Json } from "./v2Presentation.js";
import { createV2NotificationInTransaction, notifyV2SiteSupervisors } from "./v2NotificationService.js";
import { updateCameraRuntimeSnapshot } from "./monitoringRuntimeRegistry.js";

function workNotification(tx: Transaction, data: DocumentData, uid: string | undefined, workOrderId: string, type: string, eventKey: string, body: string) {
  if (!uid) return;
  createV2NotificationInTransaction(tx, {
    siteId: data.siteId, recipientUid: uid, recipientRole: "cleaner", type, eventKey, title: type === "work_rework" ? "More cleaning required" : type === "work_resolved" ? "Cleaning task completed" : type === "work_assigned" ? "New cleaning assignment" : "Cleaning task dismissed",
    body, entityType: "work_order", entityId: workOrderId, cameraId: data.cameraId ?? null, alertId: data.alertId ?? null, workOrderId,
    severity: data.severity ?? null, isSimulation: Boolean(data.isSimulation),
  });
}

export type V2WorkActor = AuditActor & { type: "supervisor" | "cleaner" | "orchestrator"; cleanerId?: string };
const ACTIVE = ["assigned", "in_progress", "awaiting_review"] as const;
const instant = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
const hash = (namespace: string, ...values: unknown[]) => canonicalHash(namespace, ...values);
type V2WorkOrder = Record<string, any>;
const verificationSampleCount = (issueType: string) => issueType === "floor_litter" ? 3 : 2;

type VerificationSample = {
  sampleId: string;
  capturedAtMs: number;
  result: "clear" | "positive" | "inconclusive";
  modelVersions: Record<string, string>;
};

type CameraVerificationCollector = {
  siteId: string;
  cameraId: string;
  workOrderId: string;
  verificationId: string;
  issueType: string;
  managementMode: string;
  origin: string;
  requestedAtMs: number;
  requiredSampleCount: number;
  samples: VerificationSample[];
};

const cameraVerificationCollectors = new Map<string, Map<string, CameraVerificationCollector>>();

function registerCameraVerificationCollector(collector: Omit<CameraVerificationCollector, "samples"> & { samples?: VerificationSample[] }) {
  const byWork = cameraVerificationCollectors.get(collector.cameraId) ?? new Map<string, CameraVerificationCollector>();
  const current = byWork.get(collector.workOrderId);
  if (current?.verificationId === collector.verificationId) return;
  byWork.set(collector.workOrderId, { ...collector, samples: collector.samples ?? [] });
  cameraVerificationCollectors.set(collector.cameraId, byWork);
}

function removeCameraVerificationCollector(cameraId: string, workOrderId: string) {
  const byWork = cameraVerificationCollectors.get(cameraId);
  if (!byWork) return;
  byWork.delete(workOrderId);
  if (byWork.size === 0) cameraVerificationCollectors.delete(cameraId);
}

export function clearV2CameraVerificationCollectors(cameraId: string) {
  cameraVerificationCollectors.delete(cameraId);
}

export function resetV2CameraVerificationCollectors() {
  cameraVerificationCollectors.clear();
}

export function inspectV2CameraVerificationCollectors(cameraId?: string) {
  if (cameraId) return cameraVerificationCollectors.get(cameraId)?.size ?? 0;
  return [...cameraVerificationCollectors.values()].reduce((sum, entries) => sum + entries.size, 0);
}

export async function recoverV2CameraVerificationCollectors() {
  resetV2CameraVerificationCollectors();
  const works = await firestore.collection("workOrders").where("status", "==", "awaiting_review").limit(500).get();
  let recovered = 0;
  for (const work of works.docs) {
    const data = work.data();
    if (data.schemaVersion !== V2_SCHEMA_VERSION || data.origin !== "alert" || data.target?.type !== "camera" || !data.cameraId || !data.latestVerificationId) continue;
    const verification = await work.ref.collection("verifications").doc(String(data.latestVerificationId)).get();
    const verificationData = verification.data();
    if (!verification.exists || verificationData?.status !== "collecting") continue;
    registerCameraVerificationCollector({
      siteId: String(data.siteId), cameraId: String(data.cameraId), workOrderId: work.id,
      verificationId: verification.id, issueType: String(data.issueType), managementMode: String(data.managementMode),
      origin: String(data.origin), requestedAtMs: Number(verificationData.requestedAt?.toMillis?.() ?? 0),
      requiredSampleCount: Number(verificationData.requiredSampleCount ?? verificationSampleCount(String(data.issueType))),
    });
    recovered += 1;
  }
  return recovered;
}

function actorMap(actor: V2WorkActor) {
  return actor.type === "orchestrator"
    ? { type: "orchestrator", serviceId: actor.uid, displayNameSnapshot: actor.displayName }
    : { type: "human", uid: actor.uid, role: actor.role, authority: actor.authority ?? null, displayNameSnapshot: actor.displayName };
}

function present(id: string, data: DocumentData): V2WorkOrder {
  return {
    id,
    ...data,
    createdAt: instant(data.createdAt), updatedAt: instant(data.updatedAt), assignedAt: instant(data.assignedAt),
    startedAt: instant(data.startedAt), submittedAt: instant(data.submittedAt), resolvedAt: instant(data.resolvedAt), dismissedAt: instant(data.dismissedAt),
  };
}

function syncCameraWorkRuntime(work: V2WorkOrder) {
  if (!work.cameraId || !work.siteId) return;
  const cleanlinessState = work.status === "awaiting_review" ? "awaiting_review"
    : work.status === "resolved" || work.status === "dismissed" ? "clean"
      : "cleaning_in_progress";
  updateCameraRuntimeSnapshot(String(work.siteId), String(work.cameraId), { cleanlinessState });
}

async function readSite(siteId: string, transaction?: Transaction) {
  const ref = firestore.collection("sites").doc(siteId);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  return { ref, snapshot, data: snapshot.data()! };
}

async function readCleaner(siteId: string, cleanerId: string, transaction?: Transaction) {
  const ref = firestore.collection("cleaners").doc(cleanerId);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.data()?.schemaVersion !== 2 || snapshot.data()?.siteId !== siteId) throw new HttpError(404, "Cleaner not found.");
  return { ref, snapshot, data: snapshot.data()! };
}

async function readStation(siteId: string, cleanerId: string, mapRevisionId: string, transaction?: Transaction) {
  const ref = firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cleanerStations").doc(cleanerId);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  return snapshot.exists && snapshot.data()?.siteId === siteId && snapshot.data()?.point ? snapshot.data()! : null;
}

function assertCleanerAvailable(site: DocumentData, cleaner: DocumentData, station: DocumentData | null) {
  if (cleaner.status !== "active" || !cleaner.authUid) throw new HttpError(409, "Cleaner is inactive or has no active account.");
  if (cleaner.activeWorkOrderId) throw new HttpError(409, "Cleaner already has an active Work Order.");
  const availability = deriveCleanerAvailability({ siteActive: site.status === "active", accountActive: true, cleanerActive: cleaner.status === "active", availabilityOverride: cleaner.availabilityOverride === "unavailable" ? "unavailable" : "none", activeWorkOrderId: null, stationPointValid: Boolean(station), schedule: cleaner.weeklySchedule ?? {}, scheduleTimeZone: String(cleaner.scheduleTimeZone ?? site.timeZone ?? "Asia/Kuala_Lumpur") });
  if (!availability.available) throw new HttpError(409, `Cleaner is unavailable: ${availability.reasons.join(", ")}.`);
}

async function cameraTarget(siteId: string, cameraId: string, transaction?: Transaction) {
  const cameraRef = firestore.collection("cameras").doc(cameraId);
  const camera = transaction ? await transaction.get(cameraRef) : await cameraRef.get();
  if (!camera.exists || camera.data()?.schemaVersion !== 2 || camera.data()?.siteId !== siteId || camera.data()?.status !== "active") throw new HttpError(404, "Camera not found.");
  const site = await readSite(siteId, transaction);
  const mapRevisionId = String(site.data.activeMapRevisionId ?? "");
  const placementRef = firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cameraPlacements").doc(cameraId);
  const placement = transaction ? await transaction.get(placementRef) : await placementRef.get();
  if (!placement.exists || placement.data()?.siteId !== siteId || !placement.data()?.zoneId) throw new HttpError(409, "Camera Placement is missing from the Active Map Revision.");
  return { site, camera, mapRevisionId, placement: placement.data()! };
}

async function coordinateTarget(siteId: string, point: MapPoint, transaction?: Transaction) {
  const site = await readSite(siteId, transaction);
  const mapRevisionId = String(site.data.activeMapRevisionId ?? "");
  const revisionRef = firestore.collection("siteMapRevisions").doc(mapRevisionId);
  const zonesRef = firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("zoneGeometry");
  const [revision, zones] = transaction
    ? await Promise.all([transaction.get(revisionRef), transaction.get(zonesRef)])
    : await Promise.all([revisionRef.get(), zonesRef.get()]);
  if (!revision.exists || revision.data()?.siteId !== siteId) throw new HttpError(409, "The Active Site Map is unavailable.");
  if (!pointInMapBounds(point, Number(revision.data()?.widthMeters), Number(revision.data()?.heightMeters))) throw new HttpError(400, "Coordinate target must be inside the Site Map boundary.");
  const zoneId = containingPolygon(point, zones.docs.map((doc) => ({ id: doc.id, polygon: doc.data().polygon as Polygon })));
  const zone = zoneId ? zones.docs.find((doc) => doc.id === zoneId) : null;
  return { site, mapRevisionId, zoneId, zoneName: zone ? String(zone.data().zoneNameSnapshot ?? zoneId) : "Unzoned area" };
}

function deterministicInstructions(alert: DocumentData) {
  const camera = String(alert.cameraNameSnapshot ?? "Camera"); const zone = String(alert.zoneNameSnapshot ?? "Zone");
  if (alert.issueType === "bin_service") return `Service ${(alert.affectedBinIds ?? []).map(String).join(", ") || "the registered bin"} at ${camera}, ${zone}`;
  if (alert.issueType === "floor_spill") return `Clean floor spill at ${camera}, ${zone}`;
  return `Clean floor litter at ${camera}, ${zone}`;
}

function workTargetFromAlert(alert: DocumentData) {
  return { type: "camera", mapRevisionId: String(alert.mapRevisionId), zoneId: String(alert.zoneId), zoneNameSnapshot: String(alert.zoneNameSnapshot ?? alert.zoneId), point: alert.cameraPoint ?? null, cameraId: String(alert.cameraId), cameraNameSnapshot: String(alert.cameraNameSnapshot ?? alert.cameraId) };
}

export async function createV2AlertWorkOrder(input: { siteId: string; alertId: string; assignedCleanerId: string; idempotencyKey: string }, actor: V2WorkActor, requestId: string, command?: OrchestrationCommand) {
  const workId = hash("v2-work-order", input.siteId, "alert", input.alertId, input.idempotencyKey);
  const requestFingerprint = hash("v2-work-request", input);
  const workRef = firestore.collection("workOrders").doc(workId);
  const activeKeyRef = firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-work", input.siteId, input.alertId));
  const auditRef = firestore.collection("auditEvents").doc();
  let replay: any = null;
  await firestore.runTransaction(async (transaction) => {
    const guard = command ? await readOrchestrationGuard(transaction, command) : null;
    if (guard?.replay) { replay = guard.replay.workOrder; return; }
    const [site, alert, cleaner, activeKey, existingWork] = await Promise.all([
      transaction.get(firestore.collection("sites").doc(input.siteId)), transaction.get(firestore.collection("alerts").doc(input.alertId)),
      transaction.get(firestore.collection("cleaners").doc(input.assignedCleanerId)), transaction.get(activeKeyRef), transaction.get(workRef),
    ]);
    if (existingWork.exists) { if (existingWork.data()?.requestFingerprint !== requestFingerprint) throw new HttpError(409, "Work idempotency key conflicts with another assignment."); return; }
    if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
    if (!alert.exists || alert.data()?.siteId !== input.siteId) throw new HttpError(404, "Alert not found.");
    const alertData = alert.data()!;
    if (command && (alertData.managementMode !== "orchestrated" || alertData.status !== "waiting_for_cleaner")) throw new OrchestrationConflict("alert_changed");
    if (command && (alertData.mapRevisionId !== guard!.data.inputSnapshot.activeMapRevisionId
      || Number(alertData.revision) !== Number(guard!.data.inputSnapshot.alerts.find((a: any) => a.alertId === input.alertId)?.revision))) throw new OrchestrationConflict("alert_changed");
    if (!["waiting_for_cleaner", "assigned"].includes(String(alertData.status)) || alertData.activeWorkOrderId) throw new HttpError(409, "Alert is not waiting for Cleaner assignment.");
    if (activeKey.exists) throw new HttpError(409, "Alert already has an active Work Order.");
    if (!cleaner.exists || cleaner.data()?.schemaVersion !== 2 || cleaner.data()?.siteId !== input.siteId) throw new HttpError(404, "Cleaner not found.");
    const account = await transaction.get(firestore.collection("userAccounts").doc(String(cleaner.data()?.authUid)));
    const station = await transaction.get(firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).collection("cleanerStations").doc(input.assignedCleanerId));
    const placement = await transaction.get(firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).collection("cameraPlacements").doc(String(alertData.cameraId)));
    const zoneGeometry = await transaction.get(firestore.collection("siteMapRevisions").doc(String(alertData.mapRevisionId)).collection("zoneGeometry").doc(String(alertData.zoneId)));
    if (!account.exists || account.data()?.status !== "active" || account.data()?.siteId !== input.siteId) throw new HttpError(409, "Cleaner account is inactive."); assertCleanerAvailable(site.data()!, cleaner.data()!, station.exists ? station.data()! : null);
    const storedZoneName = String(placement.data()?.zoneNameSnapshot ?? alertData.zoneNameSnapshot ?? "");
    const zoneNameSnapshot = storedZoneName && storedZoneName !== String(alertData.zoneId)
      ? storedZoneName
      : String(zoneGeometry.data()?.zoneNameSnapshot ?? alertData.zoneId);
    const normalizedAlert = { ...alertData, zoneNameSnapshot };
    const instructions = deterministicInstructions(normalizedAlert);
    const target = { ...workTargetFromAlert(normalizedAlert), point: placement.data()?.point ?? null, zoneNameSnapshot };
    const managementMode = actor.type === "orchestrator" ? "orchestrated" : "manual";
    const data = { schemaVersion: V2_SCHEMA_VERSION, workOrderId: workId, siteId: input.siteId, origin: "alert", alertId: input.alertId, managementMode, status: "assigned", severity: String(alertData.severity ?? "warning"), issueType: String(alertData.issueType), title: instructions, instructions, target, mapRevisionId: String(alertData.mapRevisionId), zoneId: String(alertData.zoneId), cameraId: String(alertData.cameraId), assignedCleanerId: input.assignedCleanerId, cleanerNameSnapshot: String(cleaner.data()!.fullName), assignedAt: FieldValue.serverTimestamp(), assignedBy: actorMap(actor), startedAt: null, submittedAt: null, resolvedAt: null, resolvedBy: null, dismissedAt: null, dismissedBy: null, dismissReason: null, creationEvidenceMediaId: null, completionEvidenceMediaId: null, latestVerificationId: null, latestVerificationOutcome: null, reworkCount: 0, isSimulation: Boolean(alertData.isSimulation), idempotencyKey: input.idempotencyKey, requestFingerprint, createdAt: FieldValue.serverTimestamp(), createdByUid: actor.type === "supervisor" ? actor.uid : null, updatedAt: FieldValue.serverTimestamp(), revision: 1 };
    if (command && guard) commitOrchestration(transaction, guard, command, { workOrder: { id: workId, ...data } });
    transaction.create(workRef, data);
    transaction.create(activeKeyRef, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, alertId: input.alertId, workOrderId: workId, cleanerId: input.assignedCleanerId, createdAt: FieldValue.serverTimestamp() });
    transaction.update(firestore.collection("cleaners").doc(input.assignedCleanerId), { activeWorkOrderId: workId, activeWorkAssignedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    transaction.update(alert.ref, { status: "assigned", managementMode, activeWorkOrderId: workId, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    transaction.set(firestore.collection("cameraRuntimeStates").doc(String(alertData.cameraId)), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: String(alertData.cameraId), cleanlinessState: "cleaning_in_progress", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.create(workRef.collection("events").doc(), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: workId, type: "assigned", fromStatus: "waiting_for_cleaner", toStatus: "assigned", cleanerId: input.assignedCleanerId, previousCleanerId: null, actor: actorMap(actor), reasonCode: "cleaner_assigned", note: null, evidenceMediaIds: [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    transaction.create(alert.ref.collection("events").doc(), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, alertId: input.alertId, type: "assigned", fromStatus: "waiting_for_cleaner", toStatus: "assigned", workOrderId: workId, actor: actorMap(actor), reasonCode: "cleaner_assigned", note: null, requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    workNotification(transaction, data, String(cleaner.data()!.authUid), workId, "work_assigned", workId, instructions);
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "work_order_assigned", resourceType: "WorkOrder", resourceId: workId, outcome: "succeeded", after: { alertId: input.alertId, cleanerId: input.assignedCleanerId }, requestId }));
  });
  if (replay) return v2Json(replay);
  const created = await getV2WorkOrder(input.siteId, workId);
  syncCameraWorkRuntime(created);
  if (created.cameraId) publishCameraWorkflow(input.siteId, String(created.cameraId));
  return created;
}

export async function createV2ManualWorkOrder(input: { siteId: string; title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: { type: "camera"; cameraId: string } | { type: "coordinate"; point: MapPoint }; creationEvidenceMediaId?: string | null; idempotencyKey: string }, actor: V2WorkActor, requestId: string) {
  const workId = hash("v2-work-order", input.siteId, "manual", input.idempotencyKey);
  const requestFingerprint = hash("v2-work-request", input);
  const workRef = firestore.collection("workOrders").doc(workId);
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const site = await transaction.get(firestore.collection("sites").doc(input.siteId));
    const existingWork = await transaction.get(workRef);
    if (existingWork.exists) { if (existingWork.data()?.requestFingerprint !== requestFingerprint) throw new HttpError(409, "Work idempotency key conflicts with another manual request."); return; }
    if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
    const cleaner = await transaction.get(firestore.collection("cleaners").doc(input.assignedCleanerId));
    if (!cleaner.exists || cleaner.data()?.schemaVersion !== 2 || cleaner.data()?.siteId !== input.siteId) throw new HttpError(404, "Cleaner not found.");
    const account = await transaction.get(firestore.collection("userAccounts").doc(String(cleaner.data()?.authUid))); const station = await transaction.get(firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).collection("cleanerStations").doc(input.assignedCleanerId));
    if (!account.exists || account.data()?.status !== "active" || account.data()?.siteId !== input.siteId) throw new HttpError(409, "Cleaner account is inactive."); assertCleanerAvailable(site.data()!, cleaner.data()!, station.exists ? station.data()! : null);
    let target: DocumentData; let mapRevisionId: string; let zoneId: string | null; let cameraId: string | null = null;
    if (input.target.type === "camera") { const result = await cameraTarget(input.siteId, input.target.cameraId, transaction); mapRevisionId = result.mapRevisionId; zoneId = String(result.placement.zoneId); cameraId = input.target.cameraId; target = { type: "camera", mapRevisionId, zoneId, zoneNameSnapshot: String(result.placement.zoneNameSnapshot ?? zoneId), point: result.placement.point, cameraId, cameraNameSnapshot: String(result.camera.data()?.name ?? cameraId) }; }
    else { const result = await coordinateTarget(input.siteId, input.target.point, transaction); mapRevisionId = result.mapRevisionId; zoneId = result.zoneId; target = { type: "coordinate", mapRevisionId, zoneId, zoneNameSnapshot: result.zoneName, point: input.target.point }; }
    const data = { schemaVersion: V2_SCHEMA_VERSION, workOrderId: workId, siteId: input.siteId, origin: "manual", alertId: null, managementMode: "manual", status: "assigned", severity: input.severity, issueType: "general_cleaning", title: input.title, instructions: input.instructions, target, mapRevisionId, zoneId, cameraId, assignedCleanerId: input.assignedCleanerId, cleanerNameSnapshot: String(cleaner.data()!.fullName), assignedAt: FieldValue.serverTimestamp(), assignedBy: actorMap(actor), startedAt: null, submittedAt: null, resolvedAt: null, resolvedBy: null, dismissedAt: null, dismissedBy: null, dismissReason: null, creationEvidenceMediaId: input.creationEvidenceMediaId ?? null, completionEvidenceMediaId: null, latestVerificationId: null, latestVerificationOutcome: null, reworkCount: 0, isSimulation: false, idempotencyKey: input.idempotencyKey, requestFingerprint, createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), revision: 1 };
    transaction.create(workRef, data);
    transaction.create(firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-manual-work", input.siteId, workId)), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: workId, cleanerId: input.assignedCleanerId, createdAt: FieldValue.serverTimestamp() });
    transaction.update(cleaner.ref, { activeWorkOrderId: workId, activeWorkAssignedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    transaction.create(workRef.collection("events").doc(), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: workId, type: "assigned", fromStatus: null, toStatus: "assigned", cleanerId: input.assignedCleanerId, previousCleanerId: null, actor: actorMap(actor), reasonCode: "manual_work_created", note: null, evidenceMediaIds: input.creationEvidenceMediaId ? [input.creationEvidenceMediaId] : [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    workNotification(transaction, data, String(cleaner.data()!.authUid), workId, "work_assigned", workId, input.title);
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "manual_work_created", resourceType: "WorkOrder", resourceId: workId, outcome: "succeeded", after: { targetType: input.target.type, cleanerId: input.assignedCleanerId }, requestId }));
  });
  const created = await getV2WorkOrder(input.siteId, workId);
  syncCameraWorkRuntime(created);
  if (created.cameraId) publishCameraWorkflow(input.siteId, String(created.cameraId));
  return created;
}

export async function getV2WorkOrder(siteId: string, workOrderId: string): Promise<V2WorkOrder> { const snapshot = await firestore.collection("workOrders").doc(workOrderId).get(); if (!snapshot.exists || snapshot.data()?.schemaVersion !== 2 || snapshot.data()?.siteId !== siteId) throw new HttpError(404, "Work Order not found."); return present(snapshot.id, snapshot.data()!); }

export async function listV2WorkOrdersPage(siteId: string, input: { status: string; cleanerId?: string; alertId?: string; zoneId?: string; cameraId?: string; origin?: "alert" | "manual"; limit: number; cursor?: string }) {
  const filters = { siteId, status: input.status, cleanerId: input.cleanerId ?? null, alertId: input.alertId ?? null, zoneId: input.zoneId ?? null, cameraId: input.cameraId ?? null, origin: input.origin ?? null };
  let baseQuery: FirebaseFirestore.Query = firestore.collection("workOrders").where("siteId", "==", siteId).where("schemaVersion", "==", 2);
  if (input.cleanerId) baseQuery = baseQuery.where("assignedCleanerId", "==", input.cleanerId);
  if (input.alertId) baseQuery = baseQuery.where("alertId", "==", input.alertId);
  if (input.zoneId) baseQuery = baseQuery.where("zoneId", "==", input.zoneId);
  if (input.cameraId) baseQuery = baseQuery.where("cameraId", "==", input.cameraId);
  if (input.origin) baseQuery = baseQuery.where("origin", "==", input.origin);
  let query = baseQuery;
  if (input.status === "active") query = query.where("status", "in", ACTIVE);
  else if (input.status !== "all") query = query.where("status", "==", input.status);
  const statuses = ["assigned", "in_progress", "awaiting_review", "resolved", "dismissed"] as const;
  const [page, ...counts] = await Promise.all([
    queryCursorPage({ query, totalQuery: query, resource: "workOrders", orderField: "updatedAt", filters, limit: Math.min(input.limit, 100), cursor: input.cursor, present: (doc) => present(doc.id, doc.data()) }),
    ...statuses.map((status) => baseQuery.where("status", "==", status).count().get()),
  ]);
  return { ...page, statusCounts: Object.fromEntries(statuses.map((status, index) => [status, counts[index].data().count])) as Record<typeof statuses[number], number> };
}
export async function listV2WorkOrders(siteId: string, input: { status: string; cleanerId?: string; alertId?: string; zoneId?: string; cameraId?: string; origin?: "alert" | "manual"; limit: number }) { return (await listV2WorkOrdersPage(siteId, input)).items; }

async function workContext(siteId: string, workOrderId: string, transaction: Transaction) {
  await readSite(siteId, transaction);
  const workRef = firestore.collection("workOrders").doc(workOrderId); const work = await transaction.get(workRef); if (!work.exists || work.data()?.schemaVersion !== 2 || work.data()?.siteId !== siteId) throw new HttpError(404, "Work Order not found.");
  const data = work.data()!; const cleanerRef = firestore.collection("cleaners").doc(String(data.assignedCleanerId)); const cleaner = await transaction.get(cleanerRef); const alertRef = data.alertId ? firestore.collection("alerts").doc(String(data.alertId)) : null; const alert = alertRef ? await transaction.get(alertRef) : null; return { workRef, work, data, cleanerRef, cleaner, alertRef, alert };
}

export async function transitionV2WorkOrder(siteId: string, workOrderId: string, next: "in_progress" | "awaiting_review", actor: V2WorkActor, input: { idempotencyKey: string; completionEvidenceMediaId?: string | null }, requestId: string) {
  const eventRef = firestore.collection("workOrders").doc(workOrderId).collection("events").doc(hash("v2-work-event", workOrderId, input.idempotencyKey));
  await firestore.runTransaction(async (transaction) => {
    const context = await workContext(siteId, workOrderId, transaction); const { data, workRef, cleaner, cleanerRef, alert, alertRef } = context;
    if (actor.type === "cleaner" && String(data.assignedCleanerId) !== actor.cleanerId) throw new HttpError(404, "Work Order not found.");
    if (eventRef && (await transaction.get(eventRef)).exists) return;
    if (!canTransitionWork(String(data.status) as any, next)) throw new HttpError(409, `Work Order cannot move from ${data.status} to ${next}.`);
    const manualWork = String(data.origin) === "manual";
    if (next === "awaiting_review" && requiresCompletionEvidence(String(data.origin) as "alert" | "manual") && !input.completionEvidenceMediaId) throw new HttpError(400, "Manual Work requires Completion Evidence before review.");
    if (next === "awaiting_review" && manualWork && input.completionEvidenceMediaId) {
      const evidence = await transaction.get(firestore.collection("mediaAssets").doc(input.completionEvidenceMediaId));
      const evidenceData = evidence.data();
      if (!evidence.exists || evidenceData?.siteId !== siteId || evidenceData?.purpose !== "work_completion_evidence" || evidenceData?.ownerType !== "work_order" || evidenceData?.ownerId !== workOrderId || evidenceData?.storageStatus !== "available") throw new HttpError(400, "Completion Evidence must belong to this Manual Work Order.");
    }
    const from = String(data.status); const fields = next === "in_progress" ? { startedAt: FieldValue.serverTimestamp() } : { submittedAt: FieldValue.serverTimestamp(), completionEvidenceMediaId: input.completionEvidenceMediaId ?? null, latestVerificationOutcome: null };
    const verificationRef = next === "awaiting_review" ? workRef.collection("verifications").doc(hash("v2-verification-request", workOrderId, input.idempotencyKey)) : null;
    if (verificationRef) transaction.create(verificationRef, { schemaVersion: V2_SCHEMA_VERSION, siteId, workOrderId, alertId: data.alertId ?? null, kind: manualWork ? "manual_supervisor" : "camera_deterministic", status: manualWork ? "ready" : "collecting", requestedAt: FieldValue.serverTimestamp(), requestedBy: actorMap(actor), requiredSampleCount: manualWork ? null : verificationSampleCount(String(data.issueType)), acceptedSampleCount: 0, sampleSummaries: [], outcome: null, outcomeReasonCodes: [], completionEvidenceMediaId: input.completionEvidenceMediaId ?? null, decidedAt: null, decidedBy: null, override: null, appliedAt: null, requestId });
    transaction.update(workRef, { status: next, ...fields, ...(verificationRef ? { latestVerificationId: verificationRef.id } : {}), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    if (next === "in_progress" && alertRef && alert?.exists && ["assigned", "waiting_for_cleaner"].includes(String(alert.data()?.status))) transaction.update(alertRef, { status: "in_progress", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    if (next === "awaiting_review" && alertRef && alert?.exists && String(data.managementMode) === "orchestrated") transaction.update(alertRef, { status: "awaiting_review", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
    if (data.cameraId) transaction.set(firestore.collection("cameraRuntimeStates").doc(String(data.cameraId)), { schemaVersion: V2_SCHEMA_VERSION, siteId, cameraId: String(data.cameraId), cleanlinessState: next === "awaiting_review" ? "awaiting_review" : "cleaning_in_progress", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.create(eventRef, { schemaVersion: V2_SCHEMA_VERSION, siteId, workOrderId, type: next === "in_progress" ? "started" : "submitted", fromStatus: from, toStatus: next, cleanerId: String(data.assignedCleanerId), previousCleanerId: null, actor: actorMap(actor), reasonCode: next, note: null, evidenceMediaIds: input.completionEvidenceMediaId ? [input.completionEvidenceMediaId] : [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    void cleaner; void cleanerRef;
  });
  const updated = await getV2WorkOrder(siteId, workOrderId);
  syncCameraWorkRuntime(updated);
  if (next === "awaiting_review" && updated.origin === "alert" && updated.target?.type === "camera" && updated.cameraId && updated.latestVerificationId) {
    registerCameraVerificationCollector({
      siteId, cameraId: String(updated.cameraId), workOrderId, verificationId: String(updated.latestVerificationId),
      issueType: String(updated.issueType), managementMode: String(updated.managementMode), origin: String(updated.origin),
      requestedAtMs: Date.parse(String(updated.submittedAt ?? new Date().toISOString())),
      requiredSampleCount: verificationSampleCount(String(updated.issueType)),
    });
  }
  if (updated.cameraId) publishCameraWorkflow(siteId, updated.cameraId);
  return updated;
}

export async function applyV2Verification(input: { siteId: string; workOrderId: string; outcome: "passed" | "failed" | "inconclusive"; reason?: string | null; expectedRevision: number; idempotencyKey: string; override?: boolean }, actor: V2WorkActor, requestId: string, command?: OrchestrationCommand) {
  const workRef = firestore.collection("workOrders").doc(input.workOrderId);
  let appliedVerificationId = "";
  let replay: any = null;
  await firestore.runTransaction(async (transaction) => {
    const guard = command ? await readOrchestrationGuard(transaction, command) : null;
    if (guard?.replay) { replay = guard.replay; return; }
    const context = await workContext(input.siteId, input.workOrderId, transaction); const { data, alert, alertRef, cleanerRef } = context;
    const verificationRef = workRef.collection("verifications").doc(String(data.latestVerificationId ?? hash("v2-verification", input.workOrderId, input.idempotencyKey)));
    appliedVerificationId = verificationRef.id;
    const existing = await transaction.get(verificationRef); if (existing.exists && existing.data()?.status === "applied" && !input.override) return;
    if (command && (data.managementMode !== "orchestrated" || alert?.data()?.managementMode !== "orchestrated" || data.latestVerificationId !== command.verificationId
      || existing.data()?.status !== "ready" || existing.data()?.outcome !== command.outcome)) throw new OrchestrationConflict("review_changed");
    assertExpectedRevision(data, input.expectedRevision);
    if (String(data.status) !== "awaiting_review") throw new HttpError(409, "Work Order is not awaiting review.");
    if (!input.override && String(data.managementMode) === "manual" && actor.type !== "supervisor") throw new HttpError(403, "Manual Work requires Supervisor review.");
    const result = String(data.managementMode) === "manual" && actor.type === "supervisor"
      ? { workStatus: input.outcome === "passed" ? "resolved" as const : input.outcome === "failed" ? "in_progress" as const : "awaiting_review" as const, requiresSupervisorDecision: false }
      : applyVerification({ outcome: input.outcome, managementMode: String(data.managementMode) as any, origin: String(data.origin) as any });
    const eventType = input.outcome === "passed" ? "verification_passed" : input.outcome === "failed" ? "verification_failed" : "verification_inconclusive";
    if (result.workStatus === "resolved" || result.workStatus === "in_progress") {
      workNotification(transaction, data, context.cleaner.data()?.authUid, input.workOrderId, result.workStatus === "resolved" ? "work_resolved" : "work_rework",
        `${verificationRef.id}:${input.expectedRevision}:${input.outcome}`, result.workStatus === "resolved" ? "Your cleaning task has been completed." : "Review found that more cleaning is required. Continue the same task.");
    }
    if (actor.type === "supervisor" && !input.override) {
      const auditRef = firestore.collection("auditEvents").doc();
      transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, action: "work_verification_applied", resourceType: "WorkOrder", resourceId: input.workOrderId, outcome: "succeeded", after: { outcome: input.outcome }, requestId }));
    }
    if (existing.exists) transaction.update(verificationRef, { status: "applied", outcome: input.outcome, outcomeReasonCodes: input.reason ? [input.reason] : [], decidedAt: FieldValue.serverTimestamp(), decidedBy: actorMap(actor), override: input.override ? { outcome: input.outcome, reason: input.reason } : null, appliedAt: FieldValue.serverTimestamp(), requestId });
    else transaction.create(verificationRef, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: input.workOrderId, alertId: data.alertId ?? null, kind: data.origin === "manual" ? "manual_supervisor" : "camera_deterministic", status: "applied", requestedAt: FieldValue.serverTimestamp(), requestedBy: actorMap(actor), requiredSampleCount: null, acceptedSampleCount: 0, sampleSummaries: [], outcome: input.outcome, outcomeReasonCodes: input.reason ? [input.reason] : [], completionEvidenceMediaId: data.completionEvidenceMediaId ?? null, decidedAt: FieldValue.serverTimestamp(), decidedBy: actorMap(actor), override: input.override ? { outcome: input.outcome, reason: input.reason } : null, appliedAt: FieldValue.serverTimestamp(), requestId });
    const updates: Record<string, unknown> = { status: result.workStatus, latestVerificationId: verificationRef.id, latestVerificationOutcome: input.outcome, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1), ...(input.outcome === "failed" ? { reworkCount: FieldValue.increment(1) } : {}) };
    if (result.workStatus === "resolved") Object.assign(updates, { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: actorMap(actor) });
    if (command && guard) commitOrchestration(transaction, guard, command, { workOrder: { id: input.workOrderId, ...data, ...updates, revision: Number(data.revision) + 1,
      reworkCount: Number(data.reworkCount ?? 0) + (input.outcome === "failed" ? 1 : 0) }, verificationId: verificationRef.id });
    transaction.update(workRef, updates);
    transaction.create(workRef.collection("events").doc(), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: input.workOrderId, type: eventType, fromStatus: "awaiting_review", toStatus: result.workStatus, cleanerId: String(data.assignedCleanerId), previousCleanerId: null, actor: actorMap(actor), reasonCode: input.outcome, note: input.reason ?? null, evidenceMediaIds: data.completionEvidenceMediaId ? [data.completionEvidenceMediaId] : [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    if (alertRef && alert?.exists) {
      const alertStatus = result.workStatus === "resolved" ? "resolved" : result.workStatus === "in_progress" ? "in_progress" : "awaiting_review";
      transaction.update(alertRef, { status: alertStatus, ...(alertStatus === "resolved" ? { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: actorMap(actor), activeWorkOrderId: null } : {}), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
      if (alertStatus === "resolved") transaction.delete(firestore.collection("activeAlertKeys").doc(hash("v2-active-alert", input.siteId, data.cameraId, data.issueType)));
      transaction.create(alertRef.collection("events").doc(), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, alertId: data.alertId, type: alertStatus === "resolved" ? "resolved" : "awaiting_review", fromStatus: "awaiting_review", toStatus: alertStatus, workOrderId: input.workOrderId, actor: actorMap(actor), reasonCode: input.outcome, note: input.reason ?? null, requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    }
    if (result.workStatus === "resolved") { transaction.update(cleanerRef, { activeWorkOrderId: null, activeWorkAssignedAt: null, lastResolvedWorkOrderId: input.workOrderId, lastResolvedWorkTarget: data.target ?? null, lastResolvedWorkAt: FieldValue.serverTimestamp(), lastResolvedMapRevisionId: data.mapRevisionId ?? null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.delete(firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-work", input.siteId, data.alertId ?? input.workOrderId))); transaction.delete(firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-manual-work", input.siteId, input.workOrderId))); enqueueV2OrchestratorTriggerInTransaction(transaction, { siteId: input.siteId, type: "retry_waiting_alerts", aggregateType: "work_order", aggregateId: input.workOrderId, triggerType: "cleaner_released", uniquenessKey: `cleaner-released:${input.workOrderId}` }); }
    if (data.cameraId) transaction.set(firestore.collection("cameraRuntimeStates").doc(String(data.cameraId)), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: String(data.cameraId), cleanlinessState: result.workStatus === "resolved" ? "clean" : result.workStatus === "in_progress" ? "cleaning_in_progress" : "awaiting_review", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (input.override) transaction.create(firestore.collection("auditEvents").doc(), v2AuditEventData({ auditEventId: randomUUID(), actor, siteId: input.siteId, action: "verification_overridden", resourceType: "WorkOrder", resourceId: input.workOrderId, outcome: "succeeded", reason: input.reason, after: { outcome: input.outcome }, requestId }));
  });
  if (replay) return v2Json(replay);
  const workOrder = await getV2WorkOrder(input.siteId, input.workOrderId);
  syncCameraWorkRuntime(workOrder);
  if (workOrder.cameraId) removeCameraVerificationCollector(String(workOrder.cameraId), input.workOrderId);
  if (workOrder.cameraId && workOrder.status === "resolved") clearV2EvidenceCandidate(input.siteId, workOrder.cameraId, workOrder.issueType);
  if (workOrder.cameraId) publishCameraWorkflow(input.siteId, workOrder.cameraId);
  return { workOrder, verificationId: appliedVerificationId };
}

export async function dismissV2WorkOrder(input: { siteId: string; workOrderId: string; reason: string; expectedRevision: number; idempotencyKey: string }, actor: V2WorkActor, requestId: string) {
  await firestore.runTransaction(async (transaction) => { const context = await workContext(input.siteId, input.workOrderId, transaction); const { data, workRef, alert, alertRef, cleanerRef } = context; const eventRef = workRef.collection("events").doc(hash("v2-dismiss", input.workOrderId, input.idempotencyKey)); const existingEvent = await transaction.get(eventRef); if (existingEvent.exists) return; assertExpectedRevision(data, input.expectedRevision); if (![...ACTIVE].includes(String(data.status) as any)) throw new HttpError(409, "Work Order is already terminal."); const auditRef = firestore.collection("auditEvents").doc(); workNotification(transaction, data, context.cleaner.data()?.authUid, input.workOrderId, "work_dismissed", eventRef.id, "Your cleaning task has been dismissed."); if (data.alertId && data.cameraId) transaction.delete(firestore.collection("activeAlertKeys").doc(hash("v2-active-alert", input.siteId, data.cameraId, data.issueType))); transaction.update(workRef, { status: "dismissed", dismissedAt: FieldValue.serverTimestamp(), dismissedBy: actorMap(actor), dismissReason: input.reason, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.create(eventRef, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: input.workOrderId, type: "dismissed", fromStatus: data.status, toStatus: "dismissed", cleanerId: String(data.assignedCleanerId), previousCleanerId: null, actor: actorMap(actor), reasonCode: "supervisor_dismissed", note: input.reason, evidenceMediaIds: [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null }); transaction.update(cleanerRef, { activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.delete(firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-work", input.siteId, data.alertId ?? input.workOrderId))); transaction.delete(firestore.collection("activeWorkOrderKeys").doc(hash("v2-active-manual-work", input.siteId, input.workOrderId))); if (alertRef && alert?.exists) transaction.update(alertRef, { status: "dismissed", activeWorkOrderId: null, dismissedAt: FieldValue.serverTimestamp(), dismissedBy: actorMap(actor), dismissReason: input.reason, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); if (data.cameraId) transaction.set(firestore.collection("cameraRuntimeStates").doc(String(data.cameraId)), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: String(data.cameraId), cleanlinessState: "clean", updatedAt: FieldValue.serverTimestamp() }, { merge: true }); transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, action: "work_order_dismissed", resourceType: "WorkOrder", resourceId: input.workOrderId, outcome: "succeeded", reason: input.reason, before: { status: data.status }, after: { status: "dismissed" }, requestId })); });
  const dismissed = await getV2WorkOrder(input.siteId, input.workOrderId);
  syncCameraWorkRuntime(dismissed);
  if (dismissed.cameraId) {
    removeCameraVerificationCollector(String(dismissed.cameraId), input.workOrderId);
    publishCameraWorkflow(input.siteId, String(dismissed.cameraId));
  }
  return dismissed;
}

export async function reassignV2WorkOrder(input: { siteId: string; workOrderId: string; assignedCleanerId: string; reason: string; expectedRevision: number; idempotencyKey: string }, actor: V2WorkActor, requestId: string) {
  await firestore.runTransaction(async (transaction) => { const context = await workContext(input.siteId, input.workOrderId, transaction); const { data, workRef, cleaner: oldCleaner, cleanerRef: oldRef, alert } = context; const eventRef = workRef.collection("events").doc(hash("v2-reassign", input.workOrderId, input.idempotencyKey)); if ((await transaction.get(eventRef)).exists) return; assertExpectedRevision(data, input.expectedRevision); if (![...ACTIVE].includes(String(data.status) as any)) throw new HttpError(409, "Only active Work Orders can be reassigned."); const newCleaner = await transaction.get(firestore.collection("cleaners").doc(input.assignedCleanerId)); if (!newCleaner.exists || newCleaner.data()?.schemaVersion !== 2 || newCleaner.data()?.siteId !== input.siteId) throw new HttpError(404, "Replacement Cleaner not found."); const site = await transaction.get(firestore.collection("sites").doc(input.siteId)); const account = await transaction.get(firestore.collection("userAccounts").doc(String(newCleaner.data()?.authUid))); const station = await transaction.get(firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).collection("cleanerStations").doc(input.assignedCleanerId)); if (!account.exists || account.data()?.status !== "active") throw new HttpError(409, "Replacement Cleaner account is inactive."); assertCleanerAvailable(site.data()!, newCleaner.data()!, station.exists ? station.data()! : null); const auditRef = firestore.collection("auditEvents").doc(); workNotification(transaction, data, oldCleaner.data()?.authUid, input.workOrderId, "work_reassigned", eventRef.id, "This task is no longer assigned to you."); workNotification(transaction, data, newCleaner.data()?.authUid, input.workOrderId, "work_assigned", eventRef.id, "A cleaning task has been assigned to you."); transaction.update(oldRef, { activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.update(newCleaner.ref, { activeWorkOrderId: input.workOrderId, activeWorkAssignedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.update(workRef, { assignedCleanerId: input.assignedCleanerId, cleanerNameSnapshot: String(newCleaner.data()?.fullName), assignedAt: FieldValue.serverTimestamp(), assignedBy: actorMap(actor), managementMode: "manual", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); if (alert?.exists) transaction.update(alert.ref, { managementMode: "manual", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.create(eventRef, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, workOrderId: input.workOrderId, type: "reassigned", fromStatus: data.status, toStatus: data.status, cleanerId: input.assignedCleanerId, previousCleanerId: String(oldCleaner.data()?.cleanerId ?? data.assignedCleanerId), actor: actorMap(actor), reasonCode: "supervisor_reassigned", note: input.reason, evidenceMediaIds: [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null }); transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, action: "work_order_reassigned", resourceType: "WorkOrder", resourceId: input.workOrderId, outcome: "succeeded", reason: input.reason, before: { cleanerId: data.assignedCleanerId }, after: { cleanerId: input.assignedCleanerId }, requestId })); });
  const reassigned = await getV2WorkOrder(input.siteId, input.workOrderId);
  if (reassigned.cameraId) publishCameraWorkflow(input.siteId, String(reassigned.cameraId));
  return reassigned;
}

export async function takeOverV2WorkOrder(siteId: string, workOrderId: string, actor: V2WorkActor, reason: string, idempotencyKey: string, requestId: string) { await firestore.runTransaction(async (transaction) => { const context = await workContext(siteId, workOrderId, transaction); const { data, workRef, alert } = context; const eventRef = workRef.collection("events").doc(hash("v2-takeover", workOrderId, idempotencyKey)); if ((await transaction.get(eventRef)).exists) return; if (String(data.managementMode) === "manual") return; const auditRef = firestore.collection("auditEvents").doc(); transaction.update(workRef, { managementMode: "manual", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); if (alert?.exists) transaction.update(alert.ref, { managementMode: "manual", updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.create(eventRef, { schemaVersion: V2_SCHEMA_VERSION, siteId, workOrderId, type: "takeover", fromStatus: data.status, toStatus: data.status, cleanerId: String(data.assignedCleanerId), previousCleanerId: null, actor: actorMap(actor), reasonCode: "supervisor_takeover", note: reason, evidenceMediaIds: [], requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null }); transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, action: "work_order_takeover", resourceType: "WorkOrder", resourceId: workOrderId, outcome: "succeeded", reason, before: { managementMode: data.managementMode }, after: { managementMode: "manual" }, requestId })); }); const work = await getV2WorkOrder(siteId, workOrderId); if (work.cameraId) publishCameraWorkflow(siteId, String(work.cameraId)); return work; }

export async function listV2WorkEventsPage(siteId: string, workOrderId: string, input: { limit: number; cursor?: string }) { await getV2WorkOrder(siteId, workOrderId); const query = firestore.collection("workOrders").doc(workOrderId).collection("events"); return queryCursorPage({ query, totalQuery: query, resource: `workEvents:${workOrderId}`, orderField: "occurredAt", filters: { siteId, workOrderId }, limit: input.limit, cursor: input.cursor, present: (doc) => ({ id: doc.id, ...doc.data() }) }); }
export async function listV2WorkEvents(siteId: string, workOrderId: string) { return (await listV2WorkEventsPage(siteId, workOrderId, { limit: 100 })).items; }

export async function listV2VerificationsPage(siteId: string, workOrderId: string, input: { limit: number; cursor?: string }) {
  await getV2WorkOrder(siteId, workOrderId);
  const query = firestore.collection("workOrders").doc(workOrderId).collection("verifications");
  return queryCursorPage({ query, totalQuery: query, resource: `workVerifications:${workOrderId}`, orderField: "requestedAt", filters: { siteId, workOrderId }, limit: input.limit, cursor: input.cursor, present: (doc) => ({ id: doc.id, ...doc.data() }) });
}
export async function listV2Verifications(siteId: string, workOrderId: string) { return (await listV2VerificationsPage(siteId, workOrderId, { limit: 20 })).items; }

export async function uploadV2CompletionEvidence(input: { siteId: string; workOrderId: string; cleanerId: string; file: { buffer: Buffer; mimetype: string; originalname: string } }) {
  const work = await getV2WorkOrder(input.siteId, input.workOrderId); if (work.assignedCleanerId !== input.cleanerId || work.status !== "in_progress" || work.origin !== "manual") throw new HttpError(409, "Completion Evidence is only accepted for the assigned Manual Work Order in progress.");
  const detected = detectSupportedImage(input.file.buffer); validateDeclaredImageType(input.file.mimetype, detected.mimeType); const mediaId = randomUUID(); const storageKey = `media/${mediaId}/completion-evidence.${detected.extension}`; await writeMedia(storageKey, input.file.buffer); await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: V2_SCHEMA_VERSION, mediaId, siteId: input.siteId, purpose: "work_completion_evidence", ownerType: "work_order", ownerId: input.workOrderId, cameraId: null, mimeType: detected.mimeType, originalFileName: input.file.originalname, byteSize: input.file.buffer.length, sha256: hash("v2-media", input.file.buffer.toString("base64")), storageKey, storageStatus: "available", width: null, height: null, durationSeconds: null, capturedAt: FieldValue.serverTimestamp(), retentionClass: "operational", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: input.cleanerId, deletedAt: null, revision: 1 }); return { mediaId, workOrderId: input.workOrderId };
}

export async function recordV2CameraVerificationObservation(siteId: string, cameraId: string, observation: V2LiveObservation) {
  const collectors = [...(cameraVerificationCollectors.get(cameraId)?.values() ?? [])].filter((collector) => collector.siteId === siteId);
  if (collectors.length === 0) return 0;
  let ready = 0;
  for (const collector of collectors) {
    if (observation.capturedAtMs < collector.requestedAtMs
      || collector.samples.some((sample) => sample.sampleId === observation.sampleId)
      || collector.samples.some((sample) => sample.capturedAtMs >= observation.capturedAtMs)) continue;
    let result: "clear" | "positive" | "inconclusive";
    if (collector.issueType === "bin_service") result = observation.binStates.some(bin => bin.state === "full" || bin.state === "overflow") ? "positive" : observation.binStates.length > 0 && observation.binStates.every(bin => bin.state === "normal") ? "clear" : "inconclusive";
    else result = observation.issues.some(issue => issue.issueType === collector.issueType) ? "positive" : "clear";
    collector.samples = [...collector.samples, { sampleId: observation.sampleId, capturedAtMs: observation.capturedAtMs, result, modelVersions: observation.modelVersions }].slice(-3);
    const clearCount = collector.samples.filter(sample => sample.result === "clear").length;
    const outcome = result === "positive" ? "failed" : result === "inconclusive" ? "inconclusive" : clearCount >= collector.requiredSampleCount ? "passed" : null;
    if (!outcome) continue;
    const workRef = firestore.collection("workOrders").doc(collector.workOrderId);
    const changed = await firestore.runTransaction(async tx => {
      const [work, site] = await Promise.all([tx.get(workRef), tx.get(firestore.collection("sites").doc(siteId))]);
      const data = work.data();
      if (site.data()?.status !== "active" || !data || data.schemaVersion !== 2 || data.status !== "awaiting_review" || data.latestVerificationId !== collector.verificationId) return false;
      const verificationRef = workRef.collection("verifications").doc(collector.verificationId);
      const verification = await tx.get(verificationRef);
      const v = verification.data();
      if (!v || v.status !== "collecting") return false;
      const persistedSamples = collector.samples.map((sample) => ({ sampleId: sample.sampleId, capturedAt: Timestamp.fromMillis(sample.capturedAtMs), result: sample.result, modelVersions: sample.modelVersions }));
      tx.update(verificationRef, { sampleSummaries: persistedSamples, acceptedSampleCount: persistedSamples.length,
        status: "ready", outcome, outcomeReasonCodes: [result === "positive" ? "issue_still_visible" : result === "inconclusive" ? "camera_evidence_inconclusive" : "required_clear_samples_observed"], decidedAt: FieldValue.serverTimestamp() });
      tx.update(workRef, { latestVerificationOutcome: outcome, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
      if (data.managementMode === "orchestrated" && data.origin === "alert") enqueueV2OrchestratorTriggerInTransaction(tx, {
        siteId, type: "review_work", aggregateType: "work_order", aggregateId: workRef.id,
        triggerType: "verification_ready", uniquenessKey: verificationRef.id, verificationId: verificationRef.id,
      });
      return true;
    });
    removeCameraVerificationCollector(cameraId, collector.workOrderId);
    if (changed) ready++;
  }
  return ready;
}
