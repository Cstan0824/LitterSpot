import { Timestamp } from "firebase-admin/firestore";

export function v2Json(value: unknown): any {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(v2Json);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, v2Json(child)]));
  return value;
}
