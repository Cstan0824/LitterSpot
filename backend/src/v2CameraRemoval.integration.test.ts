import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { canonicalHash } from "./services/v2Persistence.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await response.json() as { idToken: string }).idToken;
}

run("V2 Camera removal", () => {
  const suffix = randomUUID();
  const siteId = `remove-site-${suffix}`; const mapId = `remove-map-${suffix}`; const zoneId = `remove-zone-${suffix}`;
  const cameraId = `remove-camera-${suffix}`; const sourceId = `remove-source-${suffix}`; const registrationId = `remove-registration-${suffix}`;
  const rootUid = `remove-root-${suffix}`; const rootEmail = `${rootUid}@example.test`; const regularUid = `remove-regular-${suffix}`; const regularEmail = `${regularUid}@example.test`;
  const cleanerId = `remove-cleaner-${suffix}`; const cleanerUid = `remove-cleaner-auth-${suffix}`;
  const alertId = `remove-alert-${suffix}`; const workId = `remove-work-${suffix}`; const draftId = `remove-draft-${suffix}`; const draftMediaId = `remove-draft-media-${suffix}`;
  const password = "Removal-password-123!"; let rootToken = ""; let regularToken = "";
  const reason = "The Camera was permanently removed from this Site.";
  const body = { reason, confirmation: true, expectedCameraRevision: 4, expectedMapRevisionId: mapId, idempotencyKey: `remove-${suffix}` };

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: rootUid, email: rootEmail, password, displayName: "Removal Root" });
    await firebaseAuth.createUser({ uid: regularUid, email: regularEmail, password, displayName: "Removal Regular" });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Removal Site", status: "active", rootSupervisorUid: rootUid, activeMapRevisionId: mapId, mapRevisionNumber: 1, mapDraftExists: false, firstCameraCreated: true, enabledLaptopCameraId: null, laptopCameraId: null, revision: 1 });
    await firestore.collection("userAccounts").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, role: "supervisor", siteId, profileId: rootUid, authority: "root", emailNormalized: rootEmail, displayName: "Removal Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, siteId, authority: "root", fullName: "Removal Root", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, role: "supervisor", siteId, profileId: regularUid, authority: "regular", emailNormalized: regularEmail, displayName: "Removal Regular", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, siteId, authority: "regular", fullName: "Removal Regular", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(cleanerUid).set({ schemaVersion: 2, uid: cleanerUid, role: "cleaner", siteId, profileId: cleanerId, authority: null, displayName: "Removal Cleaner", status: "active", revision: 1 });
    await firestore.collection("cleaners").doc(cleanerId).set({ schemaVersion: 2, cleanerId, authUid: cleanerUid, siteId, fullName: "Removal Cleaner", status: "active", activeWorkOrderId: workId, activeWorkAssignedAt: Timestamp.now(), revision: 1 });
    const map = firestore.collection("siteMapRevisions").doc(mapId);
    await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, parentRevisionId: null, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zoneCount: 1, cameraPlacementCount: 1, cleanerStationCount: 1, contentHash: "before-removal" });
    await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 80, yMeters: 0 }, { xMeters: 80, yMeters: 80 }, { xMeters: 0, yMeters: 80 }] });
    await map.collection("cameraPlacements").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, cameraNameSnapshot: "Removal Camera", zoneId, zoneNameSnapshot: "Main Zone", point: { xMeters: 20, yMeters: 20 } });
    await map.collection("cleanerStations").doc(cleanerId).set({ schemaVersion: 2, siteId, cleanerId, zoneId, point: { xMeters: 10, yMeters: 10 } });
    await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId, name: "Removal Camera", status: "active", monitoringEnabled: true, sourceType: "looped_video", activeSourceRevisionId: sourceId, activeRegistrationRevisionId: registrationId, isSimulation: true, revision: 4 });
    await firestore.collection("cameraSourceRevisions").doc(sourceId).set({ schemaVersion: 2, sourceRevisionId: sourceId, siteId, cameraId, type: "looped_video", sourceMediaId: "retained-source-media" });
    await firestore.collection("cameraRegistrationRevisions").doc(registrationId).set({ schemaVersion: 2, registrationRevisionId: registrationId, siteId, cameraId, sourceRevisionId: sourceId, referenceMediaId: "retained-reference-media", sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [], bins: [] });
    await firestore.collection("cameraRegistrations").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, activeRegistrationRevisionId: registrationId, status: "ready", revisionNumber: 1 });
    await firestore.collection("cameraRuntimeStates").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, connectionStatus: "online", monitoringEpisodeId: "durable-episode", monitoringSessionId: "durable-session" });
    await firestore.collection("alerts").doc(alertId).set({ schemaVersion: 2, alertId, siteId, cameraId, zoneId, zoneNameSnapshot: "Main Zone", issueType: "floor_litter", observedCondition: "litter", status: "assigned", severity: "warning", highestSeverity: "warning", activeWorkOrderId: workId, isSimulation: false, revision: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await firestore.collection("workOrders").doc(workId).set({ schemaVersion: 2, workOrderId: workId, siteId, cameraId, zoneId, alertId, assignedCleanerId: cleanerId, cleanerNameSnapshot: "Removal Cleaner", issueType: "floor_litter", status: "assigned", severity: "warning", target: { type: "camera", cameraId, zoneId, zoneNameSnapshot: "Main Zone", point: { xMeters: 20, yMeters: 20 } }, isSimulation: false, revision: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await firestore.collection("activeAlertKeys").doc(canonicalHash("v2-active-alert", siteId, cameraId, "floor_litter")).set({ schemaVersion: 2, siteId, cameraId, issueType: "floor_litter", alertId });
    await firestore.collection("activeWorkOrderKeys").doc(canonicalHash("v2-active-work", siteId, alertId)).set({ schemaVersion: 2, siteId, alertId, workOrderId: workId, cleanerId });
    await firestore.collection("cameraDrafts").doc(draftId).set({ schemaVersion: 2, draftId, siteId, cameraId, kind: "reconfigure", status: "draft", referenceMediaId: draftMediaId, source: { sourceMediaId: sourceId } });
    await firestore.collection("cameraDraftLocks").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, draftId, kind: "reconfigure" });
    await firestore.collection("mediaAssets").doc(draftMediaId).set({ schemaVersion: 2, mediaId: draftMediaId, siteId, ownerType: "camera_draft", ownerId: draftId, storageKey: `media/${draftMediaId}/reference.jpg`, storageStatus: "available", mimeType: "image/jpeg" });
    rootToken = await signIn(rootEmail, password); regularToken = await signIn(regularEmail, password);
  });

  afterAll(async () => {
    await Promise.all([firebaseAuth.deleteUser(rootUid).catch(() => undefined), firebaseAuth.deleteUser(regularUid).catch(() => undefined)]);
    for (const collection of await firestore.listCollections()) {
      const documents = (await collection.where("siteId", "==", siteId).get()).docs;
      await Promise.all(documents.map((document) => firestore.recursiveDelete(document.ref).catch(() => undefined)));
    }
    await firestore.recursiveDelete(firestore.collection("sites").doc(siteId)).catch(() => undefined);
  });

  it("requires Root authority, explicit confirmation, and current revisions", async () => {
    expect((await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${regularToken}`).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send({ ...body, confirmation: false })).status).toBe(400);
    const stale = await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send({ ...body, expectedCameraRevision: 3, idempotencyKey: `stale-${suffix}` });
    expect(stale.status).toBe(409);
    await firestore.collection("siteMapDrafts").doc(siteId).set({ schemaVersion: 2, siteId, baseRevisionId: mapId });
    await firestore.collection("sites").doc(siteId).update({ mapDraftExists: true });
    const blocked = await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send({ ...body, idempotencyKey: `map-draft-${suffix}` });
    expect(blocked.status).toBe(409); expect(blocked.body.details.code).toBe("site_map_draft_exists");
    await firestore.collection("siteMapDrafts").doc(siteId).delete(); await firestore.collection("sites").doc(siteId).update({ mapDraftExists: false });
  });

  it("removes the Camera from active use while retaining published history", async () => {
    const response = await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send(body);
    expect(response.status).toBe(200);
    expect(response.body.removal).toMatchObject({ cameraId, status: "removed", cameraRevision: 5, dismissedAlertCount: 1, dismissedWorkCount: 1, discardedDraftCount: 1, replayed: false });
    const replacementMapId = response.body.removal.mapRevisionId;
    const [camera, site, replacementMap, alert, work, cleaner, runtime] = await Promise.all([
      firestore.collection("cameras").doc(cameraId).get(), firestore.collection("sites").doc(siteId).get(), firestore.collection("siteMapRevisions").doc(replacementMapId).get(),
      firestore.collection("alerts").doc(alertId).get(), firestore.collection("workOrders").doc(workId).get(), firestore.collection("cleaners").doc(cleanerId).get(), firestore.collection("cameraRuntimeStates").doc(cameraId).get(),
    ]);
    expect(camera.data()).toMatchObject({ status: "removed", monitoringEnabled: false, removalReason: reason, removedFromMapRevisionId: mapId, removalMapRevisionId: replacementMapId, activeSourceRevisionId: sourceId, activeRegistrationRevisionId: registrationId, revision: 5 });
    expect(site.data()?.activeMapRevisionId).toBe(replacementMapId);
    expect(replacementMap.data()).toMatchObject({ parentRevisionId: mapId, cameraPlacementCount: 0, zoneCount: 1, cleanerStationCount: 1 });
    expect((await replacementMap.ref.collection("cameraPlacements").doc(cameraId).get()).exists).toBe(false);
    expect((await replacementMap.ref.collection("zoneGeometry").doc(zoneId).get()).exists).toBe(true);
    expect((await replacementMap.ref.collection("cleanerStations").doc(cleanerId).get()).exists).toBe(true);
    expect(alert.data()).toMatchObject({ status: "dismissed", activeWorkOrderId: null, dismissReason: "camera_removed" });
    expect(work.data()).toMatchObject({ status: "dismissed", dismissReason: "camera_removed" });
    expect(cleaner.data()?.activeWorkOrderId).toBeNull();
    expect(runtime.data()).toMatchObject({ connectionStatus: "offline", sourceErrorCode: "camera_removed", monitoringEpisodeId: null, monitoringSessionId: null });
    expect((await firestore.collection("activeAlertKeys").doc(canonicalHash("v2-active-alert", siteId, cameraId, "floor_litter")).get()).exists).toBe(false);
    expect((await firestore.collection("activeWorkOrderKeys").doc(canonicalHash("v2-active-work", siteId, alertId)).get()).exists).toBe(false);
    expect((await firestore.collection("cameraDrafts").doc(draftId).get()).exists).toBe(false);
    expect((await firestore.collection("cameraDraftLocks").doc(cameraId).get()).exists).toBe(false);
    expect((await firestore.collection("mediaAssets").doc(draftMediaId).get()).exists).toBe(false);
    expect((await firestore.collection("cameraSourceRevisions").doc(sourceId).get()).exists).toBe(true);
    expect((await firestore.collection("cameraRegistrationRevisions").doc(registrationId).get()).exists).toBe(true);
    expect((await firestore.collection("cameraRegistrations").doc(cameraId).get()).data()?.activeRegistrationRevisionId).toBe(registrationId);
    expect((await firestore.collection("notifications").where("siteId", "==", siteId).get()).docs.some((document) => document.data()?.recipientUid === cleanerUid && document.data()?.type === "work_dismissed")).toBe(true);
    expect((await firestore.collection("orchestratorOutbox").where("siteId", "==", siteId).get()).docs.some((document) => document.data()?.triggerType === "cleaner_released_by_camera_removal")).toBe(true);
    expect((await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "camera_removed").get()).docs[0]?.data()).toMatchObject({ actorUid: rootUid, actorAuthority: "root", reason, before: { registrationRevisionId: registrationId }, after: { status: "removed", dismissedWorkCount: 1 } });
    expect((await request(app).get("/api/camera-creation/cameras").set("Authorization", `Bearer ${rootToken}`)).body.cameras.some((cameraItem: { id: string }) => cameraItem.id === cameraId)).toBe(false);
    const history = await request(app).get(`/api/camera-creation/cameras/${cameraId}/detail`).set("Authorization", `Bearer ${rootToken}`);
    expect(history.status).toBe(200); expect(history.body.camera).toMatchObject({ id: cameraId, status: "removed", placement: null });
  });

  it("replays the same removal safely and rejects reuse with different details", async () => {
    const replay = await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send(body);
    expect(replay.status).toBe(200); expect(replay.body.removal).toMatchObject({ cameraId, status: "removed", replayed: true });
    const conflict = await request(app).post(`/api/camera-creation/cameras/${cameraId}/remove`).set("Authorization", `Bearer ${rootToken}`).send({ ...body, reason: "A different reason was supplied." });
    expect(conflict.status).toBe(409);
  });
});
