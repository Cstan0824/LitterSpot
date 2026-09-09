import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { canonicalHash } from "./v2Persistence.js";
import { v2Json } from "./v2Presentation.js";
import type { V2Notification } from "./v2Notification.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

type NotificationInput = Omit<V2Notification, "schemaVersion" | "notificationId"> & { eventKey: string };

export function v2NotificationRecord(input: NotificationInput) {
  const { eventKey, ...fields } = input;
  const notificationId = canonicalHash("v2-recipient-event", input.siteId, input.recipientUid, input.type, eventKey);
  return { ...fields, schemaVersion: 2, notificationId, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86400_000) };
}

/** Caller must write this once in the transaction protected by its workflow event key. */
export function createV2NotificationInTransaction(transaction: Transaction, input: NotificationInput) {
  const data = v2NotificationRecord(input);
  transaction.create(firestore.collection("notifications").doc(data.notificationId), data);
}

export async function writeV2Notification(input: NotificationInput) {
  const data = v2NotificationRecord(input);
  try { await firestore.collection("notifications").doc(data.notificationId).create(data); }
  catch (error) { if ((error as { code?: number }).code !== 6) throw error; }
  return data.notificationId;
}

export async function listV2Notifications(siteId: string, recipientUid: string, limit = 50) {
  return (await listV2NotificationsPage(siteId, recipientUid, { limit })).items;
}
export async function listV2NotificationsPage(siteId: string, recipientUid: string, input: { limit: number; cursor?: string }) {
  const query = firestore.collection("notifications").where("recipientUid", "==", recipientUid).where("siteId", "==", siteId).where("schemaVersion", "==", 2);
  return queryCursorPage({ query, totalQuery: query, resource: "notifications", orderField: "createdAt", filters: { siteId, recipientUid }, limit: Math.min(input.limit, 100), cursor: input.cursor, present: (doc) => v2Json({ id: doc.id, ...doc.data() }) });
}

export async function notifyV2SiteSupervisors(input: Omit<NotificationInput, "recipientUid" | "recipientRole">) {
  const recipients = await firestore.collection("supervisors").where("siteId", "==", input.siteId).where("status", "==", "active").get();
  await Promise.all(recipients.docs.map(doc => writeV2Notification({ ...input, recipientUid: doc.id, recipientRole: "supervisor" })));
}
