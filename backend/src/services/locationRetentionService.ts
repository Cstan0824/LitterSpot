import { Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";

export async function runLocationHistoryRetention(options: {
  execute: boolean;
  pageSize: number;
  now?: Date;
}) {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 500) {
    throw new Error("Location retention pageSize must be an integer from 1 to 500.");
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Location retention time must be valid.");
  const cutoff = Timestamp.fromDate(now);
  let cursor: QueryDocumentSnapshot | null = null;
  let eligible = 0;
  let deleted = 0;
  do {
    let query = firestore.collectionGroup("locationHistory")
      .where("retentionExpiresAt", "<=", cutoff)
      .orderBy("retentionExpiresAt", "asc")
      .limit(options.pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    eligible += snapshot.size;
    if (options.execute && !snapshot.empty) {
      const batch = firestore.batch();
      snapshot.docs.forEach((item) => batch.delete(item.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
    const last = snapshot.docs.at(-1);
    cursor = snapshot.size === options.pageSize && last ? last : null;
  } while (cursor);
  return {
    policyVersion: "cleaner-location-retention-v1",
    mode: options.execute ? "execute" : "dry_run",
    retentionDays: 7,
    evaluatedAt: now.toISOString(),
    eligible,
    deleted,
  };
}
