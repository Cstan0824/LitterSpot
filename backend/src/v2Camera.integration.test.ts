import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
async function signIn(email: string, password: string) { const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); return (await response.json() as { idToken: string }).idToken; }

run("V2 composite Camera workflow", () => {
  const suffix = randomUUID(); const uid = `camera-root-${suffix}`; const email = `${uid}@example.test`; const password = "Camera-password-123!"; const siteId = `camera-site-${suffix}`; const mapId = `camera-map-${suffix}`; const zoneId = `camera-zone-${suffix}`;
  const reference1 = `reference-1-${suffix}`; const reference2 = `reference-2-${suffix}`; const video1 = `video-1-${suffix}`; let token = ""; let laptopCameraId = ""; let loopCameraId = "";
  const registration = (referenceMediaId: string) => ({ referenceMediaId, sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], bins: [] });
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password, displayName: "Camera Root" });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", emailNormalized: email, displayName: "Camera Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Camera Root", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Camera Site", status: "active", rootSupervisorUid: uid, activeMapRevisionId: mapId, mapRevisionNumber: 1, firstCameraCreated: false, laptopCameraId: null, defaultSampleIntervalSeconds: 1, revision: 1 });
    const map = firestore.collection("siteMapRevisions").doc(mapId); await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, cameraPlacementCount: 0, cleanerStationCount: 0 });
    await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] });
    for (const [id, mimeType] of [[reference1, "image/jpeg"], [reference2, "image/jpeg"], [video1, "video/mp4"]]) await firestore.collection("mediaAssets").doc(id).set({ schemaVersion: 2, mediaId: id, siteId, storageStatus: "available", mimeType });
    token = await signIn(email, password);
  });
  afterAll(async () => { await firebaseAuth.deleteUser(uid).catch(() => undefined); });

  it("forces the first Camera to laptop and publishes placement plus Registration atomically", async () => {
    const rejected = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Wrong First", source: { type: "looped_video", sourceMediaId: video1 }, placement: { point: { xMeters: 10, yMeters: 10 } }, registration: registration(reference1) });
    expect(rejected.status).toBe(400);
    const draft = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Laptop Camera", source: { type: "laptop_camera" }, placement: { point: { xMeters: 10, yMeters: 10 } }, registration: registration(reference1) });
    expect(draft.status).toBe(201); laptopCameraId = draft.body.draft.cameraId;
    const published = await request(app).post(`/api/camera-creation/drafts/${draft.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`);
    expect(published.status).toBe(200);
    expect((await firestore.collection("cameras").doc(laptopCameraId).get()).data()).toMatchObject({ sourceType: "laptop_camera", monitoringEnabled: true, status: "active" });
    const site = await firestore.collection("sites").doc(siteId).get();
    expect((await firestore.collection("siteMapRevisions").doc(site.data()?.activeMapRevisionId).collection("cameraPlacements").doc(laptopCameraId).get()).data()?.zoneId).toBe(zoneId);
  });

  it("supports pre-Camera reference upload, plotting, validation, and reconfiguration publication", async () => {
    const started = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${token}`).send({ kind: "reconfigure", cameraId: laptopCameraId, name: "Laptop Camera", sourceType: "laptop_camera" });
    expect(started.status).toBe(201); const draftId = started.body.draft.id;
    const reference = await request(app).post(`/api/camera-creation/drafts/${draftId}/reference`).set("Authorization", `Bearer ${token}`).attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: "reference.jpg", contentType: "image/jpeg" });
    expect(reference.status).toBe(201);
    const registrationSaved = await request(app).put(`/api/camera-creation/drafts/${draftId}/registration`).set("Authorization", `Bearer ${token}`).send({ sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], bins: [] });
    expect(registrationSaved.status).toBe(200);
    const validation = await request(app).post(`/api/camera-creation/drafts/${draftId}/validate`).set("Authorization", `Bearer ${token}`).send({});
    expect(validation.status).toBe(200); expect(validation.body).toEqual({ valid: true, errors: [] });
    const published = await request(app).post(`/api/camera-creation/drafts/${draftId}/publish`).set("Authorization", `Bearer ${token}`).send({});
    expect(published.status).toBe(200);
  });

  it("publishes later looped Cameras disabled and preserves monitoring across replacement", async () => {
    const draft = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Loop Camera", source: { type: "looped_video", sourceMediaId: video1 }, placement: { point: { xMeters: 30, yMeters: 30 } }, registration: registration(reference2) });
    loopCameraId = draft.body.draft.cameraId;
    expect((await request(app).post(`/api/camera-creation/drafts/${draft.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    let camera = await firestore.collection("cameras").doc(loopCameraId).get();
    expect(camera.data()).toMatchObject({ sourceType: "looped_video", monitoringEnabled: false, isSimulation: true });
    await request(app).patch(`/api/camera-creation/cameras/${loopCameraId}/monitoring`).set("Authorization", `Bearer ${token}`).send({ monitoringEnabled: true, expectedRevision: camera.data()?.revision });
    camera = await firestore.collection("cameras").doc(loopCameraId).get();
    const replacement = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "reconfigure", cameraId: loopCameraId, name: "Loop Camera", source: { type: "looped_video", sourceMediaId: video1 }, registration: registration(reference2) });
    expect((await request(app).post(`/api/camera-creation/drafts/${replacement.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await firestore.collection("cameras").doc(loopCameraId).get()).data()?.monitoringEnabled).toBe(true);
  });

  it("returns a Camera detail read model with current Work, history, and safe Orchestrator trace", async () => {
    const now = Timestamp.now();
    const alertId = `camera-alert-${suffix}`; const workId = `camera-work-${suffix}`; const runId = `camera-run-${suffix}`;
    await firestore.collection("alerts").doc(alertId).set({ schemaVersion: 2, alertId, siteId, cameraId: loopCameraId, zoneId, zoneNameSnapshot: "Main", issueType: "bin_service", observedCondition: "overflow", status: "in_progress", severity: "critical", evidence: { mediaId: reference1 }, activeWorkOrderId: workId, createdAt: now, updatedAt: now, lastDetectedAt: now });
    await firestore.collection("workOrders").doc(workId).set({ schemaVersion: 2, workOrderId: workId, siteId, cameraId: loopCameraId, alertId, origin: "alert", managementMode: "orchestrated", status: "in_progress", severity: "critical", issueType: "bin_service", cleanerNameSnapshot: "Camera Cleaner", createdAt: now, updatedAt: now });
    await firestore.collection("orchestratorRuns").doc(runId).set({ schemaVersion: 2, siteId, type: "assignment", status: "succeeded", alertId, workOrderId: workId, selectedCleanerId: "camera-cleaner", decisionSummary: "Selected the nearest available Cleaner.", decisionFactors: { stationDistanceMeters: 12 }, provider: "fixture", model: "fixture-v1", createdAt: now, startedAt: now, completedAt: now });
    await firestore.collection("auditEvents").doc(`camera-audit-${suffix}`).set({ schemaVersion: 2, siteId, resourceType: "WorkOrder", resourceId: workId, action: "work_order_assigned", outcome: "succeeded", occurredAt: now });
    const response = await request(app).get(`/api/camera-creation/cameras/${loopCameraId}/detail`).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.camera.id).toBe(loopCameraId);
    expect(response.body.currentAssignments).toEqual(expect.arrayContaining([expect.objectContaining({ id: workId, status: "in_progress" })]));
    expect(response.body.recentHistory).toEqual(expect.arrayContaining([expect.objectContaining({ id: alertId, type: "alert", snapshot: { mediaId: reference1, contentUrl: `/api/media/${reference1}/content` } })]));
    expect(response.body.orchestratorTrace).toEqual([expect.objectContaining({ id: runId, decisionSummary: "Selected the nearest available Cleaner." })]);
    expect(response.body.orchestratorTrace[0]).not.toHaveProperty("inputSnapshot");
  });
});
