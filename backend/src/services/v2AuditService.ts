import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { sanitizeAuditSummary } from "./v2Persistence.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

export type AuditActor = {
  uid: string;
  role: "superadmin" | "supervisor";
  authority?: "root" | "regular" | null;
  displayName: string;
};

export function v2AuditEventData(input: {
  auditEventId: string;
  actor: AuditActor;
  siteId?: string | null;
  siteNameSnapshot?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "succeeded" | "failed";
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  errorCode?: string | null;
  requestId: string;
}) {
  return {
    schemaVersion: V2_SCHEMA_VERSION,
    auditEventId: input.auditEventId,
    siteId: input.siteId ?? null,
    siteNameSnapshot: input.siteNameSnapshot ?? null,
    actorUid: input.actor.uid,
    actorRole: input.actor.role,
    actorAuthority: input.actor.authority ?? null,
    actorNameSnapshot: input.actor.displayName,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    before: input.before == null ? null : sanitizeAuditSummary(input.before),
    after: input.after == null ? null : sanitizeAuditSummary(input.after),
    errorCode: input.errorCode ?? null,
    requestId: input.requestId,
    ipHash: null,
    occurredAt: FieldValue.serverTimestamp(),
  };
}

export async function writeV2AuditEvent(input: {
  actor: AuditActor;
  siteId?: string | null;
  siteNameSnapshot?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "succeeded" | "failed";
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  errorCode?: string | null;
  requestId: string;
}) {
  const reference = firestore.collection("auditEvents").doc();
  await reference.create(v2AuditEventData({ ...input, auditEventId: reference.id }));
  return reference.id;
}

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

export async function listV2AuditEventsPage(filters: { siteId?: string; actorUid?: string; actorRole?: "superadmin" | "supervisor"; limit?: number; cursor?: string } = {}) {
  let query: FirebaseFirestore.Query = firestore.collection("auditEvents");
  if (filters.siteId) query = query.where("siteId", "==", filters.siteId);
  if (filters.actorUid) query = query.where("actorUid", "==", filters.actorUid);
  if (filters.actorRole) query = query.where("actorRole", "==", filters.actorRole);
  return queryCursorPage({ query, totalQuery: query, resource: "auditEvents", orderField: "occurredAt", filters: { siteId: filters.siteId ?? null, actorUid: filters.actorUid ?? null, actorRole: filters.actorRole ?? null }, limit: Math.min(filters.limit ?? 25, 100), cursor: filters.cursor, present: (doc) => {
    const data = doc.data();
    return { ...data, id: doc.id, occurredAt: timestamp(data.occurredAt) };
  } });
}
export async function listV2AuditEvents(filters: { siteId?: string; actorUid?: string; actorRole?: "superadmin" | "supervisor"; limit?: number } = {}) { return (await listV2AuditEventsPage({ ...filters, limit: filters.limit ?? 100 })).items; }
