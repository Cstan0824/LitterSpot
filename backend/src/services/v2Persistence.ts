import { createHash } from "node:crypto";
import type { DocumentData, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";

const forbiddenAuditKeys = /(?:password|token|authorization|credential|secret|stack|absolutePath|storagePath|rawOutput)/i;

export function assertSiteScope(expectedSiteId: string, resource: Record<string, unknown> | undefined, label = "Resource") {
  if (!resource || resource.siteId !== expectedSiteId) throw new HttpError(404, `${label} not found.`);
  return resource;
}

export async function getSiteScopedDocument(collectionName: string, documentId: string, siteId: string, transaction?: Transaction) {
  if (!siteId) throw new HttpError(403, "A Site-scoped principal is required.");
  const reference = firestore.collection(collectionName).doc(documentId);
  const snapshot = transaction ? await transaction.get(reference) : await reference.get();
  if (!snapshot.exists) throw new HttpError(404, "Resource not found.");
  assertSiteScope(siteId, snapshot.data(), "Resource");
  return snapshot;
}

export function assertExpectedRevision(data: Record<string, unknown>, expectedRevision: number) {
  const actualRevision = Number(data.revision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpError(400, "expectedRevision must be a non-negative integer.");
  if (actualRevision !== expectedRevision) throw new HttpError(409, "The resource changed. Refresh and retry.", { expectedRevision, actualRevision });
}

export function canonicalHash(namespace: string, ...parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify([namespace, ...parts])).digest("hex");
}

export function operationKeyId(actorId: string, operation: string, idempotencyKey: string) {
  if (!idempotencyKey.trim() || idempotencyKey.length > 160) throw new HttpError(400, "A valid idempotency key is required.");
  return canonicalHash("v2-operation-key", actorId, operation, idempotencyKey.trim());
}

export function requestBodyHash(body: unknown) {
  return canonicalHash("v2-request-body", body);
}

export function assertIdempotencyReplay(data: Record<string, unknown>, bodyHash: string) {
  if (data.requestBodyHash !== bodyHash) throw new HttpError(409, "The idempotency key was already used with different input.");
  return { resourceType: String(data.resourceType), resourceId: String(data.resourceId), responseStatus: Number(data.responseStatus) };
}

export function sanitizeAuditSummary(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (depth >= 5) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditSummary(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 1000);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (forbiddenAuditKeys.test(key)) throw new HttpError(400, `Audit summary field ${key} is not allowed.`);
    output[key] = sanitizeAuditSummary(child, depth + 1);
  }
  return output;
}

export function documentData(snapshot: DocumentSnapshot<DocumentData>) {
  if (!snapshot.exists) throw new HttpError(404, "Resource not found.");
  return snapshot.data()!;
}
