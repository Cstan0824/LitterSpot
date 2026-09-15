import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { SCHEMA_VERSION } from "../shared/firestoreSchema.js";
import { canonicalHash, requestBodyHash } from "./persistence.js";
import { auditEventData, writeAuditEvent, type AuditActor } from "./auditService.js";
import { projectSupervisorList, type SupervisorListSource } from "./supervisorProjection.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

export type IdentityOperationType = "create_site_root" | "create_supervisor" | "create_cleaner" | "recover_root";

export function normalizeIdentityEmail(email: string) { return email.trim().toLowerCase(); }
export function emailReservationId(email: string) { return canonicalHash("v2-user-email", normalizeIdentityEmail(email)); }
export function identityOperationId(actorUid: string, type: IdentityOperationType, idempotencyKey: string) {
  return canonicalHash("v2-identity-operation", actorUid, type, idempotencyKey.trim());
}

export async function beginIdentityOperation(input: {
  operationId: string;
  type: IdentityOperationType;
  siteId: string | null;
  email: string;
  actorUid: string;
  requestId: string;
  request: unknown;
}) {
  const operation = firestore.collection("identityOperations").doc(input.operationId);
  const reservation = firestore.collection("userAccountEmails").doc(emailReservationId(input.email));
  const bodyHash = requestBodyHash(input.request);
  return firestore.runTransaction(async (transaction) => {
    const [existingOperation, existingReservation] = await Promise.all([transaction.get(operation), transaction.get(reservation)]);
    if (existingOperation.exists) {
      const data = existingOperation.data()!;
      if (data.requestBodyHash !== bodyHash) throw new HttpError(409, "The idempotency key was already used with different input.");
      if (data.status === "completed") return { replay: true as const, operation, reservation, authUid: String(data.authUid), profileId: String(data.profileId) };
      throw new HttpError(409, "This identity operation is already in progress or needs reconciliation.");
    }
    if (existingReservation.exists) throw new HttpError(409, "This email is already provisioned or reserved.");
    transaction.create(operation, {
      schemaVersion: SCHEMA_VERSION, operationId: input.operationId, type: input.type, siteId: input.siteId,
      emailNormalized: normalizeIdentityEmail(input.email), authUid: null, profileId: null, status: "started",
      lastCompletedStep: null, errorCode: null, requestedByUid: input.actorUid, requestId: input.requestId,
      requestBodyHash: bodyHash, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), completedAt: null,
    });
    transaction.create(reservation, {
      schemaVersion: SCHEMA_VERSION, emailNormalized: normalizeIdentityEmail(input.email), uid: null, role: input.type === "create_cleaner" ? "cleaner" : "supervisor",
      profileId: null, siteId: input.siteId, state: "reserved", operationId: input.operationId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { replay: false as const, operation, reservation, authUid: null, profileId: null };
  });
}

export async function createIdentityAuthUser(input: { operation: FirebaseFirestore.DocumentReference; email: string; password: string; displayName: string }) {
  let user;
  try {
    user = await firebaseAuth.createUser({ email: normalizeIdentityEmail(input.email), password: input.password, displayName: input.displayName.trim(), disabled: false });
  } catch (error) {
    await input.operation.update({ status: "failed", errorCode: "auth_create_failed", updatedAt: FieldValue.serverTimestamp() });
    throw error;
  }
  await input.operation.update({ authUid: user.uid, status: "auth_created", lastCompletedStep: "auth_created", updatedAt: FieldValue.serverTimestamp() });
  return user;
}

export async function compensateIdentityOperation(input: {
  operation: FirebaseFirestore.DocumentReference;
  reservation: FirebaseFirestore.DocumentReference;
  authUid: string | null;
  errorCode: string;
}) {
  if (input.authUid) await firebaseAuth.deleteUser(input.authUid).catch(() => undefined);
  await firestore.runTransaction(async (transaction) => {
    const reservation = await transaction.get(input.reservation);
    if (reservation.exists && reservation.data()?.operationId === input.operation.id) transaction.delete(input.reservation);
    transaction.set(input.operation, { status: "failed", errorCode: input.errorCode, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function listSupervisors(siteId: string, viewerAuthority: "root" | "regular") {
  return (await listSupervisorsPage(siteId, viewerAuthority, { limit: 100 })).items;
}

export async function listSupervisorsPage(siteId: string, viewerAuthority: "root" | "regular", input: { limit: number; cursor?: string; status?: "active" | "inactive" | "all" }) {
  const status = input.status ?? "all";
  const filters = { siteId, status, viewerAuthority };
  let query: FirebaseFirestore.Query = firestore.collection("supervisors").where("siteId", "==", siteId);
  if (status !== "all") query = query.where("status", "==", status);
  const page = await queryCursorPage({ query, totalQuery: query, resource: "supervisors", orderField: "fullName", direction: "asc", filters, limit: input.limit, cursor: input.cursor, present: (document) => document });
  const profiles = page.items
    .map((document) => { const data = document.data(); return { uid: document.id, fullName: data.fullName, phone: data.phone, authority: data.authority, status: data.status, revision: data.revision }; })
    .filter((profile) => profile.authority === "root" || profile.authority === "regular")
    .filter((profile) => profile.status === "active" || profile.status === "inactive")
    .sort((left, right) => Number(left.authority === "regular") - Number(right.authority === "regular") || String(left.fullName).localeCompare(String(right.fullName)));
  const accounts = viewerAuthority === "root"
    ? await Promise.all(profiles.map((profile) => firestore.collection("userAccounts").doc(profile.uid).get()))
    : [];
  const sources: SupervisorListSource[] = profiles.map((profile, index) => ({
    uid: profile.uid,
    fullName: String(profile.fullName ?? "Supervisor"),
    email: viewerAuthority === "root" ? String(accounts[index]?.data()?.emailNormalized ?? "") : "",
    phone: typeof profile.phone === "string" ? profile.phone : null,
    authority: profile.authority as "root" | "regular",
    status: profile.status as "active" | "inactive",
    revision: Number(profile.revision ?? 0),
  }));
  return { ...page, items: projectSupervisorList(sources, viewerAuthority) };
}

export async function createRegularSupervisor(input: {
  siteId: string; email: string; password: string; fullName: string; phone?: string | null; idempotencyKey: string;
}, actor: AuditActor & { uid: string }, requestId: string) {
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (site.data()?.rootSupervisorUid !== actor.uid || actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  const operationId = identityOperationId(actor.uid, "create_supervisor", input.idempotencyKey);
  const started = await beginIdentityOperation({ operationId, type: "create_supervisor", siteId: input.siteId, email: input.email, actorUid: actor.uid, requestId, request: input });
  if (started.replay) return { uid: started.authUid, replayed: true };
  let uid: string | null = null;
  try {
    uid = (await createIdentityAuthUser({ operation: started.operation, email: input.email, password: input.password, displayName: input.fullName })).uid;
    const auditRef = firestore.collection("auditEvents").doc();
    await firestore.runTransaction(async (transaction) => {
      const [operation, reservation] = await Promise.all([transaction.get(started.operation), transaction.get(started.reservation)]);
      if (!operation.exists || operation.data()?.status !== "auth_created" || !reservation.exists || reservation.data()?.operationId !== operationId) throw new HttpError(409, "Identity operation state changed.");
      transaction.create(firestore.collection("userAccounts").doc(uid!), {
        schemaVersion: SCHEMA_VERSION, uid, role: "supervisor", siteId: input.siteId, profileId: uid, authority: "regular",
        emailNormalized: normalizeIdentityEmail(input.email), displayName: input.fullName.trim(), status: "active", lastLoginAt: null,
        createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: 1,
      });
      transaction.create(firestore.collection("supervisors").doc(uid!), {
        schemaVersion: SCHEMA_VERSION, uid, siteId: input.siteId, authority: "regular", fullName: input.fullName.trim(), phone: input.phone?.trim() || null,
        status: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid,
        deactivatedAt: null, deactivatedByUid: null, revision: 1,
      });
      transaction.update(started.reservation, { uid, profileId: uid, state: "active", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(started.operation, { authUid: uid, profileId: uid, status: "completed", lastCompletedStep: "firestore_committed", updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, auditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "supervisor_created", resourceType: "Supervisor", resourceId: uid, outcome: "succeeded", after: { authority: "regular", status: "active", emailNormalized: normalizeIdentityEmail(input.email) }, requestId }));
    });
    return { uid, replayed: false };
  } catch (error) {
    await compensateIdentityOperation({ operation: started.operation, reservation: started.reservation, authUid: uid, errorCode: "supervisor_provision_failed" });
    await writeAuditEvent({ actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "supervisor_created", resourceType: "Supervisor", outcome: "failed", errorCode: "supervisor_provision_failed", requestId }).catch(() => undefined);
    throw error;
  }
}

export async function updateSupervisor(input: { siteId: string; supervisorUid: string; fullName?: string; phone?: string | null; status?: "active" | "inactive"; expectedRevision: number }, actor: AuditActor & { uid: string }, requestId: string) {
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const profileRef = firestore.collection("supervisors").doc(input.supervisorUid);
  const accountRef = firestore.collection("userAccounts").doc(input.supervisorUid);
  const auditRef = firestore.collection("auditEvents").doc();
  let nextStatus = "active";
  await firestore.runTransaction(async (transaction) => {
    const [site, profile, account] = await Promise.all([transaction.get(siteRef), transaction.get(profileRef), transaction.get(accountRef)]);
    if (!site.exists || site.data()?.rootSupervisorUid !== actor.uid || actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
    if (!profile.exists || profile.data()?.siteId !== input.siteId || !account.exists || account.data()?.siteId !== input.siteId) throw new HttpError(404, "Supervisor not found.");
    if (Number(profile.data()?.revision) !== input.expectedRevision) throw new HttpError(409, "The Supervisor changed. Refresh and retry.");
    if (profile.data()?.authority === "root" && input.status === "inactive") throw new HttpError(409, "The Root Supervisor cannot be deactivated here.");
    if (input.supervisorUid === actor.uid && input.status === "inactive") throw new HttpError(409, "You cannot deactivate your own account.");
    nextStatus = input.status ?? String(profile.data()?.status);
    const changes = {
      ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status, deactivatedAt: input.status === "inactive" ? FieldValue.serverTimestamp() : null, deactivatedByUid: input.status === "inactive" ? actor.uid : null } : {}),
      updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1),
    };
    transaction.update(profileRef, changes);
    transaction.update(accountRef, { ...(input.fullName !== undefined ? { displayName: input.fullName.trim() } : {}), ...(input.status !== undefined ? { status: input.status } : {}), updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, auditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "supervisor_updated", resourceType: "Supervisor", resourceId: input.supervisorUid, outcome: "succeeded", before: { fullName: profile.data()?.fullName, phone: profile.data()?.phone, status: profile.data()?.status }, after: { fullName: input.fullName ?? profile.data()?.fullName, phone: input.phone === undefined ? profile.data()?.phone : input.phone, status: nextStatus }, requestId }));
  });
  await firebaseAuth.updateUser(input.supervisorUid, { disabled: nextStatus === "inactive", ...(input.fullName !== undefined ? { displayName: input.fullName.trim() } : {}) });
  return { uid: input.supervisorUid, status: nextStatus };
}
