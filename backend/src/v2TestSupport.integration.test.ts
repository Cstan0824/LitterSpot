import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { env } from "./config/env.js";
import { getV2AssignmentContext } from "./services/v2OrchestratorService.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await response.json() as { idToken: string }).idToken;
}

run("V2 development test support", () => {
  const suffix = randomUUID();
  const rootUid = `test-support-root-${suffix}`;
  const rootEmail = `${rootUid}@example.test`;
  const password = "Test-support-password-123!";
  const siteId = `test-support-site-${suffix}`;
  const mapId = `test-support-map-${suffix}`;
  const zoneId = `test-support-zone-${suffix}`;
  const cameraId = `test-support-camera-${suffix}`;
  let token = "";

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: rootUid, email: rootEmail, password, displayName: "Test Support Root" });
    await firestore.collection("userAccounts").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, role: "supervisor", siteId, profileId: rootUid, authority: "root", emailNormalized: rootEmail, displayName: "Test Support Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, siteId, authority: "root", fullName: "Test Support Root", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Test Support Site", timeZone: "Asia/Kuala_Lumpur", status: "active", activeMapRevisionId: mapId, revision: 1 });
    await firestore.collection("orchestratorConfigs").doc(siteId).set({ schemaVersion: 2, siteId, status: "running", assignmentEnabled: true });
    const map = firestore.collection("siteMapRevisions").doc(mapId);
    await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100 });
    await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Test Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] });
    await map.collection("cameraPlacements").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, zoneId, zoneNameSnapshot: "Test Zone", point: { xMeters: 20, yMeters: 30 } });
    await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId, name: "Test Camera", status: "active", activeRegistrationRevisionId: "registration-test" });
    token = await signIn(rootEmail, password);
  });

  afterAll(async () => { await firebaseAuth.deleteUser(rootUid).catch(() => undefined); });

  it("creates an idempotent simulated Flag, Alert, history and Orchestrator trigger", async () => {
    const body = { cameraId, issueType: "floor_litter", condition: "litter", severity: "warning", confidence: 0.99, clientRequestId: `integration-${suffix}` };
    const first = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body);
    expect(first.status).toBe(201);
    expect(first.body.alert).toMatchObject({ siteId, cameraId, issueType: "floor_litter", status: "waiting_for_cleaner", isSimulation: true, managementMode: "orchestrated" });
    expect(first.body.flag).toMatchObject({ alertId: first.body.alert.id, isSimulation: true, qualificationPolicyVersion: "simulated-alert-v1" });
    expect(first.body.idempotent).toBe(false);
    expect((await firestore.collection("alerts").doc(first.body.alert.id).collection("events").get()).size).toBe(1);
    expect((await firestore.collection("orchestratorOutbox").where("aggregateId", "==", first.body.alert.id).get()).docs.some((document) => document.data().status === "pending")).toBe(true);

    const replay = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.alert.id).toBe(first.body.alert.id);

    const changed = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send({ ...body, severity: "critical" });
    expect(changed.status).toBe(409);
    const context = await getV2AssignmentContext(siteId);
    expect(context.alerts.map((alert) => alert.alertId)).toContain(first.body.alert.id);

    const conflict = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send({ ...body, clientRequestId: `different-${suffix}` });
    expect(conflict.status).toBe(409);
  });

  it("rejects invalid conditions, cross-Site Cameras and unauthenticated requests", async () => {
    const body = { cameraId, issueType: "floor_spill", condition: "spill", severity: "critical", clientRequestId: `invalid-${suffix}` };
    expect((await request(app).post("/api/test-support/v2/alerts").send(body)).status).toBe(401);
    expect((await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send({ ...body, condition: "full" })).status).toBe(400);
    const otherCamera = `other-camera-${suffix}`;
    await firestore.collection("cameras").doc(otherCamera).set({ schemaVersion: 2, siteId: "other-site", status: "active" });
    expect((await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send({ ...body, cameraId: otherCamera })).status).toBe(404);
  });

  it("notifies Site Supervisors once when a new simulated Alert is created while paused", async () => {
    await firestore.collection("orchestratorConfigs").doc(siteId).update({ status: "paused" });
    const body = { cameraId, issueType: "floor_spill", condition: "spill", severity: "critical", confidence: 0.99, clientRequestId: `paused-${suffix}` };
    try {
      const first = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body);
      expect(first.status).toBe(201);
      const notifications = () => firestore.collection("notifications").where("alertId", "==", first.body.alert.id).where("type", "==", "alert_waiting_orchestrator_paused").get();
      expect((await notifications()).size).toBe(1);
      const replay = await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body);
      expect(replay.body.idempotent).toBe(true);
      expect((await notifications()).size).toBe(1);
    } finally {
      await firestore.collection("orchestratorConfigs").doc(siteId).update({ status: "running" });
    }
  });

  it("denies Regular Supervisors and blocks production even for Root", async () => {
    const body = { cameraId, issueType: "bin_service", condition: "full", severity: "warning", clientRequestId: `guard-${suffix}` };
    await firestore.collection("userAccounts").doc(rootUid).update({ authority: "regular" });
    await firestore.collection("supervisors").doc(rootUid).update({ authority: "regular" });
    try {
      expect((await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body)).status).toBe(403);
    } finally {
      await firestore.collection("userAccounts").doc(rootUid).update({ authority: "root" });
      await firestore.collection("supervisors").doc(rootUid).update({ authority: "root" });
    }
    const previousEnvironment = env.appEnvironment;
    env.appEnvironment = "production-cloud";
    try {
      expect((await request(app).post("/api/test-support/v2/alerts").set("Authorization", `Bearer ${token}`).send(body)).status).toBe(404);
    } finally {
      env.appEnvironment = previousEnvironment;
    }
    expect((await firestore.collection("alerts").where("siteId", "==", siteId).where("issueType", "==", "bin_service").get()).empty).toBe(true);
  });
});
