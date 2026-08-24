import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { AuthenticatedCleaner } from "../middleware/authenticateUser.js";
import type {
  CreateWorkOrderInput,
  ReassignWorkOrderInput,
  TransitionWorkOrderInput,
  WorkOrderStatus,
} from "../schemas/cleanerOperations.js";
import { HttpError } from "../shared/httpError.js";
import { activeWorkOrderKeyId } from "../shared/workOrderKeys.js";
import { assertForwardAlertTransition, assertReviewAlertTransition } from "./alertTransitions.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { createNotificationInTransaction, deliverNotification } from "./notificationService.js";

const ACTIVE_WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "unassigned", "assigned", "accepted", "in_progress", "ready_for_review", "rework_required", "rejected",
];

type WorkOrderActor =
  | { type: "supervisor"; id: string }
  | { type: "orchestrator"; id: string }
  | { type: "cleaner"; id: string; cleaner: AuthenticatedCleaner };

function hash(namespace: string, ...parts: string[]) {
  return createHash("sha256").update(namespace).update("\0").update(parts.join("\0")).digest("hex");
}

function requestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function instant(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function presentWorkOrder(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) throw new HttpError(404, "Work order not found.");
  const data = snapshot.data()!;
  return {
    id: snapshot.id,
    alertId: String(data.alertId),
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot ?? ""),
    zoneId: String(data.zoneId),
    zoneName: String(data.zoneNameSnapshot ?? ""),
    issueType: String(data.issueType),
    status: String(data.status),
    assignedCleanerId: data.assignedCleanerId == null ? null : String(data.assignedCleanerId),
    assignedCleanerName: data.assignedCleanerNameSnapshot == null ? null : String(data.assignedCleanerNameSnapshot),
    assignedCleanerStaffCode: data.assignedCleanerStaffCodeSnapshot == null ? null : String(data.assignedCleanerStaffCodeSnapshot),
    assignmentAttempt: Number(data.assignmentAttempt ?? 0),
    instructions: String(data.instructions ?? ""),
    assignmentDecisionId: String(data.assignmentDecisionId ?? ""),
    readyForReviewEvidenceMediaIds: Array.isArray(data.readyForReviewEvidenceMediaIds)
      ? data.readyForReviewEvidenceMediaIds.map(String)
      : [],
    availabilityOverride: Boolean(data.availabilityOverride),
    assignedAt: instant(data.assignedAt),
    acceptedAt: instant(data.acceptedAt),
    startedAt: instant(data.startedAt),
    readyForReviewAt: instant(data.readyForReviewAt),
    completedAt: instant(data.completedAt),
    rejectedAt: instant(data.rejectedAt),
    cancelledAt: instant(data.cancelledAt),
    createdAt: instant(data.createdAt),
    updatedAt: instant(data.updatedAt),
  };
}

function activeWorkOrderKeyReference(alertId: string) {
  return firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId));
}

function assertActiveAlert(data: DocumentData | undefined) {
  if (!data || !["new", "acknowledged", "in_progress"].includes(String(data.status))) {
    throw new HttpError(409, "Work orders require an active alert.");
  }
}

function cleanerPermissionValues(data: DocumentData) {
  return {
    sites: Array.isArray(data.permittedSiteIds) ? data.permittedSiteIds.map(String) : [String(data.assignedSiteId)],
    zones: Array.isArray(data.permittedZoneIds) ? data.permittedZoneIds.map(String) : [String(data.assignedZoneId)],
    capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : ["general_cleaning"],
  };
}

function assertEligibleCleaner(options: {
  cleanerId: string;
  cleaner: DocumentData | undefined;
  presence: DocumentData | undefined;
  siteId: string;
  zoneId: string;
  issueType: string;
  overrideAvailability: boolean;
  currentWorkOrderId?: string;
}) {
  const data = options.cleaner;
  if (!data || data.status !== "active" || !["invited", "active"].includes(String(data.accountStatus)) || !data.authUid) {
    throw new HttpError(409, "Assigned Cleaner does not have an active linked account.");
  }
  const permissions = cleanerPermissionValues(data);
  if (!permissions.sites.includes(options.siteId) || !permissions.zones.includes(options.zoneId)) {
    throw new HttpError(409, "Assigned Cleaner is not permitted for this site and zone.");
  }
  if (!permissions.capabilities.includes("general_cleaning") && !permissions.capabilities.includes(options.issueType)) {
    throw new HttpError(409, "Assigned Cleaner lacks the required issue capability.");
  }
  const activeWorkOrderId = options.presence?.activeWorkOrderId;
  if (activeWorkOrderId && activeWorkOrderId !== options.currentWorkOrderId) {
    throw new HttpError(409, "Assigned Cleaner already has an active work order.");
  }
  if (!options.overrideAvailability && options.presence?.availability !== "online") {
    throw new HttpError(409, "Assigned Cleaner must be online unless the Supervisor explicitly overrides availability.");
  }
  const heartbeatAt = options.presence?.lastHeartbeatAt;
  if (!options.overrideAvailability && (!(heartbeatAt instanceof Timestamp)
    || Date.now() - heartbeatAt.toMillis() > 5 * 60_000)) {
    throw new HttpError(409, "Assigned Cleaner’s online heartbeat is stale; use an explicit Supervisor override only when appropriate.");
  }
  return {
    uid: String(data.authUid),
    name: String(data.fullName),
    staffCode: String(data.staffCode),
  };
}

export async function getWorkOrder(workOrderId: string) {
  return presentWorkOrder(await firestore.collection("workOrders").doc(workOrderId).get());
}

export async function createWorkOrder(input: CreateWorkOrderInput, actor: Extract<WorkOrderActor, { type: "supervisor" | "orchestrator" }>) {
  const fingerprint = requestFingerprint(input);
  const workOrderId = actor.type === "supervisor"
    ? hash("work-order-v1", actor.id, input.idempotencyKey)
    : hash("work-order-orchestrator-v1", actor.id, input.idempotencyKey);
  const workOrderReference = firestore.collection("workOrders").doc(workOrderId);
  const alertReference = firestore.collection("alerts").doc(input.alertId);
  const cleanerReference = firestore.collection("cleaners").doc(input.assignedCleanerId);
  const presenceReference = firestore.collection("cleanerPresence").doc(input.assignedCleanerId);
  const activeKeyReference = activeWorkOrderKeyReference(input.alertId);
  const decisionReference = firestore.collection("workOrderDecisions").doc(hash("work-order-decision-v1", input.assignmentDecisionId));

  const outcome = await firestore.runTransaction(async (transaction) => {
    const [workOrder, alert, cleaner, presence, activeKey, decision] = await Promise.all([
      transaction.get(workOrderReference),
      transaction.get(alertReference),
      transaction.get(cleanerReference),
      transaction.get(presenceReference),
      transaction.get(activeKeyReference),
      transaction.get(decisionReference),
    ]);
    if (workOrder.exists) {
      if (workOrder.data()?.idempotencyKey !== input.idempotencyKey
        || workOrder.data()?.alertId !== input.alertId
        || workOrder.data()?.requestFingerprint !== fingerprint) {
        throw new HttpError(409, "Work-order idempotency key conflicts with another request.");
      }
      return { created: false, notificationId: null as string | null };
    }
    if (!alert.exists) throw new HttpError(404, "Alert not found.");
    assertActiveAlert(alert.data());
    if (activeKey.exists) throw new HttpError(409, "This alert already has an active work order.");
    if (decision.exists) throw new HttpError(409, "Assignment decision has already been applied.");
    const assigned = assertEligibleCleaner({
      cleanerId: input.assignedCleanerId,
      cleaner: cleaner.data(),
      presence: presence.data(),
      siteId: String(alert.data()!.siteId),
      zoneId: String(alert.data()!.zoneId),
      issueType: String(alert.data()!.issueType),
      overrideAvailability: input.overrideAvailability,
    });
    const historyReference = workOrderReference.collection("statusHistory").doc(hash("work-order-history-v1", workOrderId, input.idempotencyKey));
    const attemptReference = workOrderReference.collection("assignmentAttempts").doc(hash("work-order-assignment-v1", workOrderId, input.assignmentDecisionId));
    const common = {
      alertId: alert.id,
      siteId: String(alert.data()!.siteId),
      siteNameSnapshot: String(alert.data()!.siteName ?? alert.data()!.siteNameSnapshot ?? ""),
      zoneId: String(alert.data()!.zoneId),
      zoneNameSnapshot: String(alert.data()!.zoneName ?? alert.data()!.zoneNameSnapshot ?? ""),
      issueType: String(alert.data()!.issueType),
    };
    transaction.create(workOrderReference, {
      ...common,
      status: "assigned",
      assignedCleanerId: cleaner.id,
      assignedCleanerUid: assigned.uid,
      assignedCleanerNameSnapshot: assigned.name,
      assignedCleanerStaffCodeSnapshot: assigned.staffCode,
      assignmentAttempt: 1,
      instructions: input.instructions,
      assignmentDecisionId: input.assignmentDecisionId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      availabilityOverride: input.overrideAvailability,
      assignedAt: FieldValue.serverTimestamp(),
      acceptedAt: null,
      startedAt: null,
      readyForReviewAt: null,
      readyForReviewEvidenceMediaIds: [],
      completedAt: null,
      rejectedAt: null,
      cancelledAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actor.id,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByType: actor.type,
      updatedById: actor.id,
    });
    transaction.create(activeKeyReference, { alertId: alert.id, workOrderId, createdAt: FieldValue.serverTimestamp() });
    transaction.create(decisionReference, { assignmentDecisionId: input.assignmentDecisionId, workOrderId, alertId: alert.id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(historyReference, {
      fromStatus: null,
      toStatus: "assigned",
      actorType: actor.type,
      actorId: actor.id,
      note: null,
      idempotencyKey: input.idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(attemptReference, {
      attempt: 1,
      cleanerId: cleaner.id,
      cleanerUid: assigned.uid,
      cleanerNameSnapshot: assigned.name,
      cleanerStaffCodeSnapshot: assigned.staffCode,
      assignmentDecisionId: input.assignmentDecisionId,
      instructions: input.instructions,
      actorType: actor.type,
      actorId: actor.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(presenceReference, {
      cleanerId: cleaner.id,
      availability: "busy",
      activeWorkOrderId: workOrderId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const notificationId = createNotificationInTransaction(transaction, {
      recipientUid: assigned.uid,
      recipientCleanerId: cleaner.id,
      type: "work_assigned",
      workOrderId,
      title: "New cleaning assignment",
      body: `${common.zoneNameSnapshot || "Assigned zone"}: ${input.instructions}`.slice(0, 500),
      idempotencyKey: input.idempotencyKey,
    });
    return { created: true, notificationId };
  });

  if (outcome.notificationId) await deliverNotification(outcome.notificationId);
  return { workOrder: await getWorkOrder(workOrderId), idempotent: !outcome.created };
}

function allowedTransition(actor: WorkOrderActor, from: WorkOrderStatus, to: WorkOrderStatus) {
  const cleaner: Partial<Record<WorkOrderStatus, WorkOrderStatus[]>> = {
    assigned: ["accepted", "rejected"],
    accepted: ["in_progress"],
    rework_required: ["in_progress"],
    in_progress: ["ready_for_review"],
  };
  const supervisor: Partial<Record<WorkOrderStatus, WorkOrderStatus[]>> = {
    assigned: ["accepted", "in_progress", "cancelled"],
    accepted: ["in_progress", "cancelled"],
    in_progress: ["ready_for_review", "cancelled"],
    ready_for_review: ["completed", "rework_required", "cancelled"],
    rework_required: ["in_progress", "cancelled"],
    rejected: ["cancelled"],
  };
  return (actor.type === "cleaner" ? cleaner : supervisor)[from]?.includes(to) ?? false;
}

export async function transitionWorkOrder(workOrderId: string, input: TransitionWorkOrderInput, actor: WorkOrderActor) {
  const reference = firestore.collection("workOrders").doc(workOrderId);
  const fingerprint = requestFingerprint({ ...input, actorType: actor.type, actorId: actor.id });
  const outcome = await firestore.runTransaction(async (transaction) => {
    const workOrder = await transaction.get(reference);
    if (!workOrder.exists) throw new HttpError(404, "Work order not found.");
    const data = workOrder.data()!;
    const alertReference = firestore.collection("alerts").doc(String(data.alertId));
    const historyReference = reference.collection("statusHistory").doc(hash("work-order-history-v1", workOrderId, input.idempotencyKey));
    const presenceReference = firestore.collection("cleanerPresence").doc(String(data.assignedCleanerId));
    const activeKeyReference = activeWorkOrderKeyReference(String(data.alertId));
    const [history, presence, activeKey, alert] = await Promise.all([
      transaction.get(historyReference),
      transaction.get(presenceReference),
      transaction.get(activeKeyReference),
      transaction.get(alertReference),
    ]);
    if (history.exists) {
      if (history.data()?.requestFingerprint !== fingerprint) throw new HttpError(409, "Transition idempotency key conflicts with another action.");
      return { duplicate: true, notificationId: null as string | null };
    }
    if (actor.type === "cleaner" && data.assignedCleanerId !== actor.cleaner.cleanerId) throw new HttpError(404, "Work order not found.");
    const currentStatus = String(data.status) as WorkOrderStatus;
    if (!allowedTransition(actor, currentStatus, input.status)) {
      throw new HttpError(409, `Work order cannot move from ${currentStatus} to ${input.status}.`);
    }
    const timestampFields: Partial<Record<WorkOrderStatus, string>> = {
      accepted: "acceptedAt",
      in_progress: "startedAt",
      ready_for_review: "readyForReviewAt",
      completed: "completedAt",
      rejected: "rejectedAt",
      cancelled: "cancelledAt",
    };
    const timestampField = timestampFields[input.status];
    transaction.update(reference, {
      status: input.status,
      ...(timestampField ? { [timestampField]: FieldValue.serverTimestamp() } : {}),
      ...(input.status === "ready_for_review" ? { readyForReviewEvidenceMediaIds: input.evidenceMediaIds ?? [] } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByType: actor.type,
      updatedById: actor.id,
    });
    transaction.create(historyReference, {
      fromStatus: currentStatus,
      toStatus: input.status,
      actorType: actor.type,
      actorId: actor.id,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (input.status === "in_progress" && alert.exists && ["new", "acknowledged"].includes(String(alert.data()?.status))) {
      const currentAlertStatus = String(alert.data()?.status) as "new" | "acknowledged";
      assertForwardAlertTransition(currentAlertStatus, "in_progress");
      transaction.update(alertReference, {
        status: "in_progress",
        statusUpdatedAt: FieldValue.serverTimestamp(),
        statusUpdatedByUid: actor.type === "cleaner" ? actor.cleaner.uid : actor.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(alertReference.collection("statusHistory").doc(randomUUID()), {
        previousStatus: currentAlertStatus,
        newStatus: "in_progress",
        actorType: actor.type,
        actorUid: actor.type === "cleaner" ? actor.cleaner.uid : actor.id,
        actorNameSnapshot: actor.type === "cleaner" ? actor.cleaner.displayName : "LitterSpot operator",
        actorEmailSnapshot: actor.type === "cleaner" ? actor.cleaner.email || null : null,
        note: input.note ?? null,
        changedAt: FieldValue.serverTimestamp(),
      });
    }
    if (input.status === "rework_required" && alert.exists && String(alert.data()?.status) === "awaiting_verification") {
      assertReviewAlertTransition("awaiting_verification", "in_progress");
      transaction.update(alertReference, {
        status: "in_progress",
        statusUpdatedAt: FieldValue.serverTimestamp(),
        statusUpdatedByUid: actor.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(alertReference.collection("statusHistory").doc(randomUUID()), {
        previousStatus: "awaiting_verification",
        newStatus: "in_progress",
        actorType: actor.type,
        actorUid: actor.id,
        actorNameSnapshot: actor.type === "cleaner" ? actor.cleaner.displayName : "LitterSpot operator",
        actorEmailSnapshot: actor.type === "cleaner" ? actor.cleaner.email || null : null,
        note: input.note ?? null,
        changedAt: FieldValue.serverTimestamp(),
      });
    }
    if (["rejected", "cancelled", "completed"].includes(input.status)
      && presence.exists && presence.data()?.activeWorkOrderId === workOrderId) {
      transaction.update(presenceReference, {
        availability: "online",
        activeWorkOrderId: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (["cancelled", "completed"].includes(input.status) && activeKey.exists && activeKey.data()?.workOrderId === workOrderId) {
      transaction.delete(activeKeyReference);
    }
    const notificationId = ["rework_required", "cancelled"].includes(input.status) && data.assignedCleanerUid
      ? createNotificationInTransaction(transaction, {
        recipientUid: String(data.assignedCleanerUid),
        recipientCleanerId: String(data.assignedCleanerId),
        type: input.status === "rework_required" ? "rework_required" : "work_cancelled",
        workOrderId,
        title: input.status === "rework_required" ? "Rework required" : "Cleaning assignment cancelled",
        body: input.note || (input.status === "rework_required" ? "Please review the work order and clean the area again." : "This assignment is no longer active."),
        idempotencyKey: input.idempotencyKey,
      })
      : null;
    return { duplicate: false, notificationId };
  });
  if (outcome.notificationId) await deliverNotification(outcome.notificationId);
  return { workOrder: await getWorkOrder(workOrderId), idempotent: outcome.duplicate };
}

export async function reassignWorkOrder(workOrderId: string, input: ReassignWorkOrderInput, actorUid: string) {
  const reference = firestore.collection("workOrders").doc(workOrderId);
  const fingerprint = requestFingerprint({ ...input, actorUid });
  const outcome = await firestore.runTransaction(async (transaction) => {
    const workOrder = await transaction.get(reference);
    if (!workOrder.exists) throw new HttpError(404, "Work order not found.");
    const data = workOrder.data()!;
    const historyReference = reference.collection("statusHistory").doc(hash("work-order-history-v1", workOrderId, input.idempotencyKey));
    const decisionReference = firestore.collection("workOrderDecisions").doc(hash("work-order-decision-v1", input.assignmentDecisionId));
    const cleanerReference = firestore.collection("cleaners").doc(input.assignedCleanerId);
    const newPresenceReference = firestore.collection("cleanerPresence").doc(input.assignedCleanerId);
    const oldPresenceReference = firestore.collection("cleanerPresence").doc(String(data.assignedCleanerId));
    const [history, decision, cleaner, newPresence, oldPresence] = await Promise.all([
      transaction.get(historyReference),
      transaction.get(decisionReference),
      transaction.get(cleanerReference),
      transaction.get(newPresenceReference),
      transaction.get(oldPresenceReference),
    ]);
    if (history.exists) {
      if (history.data()?.requestFingerprint !== fingerprint) throw new HttpError(409, "Reassignment idempotency key conflicts with another action.");
      return { duplicate: true, notificationId: null as string | null };
    }
    if (!["assigned", "rejected"].includes(String(data.status))) throw new HttpError(409, "Only assigned or rejected work can be reassigned.");
    if (data.assignedCleanerId === input.assignedCleanerId) throw new HttpError(409, "Choose a different Cleaner for reassignment.");
    if (decision.exists) throw new HttpError(409, "Assignment decision has already been applied.");
    const assigned = assertEligibleCleaner({
      cleanerId: input.assignedCleanerId,
      cleaner: cleaner.data(),
      presence: newPresence.data(),
      siteId: String(data.siteId),
      zoneId: String(data.zoneId),
      issueType: String(data.issueType),
      overrideAvailability: input.overrideAvailability,
      currentWorkOrderId: workOrderId,
    });
    const attempt = Number(data.assignmentAttempt ?? 0) + 1;
    const attemptReference = reference.collection("assignmentAttempts").doc(hash("work-order-assignment-v1", workOrderId, input.assignmentDecisionId));
    transaction.update(reference, {
      status: "assigned",
      assignedCleanerId: cleaner.id,
      assignedCleanerUid: assigned.uid,
      assignedCleanerNameSnapshot: assigned.name,
      assignedCleanerStaffCodeSnapshot: assigned.staffCode,
      assignmentAttempt: attempt,
      instructions: input.instructions,
      assignmentDecisionId: input.assignmentDecisionId,
      availabilityOverride: input.overrideAvailability,
      assignedAt: FieldValue.serverTimestamp(),
      acceptedAt: null,
      startedAt: null,
      readyForReviewAt: null,
      rejectedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByType: "supervisor",
      updatedById: actorUid,
    });
    transaction.create(decisionReference, { assignmentDecisionId: input.assignmentDecisionId, workOrderId, alertId: data.alertId, createdAt: FieldValue.serverTimestamp() });
    transaction.create(historyReference, {
      fromStatus: data.status,
      toStatus: "assigned",
      actorType: "supervisor",
      actorId: actorUid,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(attemptReference, {
      attempt,
      cleanerId: cleaner.id,
      cleanerUid: assigned.uid,
      cleanerNameSnapshot: assigned.name,
      cleanerStaffCodeSnapshot: assigned.staffCode,
      assignmentDecisionId: input.assignmentDecisionId,
      instructions: input.instructions,
      actorType: "supervisor",
      actorId: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (oldPresence.exists && oldPresence.data()?.activeWorkOrderId === workOrderId) {
      transaction.update(oldPresenceReference, { availability: "online", activeWorkOrderId: null, updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.set(newPresenceReference, {
      cleanerId: cleaner.id,
      availability: "busy",
      activeWorkOrderId: workOrderId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const notificationId = createNotificationInTransaction(transaction, {
      recipientUid: assigned.uid,
      recipientCleanerId: cleaner.id,
      type: "work_reassigned",
      workOrderId,
      title: "Cleaning assignment reassigned to you",
      body: input.instructions,
      idempotencyKey: input.idempotencyKey,
    });
    return { duplicate: false, notificationId };
  });
  if (outcome.notificationId) await deliverNotification(outcome.notificationId);
  return { workOrder: await getWorkOrder(workOrderId), idempotent: outcome.duplicate };
}

export async function listWorkOrders(input: {
  status: WorkOrderStatus | "active" | "all";
  alertId?: string;
  cleanerId?: string;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("workOrders");
  if (input.alertId) query = query.where("alertId", "==", input.alertId);
  else if (input.cleanerId) query = query.where("assignedCleanerId", "==", input.cleanerId);
  if (input.status === "active") query = query.where("status", "in", ACTIVE_WORK_ORDER_STATUSES);
  else if (input.status !== "all") query = query.where("status", "==", input.status);
  return queryCursorPage({
    query,
    resource: "work-orders",
    orderField: "createdAt",
    filters: { status: input.status, alertId: input.alertId, cleanerId: input.cleanerId },
    limit: input.limit,
    cursor: input.cursor,
    present: presentWorkOrder,
  });
}

export async function listWorkOrderHistory(workOrderId: string, input: { limit: number; cursor?: string }) {
  const workOrder = await firestore.collection("workOrders").doc(workOrderId).get();
  if (!workOrder.exists) throw new HttpError(404, "Work order not found.");
  const query: Query<DocumentData> = workOrder.ref.collection("statusHistory");
  return queryCursorPage({
    query,
    resource: `work-order-history:${workOrderId}`,
    orderField: "createdAt",
    filters: { workOrderId },
    limit: input.limit,
    cursor: input.cursor,
    present: (snapshot) => {
      const data = snapshot.data();
      return {
        id: snapshot.id,
        fromStatus: data.fromStatus == null ? null : String(data.fromStatus),
        toStatus: String(data.toStatus),
        actorType: String(data.actorType),
        actorId: String(data.actorId),
        note: data.note == null ? null : String(data.note),
        createdAt: instant(data.createdAt),
      };
    },
  });
}
