import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { canonicalHash } from "./persistence.js";
import { serializeFirestore } from "./presentation.js";
import type { NotificationRecord } from "./notification.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

type NotificationInput = Omit<NotificationRecord, "schemaVersion" | "notificationId"> & { eventKey: string };

export function notificationRecord(input: NotificationInput) {
  const { eventKey, ...fields } = input;
  const notificationId = canonicalHash("v2-recipient-event", input.siteId, input.recipientUid, input.type, eventKey);
  return { ...fields, schemaVersion: 2, notificationId, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86400_000) };
}

/** Caller must write this once in the transaction protected by its workflow event key. */
export function createNotificationInTransaction(transaction: Transaction, input: NotificationInput) {
  const data = notificationRecord(input);
  transaction.create(firestore.collection("notifications").doc(data.notificationId), data);
}

export async function writeNotification(input: NotificationInput) {
  const data = notificationRecord(input);
  try { await firestore.collection("notifications").doc(data.notificationId).create(data); }
  catch (error) { if ((error as { code?: number }).code !== 6) throw error; }
  return data.notificationId;
}

export async function listNotifications(siteId: string, recipientUid: string, limit = 50) {
  return (await listNotificationsPage(siteId, recipientUid, { limit })).items;
}
export async function listNotificationsPage(siteId: string, recipientUid: string, input: { limit: number; cursor?: string }) {
  const query = firestore.collection("notifications").where("recipientUid", "==", recipientUid).where("siteId", "==", siteId).where("schemaVersion", "==", 2);
  return queryCursorPage({ query, totalQuery: query, resource: "notifications", orderField: "createdAt", filters: { siteId, recipientUid }, limit: Math.min(input.limit, 100), cursor: input.cursor, present: (doc) => serializeFirestore({ id: doc.id, ...doc.data() }) });
}

export async function notifySiteSupervisors(input: Omit<NotificationInput, "recipientUid" | "recipientRole">) {
  const recipients = await firestore.collection("supervisors").where("siteId", "==", input.siteId).where("status", "==", "active").get();
  await Promise.all(recipients.docs.map(doc => writeNotification({ ...input, recipientUid: doc.id, recipientRole: "supervisor" })));
}
