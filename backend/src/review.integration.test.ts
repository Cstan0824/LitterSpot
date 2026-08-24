import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { activeWorkOrderKeyId } from "./shared/workOrderKeys.js";

process.env.ORCHESTRATOR_INTERNAL_TOKEN ||= "review-integration-token";

const emulatorDescribe = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;
const prefix = `review-${process.pid}`;
const supervisorUid = `${prefix}-supervisor`;
const supervisorEmail = `${supervisorUid}@example.test`;
const supervisorPassword = "Review-supervisor-password-123!";
const cleanerUid = `${prefix}-cleaner-auth`;
const cleanerEmail = `${prefix}-cleaner@example.test`;
const cleanerPassword = "Review-cleaner-password-123!";
const siteId = `${prefix}-site`;
const zoneId = `${prefix}-zone`;
const alertId = `${prefix}-alert`;
const cleanerId = `${prefix}-cleaner`;
const workOrderId = `${prefix}-work-order`;
const activeAlertKeyId = `${prefix}-active-alert-key`;
let supervisorToken = "";
let cleanerToken = "";
let runId = "";
let claimToken = "";

const { app } = await import("./app.js");
const { firebaseAuth, firestore } = await import("./config/firebase.js");

async function signIn(email: string, password: string) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const result = await response.json() as { idToken?: string };
  if (!response.ok || !result.idToken) throw new Error("Could not sign in to Auth emulator.");
  return result.idToken;
}

function internal(path: string, method: "get" | "post" = "get") {
  return request(app)[method](`/internal/orchestrator${path}`)
    .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
    .set("X-Orchestrator-Worker-ID", `${prefix}-worker`);
}

emulatorDescribe("Phase 14 review and rework HTTP journey", () => {
  beforeAll(async () => {
    await Promise.all([
      firebaseAuth.createUser({ uid: supervisorUid, email: supervisorEmail, password: supervisorPassword, displayName: "Review Supervisor" }),
      firebaseAuth.createUser({ uid: cleanerUid, email: cleanerEmail, password: cleanerPassword, displayName: "Review Cleaner" }),
    ]);
    await firestore.collection("supervisors").doc(supervisorUid).set({ role: "supervisor", status: "active", email: supervisorEmail, displayName: "Review Supervisor" });
    await firestore.collection("userAccounts").doc(supervisorUid).set({ role: "supervisor", profileId: supervisorUid, status: "active" });
    await firestore.collection("sites").doc(siteId).set({ name: "Review Site", status: "active", timezone: "Asia/Kuala_Lumpur" });
    await firestore.collection("zones").doc(zoneId).set({ name: "Review Zone", siteId, status: "active" });
    await firestore.collection("cleaners").doc(cleanerId).set({
      status: "active", accountStatus: "active", authUid: cleanerUid, fullName: "Review Cleaner", staffCode: `${prefix}-staff`,
      assignedSiteId: siteId, assignedZoneId: zoneId, permittedSiteIds: [siteId], permittedZoneIds: [zoneId], capabilities: ["floor_litter"],
    });
    await firestore.collection("userAccounts").doc(cleanerUid).set({ role: "cleaner", profileId: cleanerId, status: "active" });
    await firestore.collection("cleanerPresence").doc(cleanerId).set({ cleanerId, availability: "busy", activeWorkOrderId: workOrderId, lastHeartbeatAt: Timestamp.now() });
    await firestore.collection("alerts").doc(alertId).set({
      workflowVersion: "grouped-temporal-v2", status: "in_progress", siteId, zoneId, siteNameSnapshot: "Review Site", zoneNameSnapshot: "Review Zone",
      issueType: "floor_litter", severity: "warning", activeKeyId: activeAlertKeyId, firstEvidenceMediaId: "media-before", latestEvidenceMediaId: "media-before",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await firestore.collection("activeAlertKeys").doc(activeAlertKeyId).set({ alertId, siteId, zoneId, issueType: "floor_litter" });
    await firestore.collection("alertConfirmationResets").doc(activeAlertKeyId).set({ generation: 3 });
    await firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId)).set({ alertId, workOrderId });
    await firestore.collection("workOrders").doc(workOrderId).set({
      alertId, siteId, siteNameSnapshot: "Review Site", zoneId, zoneNameSnapshot: "Review Zone", issueType: "floor_litter", status: "in_progress",
      assignedCleanerId: cleanerId, assignedCleanerUid: cleanerUid, assignedCleanerNameSnapshot: "Review Cleaner", assignedCleanerStaffCodeSnapshot: `${prefix}-staff`,
      assignmentAttempt: 1, instructions: "Clean the review zone.", assignmentDecisionId: `${prefix}-assignment`, readyForReviewEvidenceMediaIds: [],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    supervisorToken = await signIn(supervisorEmail, supervisorPassword);
    cleanerToken = await signIn(cleanerEmail, cleanerPassword);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("workOrders").doc(workOrderId)).catch(() => undefined);
    await firestore.recursiveDelete(firestore.collection("alerts").doc(alertId)).catch(() => undefined);
    for (const [collection, id] of [["activeWorkOrderKeys", activeWorkOrderKeyId(alertId)], ["activeAlertKeys", activeAlertKeyId], ["alertConfirmationResets", activeAlertKeyId], ["cleanerPresence", cleanerId], ["cleaners", cleanerId], ["zones", zoneId], ["sites", siteId], ["supervisors", supervisorUid], ["userAccounts", supervisorUid], ["userAccounts", cleanerUid]] as const) {
      await firestore.collection(collection).doc(id).delete().catch(() => undefined);
    }
    await firebaseAuth.deleteUser(supervisorUid).catch(() => undefined);
    await firebaseAuth.deleteUser(cleanerUid).catch(() => undefined);
  });

  it("keeps cleaner submission separate from clean resolution and supports idempotent rework/clean decisions", async () => {
    const ensure = await request(app).post("/api/orchestrator/runs/ensure").set("Authorization", `Bearer ${supervisorToken}`).send({ alertId });
    expect(ensure.status).toBe(201);
    runId = ensure.body.run.id;
    const claim = await internal(`/runs/${runId}/claim`, "post").send({ workerId: `${prefix}-worker`, leaseSeconds: 120 });
    expect(claim.status).toBe(200);
    claimToken = claim.body.claimToken;

    const submissionBody = { idempotencyKey: `${prefix}-submit-1`, note: "Initial cleaning complete.", evidenceMediaIds: ["media-after-1"] };
    const submitted = await request(app).post(`/api/cleaner/work-orders/${workOrderId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send(submissionBody);
    expect(submitted.status).toBe(200);
    expect(submitted.body.workOrder.status).toBe("ready_for_review");
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("awaiting_verification");
    expect(submitted.body.alertId).toBe(alertId);
    const replay = await request(app).post(`/api/cleaner/work-orders/${workOrderId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send(submissionBody);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect((await firestore.collection("workOrders").doc(workOrderId).collection("reviewRequests").get()).size).toBe(1);

    const context = await request(app).get(`/api/work-orders/${workOrderId}/reviews`).set("Authorization", `Bearer ${supervisorToken}`);
    expect(context.status).toBe(200);
    expect(context.body.reviewRequests).toHaveLength(1);
    const firstRequestId = context.body.reviewRequests[0].id;

    const fresh = await internal(`/runs/${runId}/review-requests`, "post").send({
      claimToken, workOrderId, alertId, rationale: "Capture a closer view.", idempotencyKey: `${prefix}-fresh-1`,
    });
    expect(fresh.status).toBe(201);
    const rework = await internal(`/runs/${runId}/reviews`, "post").send({
      claimToken, workOrderId, alertId, reviewRequestId: firstRequestId, decision: "rework", rationaleSummary: "Litter remains near the bin.",
      afterEvidenceMediaIds: ["media-after-1"], visionResults: { visibleResidual: true }, modelVersions: { detector: "test-v1" }, idempotencyKey: `${prefix}-decision-1`,
    });
    expect(rework.status).toBe(201);
    expect(rework.body.workOrder.status).toBe("rework_required");
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("in_progress");

    const started = await request(app).post(`/api/cleaner/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `${prefix}-start-2` });
    expect(started.status).toBe(200);
    const submittedAgain = await request(app).post(`/api/cleaner/work-orders/${workOrderId}/ready-for-review`).set("Authorization", `Bearer ${cleanerToken}`).send({ idempotencyKey: `${prefix}-submit-2`, evidenceMediaIds: ["media-after-2"] });
    expect(submittedAgain.status).toBe(200);
    const secondContext = await request(app).get(`/api/work-orders/${workOrderId}/reviews`).set("Authorization", `Bearer ${supervisorToken}`);
    const secondRequestId = secondContext.body.reviewRequests.find((item: { id: string }) => item.id !== firstRequestId).id;

    const cleanBody = {
      claimToken, workOrderId, alertId, reviewRequestId: secondRequestId, decision: "clean", rationaleSummary: "The area is clean in the final evidence.",
      afterEvidenceMediaIds: ["media-after-2"], visionResults: { clean: true }, modelVersions: { detector: "test-v1" }, idempotencyKey: `${prefix}-decision-2`,
    };
    const clean = await internal(`/runs/${runId}/reviews`, "post").send(cleanBody);
    expect(clean.status).toBe(201);
    expect(clean.body.workOrder.status).toBe("completed");
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("resolved");
    expect((await firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId)).get()).exists).toBe(false);
    expect((await firestore.collection("activeAlertKeys").doc(activeAlertKeyId).get()).exists).toBe(false);
    expect((await firestore.collection("cleanerPresence").doc(cleanerId).get()).data()).toMatchObject({ availability: "online", activeWorkOrderId: null });
    const cleanReplay = await internal(`/runs/${runId}/reviews`, "post").send(cleanBody);
    expect(cleanReplay.status).toBe(200);
    expect(cleanReplay.body.idempotent).toBe(true);
  });
});
