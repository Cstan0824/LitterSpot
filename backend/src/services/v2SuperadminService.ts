import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { v2AuditEventData, writeV2AuditEvent, type AuditActor } from "./v2AuditService.js";
import { beginIdentityOperation, compensateIdentityOperation, createIdentityAuthUser, identityOperationId, normalizeIdentityEmail } from "./v2IdentityService.js";
import { firebaseAuth } from "../config/firebase.js";
import { reconcileV2SiteOperation } from "./v2SiteOperationService.js";

function iso(value: unknown) { return value instanceof Timestamp ? value.toDate().toISOString() : null; }

export async function createV2Site(input: {
  name: string; timeZone: string; description?: string | null;
  rootEmail: string; rootPassword: string; rootDisplayName: string; widthMeters: number; heightMeters: number; gridSizeMeters: number;
  backgroundMediaId?: string | null; idempotencyKey: string;
}, actor: AuditActor & { uid: string }, requestId: string) {
  const email = normalizeIdentityEmail(input.rootEmail);
  const operationId = identityOperationId(actor.uid, "create_site_root", input.idempotencyKey);
  const siteRef = firestore.collection("sites").doc();
  const mapRef = firestore.collection("siteMapRevisions").doc();
  const started = await beginIdentityOperation({ operationId, type: "create_site_root", siteId: siteRef.id, email, actorUid: actor.uid, requestId, request: input });
  if (started.replay) return { siteId: String((await started.operation.get()).data()?.siteId), rootSupervisorUid: started.authUid, replayed: true };
  let rootUid: string | null = null;
  try {
    rootUid = (await createIdentityAuthUser({ operation: started.operation, email, password: input.rootPassword, displayName: input.rootDisplayName })).uid;
    const auditRef = firestore.collection("auditEvents").doc();
    await firestore.runTransaction(async (transaction) => {
      const [operation, reservation] = await Promise.all([transaction.get(started.operation), transaction.get(started.reservation)]);
      if (!operation.exists || operation.data()?.status !== "auth_created" || !reservation.exists || reservation.data()?.operationId !== operationId) throw new HttpError(409, "Identity operation state changed.");
      transaction.create(siteRef, {
        schemaVersion: V2_SCHEMA_VERSION, siteId: siteRef.id, name: input.name.trim(), nameNormalized: input.name.trim().toLowerCase(),
        description: input.description?.trim() || null, timeZone: input.timeZone, status: "active", rootSupervisorUid: rootUid,
        activeMapRevisionId: mapRef.id, mapDraftExists: false, firstCameraCreated: false, laptopCameraId: null,
        defaultSampleIntervalSeconds: 1, fullBinAlertsEnabled: true, alertPolicyVersion: "cleanliness-v2", analyticsPolicyVersion: "analytics-v2",
        createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid,
        deactivatedAt: null, deactivatedByUid: null, deactivationOperationId: null, revision: 1,
      });
      transaction.create(mapRef, {
        schemaVersion: V2_SCHEMA_VERSION, revisionId: mapRef.id, siteId: siteRef.id, revisionNumber: 1, parentRevisionId: null,
        widthMeters: input.widthMeters, heightMeters: input.heightMeters, gridSizeMeters: input.gridSizeMeters, backgroundMediaId: input.backgroundMediaId ?? null,
        backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: input.widthMeters, heightMeters: input.heightMeters, opacity: 1 },
        zoneCount: 0, cameraPlacementCount: 0, cleanerStationCount: 0, contentHash: `empty:${siteRef.id}:${input.widthMeters}:${input.heightMeters}`,
        publishedAt: FieldValue.serverTimestamp(), publishedByUid: actor.uid, publicationRequestId: requestId,
      });
      transaction.create(firestore.collection("userAccounts").doc(rootUid!), {
        schemaVersion: V2_SCHEMA_VERSION, uid: rootUid, role: "supervisor", siteId: siteRef.id, profileId: rootUid, authority: "root",
        emailNormalized: email, displayName: input.rootDisplayName.trim(), status: "active", lastLoginAt: null,
        createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: 1,
      });
      transaction.create(firestore.collection("supervisors").doc(rootUid!), {
        schemaVersion: V2_SCHEMA_VERSION, uid: rootUid, siteId: siteRef.id, authority: "root", fullName: input.rootDisplayName.trim(),
        phone: null, status: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid,
        updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, deactivatedAt: null, deactivatedByUid: null, revision: 1,
      });
      transaction.set(firestore.collection("orchestratorConfigs").doc(siteRef.id), {
        schemaVersion: V2_SCHEMA_VERSION, siteId: siteRef.id, status: "running", pausedAt: null, pausedByUid: null, pauseReason: null,
        assignmentEnabled: true, reviewEnabled: true, provider: "ollama", model: "qwen3.5:4b", assignmentPolicyVersion: "assignment-v2",
        reviewPolicyVersion: "review-v2", technicalRetryLimit: 3, technicalRetryDelaysMs: [1000, 2000, 4000], requestTimeoutMs: 60000,
        activeRunId: null,
        lastRunAt: null, lastSuccessfulRunAt: null, lastFailureAt: null, lastFailureCode: null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: 1,
      });
      transaction.update(started.reservation, { uid: rootUid, profileId: rootUid, siteId: siteRef.id, state: "active", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(started.operation, { siteId: siteRef.id, authUid: rootUid, profileId: rootUid, status: "completed", lastCompletedStep: "firestore_committed", updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: siteRef.id, siteNameSnapshot: input.name.trim(), action: "site_created", resourceType: "Site", resourceId: siteRef.id, outcome: "succeeded", after: { status: "active", rootSupervisorUid: rootUid, widthMeters: input.widthMeters, heightMeters: input.heightMeters }, requestId }));
    });
    return { siteId: siteRef.id, rootSupervisorUid: rootUid, replayed: false };
  } catch (error) {
    await compensateIdentityOperation({ operation: started.operation, reservation: started.reservation, authUid: rootUid, errorCode: "site_root_provision_failed" });
    await writeV2AuditEvent({ actor, siteId: null, siteNameSnapshot: input.name.trim(), action: "site_created", resourceType: "Site", outcome: "failed", errorCode: "site_root_provision_failed", requestId }).catch(() => undefined);
    throw error;
  }
}

export async function updateV2SiteStatus(siteId: string, status: "active" | "inactive", reason: string, actor: AuditActor, requestId: string) {
  const ref = firestore.collection("sites").doc(siteId);
  const operationRef = firestore.collection("siteOperations").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  let before: Record<string, unknown> = {};
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new HttpError(404, "Site not found.");
    before = current.data()!;
    if (before.status === status) throw new HttpError(409, `Site is already ${status}.`);
    if (status === "active" && before.deactivationOperationId) {
      const priorOperation = await transaction.get(firestore.collection("siteOperations").doc(String(before.deactivationOperationId)));
      if (priorOperation.data()?.status !== "completed") throw new HttpError(409, "Site deactivation cleanup must complete before reactivation.");
    }
    transaction.create(operationRef, {
      schemaVersion: V2_SCHEMA_VERSION, operationId: operationRef.id, siteId, type: status === "inactive" ? "deactivate" : "reactivate",
      status: status === "inactive" ? "pending" : "completed", reason, requestedByUid: actor.uid, requestId,
      counts: {}, cursorState: {}, lastErrorCode: null, createdAt: FieldValue.serverTimestamp(), startedAt: null,
      updatedAt: FieldValue.serverTimestamp(), completedAt: status === "active" ? FieldValue.serverTimestamp() : null,
    });
    transaction.update(ref, { status, deactivatedAt: status === "inactive" ? FieldValue.serverTimestamp() : null, deactivatedByUid: status === "inactive" ? actor.uid : null, deactivationOperationId: status === "inactive" ? operationRef.id : null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    if (status === "inactive") transaction.set(firestore.collection("orchestratorConfigs").doc(siteId), { status: "paused", pausedAt: FieldValue.serverTimestamp(), pausedByUid: actor.uid, pauseReason: "site_deactivated", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) }, { merge: true });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(before.name ?? ""), action: status === "inactive" ? "site_deactivated" : "site_reactivated", resourceType: "Site", resourceId: siteId, outcome: "succeeded", reason, before: { status: before.status }, after: { status, operationId: operationRef.id }, requestId }));
  });
  if (status === "inactive") {
    for (let page = 0; page < 12; page += 1) {
      try { if ((await reconcileV2SiteOperation(siteId, operationRef.id)).status === "completed") break; }
      catch { break; } // Durable pending operation will resume on the maintenance tick.
    }
  }
  return { ...before, id: siteId, status, operationId: operationRef.id, deactivationOperationId: status === "inactive" ? operationRef.id : null, createdAt: iso(before.createdAt), updatedAt: new Date().toISOString() };
}

export async function recoverV2Root(input: {
  siteId: string; mode: "reset_existing" | "replace"; email?: string; password: string; displayName: string; reason: string; idempotencyKey: string;
}, actor: AuditActor & { uid: string }, requestId: string) {
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const site = await siteRef.get();
  if (!site.exists) throw new HttpError(404, "Site not found.");
  const currentRootUid = String(site.data()?.rootSupervisorUid ?? "");
  if (input.mode === "reset_existing") {
    if (!currentRootUid) throw new HttpError(409, "Site has no Root Supervisor reference. Replace the Root account instead.");
    await firebaseAuth.updateUser(currentRootUid, { password: input.password, displayName: input.displayName.trim(), disabled: false });
    const auditRef = firestore.collection("auditEvents").doc();
    await firestore.runTransaction(async (transaction) => {
      const [profile, account] = await Promise.all([transaction.get(firestore.collection("supervisors").doc(currentRootUid)), transaction.get(firestore.collection("userAccounts").doc(currentRootUid))]);
      if (!profile.exists || !account.exists || profile.data()?.siteId !== input.siteId || account.data()?.siteId !== input.siteId) throw new HttpError(409, "Root Supervisor profile is incomplete.");
      transaction.update(profile.ref, { fullName: input.displayName.trim(), status: "active", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, deactivatedAt: null, deactivatedByUid: null, revision: FieldValue.increment(1) });
      transaction.update(account.ref, { displayName: input.displayName.trim(), status: "active", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
      transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "root_recovered", resourceType: "Supervisor", resourceId: currentRootUid, outcome: "succeeded", reason: input.reason, after: { mode: input.mode, status: "active" }, requestId }));
    });
    return { rootSupervisorUid: currentRootUid, mode: input.mode };
  }
  if (!input.email) throw new HttpError(400, "email is required when replacing the Root Supervisor.");
  const operationId = identityOperationId(actor.uid, "recover_root", input.idempotencyKey);
  const started = await beginIdentityOperation({ operationId, type: "recover_root", siteId: input.siteId, email: input.email, actorUid: actor.uid, requestId, request: input });
  if (started.replay) return { rootSupervisorUid: started.authUid, mode: input.mode };
  let newUid: string | null = null;
  try {
    newUid = (await createIdentityAuthUser({ operation: started.operation, email: input.email, password: input.password, displayName: input.displayName })).uid;
    const auditRef = firestore.collection("auditEvents").doc();
    await firestore.runTransaction(async (transaction) => {
      const [currentSite, operation, reservation] = await Promise.all([transaction.get(siteRef), transaction.get(started.operation), transaction.get(started.reservation)]);
      const liveRootUid = String(currentSite.data()?.rootSupervisorUid ?? "");
      if (!currentSite.exists || liveRootUid !== currentRootUid) throw new HttpError(409, "Root Supervisor changed during recovery.");
      const [currentProfile, currentAccount] = currentRootUid ? await Promise.all([
        transaction.get(firestore.collection("supervisors").doc(currentRootUid)),
        transaction.get(firestore.collection("userAccounts").doc(currentRootUid)),
      ]) : [null, null];
      if (currentRootUid && (!currentProfile?.exists || !currentAccount?.exists)) throw new HttpError(409, "Root recovery state is incomplete.");
      if (operation.data()?.status !== "auth_created" || reservation.data()?.operationId !== operationId) throw new HttpError(409, "Root recovery state is incomplete.");
      transaction.create(firestore.collection("userAccounts").doc(newUid!), { schemaVersion: V2_SCHEMA_VERSION, uid: newUid, role: "supervisor", siteId: input.siteId, profileId: newUid, authority: "root", emailNormalized: normalizeIdentityEmail(input.email!), displayName: input.displayName.trim(), status: "active", lastLoginAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: 1 });
      transaction.create(firestore.collection("supervisors").doc(newUid!), { schemaVersion: V2_SCHEMA_VERSION, uid: newUid, siteId: input.siteId, authority: "root", fullName: input.displayName.trim(), phone: null, status: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, deactivatedAt: null, deactivatedByUid: null, revision: 1 });
      if (currentProfile && currentAccount) {
        transaction.update(currentProfile.ref, { authority: "regular", status: "inactive", deactivatedAt: FieldValue.serverTimestamp(), deactivatedByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
        transaction.update(currentAccount.ref, { authority: "regular", status: "inactive", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
      }
      transaction.update(siteRef, { rootSupervisorUid: newUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
      transaction.update(started.reservation, { uid: newUid, profileId: newUid, state: "active", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(started.operation, { authUid: newUid, profileId: newUid, status: "completed", lastCompletedStep: "firestore_committed", updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "root_replaced", resourceType: "Supervisor", resourceId: newUid, outcome: "succeeded", reason: input.reason, before: { rootSupervisorUid: currentRootUid }, after: { rootSupervisorUid: newUid }, requestId }));
    });
    if (currentRootUid) await firebaseAuth.updateUser(currentRootUid, { disabled: true });
    return { rootSupervisorUid: newUid, mode: input.mode };
  } catch (error) {
    await compensateIdentityOperation({ operation: started.operation, reservation: started.reservation, authUid: newUid, errorCode: "root_recovery_failed" });
    await writeV2AuditEvent({ actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "root_replaced", resourceType: "Supervisor", outcome: "failed", reason: input.reason, errorCode: "root_recovery_failed", requestId }).catch(() => undefined);
    throw error;
  }
}
