import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { app } from "./app.js";
import { runLocationHistoryRetention } from "./services/locationRetentionService.js";
import { activeWorkOrderKeyId } from "./shared/workOrderKeys.js";

const emulatorDescribe = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;
const prefix = `cleaner-operations-${process.pid}`;
const supervisorUid = `${prefix}-supervisor`;
const supervisorEmail = `${supervisorUid}@example.test`;
const supervisorPassword = "Supervisor-emulator-password-123!";
const cleanerEmail = `${prefix}-cleaner@example.test`;
const cleanerPassword = "Cleaner-emulator-password-123!";
const siteId = `${prefix}-site`;
const zoneId = `${prefix}-zone`;
const alertId = `${prefix}-alert`;
const secondAlertId = `${prefix}-alert-2`;
let supervisorToken = "";
let cleanerToken = "";
let cleanerId = "";
let cleanerUid = "";
let workOrderId = "";
let secondCleanerId = "";
let secondCleanerUid = "";
let secondCleanerToken = "";
let secondWorkOrderId = "";
let conflictCleanerId = "";
const conflictAuthUid = `${prefix}-conflict-auth`;

async function signIn(email: string, password: string) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const result = await response.json() as { idToken?: string; error?: unknown };
  if (!response.ok || !result.idToken) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(result.error)}`);
  return result.idToken;
}

function asSupervisor(method: "get" | "post" | "patch" | "delete", path: string) {
  return request(app)[method](path).set("Authorization", `Bearer ${supervisorToken}`);
}

function asCleaner(method: "get" | "put" | "post" | "delete", path: string, token = cleanerToken) {
  return request(app)[method](path).set("Authorization", `Bearer ${token}`);
}

async function deleteQuery(collection: string, field: string, value: string) {
  const snapshot = await firestore.collection(collection).where(field, "==", value).get();
  await Promise.all(snapshot.docs.map((item) => firestore.recursiveDelete(item.ref)));
}

emulatorDescribe("Phase 10-11 Cleaner identity and operations HTTP journey", () => {
  beforeAll(async () => {
    await firebaseAuth.createUser({
      uid: supervisorUid,
      email: supervisorEmail,
      password: supervisorPassword,
      displayName: "Cleaner Test Supervisor",
    });
    await firestore.collection("supervisors").doc(supervisorUid).set({
      role: "supervisor",
      status: "active",
      email: supervisorEmail,
      displayName: "Cleaner Test Supervisor",
    });
    await firestore.collection("sites").doc(siteId).set({ name: "Cleaner Test Site", status: "active", timezone: "Asia/Kuala_Lumpur" });
    await firestore.collection("zones").doc(zoneId).set({ name: "Cleaner Test Zone", siteId, status: "active" });
    supervisorToken = await signIn(supervisorEmail, supervisorPassword);
  });

  afterAll(async () => {
    if (workOrderId) await firestore.recursiveDelete(firestore.collection("workOrders").doc(workOrderId)).catch(() => undefined);
    if (secondWorkOrderId) await firestore.recursiveDelete(firestore.collection("workOrders").doc(secondWorkOrderId)).catch(() => undefined);
    if (cleanerId) {
      await deleteQuery("notifications", "recipientCleanerId", cleanerId);
      await deleteQuery("cleanerPushTokens", "cleanerId", cleanerId);
      await deleteQuery("userAccountEmails", "cleanerId", cleanerId);
      await firestore.recursiveDelete(firestore.collection("cleaners").doc(cleanerId)).catch(() => undefined);
      await firestore.collection("cleanerPresence").doc(cleanerId).delete().catch(() => undefined);
      await firestore.collection("cleanerStaffCodes").doc("cln-99101").delete().catch(() => undefined);
    }
    if (secondCleanerId) {
      await deleteQuery("notifications", "recipientCleanerId", secondCleanerId);
      await deleteQuery("cleanerPushTokens", "cleanerId", secondCleanerId);
      await deleteQuery("userAccountEmails", "cleanerId", secondCleanerId);
      await firestore.recursiveDelete(firestore.collection("cleaners").doc(secondCleanerId)).catch(() => undefined);
      await firestore.collection("cleanerPresence").doc(secondCleanerId).delete().catch(() => undefined);
      await firestore.collection("cleanerStaffCodes").doc("cln-99102").delete().catch(() => undefined);
    }
    if (conflictCleanerId) {
      await firestore.recursiveDelete(firestore.collection("cleaners").doc(conflictCleanerId)).catch(() => undefined);
      await firestore.collection("cleanerStaffCodes").doc("cln-99103").delete().catch(() => undefined);
    }
    if (workOrderId) await deleteQuery("workOrderDecisions", "workOrderId", workOrderId);
    if (secondWorkOrderId) await deleteQuery("workOrderDecisions", "workOrderId", secondWorkOrderId);
    await deleteQuery("activeWorkOrderKeys", "alertId", alertId);
    await deleteQuery("activeWorkOrderKeys", "alertId", secondAlertId);
    await firestore.collection("alerts").doc(alertId).delete().catch(() => undefined);
    await firestore.collection("alerts").doc(secondAlertId).delete().catch(() => undefined);
    await firestore.collection("zones").doc(zoneId).delete().catch(() => undefined);
    await firestore.collection("sites").doc(siteId).delete().catch(() => undefined);
    await firestore.collection("supervisors").doc(supervisorUid).delete().catch(() => undefined);
    await firestore.collection("userAccounts").doc(supervisorUid).delete().catch(() => undefined);
    if (cleanerUid) await firestore.collection("userAccounts").doc(cleanerUid).delete().catch(() => undefined);
    if (cleanerUid) await firebaseAuth.deleteUser(cleanerUid).catch(() => undefined);
    if (secondCleanerUid) await firestore.collection("userAccounts").doc(secondCleanerUid).delete().catch(() => undefined);
    if (secondCleanerUid) await firebaseAuth.deleteUser(secondCleanerUid).catch(() => undefined);
    await firebaseAuth.deleteUser(conflictAuthUid).catch(() => undefined);
    await firebaseAuth.deleteUser(supervisorUid).catch(() => undefined);
  });

  it("provisions identities, enforces roles, and completes a rework-capable work order", async () => {
    const createdCleaner = await asSupervisor("post", "/api/cleaners").send({
      staffCode: "CLN-99101",
      fullName: "Emulator Cleaner",
      phone: "+60 12-345 6789",
      assignedZoneId: zoneId,
      capabilities: ["floor_litter"],
    });
    expect(createdCleaner.status).toBe(201);
    cleanerId = createdCleaner.body.cleaner.id;
    expect(createdCleaner.body.cleaner).toMatchObject({ accountStatus: "not_provisioned", authUid: null });

    const provisioned = await asSupervisor("post", `/api/cleaners/${cleanerId}/account`).send({ email: cleanerEmail });
    expect(provisioned.status).toBe(201);
    expect(provisioned.body.setupLink).toContain("mode=resetPassword");
    cleanerUid = provisioned.body.cleaner.authUid;
    expect(cleanerUid).toBe(`cleaner-${cleanerId}`);
    const provisionReplay = await asSupervisor("post", `/api/cleaners/${cleanerId}/account`).send({ email: cleanerEmail });
    expect(provisionReplay.status).toBe(200);
    expect(provisionReplay.body.idempotent).toBe(true);
    await firebaseAuth.updateUser(cleanerUid, { password: cleanerPassword });
    cleanerToken = await signIn(cleanerEmail, cleanerPassword);

    const cleanerSession = await asCleaner("get", "/api/me");
    expect(cleanerSession.status).toBe(200);
    expect(cleanerSession.body).toMatchObject({ role: "cleaner", cleaner: { cleanerId } });
    expect((await asCleaner("get", "/api/sites")).status).toBe(403);
    expect((await asSupervisor("get", "/api/cleaner/me")).status).toBe(403);

    const heartbeatBody = {
      availability: "online",
      locationConsent: true,
      clientHeartbeatId: `${prefix}-heartbeat-001`,
      location: {
        latitude: 3.2379,
        longitude: 101.684,
        accuracyMeters: 12,
        capturedAt: new Date().toISOString(),
        source: "browser_geolocation",
      },
    };
    const heartbeat = await asCleaner("put", "/api/cleaner/presence").send(heartbeatBody);
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body).toMatchObject({ idempotent: false, presence: { availability: "online", locationStatus: "fresh" } });
    const replayedHeartbeat = await asCleaner("put", "/api/cleaner/presence").send(heartbeatBody);
    expect(replayedHeartbeat.body.idempotent).toBe(true);
    const conflictingHeartbeat = await asCleaner("put", "/api/cleaner/presence").send({
      ...heartbeatBody,
      location: { ...heartbeatBody.location, latitude: 4.0 },
    });
    expect(conflictingHeartbeat.status).toBe(409);
    const retentionDryRun = await runLocationHistoryRetention({
      execute: false,
      pageSize: 10,
      now: new Date(Date.now() + 8 * 24 * 60 * 60_000),
    });
    expect(retentionDryRun).toMatchObject({ eligible: 1, deleted: 0 });
    const retentionExecution = await runLocationHistoryRetention({
      execute: true,
      pageSize: 10,
      now: new Date(Date.now() + 8 * 24 * 60 * 60_000),
    });
    expect(retentionExecution).toMatchObject({ eligible: 1, deleted: 1 });

    await firestore.collection("alerts").doc(alertId).set({
      workflowVersion: "grouped-temporal-v2",
      status: "new",
      siteId,
      siteName: "Cleaner Test Site",
      zoneId,
      zoneName: "Cleaner Test Zone",
      issueType: "floor_litter",
      severity: "warning",
      lastDetectedAt: new Date(),
    });

    const createdWork = await asSupervisor("post", "/api/work-orders").send({
      alertId,
      assignedCleanerId: cleanerId,
      instructions: "Clean the litter near the lower staircase.",
      assignmentDecisionId: `${prefix}-decision-001`,
      idempotencyKey: `${prefix}-work-001`,
    });
    expect(createdWork.status).toBe(201);
    workOrderId = createdWork.body.workOrder.id;
    expect(createdWork.body.workOrder).toMatchObject({ status: "assigned", assignedCleanerId: cleanerId });
    const prematureAlertResolution = await asSupervisor("patch", `/api/alerts/${alertId}/status`).send({
      status: "resolved",
      note: "This must be blocked while work remains active.",
    });
    expect(prematureAlertResolution.status).toBe(409);
    const replayedWork = await asSupervisor("post", "/api/work-orders").send({
      alertId,
      assignedCleanerId: cleanerId,
      instructions: "Clean the litter near the lower staircase.",
      assignmentDecisionId: `${prefix}-decision-001`,
      idempotencyKey: `${prefix}-work-001`,
    });
    expect(replayedWork.status).toBe(200);
    expect(replayedWork.body.idempotent).toBe(true);
    const conflictingWork = await asSupervisor("post", "/api/work-orders").send({
      alertId,
      assignedCleanerId: cleanerId,
      instructions: "Different instructions using the same key.",
      assignmentDecisionId: `${prefix}-decision-001`,
      idempotencyKey: `${prefix}-work-001`,
    });
    expect(conflictingWork.status).toBe(409);

    const cleanerQueue = await asCleaner("get", "/api/cleaner/work-orders?status=active&limit=10");
    expect(cleanerQueue.status).toBe(200);
    expect(cleanerQueue.body.workOrders.map((item: { id: string }) => item.id)).toContain(workOrderId);

    for (const [action, key, expected] of [
      ["accept", "accept-001", "accepted"],
      ["start", "start-001", "in_progress"],
      ["ready-for-review", "ready-001", "ready_for_review"],
    ] as const) {
      const response = await asCleaner("post", `/api/cleaner/work-orders/${workOrderId}/${action}`)
        .send({ idempotencyKey: `${prefix}-${key}` });
      expect(response.status).toBe(200);
      expect(response.body.workOrder.status).toBe(expected);
    }

    const rework = await asSupervisor("patch", `/api/work-orders/${workOrderId}/status`).send({
      status: "rework_required",
      idempotencyKey: `${prefix}-rework-001`,
      note: "Some litter remains visible.",
    });
    expect(rework.body.workOrder.status).toBe("rework_required");
    const restarted = await asCleaner("post", `/api/cleaner/work-orders/${workOrderId}/start`).send({
      idempotencyKey: `${prefix}-start-002`,
    });
    expect(restarted.body.workOrder.status).toBe("in_progress");
    const readyAgain = await asCleaner("post", `/api/cleaner/work-orders/${workOrderId}/ready-for-review`).send({
      idempotencyKey: `${prefix}-ready-002`,
    });
    expect(readyAgain.body.workOrder.status).toBe("ready_for_review");
    const completed = await asSupervisor("patch", `/api/work-orders/${workOrderId}/status`).send({
      status: "completed",
      idempotencyKey: `${prefix}-complete-001`,
      note: "Manual Phase 11 acceptance completion.",
    });
    expect(completed.body.workOrder.status).toBe("completed");
    expect((await firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId)).get()).exists).toBe(false);

    const history = await asSupervisor("get", `/api/work-orders/${workOrderId}/history?limit=20`);
    expect(history.status).toBe(200);
    expect(history.body.history.map((item: { toStatus: string }) => item.toStatus)).toEqual([
      "completed", "ready_for_review", "in_progress", "rework_required",
      "ready_for_review", "in_progress", "accepted", "assigned",
    ]);

    const inbox = await asCleaner("get", "/api/cleaner/notifications?status=unread&limit=20");
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications.length).toBeGreaterThanOrEqual(2);
    expect(inbox.body.notifications.map((item: { type: string }) => item.type)).toEqual(expect.arrayContaining(["work_assigned", "rework_required"]));
    const notificationId = inbox.body.notifications[0].id;
    const read = await asCleaner("post", `/api/cleaner/notifications/${notificationId}/read`);
    expect(read.body.notification.status).toBe("read");

    const finalPresence = await asCleaner("get", "/api/cleaner/presence");
    expect(finalPresence.body.presence).toMatchObject({ availability: "online", activeWorkOrderId: null });

    const secondCleaner = await asSupervisor("post", "/api/cleaners").send({
      staffCode: "CLN-99102",
      fullName: "Second Emulator Cleaner",
      phone: "+60 12-345 6790",
      assignedZoneId: zoneId,
      capabilities: ["floor_litter"],
    });
    secondCleanerId = secondCleaner.body.cleaner.id;
    const secondEmail = `${prefix}-cleaner-2@example.test`;
    const secondProvisioned = await asSupervisor("post", `/api/cleaners/${secondCleanerId}/account`).send({ email: secondEmail });
    secondCleanerUid = secondProvisioned.body.cleaner.authUid;
    await firebaseAuth.updateUser(secondCleanerUid, { password: cleanerPassword });
    secondCleanerToken = await signIn(secondEmail, cleanerPassword);
    await asCleaner("put", "/api/cleaner/presence", secondCleanerToken).send({ availability: "online", locationConsent: false });

    await firestore.collection("alerts").doc(secondAlertId).set({
      workflowVersion: "grouped-temporal-v2",
      status: "new",
      siteId,
      siteName: "Cleaner Test Site",
      zoneId,
      zoneName: "Cleaner Test Zone",
      issueType: "floor_litter",
      severity: "warning",
      lastDetectedAt: new Date(),
    });
    const secondWork = await asSupervisor("post", "/api/work-orders").send({
      alertId: secondAlertId,
      assignedCleanerId: cleanerId,
      instructions: "Clean the secondary test area.",
      assignmentDecisionId: `${prefix}-decision-002`,
      idempotencyKey: `${prefix}-work-002`,
    });
    secondWorkOrderId = secondWork.body.workOrder.id;
    const rejected = await asCleaner("post", `/api/cleaner/work-orders/${secondWorkOrderId}/reject`).send({
      idempotencyKey: `${prefix}-reject-001`,
      note: "Unable to access the area.",
    });
    expect(rejected.body.workOrder.status).toBe("rejected");
    const reassigned = await asSupervisor("post", `/api/work-orders/${secondWorkOrderId}/reassign`).send({
      assignedCleanerId: secondCleanerId,
      instructions: "Take over the secondary test area.",
      assignmentDecisionId: `${prefix}-decision-003`,
      idempotencyKey: `${prefix}-reassign-001`,
      note: "Reassigned after rejection.",
    });
    expect(reassigned.body.workOrder).toMatchObject({ status: "assigned", assignedCleanerId: secondCleanerId, assignmentAttempt: 2 });
    const secondQueue = await asCleaner("get", "/api/cleaner/work-orders?status=active&limit=10", secondCleanerToken);
    expect(secondQueue.body.workOrders.map((item: { id: string }) => item.id)).toContain(secondWorkOrderId);
    const cancelled = await asSupervisor("patch", `/api/work-orders/${secondWorkOrderId}/status`).send({
      status: "cancelled",
      idempotencyKey: `${prefix}-cancel-001`,
      note: "End of reassignment acceptance test.",
    });
    expect(cancelled.body.workOrder.status).toBe("cancelled");

    const conflictEmail = `${prefix}-already-used@example.test`;
    await firebaseAuth.createUser({ uid: conflictAuthUid, email: conflictEmail, password: cleanerPassword });
    const conflictCleaner = await asSupervisor("post", "/api/cleaners").send({
      staffCode: "CLN-99103",
      fullName: "Conflict Emulator Cleaner",
      phone: "+60 12-345 6791",
      assignedZoneId: zoneId,
    });
    conflictCleanerId = conflictCleaner.body.cleaner.id;
    const conflictProvision = await asSupervisor("post", `/api/cleaners/${conflictCleanerId}/account`).send({ email: conflictEmail });
    expect(conflictProvision.status).toBe(409);
    expect((await asSupervisor("get", `/api/cleaners/${conflictCleanerId}`)).body.cleaner)
      .toMatchObject({ authUid: null, email: null, accountStatus: "not_provisioned" });

    const deactivated = await asSupervisor("delete", `/api/cleaners/${cleanerId}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.cleaner).toMatchObject({ status: "inactive", accountStatus: "disabled" });
    expect([401, 403]).toContain((await asCleaner("get", "/api/cleaner/me")).status);
  });
});
