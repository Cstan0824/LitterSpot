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
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({
      baseRevisionId: initialRevisionId, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5,
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
    expect((await firestore.collection("auditEvents").where("siteId", "==", siteId).where("action", "==", "site_map_published").get()).size).toBe(1);
  });

  it("allows a Regular Supervisor to publish one validated Cleaner Station-only revision", async () => {
    const before = (await firestore.collection("sites").doc(siteId).get()).data()?.activeMapRevisionId;
    const response = await request(app).put(`/api/site-map/station-points/${cleanerId}`).set("Authorization", `Bearer ${regularToken}`).send({ point: { xMeters: 10, yMeters: 10 } });
    expect(response.status).toBe(200);
    expect(response.body.station.zoneId).toBe(`zone-a-${suffix}`);
    expect(response.body.station.mapRevisionId).not.toBe(before);
    expect((await firestore.collection("siteMapRevisions").doc(response.body.station.mapRevisionId).collection("cleanerStations").doc(cleanerId).get()).exists).toBe(true);
  });

  it("blocks a Regular Supervisor from full Site Map draft mutations", async () => {
    const routes = [
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
    const saved = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: site.data()?.activeMapRevisionId, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zones: [{ zoneId: zoneA, zoneNameSnapshot: "Zone A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 40, yMeters: 0 }, { xMeters: 40, yMeters: 40 }, { xMeters: 0, yMeters: 40 }] }] });
    expect(saved.status).toBe(200);
    expect((await firestore.collection("siteMapDrafts").doc(siteId).collection("zoneGeometry").get()).size).toBe(1);
    await request(app).post("/api/site-map/draft/validate").set("Authorization", `Bearer ${token}`);
    expect((await request(app).post("/api/site-map/draft/publish").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await firestore.collection("zones").doc(zoneB).get()).data()?.lifecycleStatus).toBe("retired");
  });

  it("rejects overlapping geometry", async () => {
    const site = await firestore.collection("sites").doc(siteId).get();
    const response = await request(app).post("/api/site-map/draft").set("Authorization", `Bearer ${token}`).send({ baseRevisionId: site.data()?.activeMapRevisionId, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zones: [
      { zoneId: "overlap-a", zoneNameSnapshot: "A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 50, yMeters: 0 }, { xMeters: 50, yMeters: 50 }, { xMeters: 0, yMeters: 50 }] },
      { zoneId: "overlap-b", zoneNameSnapshot: "B", polygon: [{ xMeters: 25, yMeters: 25 }, { xMeters: 75, yMeters: 25 }, { xMeters: 75, yMeters: 75 }, { xMeters: 25, yMeters: 75 }] },
    ] });
    expect(response.status).toBe(200);
    expect(response.body.draft.validationStatus).toBe("invalid");
  });
});
