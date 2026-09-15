import { Timestamp } from "firebase-admin/firestore";

export function serializeFirestore(value: unknown): any {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestore);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeFirestore(child)]));
  return value;
}
