import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const body = await response.json() as { idToken?: string };
  if (!body.idToken) throw new Error("Map test sign-in failed.");
  return body.idToken;
}

run("V2 Site Map workflow", () => {
  const suffix = randomUUID();
  const uid = `map-root-${suffix}`;
  const email = `${uid}@example.test`;
  const regularUid = `map-regular-${suffix}`;
  const regularEmail = `${regularUid}@example.test`;
  const cleanerId = `map-cleaner-${suffix}`;
  const password = "Map-emulator-password-123!";
  const siteId = `map-site-${suffix}`;
  const initialRevisionId = `map-initial-${suffix}`;
  let token = "";
  let regularToken = "";

  async function currentMap() {
    const response = await request(app).get("/api/site-map").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response.body.map as { activeRevisionId: string; revision: { widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId?: string | null; backgroundTransform?: Record<string, number> | null }; zones: Array<{ id: string; zoneId: string; zoneNameSnapshot: string; polygon: Array<{ xMeters: number; yMeters: number }> }>; cameraPlacements: Array<{ id: string; point: { xMeters: number; yMeters: number } }>; cleanerStations: Array<{ id: string; point: { xMeters: number; yMeters: number } }> };
  }

  async function startDraft() {
    const response = await request(app).post("/api/site-map/draft/start").set("Authorization", `Bearer ${token}`).send({});
    expect(response.status).toBe(201);
    return response.body.draft as { revision: number; baseRevisionId: string };
  }

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password, displayName: "Map Root" });
    await firebaseAuth.createUser({ uid: regularUid, email: regularEmail, password, displayName: "Map Regular" });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", emailNormalized: email, displayName: "Map Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Map Root", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, role: "supervisor", siteId, profileId: regularUid, authority: "regular", emailNormalized: regularEmail, displayName: "Map Regular", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, siteId, authority: "regular", fullName: "Map Regular", status: "active", revision: 1 });
    await firestore.collection("cleaners").doc(cleanerId).set({ schemaVersion: 2, cleanerId, authUid: `auth-${cleanerId}`, siteId, fullName: "Map Cleaner", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Map Site", status: "active", rootSupervisorUid: uid, activeMapRevisionId: initialRevisionId, mapRevisionNumber: 1, mapDraftExists: false, revision: 1 });
    await firestore.collection("siteMapRevisions").doc(initialRevisionId).set({ schemaVersion: 2, revisionId: initialRevisionId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5 });
    token = await signIn(email, password);
    regularToken = await signIn(regularEmail, password);
  });

  afterAll(async () => { await firebaseAuth.deleteUser(uid).catch(() => undefined); await firebaseAuth.deleteUser(regularUid).catch(() => undefined); });

  it("validates, publishes, and reads immutable map geometry", async () => {
    await startDraft();
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({
      baseRevisionId: initialRevisionId, expectedRevision: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5,
      zones: [
        { zoneId: `zone-a-${suffix}`, zoneNameSnapshot: "Zone A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 40, yMeters: 0 }, { xMeters: 40, yMeters: 40 }, { xMeters: 0, yMeters: 40 }] },
        { zoneId: `zone-b-${suffix}`, zoneNameSnapshot: "Zone B", polygon: [{ xMeters: 50, yMeters: 0 }, { xMeters: 90, yMeters: 0 }, { xMeters: 90, yMeters: 40 }, { xMeters: 50, yMeters: 40 }] },
      ],
    });
    expect(saved.status).toBe(200);
    expect((await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`)).body.valid).toBe(true);
    const published = await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`);
    expect(published.status).toBe(200);
    expect(published.body.map.zones).toHaveLength(2);
    expect((await firestore.collection("zones").where("siteId", "==", siteId).get()).size).toBe(2);
    const audits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "site_map_published").get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data()).toMatchObject({ actorUid: uid, actorRole: "supervisor", actorAuthority: "root", actorNameSnapshot: "Map Root" });
    expect(audits.docs[0].data().requestId).toEqual(expect.any(String));
  });

  it("allows a Regular Supervisor to publish an in-boundary Cleaner Station Point without a Zone", async () => {
    const before = (await firestore.collection("sites").doc(siteId).get()).data()?.activeMapRevisionId;
    const response = await request(app).put(`/api/site-map/station-points/${cleanerId}`).set("Authorization", `Bearer ${regularToken}`).send({ point: { xMeters: 10, yMeters: 80 } });
    expect(response.status).toBe(200);
    expect(response.body.station.zoneId).toBeNull();
    expect(response.body.station.mapRevisionId).not.toBe(before);
    const station = await firestore.collection("siteMapRevisions").doc(response.body.station.mapRevisionId).collection("cleanerStations").doc(cleanerId).get();
    expect(station.exists).toBe(true);
    expect(station.data()?.zoneId).toBeNull();
    const audits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "cleaner_station_updated").get();
    expect(audits.docs.at(-1)?.data()).toMatchObject({ actorUid: regularUid, actorRole: "supervisor", actorAuthority: "regular", actorNameSnapshot: "Map Regular" });
  });

  it("blocks a Regular Supervisor from full Site Map draft mutations", async () => {
    const routes = [
      request(app).get("/api/site-map/draft").set("Authorization", `Bearer ${regularToken}`),
      request(app).post("/api/site-map/draft/start").set("Authorization", `Bearer ${regularToken}`).send({}),
      request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${regularToken}`).send({}),
      request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${regularToken}`),
      request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${regularToken}`),
      request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${regularToken}`),
    ];
    const responses = await Promise.all(routes);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Root Supervisor access is required.");
    }
  });

  it("removes omitted draft geometry and retires the removed stable Zone", async () => {
    const site = await firestore.collection("sites").doc(siteId).get();
    const zoneA = `zone-a-${suffix}`;
    const zoneB = `zone-b-${suffix}`;
    await startDraft();
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: site.data()?.activeMapRevisionId, expectedRevision: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zones: [{ zoneId: zoneA, zoneNameSnapshot: "Zone A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 40, yMeters: 0 }, { xMeters: 40, yMeters: 40 }, { xMeters: 0, yMeters: 40 }] }] });
    expect(saved.status).toBe(200);
    expect((await firestore.collection("siteMapDrafts").doc(siteId).collection("zoneGeometry").get()).size).toBe(1);
    await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`);
    expect((await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await firestore.collection("zones").doc(zoneB).get()).data()?.lifecycleStatus).toBe("retired");
    const retired = await request(app).get("/api/site-map/retired-zones").set("Authorization", `Bearer ${token}`);
    expect(retired.status).toBe(200);
    expect(retired.body.zones).toEqual(expect.arrayContaining([expect.objectContaining({ zoneId: zoneB, zoneNameSnapshot: "Zone B", polygon: expect.any(Array) })]));
    expect((await request(app).get("/api/site-map/retired-zones").set("Authorization", `Bearer ${regularToken}`)).status).toBe(403);
  });

  it("rejects overlapping geometry", async () => {
    const site = await firestore.collection("sites").doc(siteId).get();
    await startDraft();
    const response = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: site.data()?.activeMapRevisionId, expectedRevision: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zones: [
      { zoneId: "overlap-a", zoneNameSnapshot: "A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 50, yMeters: 0 }, { xMeters: 50, yMeters: 50 }, { xMeters: 0, yMeters: 50 }] },
      { zoneId: "overlap-b", zoneNameSnapshot: "B", polygon: [{ xMeters: 25, yMeters: 25 }, { xMeters: 75, yMeters: 25 }, { xMeters: 75, yMeters: 75 }, { xMeters: 25, yMeters: 75 }] },
    ] });
    expect(response.status).toBe(422);
    expect(response.body.details).toMatchObject({ code: "site_map_geometry_invalid", zoneConflicts: [expect.objectContaining({ reason: "edges_cross", zoneIds: ["overlap-a", "overlap-b"] })] });
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
    const failures = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "site_map_request_failed").get();
    expect(failures.docs.some((document) => document.data().errorCode === "site_map_geometry_invalid" && document.data().outcome === "failed")).toBe(true);
  });

  it("recovers one existing draft and rejects stale concurrent saves", async () => {
    const activeRevisionId = String((await firestore.collection("sites").doc(siteId).get()).data()?.activeMapRevisionId);
    await firestore.collection("siteMapRevisions").doc(activeRevisionId).collection("cleanerStations").doc(cleanerId).set({ schemaVersion: 2, siteId, cleanerId, cleanerNameSnapshot: "Map Cleaner", point: { xMeters: 10, yMeters: 80 }, zoneId: null });
    const map = await currentMap();
    const draft = await startDraft();
    const cameraWhileDrafting = await request(app).post("/api/camera-creation/drafts/start").set("Authorization", `Bearer ${token}`).send({ kind: "create", name: "Blocked Camera", sourceType: "laptop_camera", placement: { point: { xMeters: 10, yMeters: 10 } } });
    expect(cameraWhileDrafting.status).toBe(409);
    expect(cameraWhileDrafting.body.details.code).toBe("site_map_draft_exists");
    const duplicate = await request(app).post("/api/site-map/draft/start").set("Authorization", `Bearer ${token}`).send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.details.code).toBe("site_map_draft_exists");
    const body = { baseRevisionId: map.activeRevisionId, expectedRevision: draft.revision, widthMeters: map.revision.widthMeters, heightMeters: map.revision.heightMeters, gridSizeMeters: map.revision.gridSizeMeters, backgroundMediaId: map.revision.backgroundMediaId ?? null, backgroundTransform: map.revision.backgroundTransform ?? null, zones: map.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })), cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })), cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })) };
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send(body);
    expect(saved.status).toBe(200);
    const savedDraft = await request(app).get("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
    expect(savedDraft.body.cleanerStations).toEqual(expect.arrayContaining([expect.objectContaining({ cleanerNameSnapshot: "Map Cleaner" })]));
    const stale = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send(body);
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("site_map_draft_revision_conflict");
    const recovered = await request(app).get("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
    expect(recovered.status).toBe(200);
    expect(recovered.body.draft).toMatchObject({ baseRevisionId: map.activeRevisionId, revision: 2, validationStatus: "not_validated" });
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
  });

  it("binds validation to the exact draft content", async () => {
    const map = await currentMap();
    await startDraft();
    const body = { baseRevisionId: map.activeRevisionId, expectedRevision: 1, widthMeters: map.revision.widthMeters, heightMeters: map.revision.heightMeters, gridSizeMeters: map.revision.gridSizeMeters, backgroundMediaId: map.revision.backgroundMediaId ?? null, backgroundTransform: map.revision.backgroundTransform ?? null, zones: map.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })), cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })), cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })) };
    expect((await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send(body)).status).toBe(200);
    expect((await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`)).body.valid).toBe(true);
    const firstZone = map.zones[0];
    await firestore.collection("siteMapDrafts").doc(siteId).collection("zoneGeometry").doc(firstZone.id).update({ zoneNameSnapshot: "Changed after validation" });
    const published = await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`);
    expect(published.status).toBe(409);
    expect(published.body.details.code).toBe("site_map_validated_content_changed");
    expect((await firestore.collection("sites").doc(siteId).get()).data()?.activeMapRevisionId).toBe(map.activeRevisionId);
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
  });

  it("uploads and publishes one aspect-preserving Site background", async () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(1536, 16);
    png.writeUInt32BE(1024, 20);
    const upload = await request(app).post("/api/site-map/background").set("Authorization", `Bearer ${token}`).attach("image", png, { filename: "sunway.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(upload.body.background).toMatchObject({ width: 1536, height: 1024, mimeType: "image/png" });
    const map = await currentMap();
    await startDraft();
    const transform = { xMeters: 0, yMeters: 0, widthMeters: 90, heightMeters: 60, opacity: 1 };
    const save = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({
      baseRevisionId: map.activeRevisionId,
      expectedRevision: 1,
      widthMeters: 100,
      heightMeters: 100,
      gridSizeMeters: 5,
      backgroundMediaId: upload.body.background.mediaId,
      backgroundTransform: transform,
      zones: map.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })),
      cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })),
      cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })),
    });
    expect(save.status).toBe(200);
    expect((await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`)).body.valid).toBe(true);
    const published = await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`);
    expect(published.status).toBe(200);
    expect(published.body.map.revision).toMatchObject({ backgroundMediaId: upload.body.background.mediaId, backgroundTransform: transform, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down" });
  });

  it("keeps Site background upload and ownership Root-scoped", async () => {
    expect((await request(app).post("/api/site-map/background").set("Authorization", `Bearer ${regularToken}`)).status).toBe(403);
    const foreignMediaId = `foreign-map-${suffix}`;
    await firestore.collection("mediaAssets").doc(foreignMediaId).set({ schemaVersion: 2, mediaId: foreignMediaId, siteId: "another-site", purpose: "site_map_background", ownerType: "site", ownerId: "another-site", storageStatus: "available", mimeType: "image/png", width: 300, height: 200 });
    const map = await currentMap();
    await startDraft();
    const response = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: map.activeRevisionId, expectedRevision: 1, widthMeters: map.revision.widthMeters, heightMeters: map.revision.heightMeters, gridSizeMeters: map.revision.gridSizeMeters, backgroundMediaId: foreignMediaId, backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 90, heightMeters: 60, opacity: 1 }, zones: map.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })), cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })), cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })) });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("A valid Site background image is required.");
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
  });

  it("rejects stretched backgrounds and boundary shrinkage without scaling coordinates", async () => {
    const map = await currentMap();
    const mediaId = String(map.revision.backgroundMediaId);
    await startDraft();
    const common = {
      baseRevisionId: map.activeRevisionId,
      expectedRevision: 1,
      gridSizeMeters: 5,
      backgroundMediaId: mediaId,
      zones: map.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })),
      cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })),
      cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })),
    };
    const stretched = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ ...common, widthMeters: 100, heightMeters: 100, backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 90, heightMeters: 90, opacity: 1 } });
    expect(stretched.status).toBe(400);
    expect(stretched.body.details.code).toBe("background_aspect_ratio_mismatch");
    const outside = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ ...common, widthMeters: 100, heightMeters: 100, backgroundTransform: { xMeters: 20, yMeters: 0, widthMeters: 90, heightMeters: 60, opacity: 1 } });
    expect(outside.status).toBe(422);
    expect(outside.body.details.code).toBe("background_outside_site_boundary");
    const shrunken = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ ...common, widthMeters: 20, heightMeters: 20, backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 18, heightMeters: 12, opacity: 1 } });
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);
    expect(shrunken.status).toBe(422);
    expect(shrunken.body.details.errors.some((value: string) => value.endsWith("outside_bounds"))).toBe(true);
  });

  it("publishes map corrections and protects Physical Camera Move drafts", async () => {
    const cameraId = `move-camera-${suffix}`;
    const sourceMediaId = `move-source-media-${suffix}`;
    const sourceRevisionId = `move-source-revision-${suffix}`;
    await firestore.collection("mediaAssets").doc(sourceMediaId).set({ schemaVersion: 2, mediaId: sourceMediaId, siteId, purpose: "camera_source_video", ownerType: "camera", ownerId: cameraId, cameraId, storageStatus: "available", mimeType: "video/mp4", revision: 1 });
    await firestore.collection("cameraSourceRevisions").doc(sourceRevisionId).set({ schemaVersion: 2, sourceRevisionId, siteId, cameraId, type: "looped_video", sourceMediaId, sampleIntervalSeconds: 1, isSimulation: true });
    await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId, name: "Move Camera", status: "active", monitoringEnabled: false, sourceType: "looped_video", activeSourceRevisionId: sourceRevisionId, activeRegistrationRevisionId: "registration-1", revision: 1 });
    let map = await currentMap();
    await startDraft();
    const zone = map.zones[0];
    const seedPlacement = { xMeters: 10, yMeters: 10 };
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: map.activeRevisionId, expectedRevision: 1, widthMeters: map.revision.widthMeters, heightMeters: map.revision.heightMeters, gridSizeMeters: map.revision.gridSizeMeters, backgroundMediaId: map.revision.backgroundMediaId ?? null, backgroundTransform: map.revision.backgroundTransform ?? null, zones: map.zones.map((item) => ({ zoneId: item.zoneId, zoneNameSnapshot: item.zoneNameSnapshot, polygon: item.polygon })), cameraPlacements: [...map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.point })), { id: cameraId, point: seedPlacement }], cameraPlacementChanges: [{ cameraId, mode: "map_position_correction", reason: "Recover the missing Camera Placement.", confirmation: true }], cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })) });
    expect(saved.status).toBe(200);
    await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`);
    expect((await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    map = await currentMap();

    await startDraft();
    const bypassBody = { baseRevisionId: map.activeRevisionId, expectedRevision: 1, widthMeters: map.revision.widthMeters, heightMeters: map.revision.heightMeters, gridSizeMeters: map.revision.gridSizeMeters, backgroundMediaId: map.revision.backgroundMediaId ?? null, backgroundTransform: map.revision.backgroundTransform ?? null, zones: map.zones.map((item) => ({ zoneId: item.zoneId, zoneNameSnapshot: item.zoneNameSnapshot, polygon: item.polygon })), cameraPlacements: map.cameraPlacements.map((placement) => ({ id: placement.id, point: placement.id === cameraId ? { xMeters: 12, yMeters: 12 } : placement.point })), cleanerStations: map.cleanerStations.map((station) => ({ id: station.id, point: station.point })) };
    const bypass = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send(bypassBody);
    expect(bypass.status).toBe(422);
    expect(bypass.body.details.code).toBe("camera_placement_change_requires_correction");
    expect((await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ ...bypassBody, cameraPlacementChanges: [{ cameraId, mode: "physical_camera_move", reason: "Trying to bypass registration", confirmation: true }] })).status).toBe(400);
    await request(app).delete("/api/site-map/draft").set("Authorization", `Bearer ${token}`);

    const moveBody = { point: { xMeters: 15, yMeters: 15 }, mode: "map_position_correction", reason: "The original pin was measured incorrectly.", expectedCameraRevision: 1, expectedMapRevisionId: map.activeRevisionId, confirmation: true };
    expect((await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${regularToken}`).send(moveBody)).status).toBe(403);
    expect((await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send({ ...moveBody, confirmation: false })).status).toBe(400);
    const outsideZone = await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send({ ...moveBody, point: { xMeters: 80, yMeters: 80 } });
    expect(outsideZone.status).toBe(422);
    expect(outsideZone.body.details.code).toBe("camera_placement_not_in_exactly_one_zone");
    const correction = await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send({ point: { xMeters: 15, yMeters: 15 }, mode: "map_position_correction", reason: "The original pin was measured incorrectly.", expectedCameraRevision: 1, expectedMapRevisionId: map.activeRevisionId, confirmation: true });
    expect(correction.status).toBe(200);
    expect(correction.body.placement).toMatchObject({ mode: "map_position_correction", status: "published", point: { xMeters: 15, yMeters: 15 }, cameraRevision: 2 });
    const registrationBefore = (await firestore.collection("cameras").doc(cameraId).get()).data()?.activeRegistrationRevisionId;

    const physicalBody = { point: { xMeters: 20, yMeters: 20 }, mode: "physical_camera_move", reason: "The Camera was installed at a new position.", expectedCameraRevision: 2, expectedMapRevisionId: correction.body.placement.mapRevisionId, confirmation: true };
    await firestore.collection("cameras").doc(cameraId).update({ monitoringEnabled: true });
    const whileMonitoring = await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send(physicalBody);
    expect(whileMonitoring.status).toBe(409);
    expect(whileMonitoring.body.details.code).toBe("camera_monitoring_must_be_disabled");
    await firestore.collection("cameras").doc(cameraId).update({ monitoringEnabled: false });
    const physical = await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send(physicalBody);
    expect(physical.status).toBe(200);
    expect(physical.body.placement).toMatchObject({ mode: "physical_camera_move", status: "registration_required", draft: { kind: "physical_move", validationStatus: "not_validated", source: { sourceMediaId } } });
    const draftId = physical.body.placement.draft.id;
    const invalid = await request(app).post(`/api/camera-creation/drafts/${draftId}/validate`).set("Authorization", `Bearer ${token}`).send({});
    expect(invalid.body).toMatchObject({ valid: false, errors: expect.arrayContaining(["registration_required"]) });
    expect((await request(app).get(`/api/camera-creation/drafts/${draftId}`).set("Authorization", `Bearer ${regularToken}`)).status).toBe(403);
    expect((await firestore.collection("cameras").doc(cameraId).get()).data()?.activeRegistrationRevisionId).toBe(registrationBefore);
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect((await request(app).post(`/api/camera-creation/drafts/${draftId}/reference`).set("Authorization", `Bearer ${token}`).attach("image", png, { filename: "moved-reference.png", contentType: "image/png" })).status).toBe(201);
    expect((await request(app).put(`/api/camera-creation/drafts/${draftId}/registration`).set("Authorization", `Bearer ${token}`).send({ sourceWidth: 640, sourceHeight: 480, walkableFloorPolygon: [{ x: 0.05, y: 0.55 }, { x: 0.95, y: 0.55 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }], bins: [] })).status).toBe(200);
    expect((await request(app).post(`/api/camera-creation/drafts/${draftId}/validate`).set("Authorization", `Bearer ${token}`).send({})).body.valid).toBe(true);
    const publishedMove = await request(app).post(`/api/camera-creation/drafts/${draftId}/publish`).set("Authorization", `Bearer ${token}`).send({});
    expect(publishedMove.status).toBe(200);
    const movedCamera = await firestore.collection("cameras").doc(cameraId).get();
    expect(movedCamera.data()?.activeRegistrationRevisionId).not.toBe(registrationBefore);
    const movedMapId = (await firestore.collection("sites").doc(siteId).get()).data()?.activeMapRevisionId;
    expect((await firestore.collection("siteMapRevisions").doc(movedMapId).collection("cameraPlacements").doc(cameraId).get()).data()).toMatchObject({ point: { xMeters: 20, yMeters: 20 }, zoneNameSnapshot: zone.zoneNameSnapshot });
    const moveAudits = await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "camera_physically_moved").get();
    expect(moveAudits.docs.at(-1)?.data()).toMatchObject({ actorUid: uid, actorAuthority: "root", reason: "The Camera was installed at a new position.", before: { placement: { point: { xMeters: 15, yMeters: 15 } } }, after: { placement: { point: { xMeters: 20, yMeters: 20 } } } });
    const finalCamera = movedCamera.data()!;
    const cancellable = await request(app).post(`/api/site-map/camera-placements/${cameraId}`).set("Authorization", `Bearer ${token}`).send({ point: { xMeters: 25, yMeters: 25 }, mode: "physical_camera_move", reason: "Testing safe cancellation.", expectedCameraRevision: finalCamera.revision, expectedMapRevisionId: movedMapId, confirmation: true });
    expect(cancellable.status).toBe(200);
    expect((await request(app).delete(`/api/camera-creation/drafts/${cancellable.body.placement.draft.id}`).set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect((await firestore.collection("mediaAssets").doc(sourceMediaId).get()).exists).toBe(true);
    expect(zone).toBeDefined();
  });
});
