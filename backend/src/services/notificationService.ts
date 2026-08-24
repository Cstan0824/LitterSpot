import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type Query, type Transaction } from "firebase-admin/firestore";
import { firebaseMessaging, firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

export type NotificationType = "work_assigned" | "work_reassigned" | "rework_required" | "work_cancelled" | "system_message";

function hash(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function instant(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function presentNotification(id: string, data: DocumentData) {
  return {
    id,
    recipientUid: String(data.recipientUid),
    recipientCleanerId: String(data.recipientCleanerId),
    type: String(data.type),
    workOrderId: data.workOrderId == null ? null : String(data.workOrderId),
    title: String(data.title),
    body: String(data.body),
    status: String(data.status),
    deliveryAttempts: Number(data.deliveryAttempts ?? 0),
    deliveryReasonCode: data.deliveryReasonCode == null ? null : String(data.deliveryReasonCode),
    createdAt: instant(data.createdAt),
    sentAt: instant(data.sentAt),
    readAt: instant(data.readAt),
  };
}

export function notificationReference(options: {
  recipientCleanerId: string;
  type: NotificationType;
  workOrderId: string | null;
  idempotencyKey: string;
}) {
  return firestore.collection("notifications").doc(hash(
    "notification-v1",
    options.recipientCleanerId,
    options.type,
    options.workOrderId ?? "none",
    options.idempotencyKey,
  ));
}

export function createNotificationInTransaction(transaction: Transaction, options: {
  recipientUid: string;
  recipientCleanerId: string;
  type: NotificationType;
  workOrderId: string | null;
  title: string;
  body: string;
  idempotencyKey: string;
}) {
  const reference = notificationReference(options);
  transaction.create(reference, {
    recipientUid: options.recipientUid,
    recipientCleanerId: options.recipientCleanerId,
    type: options.type,
    workOrderId: options.workOrderId,
    title: options.title,
    body: options.body,
    status: "pending",
    deliveryAttempts: 0,
    deliveryReasonCode: null,
    createdAt: FieldValue.serverTimestamp(),
    sentAt: null,
    readAt: null,
  });
  return reference.id;
}

export async function deliverNotification(notificationId: string) {
  const reference = firestore.collection("notifications").doc(notificationId);
  try {
    const snapshot = await reference.get();
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (data.status === "read" || data.status === "sent") return presentNotification(snapshot.id, data);
    const tokenSnapshot = await firestore.collection("cleanerPushTokens")
      .where("cleanerId", "==", String(data.recipientCleanerId))
      .where("status", "==", "active")
      .limit(500)
      .get();
    if (tokenSnapshot.empty) {
      await reference.update({
        status: "failed",
        deliveryAttempts: FieldValue.increment(1),
        deliveryReasonCode: "no_registered_push_token",
      });
      return presentNotification(reference.id, (await reference.get()).data()!);
    }
    const response = await firebaseMessaging.sendEachForMulticast({
      tokens: tokenSnapshot.docs.map((item) => String(item.data().token)),
      notification: { title: String(data.title), body: String(data.body) },
      data: {
        notificationId,
        workOrderId: data.workOrderId == null ? "" : String(data.workOrderId),
        type: String(data.type),
      },
    });
    const invalidReferences = response.responses.flatMap((result, index) => {
      const code = result.error?.code;
      return !result.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(String(code))
        ? [tokenSnapshot.docs[index].ref]
        : [];
    });
    await Promise.all(invalidReferences.map((item) => item.update({ status: "invalid", invalidatedAt: FieldValue.serverTimestamp() })));
    await reference.update({
      status: response.successCount > 0 ? "sent" : "failed",
      deliveryAttempts: FieldValue.increment(1),
      deliveryReasonCode: response.successCount > 0 ? null : "push_delivery_failed",
      sentAt: response.successCount > 0 ? FieldValue.serverTimestamp() : null,
    });
    return presentNotification(reference.id, (await reference.get()).data()!);
  } catch {
    await reference.update({
      status: "failed",
      deliveryAttempts: FieldValue.increment(1),
      deliveryReasonCode: "push_service_unavailable",
    }).catch(() => undefined);
    return null;
  }
}

export async function listCleanerNotifications(cleanerId: string, input: {
  status: "unread" | "read" | "all";
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("notifications").where("recipientCleanerId", "==", cleanerId);
  if (input.status === "read") query = query.where("status", "==", "read");
  if (input.status === "unread") query = query.where("status", "in", ["pending", "sent", "failed"]);
  return queryCursorPage({
    query,
    resource: "cleaner-notifications",
    orderField: "createdAt",
    filters: { cleanerId, status: input.status },
    limit: input.limit,
    cursor: input.cursor,
    present: (item) => presentNotification(item.id, item.data()),
  });
}

export async function markNotificationRead(cleanerId: string, notificationId: string) {
  const reference = firestore.collection("notifications").doc(notificationId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data()?.recipientCleanerId !== cleanerId) throw new HttpError(404, "Notification not found.");
    if (snapshot.data()?.status === "read") return;
    transaction.update(reference, { status: "read", readAt: FieldValue.serverTimestamp() });
  });
  return presentNotification(reference.id, (await reference.get()).data()!);
}

export async function registerCleanerPushToken(cleanerId: string, uid: string, input: {
  deviceId: string;
  token: string;
  userAgent?: string;
}) {
  const id = hash("cleaner-push-token-v1", cleanerId, input.deviceId);
  await firestore.collection("cleanerPushTokens").doc(id).set({
    cleanerId,
    uid,
    deviceId: input.deviceId,
    token: input.token,
    userAgent: input.userAgent ?? null,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    invalidatedAt: null,
  }, { merge: true });
  return { deviceId: input.deviceId, status: "active" };
}

export async function removeCleanerPushToken(cleanerId: string, deviceId: string) {
  const id = hash("cleaner-push-token-v1", cleanerId, deviceId);
  const reference = firestore.collection("cleanerPushTokens").doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.cleanerId !== cleanerId) throw new HttpError(404, "Push device not found.");
  await reference.update({ status: "inactive", token: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  return { deviceId, status: "inactive" };
}
