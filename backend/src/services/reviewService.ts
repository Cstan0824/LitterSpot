import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import type { AuthenticatedCleaner } from "../middleware/authenticateUser.js";
import type {
  CleanerReviewSubmissionInput,
  ReviewDecision,
  ReviewDecisionInput,
  ReviewRequestInput,
  ReviewRequestStatus,
} from "../schemas/review.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { activeWorkOrderKeyId } from "../shared/workOrderKeys.js";
import { assertReviewAlertTransition } from "./alertTransitions.js";
import { createNotificationInTransaction, deliverNotification } from "./notificationService.js";
import { getWorkOrder } from "./workOrderService.js";

type ReviewActor =
  | { type: "cleaner"; id: string; cleaner: AuthenticatedCleaner }
  | { type: "supervisor" | "orchestrator"; id: string };

function hash(namespace: string, ...parts: string[]) {
  return createHash("sha256").update(namespace).update("\0").update(parts.join("\0")).digest("hex");
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timestampJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(timestampJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestampJson(item)]));
  }
  return value;
}

function present(snapshot: DocumentSnapshot, label: string) {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return { id: snapshot.id, ...timestampJson(snapshot.data()) as Record<string, unknown> };
}

function requestReference(workOrderId: string, idempotencyKey: string) {
  return firestore.collection("workOrders").doc(workOrderId).collection("reviewRequests")
    .doc(hash("review-request-v1", workOrderId, idempotencyKey));
}

function reviewReference(workOrderId: string, idempotencyKey: string) {
  return firestore.collection("workOrders").doc(workOrderId).collection("reviews")
    .doc(hash("review-v1", workOrderId, idempotencyKey));
}

function evidenceIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function alertEvidenceIds(data: DocumentData) {
  return [data.firstEvidenceMediaId, data.latestEvidenceMediaId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function assertWorkOrderAlert(workOrder: DocumentData, alert: DocumentData, workOrderId: string, alertId: string) {
  if (String(workOrder.alertId) !== alertId) throw new HttpError(409, "Work order does not belong to this alert.");
  if (String(alertId) !== String(workOrder.alertId) || !alert) throw new HttpError(404, "Alert not found.");
  if (String(workOrderId).length === 0) throw new HttpError(400, "workOrderId is required.");
}

function assertReviewState(workOrder: DocumentData, alert: DocumentData) {
  if (String(workOrder.status) !== "ready_for_review") {
    throw new HttpError(409, "Work order must be ready for review.");
  }
  if (String(alert.status) !== "awaiting_verification") {
    throw new HttpError(409, "Alert must be awaiting verification.");
  }
}

export async function getReviewRequest(workOrderId: string, reviewRequestId: string) {
  return present(
    await firestore.collection("workOrders").doc(workOrderId).collection("reviewRequests").doc(reviewRequestId).get(),
    "Review request",
  );
}

export async function listReviewRequests(workOrderId: string, status: ReviewRequestStatus | "all" = "all", limit = 25) {
  let query = firestore.collection("workOrders").doc(workOrderId).collection("reviewRequests")
    .orderBy("createdAt", "desc").limit(limit);
  if (status !== "all") query = firestore.collection("workOrders").doc(workOrderId).collection("reviewRequests")
    .where("status", "==", status).orderBy("createdAt", "desc").limit(limit);
  const snapshot = await query.get();
  return snapshot.docs.map((item) => present(item, "Review request"));
}

export async function listReviews(workOrderId: string, limit = 25) {
  const snapshot = await firestore.collection("workOrders").doc(workOrderId).collection("reviews")
    .orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((item) => present(item, "Review"));
}

export async function getReviewContext(workOrderId: string) {
  const [workOrder, reviewRequests, reviews] = await Promise.all([
    getWorkOrder(workOrderId),
    listReviewRequests(workOrderId),
    listReviews(workOrderId),
  ]);
  return { workOrder, reviewRequests, reviews };
}

export async function submitCleanerForReview(
  workOrderId: string,
  input: CleanerReviewSubmissionInput,
  actor: { type: "cleaner"; id: string; cleaner: AuthenticatedCleaner },
) {
  const workOrderReference = firestore.collection("workOrders").doc(workOrderId);
  const alertIdHolder = { value: "" };
  const requestId = requestReference(workOrderId, input.idempotencyKey).id;
  const requestRef = requestReference(workOrderId, input.idempotencyKey);
  const requestFingerprint = fingerprint(input);
  let idempotent = false;

  await firestore.runTransaction(async (transaction) => {
    const workOrderSnapshot = await transaction.get(workOrderReference);
    if (!workOrderSnapshot.exists) throw new HttpError(404, "Work order not found.");
    const workOrder = workOrderSnapshot.data()!;
    if (String(workOrder.assignedCleanerId) !== actor.cleaner.cleanerId) throw new HttpError(404, "Work order not found.");
    const alertId = String(workOrder.alertId ?? "");
    alertIdHolder.value = alertId;
    const alertReference = firestore.collection("alerts").doc(alertId);
    const [alertSnapshot, existingRequest] = await Promise.all([
      transaction.get(alertReference),
      transaction.get(requestRef),
    ]);
    if (!alertSnapshot.exists) throw new HttpError(404, "Alert not found.");
    if (existingRequest.exists) {
      if (existingRequest.data()?.requestFingerprint !== requestFingerprint) {
        throw new HttpError(409, "Review submission idempotency key conflicts with another request.");
      }
      idempotent = true;
      return;
    }
    const alert = alertSnapshot.data()!;
    if (String(workOrder.status) !== "in_progress") throw new HttpError(409, "Work order must be in progress before review submission.");
    if (String(alert.status) !== "in_progress") throw new HttpError(409, "Alert must be in progress before review submission.");
    assertReviewAlertTransition("in_progress", "awaiting_verification");

    transaction.update(workOrderReference, {
      status: "ready_for_review",
      readyForReviewAt: FieldValue.serverTimestamp(),
      readyForReviewEvidenceMediaIds: input.evidenceMediaIds,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByType: actor.type,
      updatedById: actor.id,
    });
    transaction.create(workOrderReference.collection("statusHistory").doc(randomUUID()), {
      fromStatus: "in_progress",
      toStatus: "ready_for_review",
      actorType: actor.type,
      actorId: actor.id,
      note: input.note ?? null,
      evidenceMediaIds: input.evidenceMediaIds,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(alertReference, {
      status: "awaiting_verification",
      statusUpdatedAt: FieldValue.serverTimestamp(),
      statusUpdatedByUid: actor.cleaner.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(alertReference.collection("statusHistory").doc(randomUUID()), {
      previousStatus: "in_progress",
      newStatus: "awaiting_verification",
      actorType: actor.type,
      actorUid: actor.cleaner.uid,
      actorNameSnapshot: actor.cleaner.displayName,
      actorEmailSnapshot: actor.cleaner.email || null,
      note: input.note ?? null,
      changedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(requestRef, {
      workOrderId,
      alertId,
      status: "requested",
      beforeEvidenceMediaIds: alertEvidenceIds(alert),
      afterEvidenceMediaIds: input.evidenceMediaIds,
      requestedByType: actor.type,
      requestedById: actor.id,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      rationale: "Cleaner submitted the work order for verification.",
      createdAt: FieldValue.serverTimestamp(),
      fulfilledAt: null,
      decision: null,
      decisionReviewId: null,
    });
  });

  return {
    idempotent,
    reviewRequest: await getReviewRequest(workOrderId, requestId),
    workOrder: await getWorkOrder(workOrderId),
    alertId: alertIdHolder.value,
  };
}

export async function requestFreshEvidence(input: ReviewRequestInput, actor: ReviewActor) {
  const workOrderReference = firestore.collection("workOrders").doc(input.workOrderId);
  const requestRef = requestReference(input.workOrderId, input.idempotencyKey);
  const requestFingerprint = fingerprint({ ...input, actorType: actor.type, actorId: actor.id });
  let idempotent = false;
  await firestore.runTransaction(async (transaction) => {
    const workOrderSnapshot = await transaction.get(workOrderReference);
    if (!workOrderSnapshot.exists) throw new HttpError(404, "Work order not found.");
    const workOrder = workOrderSnapshot.data()!;
    const alertReference = firestore.collection("alerts").doc(String(workOrder.alertId ?? ""));
    const [alertSnapshot, existingRequest] = await Promise.all([
      transaction.get(alertReference),
      transaction.get(requestRef),
    ]);
    if (!alertSnapshot.exists) throw new HttpError(404, "Alert not found.");
    assertWorkOrderAlert(workOrder, alertSnapshot.data()!, input.workOrderId, input.alertId);
    if (existingRequest.exists) {
      if (existingRequest.data()?.requestFingerprint !== requestFingerprint) {
        throw new HttpError(409, "Review request idempotency key conflicts with another request.");
      }
      idempotent = true;
      return;
    }
    assertReviewState(workOrder, alertSnapshot.data()!);
    transaction.create(requestRef, {
      workOrderId: input.workOrderId,
      alertId: input.alertId,
      status: "requested",
      beforeEvidenceMediaIds: [
        ...alertEvidenceIds(alertSnapshot.data()!),
        ...evidenceIds(workOrder.readyForReviewEvidenceMediaIds),
      ].filter((value, index, values) => values.indexOf(value) === index),
      afterEvidenceMediaIds: [],
      requestedByType: actor.type,
      requestedById: actor.id,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      rationale: input.rationale ?? null,
      createdAt: FieldValue.serverTimestamp(),
      fulfilledAt: null,
      decision: null,
      decisionReviewId: null,
    });
  });
  return { idempotent, reviewRequest: await getReviewRequest(input.workOrderId, requestRef.id) };
}

export async function recordReviewDecision(input: ReviewDecisionInput, actor: ReviewActor) {
  const workOrderReference = firestore.collection("workOrders").doc(input.workOrderId);
  const reviewRef = reviewReference(input.workOrderId, input.idempotencyKey);
  const requestRef = workOrderReference.collection("reviewRequests").doc(input.reviewRequestId);
  const reviewFingerprint = fingerprint({ ...input, actorType: actor.type, actorId: actor.id });
  let idempotent = false;
  let notificationId: string | null = null;

  await firestore.runTransaction(async (transaction) => {
    const [workOrderSnapshot, reviewSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(workOrderReference),
      transaction.get(reviewRef),
      transaction.get(requestRef),
    ]);
    if (!workOrderSnapshot.exists) throw new HttpError(404, "Work order not found.");
    if (reviewSnapshot.exists) {
      if (reviewSnapshot.data()?.requestFingerprint !== reviewFingerprint) {
        throw new HttpError(409, "Review decision idempotency key conflicts with another decision.");
      }
      idempotent = true;
      return;
    }
    if (!requestSnapshot.exists) throw new HttpError(404, "Review request not found.");
    if (requestSnapshot.data()?.status !== "requested") throw new HttpError(409, "Review request has already been fulfilled.");
    const workOrder = workOrderSnapshot.data()!;
    const alertId = String(workOrder.alertId ?? "");
    const alertReference = firestore.collection("alerts").doc(alertId);
    const alertSnapshot = await transaction.get(alertReference);
    if (!alertSnapshot.exists) throw new HttpError(404, "Alert not found.");
    const alert = alertSnapshot.data()!;
    const activeWorkReference = firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId));
    const activeAlertReference = typeof alert.activeKeyId === "string"
      ? firestore.collection("activeAlertKeys").doc(alert.activeKeyId)
      : null;
    const resetReference = typeof alert.activeKeyId === "string"
      ? firestore.collection("alertConfirmationResets").doc(alert.activeKeyId)
      : null;
    const presenceReference = typeof workOrder.assignedCleanerId === "string"
      ? firestore.collection("cleanerPresence").doc(workOrder.assignedCleanerId)
      : null;
    const [activeWorkSnapshot, activeAlertSnapshot, resetSnapshot, presenceSnapshot] = await Promise.all([
      transaction.get(activeWorkReference),
      activeAlertReference ? transaction.get(activeAlertReference) : Promise.resolve(null),
      resetReference ? transaction.get(resetReference) : Promise.resolve(null),
      presenceReference ? transaction.get(presenceReference) : Promise.resolve(null),
    ]);
    assertWorkOrderAlert(workOrder, alert, input.workOrderId, input.alertId);
    assertReviewState(workOrder, alert);

    const decision = input.decision;
    const currentAlertStatus = String(alertSnapshot.data()!.status) as "awaiting_verification";
    const currentWorkStatus = String(workOrder.status);
    transaction.create(reviewRef, {
      workOrderId: input.workOrderId,
      alertId: input.alertId,
      reviewRequestId: input.reviewRequestId,
      beforeEvidenceMediaIds: evidenceIds(requestSnapshot.data()?.beforeEvidenceMediaIds),
      afterEvidenceMediaIds: input.afterEvidenceMediaIds,
      visionResults: input.visionResults,
      decision,
      rationaleSummary: input.rationaleSummary,
      modelVersions: input.modelVersions,
      promptPolicyVersion: input.promptPolicyVersion ?? null,
      actorType: actor.type,
      actorId: actor.id,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: reviewFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(requestRef, {
      status: "fulfilled",
      fulfilledAt: FieldValue.serverTimestamp(),
      decision,
      decisionReviewId: reviewRef.id,
      afterEvidenceMediaIds: input.afterEvidenceMediaIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (decision === "clean") {
      assertReviewAlertTransition(currentAlertStatus, "resolved");
      transaction.update(workOrderReference, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByType: actor.type,
        updatedById: actor.id,
      });
      transaction.create(workOrderReference.collection("statusHistory").doc(randomUUID()), {
        fromStatus: currentWorkStatus,
        toStatus: "completed",
        actorType: actor.type,
        actorId: actor.id,
        note: input.rationaleSummary,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: reviewFingerprint,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(alertReference, {
        status: "resolved",
        statusUpdatedAt: FieldValue.serverTimestamp(),
        statusUpdatedByUid: actor.id,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedByUid: actor.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(alertReference.collection("statusHistory").doc(randomUUID()), {
        previousStatus: "awaiting_verification",
        newStatus: "resolved",
        actorType: actor.type,
        actorUid: actor.id,
        actorNameSnapshot: "LitterSpot orchestrator",
        actorEmailSnapshot: null,
        note: input.rationaleSummary,
        changedAt: FieldValue.serverTimestamp(),
      });
      if (activeWorkSnapshot.exists && activeWorkSnapshot.data()?.workOrderId === input.workOrderId) transaction.delete(activeWorkReference);
      if (activeAlertSnapshot?.exists && activeAlertSnapshot.data()?.alertId === input.alertId) transaction.delete(activeAlertReference!);
      if (resetReference) {
        transaction.set(resetReference, {
          workflowVersion: alert.workflowVersion,
          siteId: alert.siteId,
          zoneId: alert.zoneId,
          issueType: alert.issueType,
          resolvedAlertId: input.alertId,
          generation: Number(resetSnapshot?.data()?.generation ?? 0) + 1,
          resetAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (presenceSnapshot?.exists && presenceSnapshot.data()?.activeWorkOrderId === input.workOrderId) {
        transaction.update(presenceReference!, { availability: "online", activeWorkOrderId: null, updatedAt: FieldValue.serverTimestamp() });
      }
    } else if (decision === "rework") {
      assertReviewAlertTransition(currentAlertStatus, "in_progress");
      transaction.update(workOrderReference, {
        status: "rework_required",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByType: actor.type,
        updatedById: actor.id,
      });
      transaction.create(workOrderReference.collection("statusHistory").doc(randomUUID()), {
        fromStatus: currentWorkStatus,
        toStatus: "rework_required",
        actorType: actor.type,
        actorId: actor.id,
        note: input.rationaleSummary,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: reviewFingerprint,
        createdAt: FieldValue.serverTimestamp(),
      });
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
        actorNameSnapshot: "LitterSpot orchestrator",
        actorEmailSnapshot: null,
        note: input.rationaleSummary,
        changedAt: FieldValue.serverTimestamp(),
      });
      if (typeof workOrder.assignedCleanerUid === "string" && typeof workOrder.assignedCleanerId === "string") {
        notificationId = createNotificationInTransaction(transaction, {
          recipientUid: workOrder.assignedCleanerUid,
          recipientCleanerId: workOrder.assignedCleanerId,
          type: "rework_required",
          workOrderId: input.workOrderId,
          title: "Rework required",
          body: input.rationaleSummary,
          idempotencyKey: input.idempotencyKey,
        });
      }
    } else if (decision === "more_evidence") {
      transaction.update(alertReference, { updatedAt: FieldValue.serverTimestamp() });
    } else {
      transaction.update(alertReference, {
        automationException: {
          code: "review_supervisor_exception",
          summary: input.rationaleSummary,
          recordedAt: FieldValue.serverTimestamp(),
          recordedBy: actor.id,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  if (notificationId) await deliverNotification(notificationId);
  return {
    idempotent,
    review: present(await reviewReference(input.workOrderId, input.idempotencyKey).get(), "Review"),
    workOrder: await getWorkOrder(input.workOrderId),
  };
}
