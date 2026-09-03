import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { v2AuditEventData, writeV2AuditEvent, type AuditActor } from "./v2AuditService.js";
import { deriveCleanerAvailability, type WeeklySchedule } from "./v2CleanerAvailability.js";
import { beginIdentityOperation, compensateIdentityOperation, createIdentityAuthUser, identityOperationId, normalizeIdentityEmail } from "./v2IdentityService.js";
import { canonicalHash } from "./v2Persistence.js";
import { publishV2CleanerStation } from "./v2MapService.js";
import { enqueueV2ImmediateAssignmentTrigger } from "./v2OrchestratorTriggers.js";

const timestamp = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
const normalizeStaffCode = (value: string) => value.trim().toUpperCase();
const staffKeyId = (siteId: string, code: string) => canonicalHash("v2-cleaner-staff-code", siteId, normalizeStaffCode(code));

async function releaseStaffKeyIfOwned(reference: FirebaseFirestore.DocumentReference, cleanerId: string) {
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists && current.data()?.cleanerId === cleanerId) transaction.delete(reference);
  });
}

async function stationForCleaner(siteId: string, cleanerId: string, activeRevisionId: string) {
  const station = await firestore.collection("siteMapRevisions").doc(activeRevisionId).collection("cleanerStations").doc(cleanerId).get();
  if (!station.exists || station.data()?.siteId !== siteId || !station.data()?.point) return null;
  return { point: station.data()?.point, zoneId: typeof station.data()?.zoneId === "string" ? String(station.data()?.zoneId) : null, mapRevisionId: activeRevisionId };
}

export async function presentV2Cleaner(cleanerId: string, expectedSiteId: string, at = new Date()) {
  const cleaner = await firestore.collection("cleaners").doc(cleanerId).get();
  if (!cleaner.exists || cleaner.data()?.schemaVersion !== 2 || cleaner.data()?.siteId !== expectedSiteId) throw new HttpError(404, "Cleaner not found.");
  const data = cleaner.data()!;
  const [site, account] = await Promise.all([firestore.collection("sites").doc(expectedSiteId).get(), firestore.collection("userAccounts").doc(String(data.authUid)).get()]);
  if (!site.exists) throw new HttpError(409, "Cleaner Site is missing.");
  const station = await stationForCleaner(expectedSiteId, cleanerId, String(site.data()?.activeMapRevisionId ?? ""));
  const availability = deriveCleanerAvailability({ siteActive: site.data()?.status === "active", accountActive: account.exists && account.data()?.status === "active", cleanerActive: data.status === "active", availabilityOverride: data.availabilityOverride === "unavailable" ? "unavailable" : "none", activeWorkOrderId: data.activeWorkOrderId == null ? null : String(data.activeWorkOrderId), stationPointValid: Boolean(station), schedule: data.weeklySchedule ?? {}, scheduleTimeZone: String(data.scheduleTimeZone ?? site.data()?.timeZone), at });
  return { id: cleaner.id, ...data, stationPoint: station?.point ?? null, stationZoneId: station?.zoneId ?? null, mapRevisionId: station?.mapRevisionId ?? null, availability, createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt), deactivatedAt: timestamp(data.deactivatedAt) };
}

export async function listV2Cleaners(siteId: string, status: "active" | "inactive" | "all" = "all") {
  const snapshot = await firestore.collection("cleaners").where("siteId", "==", siteId).limit(500).get();
  const profiles = snapshot.docs.filter((document) => document.data().schemaVersion === 2 && (status === "all" || document.data().status === status));
  return Promise.all(profiles.map((document) => presentV2Cleaner(document.id, siteId)));
}

export async function createV2Cleaner(input: {
  siteId: string; staffCode: string; fullName: string; phone: string; email: string; password: string; notes?: string | null;
  profileMediaId?: string | null; weeklySchedule: WeeklySchedule; stationPoint: { xMeters: number; yMeters: number }; idempotencyKey: string;
}, actor: AuditActor & { uid: string }, requestId: string) {
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  const operationId = identityOperationId(actor.uid, "create_cleaner", input.idempotencyKey);
  const started = await beginIdentityOperation({ operationId, type: "create_cleaner", siteId: input.siteId, email: input.email, actorUid: actor.uid, requestId, request: input });
  if (started.replay) return presentV2Cleaner(started.profileId, input.siteId);
  const cleanerRef = firestore.collection("cleaners").doc();
  const code = normalizeStaffCode(input.staffCode);
  const staffKey = firestore.collection("cleanerStaffCodeKeys").doc(staffKeyId(input.siteId, code));
  let uid: string | null = null;
  try {
    uid = (await createIdentityAuthUser({ operation: started.operation, email: input.email, password: input.password, displayName: input.fullName })).uid;
    await firestore.runTransaction(async (transaction) => {
      const [operation, reservation, existingCode] = await Promise.all([transaction.get(started.operation), transaction.get(started.reservation), transaction.get(staffKey)]);
      if (operation.data()?.status !== "auth_created" || reservation.data()?.operationId !== operationId) throw new HttpError(409, "Cleaner identity operation state changed.");
      if (existingCode.exists) throw new HttpError(409, "Staff code is already registered for this Site.");
      transaction.create(staffKey, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, staffCodeNormalized: code, cleanerId: cleanerRef.id, createdAt: FieldValue.serverTimestamp() });
      transaction.create(cleanerRef, { schemaVersion: V2_SCHEMA_VERSION, cleanerId: cleanerRef.id, authUid: uid, siteId: input.siteId, staffCode: code, staffCodeNormalized: code, fullName: input.fullName.trim(), phone: input.phone.trim(), profileMediaId: input.profileMediaId ?? null, notes: input.notes?.trim() || null, status: "active", availabilityOverride: "none", availabilityOverrideAt: null, availabilityOverrideByUid: null, weeklySchedule: input.weeklySchedule, scheduleTimeZone: String(site.data()?.timeZone), activeWorkOrderId: null, activeWorkAssignedAt: null, lastResolvedWorkOrderId: null, lastResolvedWorkTarget: null, lastResolvedWorkAt: null, lastResolvedMapRevisionId: null, createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, deactivatedAt: null, deactivatedByUid: null, revision: 1 });
      transaction.create(firestore.collection("userAccounts").doc(uid!), { schemaVersion: V2_SCHEMA_VERSION, uid, role: "cleaner", siteId: input.siteId, profileId: cleanerRef.id, authority: null, emailNormalized: normalizeIdentityEmail(input.email), displayName: input.fullName.trim(), status: "active", lastLoginAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: 1 });
      transaction.update(started.reservation, { uid, profileId: cleanerRef.id, state: "active", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(started.operation, { authUid: uid, profileId: cleanerRef.id, status: "firestore_committed", lastCompletedStep: "profile_created", updatedAt: FieldValue.serverTimestamp() });
    });
    await publishV2CleanerStation({ siteId: input.siteId, cleanerId: cleanerRef.id, point: input.stationPoint, actorUid: actor.uid, actorAuthority: actor.authority ?? "regular", actorName: actor.displayName, requestId });
    await started.operation.update({ status: "completed", lastCompletedStep: "station_published", completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await writeV2AuditEvent({ actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "cleaner_created", resourceType: "Cleaner", resourceId: cleanerRef.id, outcome: "succeeded", after: { staffCode: code, status: "active" }, requestId });
    return presentV2Cleaner(cleanerRef.id, input.siteId);
  } catch (error) {
    await Promise.all([cleanerRef.delete().catch(() => undefined), releaseStaffKeyIfOwned(staffKey, cleanerRef.id).catch(() => undefined), uid ? firestore.collection("userAccounts").doc(uid).delete().catch(() => undefined) : Promise.resolve()]);
    await compensateIdentityOperation({ operation: started.operation, reservation: started.reservation, authUid: uid, errorCode: "cleaner_provision_failed" });
    throw error;
  }
}

export async function updateV2Cleaner(input: { siteId: string; cleanerId: string; expectedRevision: number; fullName?: string; phone?: string; notes?: string | null; profileMediaId?: string | null; weeklySchedule?: WeeklySchedule; availabilityOverride?: "none" | "unavailable"; status?: "active" | "inactive" }, actor: AuditActor & { uid: string }, requestId: string) {
  const cleanerRef = firestore.collection("cleaners").doc(input.cleanerId);
  const accountRef = firestore.collection("userAccounts");
  let authUid = "";
  let nextStatus = "active";
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const cleaner = await transaction.get(cleanerRef);
    if (!cleaner.exists || cleaner.data()?.schemaVersion !== 2 || cleaner.data()?.siteId !== input.siteId) throw new HttpError(404, "Cleaner not found.");
    if (Number(cleaner.data()?.revision) !== input.expectedRevision) throw new HttpError(409, "The Cleaner changed. Refresh and retry.");
    if (cleaner.data()?.activeWorkOrderId && input.status === "inactive") throw new HttpError(409, "A busy Cleaner cannot be deactivated.");
    authUid = String(cleaner.data()?.authUid);
    nextStatus = input.status ?? String(cleaner.data()?.status);
    transaction.update(cleanerRef, { ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}), ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}), ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}), ...(input.profileMediaId !== undefined ? { profileMediaId: input.profileMediaId } : {}), ...(input.weeklySchedule !== undefined ? { weeklySchedule: input.weeklySchedule } : {}), ...(input.availabilityOverride !== undefined ? { availabilityOverride: input.availabilityOverride, availabilityOverrideAt: FieldValue.serverTimestamp(), availabilityOverrideByUid: actor.uid } : {}), ...(input.status !== undefined ? { status: input.status, deactivatedAt: input.status === "inactive" ? FieldValue.serverTimestamp() : null, deactivatedByUid: input.status === "inactive" ? actor.uid : null } : {}), updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    transaction.update(accountRef.doc(authUid), { ...(input.fullName !== undefined ? { displayName: input.fullName.trim() } : {}), ...(input.status !== undefined ? { status: input.status } : {}), updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, action: "cleaner_updated", resourceType: "Cleaner", resourceId: input.cleanerId, outcome: "succeeded", before: { status: cleaner.data()?.status, availabilityOverride: cleaner.data()?.availabilityOverride }, after: { status: nextStatus, availabilityOverride: input.availabilityOverride ?? cleaner.data()?.availabilityOverride }, requestId }));
  });
  await firebaseAuth.updateUser(authUid, { disabled: nextStatus === "inactive", ...(input.fullName !== undefined ? { displayName: input.fullName.trim() } : {}) });
  if (nextStatus === "active" && (input.weeklySchedule !== undefined || input.availabilityOverride === "none" || input.status === "active")) {
    await enqueueV2ImmediateAssignmentTrigger(input.siteId, "cleaner_availability_changed", `cleaner:${input.cleanerId}:${Date.now()}`);
  }
  return presentV2Cleaner(input.cleanerId, input.siteId);
}
