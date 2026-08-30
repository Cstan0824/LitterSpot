import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { canonicalHash } from "./v2Persistence.js";
import { createV2NotificationInTransaction } from "./v2NotificationService.js";
import { v2Json } from "./v2Presentation.js";
import { recordV2SystemEvent } from "./v2SystemService.js";

const stages = ["workOrders", "alerts", "cleaners", "orchestratorRuns", "orchestratorOutbox", "monitoringSessions", "monitoringEpisodes", "cameraRuntimeStates", "activeWorkOrderKeys", "activeAlertKeys"] as const;
const activeWork = ["assigned", "in_progress", "awaiting_review"];
const actor = { type: "system", serviceId: "site-deactivation", displayNameSnapshot: "Site deactivation" };

export async function getV2SiteOperation(siteId: string, operationId: string) {
  const doc = await firestore.collection("siteOperations").doc(operationId).get();
  if (!doc.exists || doc.data()?.schemaVersion !== 2 || doc.data()?.siteId !== siteId) throw new HttpError(404, "Site operation not found.");
  return v2Json({ id: doc.id, ...doc.data() });
}

/** A bounded, repeatable page. Site remains inactive until every stage completes. */
export async function reconcileV2SiteOperation(siteId: string, operationId: string, pageSize = 25) {
  const opRef = firestore.collection("siteOperations").doc(operationId);
  const op = await getV2SiteOperation(siteId, operationId);
  if (op.status === "completed") return op;
  if (op.type !== "deactivate") throw new HttpError(409, "Not a deactivation operation.");
  const stageIndex = Number(op.cursorState?.stage ?? 0);
  const collection = stages[stageIndex];
  if (!collection) throw new HttpError(409, "Invalid deactivation stage.");
  let query = firestore.collection(collection).where("siteId", "==", siteId).orderBy(FieldPath.documentId()).limit(Math.max(1, Math.min(pageSize, 100)));
  if (op.cursorState?.afterId) query = query.startAfter(op.cursorState.afterId);
  const page = await query.get();
  for (const row of page.docs) {
    await firestore.runTransaction(async (tx) => {
      const [site, operation, current] = await Promise.all([
        tx.get(firestore.collection("sites").doc(siteId)), tx.get(opRef), tx.get(row.ref),
      ]);
      if (operation.data()?.status === "completed") return;
      if (site.data()?.status !== "inactive" || site.data()?.deactivationOperationId !== operationId) throw new HttpError(409, "Site deactivation ownership changed.");
      if (!current.exists || current.data()?.siteId !== siteId || current.data()?.schemaVersion !== 2) return;
      const data = current.data()!;
      const now = FieldValue.serverTimestamp();
      if (collection === "workOrders" && activeWork.includes(data.status)) {
        const cleanerRef = firestore.collection("cleaners").doc(String(data.assignedCleanerId));
        const cleaner = await tx.get(cleanerRef);
        tx.update(row.ref, { status: "dismissed", dismissedAt: now, dismissedBy: actor, dismissReason: "site_deactivated", updatedAt: now, revision: FieldValue.increment(1) });
        tx.create(row.ref.collection("events").doc(canonicalHash("site-deactivated", operationId, row.id)), {
          schemaVersion: 2, siteId, workOrderId: row.id, type: "dismissed", fromStatus: data.status, toStatus: "dismissed", cleanerId: data.assignedCleanerId,
          previousCleanerId: null, actor, reasonCode: "site_deactivated", note: null, requestId: operationId, occurredAt: now,
          evidenceMediaIds: [], analyticsAppliedVersion: null, analyticsAppliedAt: null,
        });
        if (cleaner.data()?.siteId === siteId && cleaner.data()?.activeWorkOrderId === row.id) tx.update(cleanerRef, { activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: now, revision: FieldValue.increment(1) });
        if (cleaner.data()?.siteId === siteId && cleaner.data()?.authUid) createV2NotificationInTransaction(tx, {
          siteId, recipientUid: String(cleaner.data()?.authUid), recipientRole: "cleaner", type: "work_dismissed", eventKey: `${operationId}:${row.id}`,
          title: "Cleaning task dismissed", body: "The Site was deactivated. This task is closed.", entityType: "work_order", entityId: row.id,
          cameraId: data.cameraId ?? null, alertId: data.alertId ?? null, workOrderId: row.id, severity: data.severity ?? null, isSimulation: Boolean(data.isSimulation),
        });
      } else if (collection === "alerts" && ["waiting_for_cleaner", ...activeWork].includes(data.status)) {
        tx.update(row.ref, { status: "dismissed", activeWorkOrderId: null, dismissedAt: now, dismissedBy: actor, dismissReason: "site_deactivated", updatedAt: now, revision: FieldValue.increment(1) });
        tx.create(row.ref.collection("events").doc(canonicalHash("site-deactivated", operationId, row.id)), {
          schemaVersion: 2, siteId, alertId: row.id, type: "dismissed", fromStatus: data.status, toStatus: "dismissed", fromSeverity: data.severity ?? null, toSeverity: data.severity ?? null,
          workOrderId: data.activeWorkOrderId ?? null, actor, reasonCode: "site_deactivated", note: null, requestId: operationId, occurredAt: now, analyticsAppliedVersion: null, analyticsAppliedAt: null,
        });
      } else if (collection === "cleaners" && data.activeWorkOrderId) {
        tx.update(row.ref, { activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: now, revision: FieldValue.increment(1) });
      } else if (collection === "orchestratorRuns" && ["queued", "running"].includes(data.status)) {
        tx.update(row.ref, { status: "cancelled", resultCode: "site_deactivated", leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now });
      } else if (collection === "orchestratorOutbox" && ["pending", "claimed", "failed"].includes(data.status)) {
        tx.update(row.ref, { status: "cancelled", lastErrorCode: "site_deactivated", claimTokenHash: null, claimedBy: null, claimExpiresAt: null, updatedAt: now });
      } else if (collection === "monitoringSessions" && data.status === "active") {
        tx.update(row.ref, { status: "released", leaseExpiresAt: Timestamp.fromMillis(0), updatedAt: now });
      } else if (collection === "monitoringEpisodes" && !data.endedAt) {
        tx.update(row.ref, { status: "ended", endedAt: now, endReason: "site_deactivated", updatedAt: now });
      } else if (collection === "cameraRuntimeStates") {
        tx.update(row.ref, { connectionStatus: "offline", cleanlinessState: "unknown", updatedAt: now });
      } else if (collection === "activeWorkOrderKeys" || collection === "activeAlertKeys") {
        tx.delete(row.ref);
      }
    });
  }
  await firestore.runTransaction(async (tx) => {
    const latest = await tx.get(opRef);
    if (latest.data()?.status === "completed" || JSON.stringify(latest.data()?.cursorState ?? {}) !== JSON.stringify(op.cursorState ?? {})) return;
    const exhausted = page.size < Math.max(1, Math.min(pageSize, 100));
    const nextStage = exhausted ? stageIndex + 1 : stageIndex;
    const complete = nextStage === stages.length;
    tx.update(opRef, {
      status: complete ? "completed" : "running", cursorState: { stage: nextStage, afterId: exhausted ? null : page.docs.at(-1)!.id },
      [`counts.${collection}`]: FieldValue.increment(page.size), startedAt: latest.data()?.startedAt ?? FieldValue.serverTimestamp(),
      completedAt: complete ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp(), lastErrorCode: null,
    });
  });
  return getV2SiteOperation(siteId, operationId);
}

export async function recoverV2SiteOperations() {
  const ops = await firestore.collection("siteOperations").where("status", "in", ["pending", "running"]).limit(50).get();
  for (const doc of ops.docs) {
    if (doc.data().schemaVersion !== 2 || doc.data().type !== "deactivate") continue;
    try { await reconcileV2SiteOperation(String(doc.data().siteId), doc.id); }
    catch {
      await doc.ref.update({ lastErrorCode: "reconciliation_failed", updatedAt: FieldValue.serverTimestamp() });
      await recordV2SystemEvent(String(doc.data().siteId), "site_operation_failed");
    }
  }
}
