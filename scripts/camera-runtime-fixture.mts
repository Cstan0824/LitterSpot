import { app } from "../backend/src/app.js";
import { firestore, firebaseAuth } from "../backend/src/config/firebase.js";
import { setLiveInferenceForTests } from "../backend/src/services/liveMonitoringService.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Emulators required");
const siteId = "camera-browser-site", uid = "camera-browser-root", email = "camera-browser@example.test";
try { await firebaseAuth.createUser({ uid, email, password: "Camera-test-123!" }); } catch {}
await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", status: "active", revision: 1 });
await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Browser Test", status: "active", revision: 1 });
await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Camera browser test", status: "active", activeMapRevisionId: "browser-map", revision: 1 });
await firestore.collection("orchestratorConfigs").doc(siteId).set({ schemaVersion: 2, siteId, status: "paused", assignmentEnabled: false, revision: 1 });
await firestore.collection("siteMapRevisions").doc("browser-map").set({ schemaVersion: 2, siteId, revisionId: "browser-map", revisionNumber: 1, widthMeters: 100, heightMeters: 100 });
await firestore.collection("siteMapRevisions").doc("browser-map").collection("zoneGeometry").doc("browser-zone").set({ schemaVersion: 2, siteId, zoneId: "browser-zone", zoneNameSnapshot: "Main Entrance", polygon: [{xMeters:0,yMeters:0},{xMeters:100,yMeters:0},{xMeters:100,yMeters:100},{xMeters:0,yMeters:100}] });
await firestore.collection("zones").doc("browser-zone").set({ schemaVersion: 2, siteId, zoneId: "browser-zone", lifecycleStatus: "active", name: "Main Entrance" });
const root = process.env.MEDIA_STORAGE_ROOT!; mkdirSync(`${root}/fixtures`, { recursive: true });
for (const [key, color] of [["dirty", "red"], ["clean", "green"]]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=1920x1080:r=30`, "-t", "3", "-pix_fmt", "yuv420p", `${root}/fixtures/${key}.mp4`]);
  await firestore.collection("mediaAssets").doc(`browser-${key}`).set({ schemaVersion: 2, siteId, mediaId: `browser-${key}`, purpose: "camera_source_video", storageStatus: "available", storageKey: `fixtures/${key}.mp4`, mimeType: "video/mp4", originalFileName: `${key}.mp4` });
}
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `${root}/fixtures/dirty.mp4`, "-frames:v", "1", `${root}/fixtures/ref.jpg`]);
await firestore.collection("mediaAssets").doc("browser-reference").set({ schemaVersion: 2, siteId, storageStatus: "available", storageKey: "fixtures/ref.jpg", mimeType: "image/jpeg" });
for (const cameraId of ["browser-c1", "browser-c2", "browser-c3", "browser-c4", "browser-c5", "browser-c6"]) {
  await firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, name: cameraId, status: "active", monitoringEnabled: true, sourceType: "looped_video", isSimulation: true, activeSourceRevisionId: `${cameraId}-source`, activeRegistrationRevisionId: `${cameraId}-reg`, revision: 1 });
  await firestore.collection("cameraSourceRevisions").doc(`${cameraId}-source`).set({ schemaVersion: 2, siteId, cameraId, type: "looped_video", sourceMediaId: "browser-dirty", sampleIntervalSeconds: 1 });
  await firestore.collection("cameraRegistrationRevisions").doc(`${cameraId}-reg`).set({ schemaVersion: 2, siteId, cameraId, sourceRevisionId: `${cameraId}-source`, referenceMediaId: "browser-reference", sourceWidth: 1920, sourceHeight: 1080, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bins: [] });
  await firestore.collection("siteMapRevisions").doc("browser-map").collection("cameraPlacements").doc(cameraId).set({ schemaVersion: 2, siteId, cameraId, zoneId: "browser-zone", point: { xMeters: 10, yMeters: 10 } });
  await firestore.collection("cameras").doc(cameraId).collection("demoScenes").doc("clean").set({ sourceRevisionId: `${cameraId}-source`, registrationRevisionId: `${cameraId}-reg`, mediaId: "browser-clean" });
}
setLiveInferenceForTests(async input => {
  // The test boundary substitutes only model inference; Camera/Alert contracts remain real.
  const cameraId = (input.registration as any).cameraId;
  const camera = await firestore.collection("cameras").doc(cameraId).get();
  const clean = camera.data()?.demoPlayback?.mediaId === "browser-clean";
  return { image: { width: 1920, height: 1080 }, focusRegion: [], peopleCount: 1, people: [{ confidence: .9, bbox: { x1: 300, y1: 200, x2: 600, y2: 700 } }], bins: [], floorHazards: clean ? [] : [{ className: "floor_spill", confidence: .9, bbox: { x1: 600, y1: 400, x2: 900, y2: 700 }, polygon: [] }], modelVersions: { floorHazard: "fixture", people: "fixture", binLocalizer: "fixture", binState: "fixture" }, processingTimeMs: 10 } as any;
});
app.listen(3180, "127.0.0.1", () => console.log("Camera fixture API ready on 3180"));
