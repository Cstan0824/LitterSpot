import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const body = await response.json() as { idToken?: string };
  if (!body.idToken) throw new Error("Cleaner test sign-in failed.");
  return body.idToken;
}

run("V2 Cleaner workflow", () => {
  const suffix = randomUUID();
  const rootUid = `cleaner-root-${suffix}`;
  const rootEmail = `${rootUid}@example.test`;
  const cleanerEmail = `cleaner-${suffix}@example.test`;
  const duplicateEmail = `duplicate-${suffix}@example.test`;
  const password = "Cleaner-emulator-password-123!";
  const siteId = `cleaner-site-${suffix}`;
  const revisionId = `cleaner-map-${suffix}`;
  const zoneId = `cleaner-zone-${suffix}`;
  let rootToken = "";
  let cleanerToken = "";
  let cleanerId = "";

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: rootUid, email: rootEmail, password, displayName: "Cleaner Root" });
    await firestore.collection("userAccounts").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, role: "supervisor", siteId, profileId: rootUid, authority: "root", emailNormalized: rootEmail, displayName: "Cleaner Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(rootUid).set({ schemaVersion: 2, uid: rootUid, siteId, authority: "root", fullName: "Cleaner Root", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Cleaner Site", timeZone: "Asia/Kuala_Lumpur", status: "active", rootSupervisorUid: rootUid, activeMapRevisionId: revisionId, mapRevisionNumber: 1, revision: 1 });
    const revision = firestore.collection("siteMapRevisions").doc(revisionId);
    await revision.set({ schemaVersion: 2, revisionId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, zoneCount: 1, cameraPlacementCount: 0, cleanerStationCount: 0 });
    await revision.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 50, yMeters: 0 }, { xMeters: 50, yMeters: 50 }, { xMeters: 0, yMeters: 50 }] });
    rootToken = await signIn(rootEmail, password);
  });

  afterAll(async () => {
    for (const email of [rootEmail, cleanerEmail, duplicateEmail]) { const user = await firebaseAuth.getUserByEmail(email).catch(() => null); if (user) await firebaseAuth.deleteUser(user.uid).catch(() => undefined); }
  });

  it("creates a directly usable Cleaner account with schedule and Station Point", async () => {
    const response = await request(app).post("/api/cleaners").set("Authorization", `Bearer ${rootToken}`).send({ staffCode: "CLN-001", fullName: "Test Cleaner", phone: "+60123456789", email: cleanerEmail, password, weeklySchedule: { mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 }, thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 } }, stationPoint: { xMeters: 70, yMeters: 70 }, idempotencyKey: `cleaner-create-${suffix}` });
    expect(response.status).toBe(201);
    cleanerId = response.body.cleaner.id;
    expect(response.body.cleaner).toMatchObject({ siteId, staffCode: "CLN-001", stationZoneId: null, availability: { available: true } });
    expect(response.body.cleaner).not.toHaveProperty("assignedZoneId");
    expect(response.body.cleaner).not.toHaveProperty("capabilities");
    cleanerToken = await signIn(cleanerEmail, password);
    const me = await request(app).get("/api/cleaner/me").set("Authorization", `Bearer ${cleanerToken}`);
    expect(me.status).toBe(200);
    expect(me.body.cleaner.id).toBe(cleanerId);
    const map = await request(app).get("/api/cleaner/map").set("Authorization", `Bearer ${cleanerToken}`);
    expect(map.status).toBe(200);
    expect(map.body.map).toMatchObject({ siteId, activeRevisionId: expect.any(String), revision: { widthMeters: 100, heightMeters: 100, gridSizeMeters: 5 }, station: { zoneId: null } });
    expect(map.body.map.zones).toEqual([expect.objectContaining({ id: zoneId, zoneNameSnapshot: "Main Zone" })]);
    expect(map.body.map).not.toHaveProperty("cleanerStations");
    expect(map.body.map).not.toHaveProperty("cameraPlacements");
  });

  it("derives unavailability from Supervisor override and schedule", async () => {
    const current = await request(app).get(`/api/cleaners/${cleanerId}`).set("Authorization", `Bearer ${rootToken}`);
    const overridden = await request(app).put(`/api/cleaners/${cleanerId}/availability-override`).set("Authorization", `Bearer ${rootToken}`).send({ expectedRevision: current.body.cleaner.revision, availabilityOverride: "unavailable" });
    expect(overridden.status).toBe(200);
    expect(overridden.body.cleaner.availability).toMatchObject({ available: false, reasons: expect.arrayContaining(["availability_override"]) });
    const scheduled = await request(app).put(`/api/cleaners/${cleanerId}/schedule`).set("Authorization", `Bearer ${rootToken}`).send({ expectedRevision: overridden.body.cleaner.revision, weeklySchedule: {} });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.cleaner.availability.reasons).toEqual(expect.arrayContaining(["availability_override", "outside_schedule"]));
  });

  it("enforces Site-scoped staff-code uniqueness and compensates failed Auth creation", async () => {
    const response = await request(app).post("/api/cleaners").set("Authorization", `Bearer ${rootToken}`).send({ staffCode: "CLN-001", fullName: "Duplicate Cleaner", phone: "+60111111111", email: duplicateEmail, password, weeklySchedule: {}, stationPoint: { xMeters: 40, yMeters: 40 }, idempotencyKey: `duplicate-${suffix}` });
    expect(response.status).toBe(409);
    await expect(firebaseAuth.getUserByEmail(duplicateEmail)).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  it("deactivates the Cleaner account and preserves its staff-code reservation", async () => {
    const current = await request(app).get(`/api/cleaners/${cleanerId}`).set("Authorization", `Bearer ${rootToken}`);
    const response = await request(app).delete(`/api/cleaners/${cleanerId}`).set("Authorization", `Bearer ${rootToken}`).send({ expectedRevision: current.body.cleaner.revision });
    expect(response.status).toBe(200);
    expect(response.body.cleaner.status).toBe("inactive");
    expect((await firestore.collection("cleanerStaffCodeKeys").where("cleanerId", "==", cleanerId).get()).size).toBe(1);
  });
});
