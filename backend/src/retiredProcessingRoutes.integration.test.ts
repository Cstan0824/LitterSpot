import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { writeMedia, deleteStoredMedia } from "./services/localMediaStorage.js";

const run = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST ? describe : describe.skip;
const suffix = randomUUID();
const uid = `retirement-root-${suffix}`;
const siteId = `retirement-site-${suffix}`;
const mapId = `retirement-map-${suffix}`;
const mediaId = `retirement-media-${suffix}`;
const foreignId = `retirement-foreign-${suffix}`;
const cleanerUid = `retirement-cleaner-${suffix}`;
const cleanerId = `retirement-staff-${suffix}`;
const legacyUid = `retirement-legacy-${suffix}`;
const legacyId = `retirement-old-staff-${suffix}`;
const storageKey = `test/${mediaId}.jpg`;
const content = Buffer.alloc(384, 0x7f);
let token = "";
let cleanerToken = "";
let legacyToken = "";

run("retired processing APIs and protected operational boundary", () => {
  beforeAll(async () => {
    const email = `${uid}@example.test`;
    const password = "Retirement-emulator-only-123!";
    await firebaseAuth.createUser({ uid, email, password });
    await firestore.doc(`userAccounts/${uid}`).set({ schemaVersion: 2, uid, profileId: uid, siteId, role: "supervisor", authority: "root", displayName: "Retirement Root", emailNormalized: email, status: "active" });
    await firestore.doc(`supervisors/${uid}`).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Retirement Root", status: "active" });
    await firestore.doc(`sites/${siteId}`).set({ schemaVersion: 2, siteId, name: "Retirement Site", status: "active", timeZone: "Asia/Kuala_Lumpur", activeMapRevisionId: mapId, rootSupervisorUid: uid, mapRevisionNumber: 1 });
    await firestore.doc(`orchestratorConfigs/${siteId}`).set({ schemaVersion: 2, siteId, status: "paused", revision: 1, provider: "ollama", model: "fixture", controlHistory: [] });
    await firestore.doc(`siteMapRevisions/${mapId}`).set({ schemaVersion: 2, revisionId: mapId, siteId, widthMeters: 100, heightMeters: 100, gridSizeMeters: 5, revisionNumber: 1 });
    await writeMedia(storageKey, content);
    const media = { schemaVersion: 2, mediaId, siteId, storageKey, storageStatus: "available", mimeType: "image/jpeg", originalFileName: "evidence.jpg", byteSize: content.length, evidenceObservation: { sampleId: "exact-analyzed-sample" } };
    await firestore.doc(`mediaAssets/${mediaId}`).set(media);
    await firestore.doc(`mediaAssets/${foreignId}`).set({ ...media, siteId: "another-site", mediaId: foreignId });
    const login = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    token = (await login.json() as { idToken: string }).idToken;
    expect(token).toBeTruthy();
    for (const [userUid, staffId, legacy] of [[cleanerUid, cleanerId, false], [legacyUid, legacyId, true]] as const) {
      const userEmail = `${userUid}@example.test`;
      await firebaseAuth.createUser({ uid: userUid, email: userEmail, password });
      await firestore.doc(`userAccounts/${userUid}`).set({ schemaVersion: 2, uid: userUid, role: "cleaner", siteId, profileId: staffId, status: "active" });
      await firestore.doc(`cleaners/${staffId}`).set({ ...(legacy ? { accountStatus: "invited", assignedSiteId: siteId, assignedZoneId: "old-zone" } : { schemaVersion: 2, siteId, weeklySchedule: {}, scheduleTimeZone: "Asia/Kuala_Lumpur", availabilityOverride: "none", activeWorkOrderId: null }), cleanerId: staffId, authUid: userUid, fullName: "Boundary Cleaner", status: "active" });
      const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: userEmail, password, returnSecureToken: true }) });
      const userToken = (await signIn.json() as { idToken: string }).idToken;
      expect(userToken).toBeTruthy();
      if (legacy) legacyToken = userToken; else cleanerToken = userToken;
    }
  });

  afterAll(async () => {
    await deleteStoredMedia(storageKey);
    await firebaseAuth.deleteUser(uid);
    await firebaseAuth.deleteUser(cleanerUid);
    await firebaseAuth.deleteUser(legacyUid);
    await Promise.all([`cleaners/${cleanerId}`, `cleaners/${legacyId}`, `userAccounts/${cleanerUid}`, `userAccounts/${legacyUid}`].map(path => firestore.doc(path).delete()));
    await Promise.all([`userAccounts/${uid}`, `supervisors/${uid}`, `sites/${siteId}`, `siteMapRevisions/${mapId}`, `mediaAssets/${mediaId}`, `mediaAssets/${foreignId}`, `orchestratorConfigs/${siteId}`, `dashboardSummaries/${siteId}`, `binPlacementSnapshots/${siteId}`].map(path => firestore.doc(path).delete()));
  });

  it.each([
    ["get", "/api/analysis-runs"], ["get", "/api/analysis-runs/record"], ["post", "/api/analysis-runs/record/evaluate-alerts"],
    ["get", "/api/analytics/reports"], ["get", "/api/analytics/reports/record/csv"], ["post", "/api/analytics/reports"], ["post", "/api/analytics/reconcile"],
    ["get", "/api/detections"], ["get", "/api/detections/record"], ["post", "/api/detections/bin-state"], ["post", "/api/detections/bin-state/batch"],
    ["get", "/api/dashboard/summary"], ["post", "/api/dashboard/reconcile"],
    ["get", "/api/flags"], ["get", "/api/flags/record"], ["get", "/api/issue-observations"], ["get", "/api/issue-observations/record"],
    ["get", "/api/processing-jobs"], ["get", "/api/processing-jobs/record/results"], ["post", "/api/processing-jobs/record/process"], ["post", "/api/processing-jobs/record/retry"],
    ["get", "/api/system-events"], ["get", "/api/system-events/record"],
    ["get", "/api/media"], ["post", "/api/media/images"], ["post", "/api/media/videos"],
    ["get", "/api/cameras/record/registration"], ["get", "/api/cameras/record/registration/workspace"],
    ["get", "/api/cameras/record/registration/draft"], ["put", "/api/cameras/record/registration/draft"],
    ["get", "/api/cameras/record/registration/revisions"], ["post", "/api/cameras/record/registration/reference"],
    ["post", "/api/cameras/record/registration/source-video"], ["post", "/api/cameras/record/registration/validate"],
    ["post", "/api/cameras/record/registration/preview"], ["put", "/api/cameras/record/registration"],
    ["post", "/api/orchestrator/recover"], ["post", "/api/orchestrator/runs/ensure"],
    ["get", "/internal/orchestrator/runs"], ["get", "/internal/orchestrator/runs/record/context"], ["get", "/internal/orchestrator/work-orders/record/review-context"],
    ["get", "/internal/orchestrator/alerts/record/eligible-cleaners"], ["post", "/internal/orchestrator/runs/record/claim"], ["post", "/internal/orchestrator/runs/record/complete"],
    ["post", "/internal/orchestrator/runs/record/decisions"], ["post", "/internal/orchestrator/runs/record/review-requests"], ["post", "/internal/orchestrator/runs/record/reviews"], ["post", "/internal/orchestrator/work-orders"],
  ])("returns route-not-found for authenticated %s %s", async (method, path) => {
    const operation = method === "get" ? request(app).get(path) : method === "put" ? request(app).put(path) : request(app).post(path);
    const response = path.startsWith("/internal/")
      ? await operation.set({ "x-orchestrator-token": String(process.env.ORCHESTRATOR_INTERNAL_TOKEN), "x-orchestrator-worker-id": "retirement-boundary-test" })
      : await operation.set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Route not found.");
  });

  it("treats the retired run path segment as a current Run identifier", async () => {
    const response = await request(app).get("/api/orchestrator/runs/record").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Orchestrator Run not found.");
  });

  it.each(["/api/me", "/api/site-map", "/api/cameras?status=all", "/api/camera-creation/cameras", "/api/alerts", "/api/work-orders", "/api/dashboard", "/api/analytics/daily", "/api/bin-placement/recommendations", "/api/orchestrator/config", "/api/orchestrator/runs"])("keeps current route %s", async path => {
    expect((await request(app).get(path).set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it.each(["/api/me", "/api/cleaner/me", "/api/cleaner/map", "/api/cleaner/work-orders", "/api/cleaner/work-orders?status=all", "/api/cleaner/notifications"])("keeps current Cleaner route %s", async path => {
    expect((await request(app).get(path).set("Authorization", `Bearer ${cleanerToken}`)).status).toBe(200);
  });

  it.each(["accept", "reject"])("retires Cleaner action %s", async action => {
    const response = await request(app).post(`/api/cleaner/work-orders/record/${action}`).set("Authorization", `Bearer ${cleanerToken}`);
    // Unhandled Cleaner paths fall through to the existing Supervisor gate.
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Supervisor access is required.");
  });

  it("keeps current internal Orchestrator worker authentication", async () => {
    const response = await request(app).post("/internal/orchestrator/assignment-runs").send({ siteId });
    expect(response.status).toBe(401);
  });

  it("rejects legacy Cleaner profiles without auto-linking or changing them", async () => {
    const response = await request(app).get("/api/me").set("Authorization", `Bearer ${legacyToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Cleaner access is inactive.");
    const profile = (await firestore.doc(`cleaners/${legacyId}`).get()).data()!;
    expect(profile.accountStatus).toBe("invited");
    expect(profile.authLinkedAt).toBeUndefined();
  });

  it("keeps local content, byte ranges, metadata, and exact overlays", async () => {
    const url = `/api/media/${mediaId}`;
    const full = await request(app).get(`${url}/content`).set("Authorization", `Bearer ${token}`);
    expect(full.status).toBe(200);
    expect(full.body).toEqual(content);
    const range = await request(app).get(`${url}/content`).set("Authorization", `Bearer ${token}`).set("Range", "bytes=0-127");
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe("bytes 0-127/384");
    expect(range.body).toEqual(content.subarray(0, 128));
    const metadata = await request(app).get(url).set("Authorization", `Bearer ${token}`);
    expect(metadata.status).toBe(200);
    expect(metadata.body.media.id).toBe(mediaId);
    expect(metadata.body.media.storageKey).toBeUndefined();
    const overlay = await request(app).get(`${url}/overlay`).set("Authorization", `Bearer ${token}`);
    expect(overlay.body.observation).toEqual({ sampleId: "exact-analyzed-sample" });
  });

  it("preserves authentication and Site isolation for media", async () => {
    expect((await request(app).get(`/api/media/${mediaId}/content`)).status).toBe(401);
    for (const path of ["", "/content", "/overlay"]) {
      expect((await request(app).get(`/api/media/${foreignId}${path}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
    }
  });
});
