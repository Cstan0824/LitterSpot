import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { createV2AlertWorkOrder, recordV2CameraVerificationObservation } from "./services/v2WorkOrderService.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await response.json() as { idToken: string }).idToken;
}

run("V2 Work Order and Verification", () => {
  const suffix = randomUUID();
  const rootUid = `work-root-${suffix}`;
  const cleanerUid = `work-cleaner-auth-${suffix}`;
  const rootEmail = `${rootUid}@example.test`;
  const cleanerEmail = `${cleanerUid}@example.test`;
  const password = "Work-emulator-password-123!";
  const siteId = `work-site-${suffix}`;
  const mapId = `work-map-${suffix}`;
  const zoneId = `work-zone-${suffix}`;
  const cameraId = `work-camera-${suffix}`;
  const cleanerId = `work-cleaner-${suffix}`;
  const secondCleanerId = `work-cleaner-2-${suffix}`;
  const secondCleanerUid = `work-cleaner-auth-2-${suffix}`;
  const secondCleanerEmail = `${secondCleanerUid}@example.test`;
  const alertId = `work-alert-${suffix}`;
  let rootToken = "";
  let cleanerToken = "";
  let workOrderId = "";

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: rootUid, email: rootEmail, password, displayName: "Work Root" });
    await firebaseAuth.createUser({ uid: cleanerUid, email: cleanerEmail, password, displayName: "Work Cleaner" });
    await firebaseAuth.createUser({ uid: secondCleanerUid, email: secondCleanerEmail, password, displayName: "Second Cleaner" });
    await firestore.collection("userAccounts").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, role: "supervisor", siteId, profileId: rootUid, authority: "root", emailNormalized: rootEmail, displayName: "Work Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, siteId, authority: "root", fullName: "Work Root", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(cleanerUid).set({ schemaVersion: 2, uid: cleanerUid, role: "cleaner", siteId, profileId: cleanerId, authority: null, emailNormalized: cleanerEmail, displayName: "Work Cleaner", status: "active", revision: 1 });
    await firestore.collection("cleaners").doc(cleanerId).set({ schemaVersion: 2, cleanerId, authUid: cleanerUid, siteId, staffCode: "WORK-001", staffCodeNormalized: "WORK-001", fullName: "Work Cleaner", phone: "+60123456789", status: "active", availabilityOverride: "none", weeklySchedule: { mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 }, thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 } }, scheduleTimeZone: "Asia/Kuala_Lumpur", activeWorkOrderId: null, revision: 1 });
    await firestore.collection("userAccounts").doc(secondCleanerUid).set({ schemaVersion: 2, uid: secondCleanerUid, role: "cleaner", siteId, profileId: secondCleanerId, authority: null, emailNormalized: secondCleanerEmail, displayName: "Second Cleaner", status: "active", revision: 1 });
    await firestore.collection("cleaners").doc(secondCleanerId).set({ schemaVersion: 2, cleanerId: secondCleanerId, authUid: secondCleanerUid, siteId, staffCode: "WORK-002", staffCodeNormalized: "WORK-002", fullName: "Second Cleaner", phone: "+60123456780", status: "active", availabilityOverride: "none", weeklySchedule: { mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 }, thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 } }, scheduleTimeZone: "Asia/Kuala_Lumpur", activeWorkOrderId: null, revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Work Site", timeZone: "Asia/Kuala_Lumpur", status: "active", rootSupervisorUid: rootUid, activeMapRevisionId: mapId, revision: 1 });
    const map = firestore.collection("siteMapRevisions").doc(mapId);
    await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100 });
    await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] });
    await map.collection("cleanerStations").doc(cleanerId).set({ schemaVersion: 2, siteId, cleanerId, cleanerNameSnapshot: "Work Cleaner", point: { xMeters: 10, yMeters: 10 }, zoneId });
    await map.collection("cleanerStations").doc(secondCleanerId).set({ schemaVersion: 2, siteId, cleanerId: secondCleanerId, cleanerNameSnapshot: "Second Cleaner", point: { xMeters: 12, yMeters: 10 }, zoneId });
    await map.collection("cameraPlacements").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, zoneId, zoneNameSnapshot: "Main Zone", point: { xMeters: 20, yMeters: 20 } });
    await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId, name: "Work Camera", status: "active" });
    await firestore.collection("alerts").doc(alertId).set({ schemaVersion: 2, alertId, siteId, mapRevisionId: mapId, zoneId, zoneNameSnapshot: "Main Zone", cameraId, cameraNameSnapshot: "Work Camera", issueType: "floor_litter", observedCondition: "litter", status: "waiting_for_cleaner", severity: "warning", highestSeverity: "warning", priorityScore: 40, activeWorkOrderId: null, managementMode: "orchestrated", isSimulation: false, revision: 1 });
    rootToken = await signIn(rootEmail, password);
    cleanerToken = await signIn(cleanerEmail, password);
  });

  afterAll(async () => { await firebaseAuth.deleteUser(rootUid).catch(() => undefined); await firebaseAuth.deleteUser(cleanerUid).catch(() => undefined); await firebaseAuth.deleteUser(secondCleanerUid).catch(() => undefined); });

  it("assigns atomically, applies failed and passed Verification, and releases the Cleaner", async () => {
    const assignment = await request(app).post(`/api/alerts/${alertId}/manual-assignment`).set("Authorization", `Bearer ${rootToken}`).send({ assignedCleanerId: cleanerId, idempotencyKey: `assign-${suffix}` });
    expect(assignment.status).toBe(201);
    workOrderId = assignment.body.workOrder.id;
    expect(assignment.body.workOrder).toMatchObject({ origin: "alert", status: "assigned", assignedCleanerId: cleanerId, managementMode: "manual" });
    expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()?.activeWorkOrderId).toBe(workOrderId);
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("assigned");

    expect((await request(app).post(`/api/cleaner/work-orders/${workOrderId}/accept`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `accept-${suffix}` })).status).toBe(404);
    expect((await request(app).post(`/api/cleaner/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `start-${suffix}` })).status).toBe(200);
    expect((await request(app).post(`/api/cleaner/work-orders/${workOrderId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `submit-${suffix}` })).status).toBe(200);

    const awaiting = await request(app).get(`/api/work-orders/${workOrderId}`).set("Authorization", `Bearer ${rootToken}`);
    const verificationList = await request(app).get(`/api/work-orders/${workOrderId}/verifications`).set("Authorization", `Bearer ${rootToken}`);
    expect(verificationList.status).toBe(200);
    expect(verificationList.body.verifications[0]).toMatchObject({ kind: "camera_deterministic", status: "collecting", requiredSampleCount: 3 });
    const failed = await request(app).post(`/api/work-orders/${workOrderId}/verification`).set("Authorization", `Bearer ${rootToken}`).send({ outcome: "failed", expectedRevision: awaiting.body.workOrder.revision, idempotencyKey: `verify-failed-${suffix}` });
    expect(failed.status).toBe(200);
    expect(failed.body.workOrder.status).toBe("in_progress");
    expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()?.activeWorkOrderId).toBe(workOrderId);

    await request(app).post(`/api/cleaner/work-orders/${workOrderId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `submit-${suffix}-2` });
    const awaitingAgain = await request(app).get(`/api/work-orders/${workOrderId}`).set("Authorization", `Bearer ${rootToken}`);
    const passed = await request(app).post(`/api/work-orders/${workOrderId}/verification`).set("Authorization", `Bearer ${rootToken}`).send({ outcome: "passed", expectedRevision: awaitingAgain.body.workOrder.revision, idempotencyKey: `verify-passed-${suffix}` });
    expect(passed.status).toBe(200);
    expect(passed.body.workOrder.status).toBe("resolved");
    expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()?.activeWorkOrderId).toBeNull();
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("resolved");
  });

  it("requires completion evidence for coordinate Work", async () => {
    const manual = await request(app).post("/api/work-orders/manual").set("Authorization", `Bearer ${rootToken}`).send({ title: "Inspect entrance", instructions: "Clean the entrance floor and inspect the mat.", severity: "warning", assignedCleanerId: cleanerId, target: { type: "coordinate", point: { xMeters: 50, yMeters: 50 } }, idempotencyKey: `manual-${suffix}` });
    expect(manual.status).toBe(201);
    const manualId = manual.body.workOrder.id;
    expect((await request(app).post(`/api/cleaner/work-orders/${manualId}/start`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `manual-start-${suffix}` })).status).toBe(200);
    const missing = await request(app).post(`/api/cleaner/work-orders/${manualId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `manual-submit-${suffix}` });
    expect(missing.status).toBe(400);
    const evidence = await request(app).post(`/api/cleaner/work-orders/${manualId}/completion-evidence`).set("Authorization", `Bearer ${cleanerToken}`).attach("photo", jpeg, { filename: "completion.jpg", contentType: "image/jpeg" });
    expect(evidence.status).toBe(201);
    const submitted = await request(app).post(`/api/cleaner/work-orders/${manualId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `manual-submit-${suffix}-2`, completionEvidenceMediaId: evidence.body.evidence.mediaId });
    expect(submitted.status).toBe(200);
    expect(submitted.body.workOrder.status).toBe("awaiting_review");
    const resolved = await request(app).post(`/api/work-orders/${manualId}/verification`).set("Authorization", `Bearer ${rootToken}`).send({ outcome: "passed", reason: "Completion photo accepted", expectedRevision: submitted.body.workOrder.revision, idempotencyKey: `manual-resolve-${suffix}` });
    expect(resolved.status).toBe(200);
    expect(resolved.body.workOrder.status).toBe("resolved");
  });

  it("applies deterministic Camera samples for orchestrated Work and allows Supervisor override after inconclusive evidence", async () => {
    const automatedAlert = `automated-alert-${suffix}`;
    await firestore.collection("alerts").doc(automatedAlert).set({ schemaVersion: 2, alertId: automatedAlert, siteId, mapRevisionId: mapId, zoneId, zoneNameSnapshot: "Main Zone", cameraId, cameraNameSnapshot: "Work Camera", issueType: "floor_spill", observedCondition: "spill", status: "waiting_for_cleaner", severity: "critical", activeWorkOrderId: null, managementMode: "orchestrated", isSimulation: false, revision: 1 });
    const automated = await createV2AlertWorkOrder({ siteId, alertId: automatedAlert, assignedCleanerId: cleanerId, idempotencyKey: `auto-${suffix}` }, { uid: "orchestrator-test", role: "supervisor", authority: null, displayName: "Orchestrator", type: "orchestrator" }, `auto-${suffix}`);
    await request(app).post(`/api/cleaner/work-orders/${automated.id}/start`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `auto-start-${suffix}` });
    await request(app).post(`/api/cleaner/work-orders/${automated.id}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `auto-submit-${suffix}` });
    for (let index = 1; index <= 2; index += 1) await recordV2CameraVerificationObservation(siteId, cameraId, { sampleId: `clear-${suffix}-${index}`, capturedAtMs: Date.now() + index, peopleCount: 0, issues: [], binStates: [], modelVersions: {}, isSimulation: false });
    expect((await firestore.collection("workOrders").doc(automated.id).get()).data()?.status).toBe("resolved");

    const binAlert = `bin-alert-${suffix}`;
    await firestore.collection("alerts").doc(binAlert).set({ schemaVersion: 2, alertId: binAlert, siteId, mapRevisionId: mapId, zoneId, zoneNameSnapshot: "Main Zone", cameraId, cameraNameSnapshot: "Work Camera", issueType: "bin_service", observedCondition: "full", status: "waiting_for_cleaner", severity: "warning", activeWorkOrderId: null, managementMode: "orchestrated", isSimulation: false, revision: 1 });
    const binWork = await createV2AlertWorkOrder({ siteId, alertId: binAlert, assignedCleanerId: cleanerId, idempotencyKey: `bin-auto-${suffix}` }, { uid: "orchestrator-test", role: "supervisor", authority: null, displayName: "Orchestrator", type: "orchestrator" }, `bin-auto-${suffix}`);
    await request(app).post(`/api/cleaner/work-orders/${binWork.id}/start`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `bin-start-${suffix}` });
    await request(app).post(`/api/cleaner/work-orders/${binWork.id}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `bin-submit-${suffix}` });
    await recordV2CameraVerificationObservation(siteId, cameraId, { sampleId: `unknown-${suffix}`, capturedAtMs: Date.now(), peopleCount: 0, issues: [], binStates: [{ binId: "bin-1", state: "unknown" }], modelVersions: {}, isSimulation: false });
    const inconclusive = await request(app).get(`/api/work-orders/${binWork.id}`).set("Authorization", `Bearer ${rootToken}`);
    expect(inconclusive.body.workOrder).toMatchObject({ status: "awaiting_review", latestVerificationOutcome: "inconclusive" });
    const override = await request(app).post(`/api/work-orders/${binWork.id}/verification/override`).set("Authorization", `Bearer ${rootToken}`).send({ outcome: "passed", reason: "Supervisor inspected the Camera manually", expectedRevision: inconclusive.body.workOrder.revision, idempotencyKey: `override-${suffix}` });
    expect(override.status).toBe(200);
    expect(override.body.workOrder.status).toBe("resolved");
  });

  it("audits Supervisor takeover, replacement, and linked dismissal", async () => {
    const takeoverAlert = `takeover-alert-${suffix}`;
    await firestore.collection("alerts").doc(takeoverAlert).set({ schemaVersion: 2, alertId: takeoverAlert, siteId, mapRevisionId: mapId, zoneId, zoneNameSnapshot: "Main Zone", cameraId, cameraNameSnapshot: "Work Camera", issueType: "floor_litter", observedCondition: "litter", status: "waiting_for_cleaner", severity: "warning", activeWorkOrderId: null, managementMode: "orchestrated", isSimulation: false, revision: 1 });
    const work = await createV2AlertWorkOrder({ siteId, alertId: takeoverAlert, assignedCleanerId: cleanerId, idempotencyKey: `takeover-work-${suffix}` }, { uid: "orchestrator-test", role: "supervisor", authority: null, displayName: "Orchestrator", type: "orchestrator" }, `takeover-work-${suffix}`);
    const takeover = await request(app).post(`/api/work-orders/${work.id}/takeover`).set("Authorization", `Bearer ${rootToken}`).send({ reason: "Supervisor is taking control", idempotencyKey: `takeover-${suffix}` });
    expect(takeover.status).toBe(200); expect(takeover.body.workOrder.managementMode).toBe("manual");
    const reassigned = await request(app).post(`/api/work-orders/${work.id}/reassign`).set("Authorization", `Bearer ${rootToken}`).send({ assignedCleanerId: secondCleanerId, reason: "Second Cleaner is closer", expectedRevision: takeover.body.workOrder.revision, idempotencyKey: `reassign-${suffix}` });
    expect(reassigned.status).toBe(200); expect(reassigned.body.workOrder.assignedCleanerId).toBe(secondCleanerId); expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()?.activeWorkOrderId).toBeNull();
    const dismissed = await request(app).post(`/api/work-orders/${work.id}/dismiss`).set("Authorization", `Bearer ${rootToken}`).send({ reason: "Issue no longer requires action", expectedRevision: reassigned.body.workOrder.revision, idempotencyKey: `dismiss-${suffix}` });
    expect(dismissed.status).toBe(200); expect(dismissed.body.workOrder.status).toBe("dismissed"); expect((await firestore.collection("alerts").doc(takeoverAlert).get()).data()?.status).toBe("dismissed"); expect((await firestore.collection("cleaners").doc(secondCleanerId).get()).data()?.activeWorkOrderId).toBeNull();
    const audits = await firestore.collection("auditEvents").where("siteId", "==", siteId).get(); const actions = audits.docs.map((document) => document.data().action); expect(actions).toEqual(expect.arrayContaining(["work_order_takeover", "work_order_reassigned", "work_order_dismissed"]));
  });
});
