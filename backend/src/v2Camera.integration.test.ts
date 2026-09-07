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
  const regularUid = `camera-regular-${suffix}`; const regularEmail = `${regularUid}@example.test`;
  const reference1 = `reference-1-${suffix}`; const reference2 = `reference-2-${suffix}`; const video1 = `video-1-${suffix}`; let token = ""; let regularToken = ""; let laptopCameraId = ""; let loopCameraId = "";
  const registration = (referenceMediaId: string) => ({ referenceMediaId, sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], bins: [] });
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password, displayName: "Camera Root" });
    await firebaseAuth.createUser({ uid: regularUid, email: regularEmail, password, displayName: "Camera Regular" });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", emailNormalized: email, displayName: "Camera Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Camera Root", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, role: "supervisor", siteId, profileId: regularUid, authority: "regular", emailNormalized: regularEmail, displayName: "Camera Regular", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, siteId, authority: "regular", fullName: "Camera Regular", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Camera Site", status: "active", rootSupervisorUid: uid, activeMapRevisionId: mapId, mapRevisionNumber: 1, firstCameraCreated: false, laptopCameraId: null, defaultSampleIntervalSeconds: 1, revision: 1 });
    const map = firestore.collection("siteMapRevisions").doc(mapId); await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, cameraPlacementCount: 0, cleanerStationCount: 0 });
    await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 50, yMeters: 0 }, { xMeters: 50, yMeters: 50 }, { xMeters: 0, yMeters: 50 }] });
    for (const [id, mimeType] of [[reference1, "image/jpeg"], [reference2, "image/jpeg"], [video1, "video/mp4"]]) await firestore.collection("mediaAssets").doc(id).set({ schemaVersion: 2, mediaId: id, siteId, storageStatus: "available", mimeType });
    token = await signIn(email, password);
    regularToken = await signIn(regularEmail, password);
  });
  afterAll(async () => { await firebaseAuth.deleteUser(uid).catch(() => undefined); await firebaseAuth.deleteUser(regularUid).catch(() => undefined); });

  it("accepts either first source and publishes disabled with placement and Registration", async () => {
    const rejected = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Wrong First", source: { type: "looped_video", sourceMediaId: video1 }, placement: { point: { xMeters: 10, yMeters: 10 } }, registration: registration(reference1) });
    expect(rejected.status).toBe(201);
    const draft = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Laptop Camera", source: { type: "laptop_camera" }, placement: { point: { xMeters: 10, yMeters: 10 } }, registration: registration(reference1) });
    expect(draft.status).toBe(201); laptopCameraId = draft.body.draft.cameraId;
    const published = await request(app).post(`/api/camera-creation/drafts/${draft.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`);
    expect(published.status).toBe(200);
    expect((await firestore.collection("cameras").doc(laptopCameraId).get()).data()).toMatchObject({ sourceType: "laptop_camera", monitoringEnabled: false, status: "active" });
    const site = await firestore.collection("sites").doc(siteId).get();
    expect((await firestore.collection("siteMapRevisions").doc(site.data()?.activeMapRevisionId).collection("cameraPlacements").doc(laptopCameraId).get()).data()?.zoneId).toBe(zoneId);
    const audits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "camera_created").get();
    expect(audits.docs.find((event) => event.data().resourceId === laptopCameraId)?.data()).toMatchObject({ actorUid: uid, actorRole: "supervisor", actorAuthority: "root", actorNameSnapshot: "Camera Root" });
  });

  it("supports pre-Camera reference upload, plotting, validation, and reconfiguration publication", async () => {
    const started = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${regularToken}`).send({ kind: "reconfigure", cameraId: laptopCameraId, name: "Laptop Camera", sourceType: "laptop_camera" });
    expect(started.status).toBe(201); const draftId = started.body.draft.id;
    expect(started.body.draft).toMatchObject({ referenceMediaId: reference1, registration: { referenceMediaId: reference1, sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: expect.any(Array), bins: [] } });
    const reference = await request(app).post(`/api/camera-creation/drafts/${draftId}/reference`).set("Authorization", `Bearer ${regularToken}`).attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: "reference.jpg", contentType: "image/jpeg" });
    expect(reference.status).toBe(201);
    const registrationSaved = await request(app).put(`/api/camera-creation/drafts/${draftId}/registration`).set("Authorization", `Bearer ${regularToken}`).send({ sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], bins: [] });
    expect(registrationSaved.status).toBe(200);
    const validation = await request(app).post(`/api/camera-creation/drafts/${draftId}/validate`).set("Authorization", `Bearer ${regularToken}`).send({});
    expect(validation.status).toBe(200); expect(validation.body).toEqual({ valid: true, errors: [] });
    const published = await request(app).post(`/api/camera-creation/drafts/${draftId}/publish`).set("Authorization", `Bearer ${regularToken}`).send({});
    expect(published.status).toBe(200);
    const audits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "camera_reconfigured").get();
    expect(audits.docs.find((event) => event.data().resourceId === laptopCameraId)?.data()).toMatchObject({ actorUid: regularUid, actorRole: "supervisor", actorAuthority: "regular", actorNameSnapshot: "Camera Regular" });
  });

  it("keeps a new Zone provisional until the Camera publishes", async () => {
    const provisionalZoneId = `provisional-zone-${suffix}`;
    const started = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${token}`).send({
      kind: "create",
      name: "Provisional Zone Camera",
      sourceType: "looped_video",
      placement: { point: { xMeters: 70, yMeters: 70 } },
      provisionalZone: { zoneId: provisionalZoneId, zoneNameSnapshot: "New Court", polygon: [{ xMeters: 60, yMeters: 60 }, { xMeters: 90, yMeters: 60 }, { xMeters: 90, yMeters: 90 }, { xMeters: 60, yMeters: 90 }] },
    });
    expect(started.status).toBe(201);
    expect((await firestore.collection("zones").doc(provisionalZoneId).get()).exists).toBe(false);
    const draftId = started.body.draft.id;
    await firestore.collection("cameraDrafts").doc(draftId).update({ "source.sourceMediaId": video1, referenceMediaId: reference2 });
    expect((await request(app).put(`/api/camera-creation/drafts/${draftId}/registration`).set("Authorization", `Bearer ${token}`).send({ sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: registration(reference2).walkableFloorPolygon, bins: [] })).status).toBe(200);
    expect((await request(app).post(`/api/camera-creation/drafts/${draftId}/validate`).set("Authorization", `Bearer ${token}`).send({})).body.valid).toBe(true);
    expect((await request(app).post(`/api/camera-creation/drafts/${draftId}/publish`).set("Authorization", `Bearer ${token}`).send({})).status).toBe(200);
    expect((await firestore.collection("zones").doc(provisionalZoneId).get()).data()).toMatchObject({ lifecycleStatus: "active", name: "New Court" });
    const site = await firestore.collection("sites").doc(siteId).get();
    expect((await firestore.collection("siteMapRevisions").doc(site.data()?.activeMapRevisionId).collection("zoneGeometry").doc(provisionalZoneId).get()).exists).toBe(true);
  });

  it("rejects a provisional Zone that touches an active Zone", async () => {
    const response = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${token}`).send({
      kind: "create",
      name: "Touching Zone Camera",
      sourceType: "laptop_camera",
      placement: { point: { xMeters: 55, yMeters: 20 } },
      provisionalZone: { zoneId: `touching-zone-${suffix}`, zoneNameSnapshot: "Touching Court", polygon: [{ xMeters: 50, yMeters: 10 }, { xMeters: 58, yMeters: 10 }, { xMeters: 58, yMeters: 30 }, { xMeters: 50, yMeters: 30 }] },
    });
    expect(response.status).toBe(422);
    expect(response.body.details).toMatchObject({ code: "provisional_zone_geometry_invalid", zoneConflicts: [expect.objectContaining({ reason: "shared_edge" })] });
  });

  it("locks one unfinished reconfiguration draft per Camera", async () => {
    const first = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${regularToken}`).send({ kind: "reconfigure", cameraId: laptopCameraId, name: "Laptop Camera", sourceType: "laptop_camera" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${regularToken}`).send({ kind: "reconfigure", cameraId: laptopCameraId, name: "Laptop Camera", sourceType: "laptop_camera" });
    expect(second.status).toBe(409);
    expect(second.body.details).toMatchObject({ code: "camera_draft_exists", draftId: first.body.draft.id });
    expect((await request(app).delete(`/api/camera-creation/drafts/${first.body.draft.id}`).set("Authorization", `Bearer ${regularToken}`)).status).toBe(204);
    expect((await firestore.collection("cameraDraftLocks").doc(laptopCameraId).get()).exists).toBe(false);
  });

  it("deletes an unfinished Camera Draft and its uploaded configuration media when cancelled", async () => {
    const started = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Cancelled Camera", sourceType: "looped_video", placement: { point: { xMeters: 20, yMeters: 20 } } });
    expect(started.status).toBe(201);
    const draftId = started.body.draft.id;
    const cancelledReferenceId = `cancel-reference-${suffix}`;
    const cancelledSourceId = `cancel-source-${suffix}`;
    await firestore.collection("mediaAssets").doc(cancelledReferenceId).set({ schemaVersion: 2, mediaId: cancelledReferenceId, siteId, ownerType: "camera_draft", ownerId: draftId, storageStatus: "available", mimeType: "image/jpeg" });
    await firestore.collection("mediaAssets").doc(cancelledSourceId).set({ schemaVersion: 2, mediaId: cancelledSourceId, siteId, ownerType: "camera_draft", ownerId: draftId, storageStatus: "available", mimeType: "video/mp4" });
    await firestore.collection("cameraDrafts").doc(draftId).update({ referenceMediaId: cancelledReferenceId, "source.sourceMediaId": cancelledSourceId });
    expect((await request(app).delete(`/api/camera-creation/drafts/${draftId}`).set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect((await firestore.collection("cameraDrafts").doc(draftId).get()).exists).toBe(false);
    expect((await firestore.collection("mediaAssets").doc(cancelledReferenceId).get()).exists).toBe(false);
    expect((await firestore.collection("mediaAssets").doc(cancelledSourceId).get()).exists).toBe(false);
  });

  it("publishes later looped Cameras disabled and preserves monitoring across replacement", async () => {
    const draft = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Loop Camera", source: { type: "looped_video", sourceMediaId: video1 }, placement: { point: { xMeters: 30, yMeters: 30 } }, registration: registration(reference2) });
    loopCameraId = draft.body.draft.cameraId;
    expect((await request(app).post(`/api/camera-creation/drafts/${draft.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    let camera = await firestore.collection("cameras").doc(loopCameraId).get();
    expect(camera.data()).toMatchObject({ sourceType: "looped_video", monitoringEnabled: false, isSimulation: true });
    await request(app).patch(`/api/camera-creation/cameras/${loopCameraId}/monitoring`).set("Authorization", `Bearer ${token}`).send({ monitoringEnabled: true, expectedRevision: camera.data()?.revision });
    const monitoringAudits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "camera_monitoring_enabled").get();
    expect(monitoringAudits.docs.find((event) => event.data().resourceId === loopCameraId)?.data()).toMatchObject({ actorUid: uid, actorRole: "supervisor", actorAuthority: "root", actorNameSnapshot: "Camera Root" });
    camera = await firestore.collection("cameras").doc(loopCameraId).get();
    const replacement = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "reconfigure", cameraId: loopCameraId, name: "Loop Camera", source: { type: "looped_video", sourceMediaId: video1 }, registration: registration(reference2) });
    expect((await request(app).post(`/api/camera-creation/drafts/${replacement.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await firestore.collection("cameras").doc(loopCameraId).get()).data()?.monitoringEnabled).toBe(true);
  });

  it("reserves only one enabled laptop Camera under concurrent requests", async () => {
    const second = await request(app).post("/api/camera-creation/drafts").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Second laptop", source: { type: "laptop_camera" }, placement: { point: { xMeters: 15, yMeters: 15 } }, registration: registration(reference1) });
    expect(second.status).toBe(201);
    expect((await request(app).post(`/api/camera-creation/drafts/${second.body.draft.id}/publish`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    const ids = [laptopCameraId, second.body.draft.cameraId];
    const enable = async (id: string, monitoringEnabled: boolean) => {
      const doc = await firestore.collection("cameras").doc(id).get();
      return request(app).patch(`/api/camera-creation/cameras/${id}/monitoring`).set("Authorization", `Bearer ${token}`).send({ monitoringEnabled, expectedRevision: doc.data()?.revision });
    };
    const results = await Promise.all(ids.map(id => enable(id, true)));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = ids[results.findIndex(r => r.status === 200)];
    const other = ids.find(id => id !== winner)!;
    expect((await enable(winner, false)).status).toBe(200);
    expect((await enable(other, true)).status).toBe(200);
    expect((await enable(other, false)).status).toBe(200);
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
