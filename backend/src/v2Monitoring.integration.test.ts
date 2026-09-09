import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { writeMedia } from "./services/localMediaStorage.js";
import { flushV2MinuteBuckets, inspectV2LiveMemory, markOfflineCameras, resetV2LiveMemory, setV2LiveInferenceForTests } from "./services/v2LiveMonitoringService.js";
import { expireRuntimeSessionForTests, resetMonitoringRuntime } from "./services/monitoringRuntimeRegistry.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
async function signIn(email: string, password: string) { const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); return (await response.json() as { idToken: string }).idToken; }

run("V2 live monitoring", () => {
  const suffix = randomUUID(); const uid = `monitor-root-${suffix}`; const email = `${uid}@example.test`; const password = "Monitor-password-123!"; const siteId = `monitor-site-${suffix}`; const mapId = `monitor-map-${suffix}`; const zoneId = `monitor-zone-${suffix}`; const cameraId = `monitor-camera-${suffix}`; const sourceId = `monitor-source-${suffix}`; const registrationId = `monitor-registration-${suffix}`; const referenceId = `monitor-reference-${suffix}`; const storageKey = `test/${referenceId}.jpg`;
  // Keep every analytics assertion in one stable UTC minute. Using Date.now()
  // per sample made this test split into two correct buckets near :59.
  const capturedNowMs = Date.now();
  const capturedMinuteStartMs = Math.floor(capturedNowMs / 60_000) * 60_000;
  const capturedBaseMs = capturedMinuteStartMs + Math.min(Math.max(capturedNowMs - capturedMinuteStartMs, 1_000), 50_000);
  let token = ""; let sessionId = ""; let leaseToken = ""; let episodeId = "";
  let includeSpill = true; let binState: "normal" | "full" | "overflow" = "normal";
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password, displayName: "Monitor Root" });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", emailNormalized: email, displayName: "Monitor Root", status: "active", revision: 1 });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Monitor Root", status: "active", revision: 1 });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Monitor Site", status: "active", activeMapRevisionId: mapId, revision: 1 });
    await firestore.collection("siteMapRevisions").doc(mapId).set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1 });
    await firestore.collection("siteMapRevisions").doc(mapId).collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Monitor Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 10, yMeters: 0 }, { xMeters: 10, yMeters: 10 }] });
    await firestore.collection("siteMapRevisions").doc(mapId).collection("cameraPlacements").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, zoneId, point: { xMeters: 1, yMeters: 1 } });
    await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId, name: "Monitor Camera", status: "active", monitoringEnabled: true, activeSourceRevisionId: sourceId, activeRegistrationRevisionId: registrationId, sourceType: "looped_video", isSimulation: true, revision: 1 });
    await writeMedia(storageKey, jpeg);
    await firestore.collection("mediaAssets").doc(referenceId).set({ schemaVersion: 2, mediaId: referenceId, siteId, storageStatus: "available", storageKey, mimeType: "image/jpeg", originalFileName: "reference.jpg" });
    await firestore.collection("cameraRegistrationRevisions").doc(registrationId).set({ schemaVersion: 2, registrationRevisionId: registrationId, siteId, cameraId, sourceRevisionId: sourceId, referenceMediaId: referenceId, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bins: [] });
    setV2LiveInferenceForTests(async () => ({ image: { width: 640, height: 480 }, focusRegion: [], peopleCount: 4, people: [{ confidence: 0.88, bbox: { x1: 20, y1: 30, x2: 120, y2: 300 } }], bins: [{ binIndex: 1, binId: "bin-1", localizerConfidence: 0.9, bbox: { x1: 1, y1: 1, x2: 10, y2: 10 }, classificationRegion: { x1: 1, y1: 1, x2: 10, y2: 10 }, state: binState, stateConfidence: 0.9, signals: { binPresence: 0.9, fullness: binState === "normal" ? 0.1 : 0.9, overflow: binState === "overflow" ? 0.9 : 0.1 }, unknownReasons: [], processingTimeMs: 2 }], floorHazards: includeSpill ? [{ className: "floor_spill", confidence: 0.8, bbox: { x1: 1, y1: 2, x2: 3, y2: 4 }, polygon: [] }] : [], modelVersions: { floorHazard: "floor-v1", people: "people-v1", binLocalizer: "bin-loc-v1", binState: "bin-state-v1" }, processingTimeMs: 12 } as any));
    token = await signIn(email, password);
  });
  afterAll(async () => { setV2LiveInferenceForTests(null); resetV2LiveMemory(cameraId); resetMonitoringRuntime(cameraId); await firebaseAuth.deleteUser(uid).catch(() => undefined); });

  it("claims one owner, starts an Episode, and processes a sample without storing the frame", async () => {
    const claim = await request(app).post("/api/monitoring/sessions/claim").set("Authorization", `Bearer ${token}`).send({}); expect(claim.status).toBe(201); sessionId = claim.body.sessionId; leaseToken = claim.body.leaseToken;
    const second = await request(app).post("/api/monitoring/sessions/claim").set("Authorization", `Bearer ${token}`).send({}); expect(second.status).toBe(409);
    const start = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/start`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).send({}); expect(start.status).toBe(201); episodeId = start.body.episodeId;
    expect((await firestore.collection("monitoringEpisodes").doc(episodeId).get()).data()?.zoneNameSnapshot).toBe("Monitor Zone");
    const capturedAt = new Date(capturedBaseMs + 1_000).toISOString();
    const sample = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).field("episodeId", episodeId).field("sequence", "1").field("capturedAt", capturedAt).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" });
    expect(sample.status).toBe(200); expect(sample.body.observation).toMatchObject({ peopleCount: 4, isSimulation: true, people: [{ confidence: 0.88 }], bins: [{ binId: "bin-1", state: "normal", confidence: 0.9 }] });
    expect((await firestore.collection("analysisRuns").where("cameraId", "==", cameraId).get()).size).toBe(0);
    const media = await firestore.collection("mediaAssets").where("cameraId", "==", cameraId).get(); expect(media.size).toBe(1); expect(media.docs[0].data().purpose).toBe("alert_evidence");
    expect(inspectV2LiveMemory(cameraId).temporalKeys).toHaveLength(3);
    const alertEvidence = (await firestore.collection("alerts").where("cameraId", "==", cameraId).get()).docs[0].data().evidence;
    expect(alertEvidence).toMatchObject({ width: 640, height: 480, people: [{ confidence: 0.88 }], bins: [{ binId: "bin-1" }], observation: { sampleId: `${episodeId}:1` } });
    expect(await flushV2MinuteBuckets(siteId, new Date())).toBe(0);
    expect(await flushV2MinuteBuckets(siteId, new Date(Date.now() + 60000))).toBe(1);
    expect((await firestore.collection("analyticsMinuteBuckets").where("siteId", "==", siteId).get()).size).toBe(1);
  });

  it("combines full and overflow into one escalating bin-service Alert", async () => {
    const resumed = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/start`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).send({});
    expect(resumed.body).toMatchObject({ episodeId, nextSequence: 2, resumed: true });
    expect(inspectV2LiveMemory(cameraId).temporalKeys).toHaveLength(3);
    includeSpill = false; binState = "full";
    for (const sequence of [2, 3]) { const response = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).field("episodeId", episodeId).field("sequence", String(sequence)).field("capturedAt", new Date(capturedBaseMs + sequence * 1_000).toISOString()).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" }); expect(response.status).toBe(200); }
    let alerts = await firestore.collection("alerts").where("cameraId", "==", cameraId).where("issueType", "==", "bin_service").get(); expect(alerts.size).toBe(1); expect(alerts.docs[0].data()).toMatchObject({ observedCondition: "full", severity: "warning" });
    binState = "overflow";
    const overflow = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).field("episodeId", episodeId).field("sequence", "4").field("capturedAt", new Date(capturedBaseMs + 4_000).toISOString()).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" }); expect(overflow.status).toBe(200);
    alerts = await firestore.collection("alerts").where("cameraId", "==", cameraId).where("issueType", "==", "bin_service").get(); expect(alerts.size).toBe(1); expect(alerts.docs[0].data()).toMatchObject({ observedCondition: "overflow", severity: "critical" }); expect((await firestore.collection("activeAlertKeys").where("cameraId", "==", cameraId).where("issueType", "==", "bin_service").get()).size).toBe(1);
    const flagsBefore = await firestore.collection("flags").where("cameraId", "==", cameraId).where("issueType", "==", "bin_service").get();
    const continuing = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).field("episodeId", episodeId).field("sequence", "5").field("capturedAt", new Date(capturedBaseMs + 5_000).toISOString()).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" }); expect(continuing.status).toBe(200);
    const flagsAfter = await firestore.collection("flags").where("cameraId", "==", cameraId).where("issueType", "==", "bin_service").get(); expect(flagsAfter.size).toBe(flagsBefore.size);
    await flushV2MinuteBuckets(siteId,new Date(Date.now()+120000));
    const buckets=await firestore.collection("analyticsMinuteBuckets").where("siteId","==",siteId).get();
    expect(buckets.size).toBe(1); expect(buckets.docs[0].data().siteTotals.successfulSampleCount).toBe(5); expect(buckets.docs[0].data().siteTotals.peopleSum).toBe(20); expect(buckets.docs[0].data().siteTotals.inferenceLatencyMsSum).toBe(60);
  });

  it("exposes Alert traceability, ages warnings, and dismisses with history", async () => {
    const alertsResponse = await request(app).get("/api/alerts").set("Authorization", `Bearer ${token}`); expect(alertsResponse.status).toBe(200); expect(alertsResponse.body.alerts.length).toBe(2);
    const spill = alertsResponse.body.alerts.find((alert: any) => alert.issueType === "floor_spill"); const detail = await request(app).get(`/api/alerts/${spill.id}`).set("Authorization", `Bearer ${token}`); expect(detail.status).toBe(200); expect(detail.body.flags.length).toBeGreaterThanOrEqual(1); expect(detail.body.occurrences.length).toBeGreaterThanOrEqual(1);
    const agedRef = firestore.collection("alerts").doc(`aged-${suffix}`); await agedRef.set({ schemaVersion: 2, alertId: agedRef.id, siteId, cameraId, issueType: "floor_litter", status: "waiting_for_cleaner", severity: "warning", highestSeverity: "warning", priorityScore: 40, createdAt: new Date(Date.now() - 16 * 60000), revision: 1 });
    expect((await request(app).post("/api/alerts/age").set("Authorization", `Bearer ${token}`).send({})).status).toBe(200); expect((await agedRef.get()).data()?.severity).toBe("critical");
    const dismissed = await request(app).post(`/api/alerts/${spill.id}/dismiss`).set("Authorization", `Bearer ${token}`).send({ reason: "False spill during test", expectedRevision: spill.revision }); expect(dismissed.status).toBe(200); expect((await firestore.collection("alerts").doc(spill.id).get()).data()?.status).toBe("dismissed");
  });

  it("rejects duplicate sequence and marks stale Camera runtime offline", async () => {
    const duplicate = await request(app).post(`/api/monitoring/sessions/${sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", leaseToken).field("episodeId", episodeId).field("sequence", "5").field("capturedAt", new Date().toISOString()).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" });
    expect(duplicate.status).toBe(409);
    await firestore.collection("cameraRuntimeStates").doc(cameraId).update({ lastSampleAcceptedAt: new Date(0), connectionStatus: "online" });
    expect(await markOfflineCameras(siteId, new Date(Date.now() + 6000), 5)).toBeGreaterThanOrEqual(1);
    expect((await firestore.collection("cameraRuntimeStates").doc(cameraId).get()).data()?.connectionStatus).toBe("offline");
  });

  it("allows lease failover after expiry and validates release ownership", async () => {
    expireRuntimeSessionForTests(siteId);
    const replacement = await request(app).post("/api/monitoring/sessions/claim").set("Authorization", `Bearer ${token}`).send({});
    expect(replacement.status).toBe(201);
    const wrongRelease = await request(app).post(`/api/monitoring/sessions/${replacement.body.sessionId}/release`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", "wrong").send({});
    expect(wrongRelease.status).toBe(409);
    const released = await request(app).post(`/api/monitoring/sessions/${replacement.body.sessionId}/release`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", replacement.body.leaseToken).send({});
    expect(released.status).toBe(200);
  });
});
