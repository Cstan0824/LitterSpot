import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";
import { writeMedia, deleteStoredMedia } from "./localMediaStorage.js";
import { detectSupportedVideo, probeVideoFile, validateDeclaredVideoType } from "./videoUploadValidation.js";
import { publishCameraControl } from "./cameraLiveEvents.js";

export function assertDemoScenesEnabled() {
  if (!["local-emulator", "development-cloud"].includes(env.appEnvironment) || process.env.CAMERA_DEMO_SCENES_ENABLED !== "true") throw new HttpError(404, "Route not found.");
}
export async function sceneCamera(siteId: string, cameraId: string) {
  const camera = await firestore.collection("cameras").doc(cameraId).get();
  if (!camera.exists || camera.data()?.schemaVersion !== 2 || camera.data()?.siteId !== siteId) throw new HttpError(404, "Camera not found.");
  if (camera.data()?.status !== "active" || camera.data()?.sourceType !== "looped_video") throw new HttpError(409, "Scenes require an active looped-video Camera.");
  return camera;
}
export async function uploadCameraScene(siteId: string, cameraId: string, key: string, file: Express.Multer.File, actorUid: string) {
  assertDemoScenesEnabled();
  const camera = await sceneCamera(siteId, cameraId);
  const registration = await firestore.collection("cameraRegistrationRevisions").doc(camera.data()!.activeRegistrationRevisionId).get();
  const detected = detectSupportedVideo(file.buffer.subarray(0, 16)); validateDeclaredVideoType(file.mimetype, detected);
  const mediaRef = firestore.collection("mediaAssets").doc();
  const storageKey = `media/${mediaRef.id}/scene.${detected.extension}`;
  const path = await writeMedia(storageKey, file.buffer);
  try {
    const probe = await probeVideoFile(path, detected);
    if (probe.durationSeconds > env.videoMaxDurationSeconds) throw new HttpError(413, "Scene video is too long.");
    if (probe.width !== registration.data()?.sourceWidth || probe.height !== registration.data()?.sourceHeight) throw new HttpError(400, "Scene dimensions must match Camera Registration. Use the same angle, framing, and bin positions.");
    const ref = camera.ref.collection("demoScenes").doc(key);
    await firestore.runTransaction(async tx => {
      const [current, prior] = await Promise.all([tx.get(camera.ref), tx.get(ref)]);
      if (current.data()?.activeSourceRevisionId !== camera.data()?.activeSourceRevisionId) throw new HttpError(409, "Camera was reconfigured. Upload against its current Registration.");
      if (prior.exists) throw new HttpError(409, "Scene key already exists. Choose a new key.");
      tx.create(mediaRef, { schemaVersion: 2, siteId, mediaId: mediaRef.id, purpose: "camera_source_video", ownerType: "camera", ownerId: cameraId, cameraId, storageKey, storageStatus: "available", mimeType: detected.mimeType, width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, byteSize: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex"), originalFileName: file.originalname.slice(0, 255), retentionClass: "configuration", expiresAt: null, createdByUid: actorUid, createdAt: FieldValue.serverTimestamp() });
      tx.create(ref, { schemaVersion: 2, siteId, cameraId, key, mediaId: mediaRef.id, sourceRevisionId: camera.data()!.activeSourceRevisionId, registrationRevisionId: camera.data()!.activeRegistrationRevisionId, createdAt: FieldValue.serverTimestamp() });
    });
    return { key, mediaId: mediaRef.id };
  } catch (error) { await deleteStoredMedia(storageKey); throw error; }
}
export async function selectCameraScene(siteId: string, cameraId: string, key: string, actorUid: string) {
  assertDemoScenesEnabled();
  const camera = await sceneCamera(siteId, cameraId);
  const result = await firestore.runTransaction(async tx => {
    const [current, scene] = await Promise.all([tx.get(camera.ref), tx.get(camera.ref.collection("demoScenes").doc(key))]);
    if (current.data()?.siteId !== siteId || current.data()?.status !== "active" || current.data()?.sourceType !== "looped_video") throw new HttpError(409, "Camera is no longer available for scene switching.");
    if (!scene.exists || scene.data()?.sourceRevisionId !== current.data()?.activeSourceRevisionId || scene.data()?.registrationRevisionId !== current.data()?.activeRegistrationRevisionId) throw new HttpError(409, "Scene does not match this Camera Registration.");
    const playback = { mediaId: scene.data()!.mediaId, sourceRevisionId: current.data()!.activeSourceRevisionId, generation: Number(current.data()?.demoPlayback?.generation ?? 0) + 1, selectedAt: Date.now() };
    tx.update(camera.ref, { demoPlayback: playback });
    return playback;
  });
  console.info(JSON.stringify({ event: "demo_camera_scene_selected", siteId, cameraId, sceneKey: key, actorUid, generation: result.generation }));
  publishCameraControl(siteId, cameraId);
  return result;
}
