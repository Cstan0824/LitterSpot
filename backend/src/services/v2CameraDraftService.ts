import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { publishCameraState, validateCameraSource, type CameraSourceType } from "./v2CameraPolicy.js";
import { cameraRegistrationDraftSchema } from "../schemas/cameraRegistration.js";
import { containingPolygon, polygonArea, validateMapGeometry, type Polygon } from "./v2MapGeometry.js";
import { v2AuditEventData } from "./v2AuditService.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { detectSupportedVideo, probeVideoFile, validateDeclaredVideoType } from "./videoUploadValidation.js";
import { deleteStoredMedia, writeMedia } from "./localMediaStorage.js";
import { env } from "../config/env.js";

function timestamp(value: unknown) { return value instanceof Timestamp ? value.toDate().toISOString() : null; }
function present(id: string, data: Record<string, unknown>) { return { id, ...data, createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) }; }

async function draftForSite(draftId: string, siteId: string) { const draft = await firestore.collection("cameraDrafts").doc(draftId).get(); if (!draft.exists || draft.data()?.siteId !== siteId || draft.data()?.status === "published") throw new HttpError(404, "Camera Draft not found."); return draft; }

export async function startV2CameraDraft(input: { siteId: string; kind: "create" | "reconfigure"; cameraId?: string; name: string; description?: string | null; sourceType: CameraSourceType; placement?: { point: { xMeters: number; yMeters: number } } | null; provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: Polygon } | null; actorUid: string }) {
  const site = await firestore.collection("sites").doc(input.siteId).get(); if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  const cameraId = input.cameraId ?? firestore.collection("cameras").doc().id; const existing = input.kind === "reconfigure" ? await firestore.collection("cameras").doc(cameraId).get() : null; if (input.kind === "reconfigure" && (!existing?.exists || existing.data()?.siteId !== input.siteId)) throw new HttpError(404, "Camera not found."); if (input.kind === "create" && !input.placement) throw new HttpError(400, "Camera Placement is required.");
  const cameraCount = (await firestore.collection("cameras").where("siteId", "==", input.siteId).limit(1).get()).size; const laptopId = site.data()?.laptopCameraId == null ? null : String(site.data()?.laptopCameraId); if (cameraCount === 0 && input.sourceType !== "laptop_camera") throw new HttpError(400, "The first Camera must use the laptop Camera source."); if (input.kind === "create" && input.sourceType === "laptop_camera" && laptopId) throw new HttpError(400, "Only one laptop Camera is allowed.");
  if (input.kind !== "create" && input.provisionalZone) throw new HttpError(400, "A provisional Zone is only supported while creating a Camera.");
  const activeRevision = firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId));
  const [revision, zoneSnapshot] = await Promise.all([activeRevision.get(), activeRevision.collection("zoneGeometry").get()]);
  if (!revision.exists) throw new HttpError(409, "Active Site Map revision is missing.");
  const mapZones = zoneSnapshot.docs.map((document) => ({ id: document.id, polygon: document.data().polygon as Polygon }));
  if (input.provisionalZone) {
    if (zoneSnapshot.docs.some((document) => document.id === input.provisionalZone?.zoneId)) throw new HttpError(409, "The provisional Zone ID is already in use.");
    const validation = validateMapGeometry({ widthMeters: Number(revision.data()?.widthMeters), heightMeters: Number(revision.data()?.heightMeters), zones: [...mapZones, { id: input.provisionalZone.zoneId, polygon: input.provisionalZone.polygon }], points: input.placement ? [{ label: "camera_placement", point: input.placement.point, requiresZone: true }] : [] });
    if (!validation.valid) throw new HttpError(400, `Provisional Zone is invalid: ${validation.errors.join(", ")}`);
  }
  let placement: Record<string, unknown> | null = null; if (input.placement) { const candidates = input.provisionalZone ? [...mapZones, { id: input.provisionalZone.zoneId, polygon: input.provisionalZone.polygon }] : mapZones; const zoneId = containingPolygon(input.placement.point, candidates); if (!zoneId) throw new HttpError(400, "Camera Placement must be inside exactly one active or provisional Zone."); placement = { point: input.placement.point, zoneId }; }
  const reference = firestore.collection("cameraDrafts").doc(); await reference.create({ schemaVersion: V2_SCHEMA_VERSION, draftId: reference.id, siteId: input.siteId, kind: input.kind, cameraId, baseCameraRevision: existing?.data()?.revision ?? null, baseMapRevisionId: String(site.data()?.activeMapRevisionId ?? ""), name: input.name.trim(), description: input.description?.trim() || null, placement, provisionalZone: input.provisionalZone ?? null, source: { type: input.sourceType, sourceMediaId: null, browserDeviceHint: null, sampleIntervalSeconds: Number(site.data()?.defaultSampleIntervalSeconds ?? 1), isSimulation: input.sourceType === "looped_video" }, registration: null, validationStatus: "not_validated", validationErrors: [], referenceCapturedAt: null, status: "draft", createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: 1 }); return present(reference.id, (await reference.get()).data()!);
}

export async function cancelV2CameraDraft(siteId: string, draftId: string) {
  const draft = await draftForSite(draftId, siteId);
  const mediaIds = [draft.data()?.referenceMediaId, draft.data()?.source?.sourceMediaId].filter((value): value is string => typeof value === "string" && value.length > 0);
  const media = await Promise.all(mediaIds.map((mediaId) => firestore.collection("mediaAssets").doc(mediaId).get()));
  await firestore.runTransaction(async (transaction) => {
    const latest = await transaction.get(draft.ref);
    if (!latest.exists || latest.data()?.siteId !== siteId || latest.data()?.status === "published") throw new HttpError(404, "Camera Draft not found.");
    for (const document of media) if (document.exists && document.data()?.ownerType === "camera_draft" && document.data()?.ownerId === draftId) transaction.delete(document.ref);
    transaction.delete(draft.ref);
  });
  await Promise.all(media.map(async (document) => {
    const storageKey = document.data()?.storageKey;
    if (typeof storageKey === "string") await deleteStoredMedia(storageKey).catch(() => undefined);
  }));
}

export async function uploadV2DraftReference(input: { siteId: string; draftId: string; file: Express.Multer.File; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); const detected = detectSupportedImage(input.file.buffer); validateDeclaredImageType(input.file.mimetype, detected.mimeType); const mediaId = firestore.collection("mediaAssets").doc().id; const storageKey = `media/${mediaId}/camera-reference.${detected.extension}`; await writeMedia(storageKey, input.file.buffer); await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: 2, mediaId, siteId: input.siteId, purpose: "camera_reference", ownerType: "camera_draft", ownerId: input.draftId, cameraId: draft.data()?.cameraId, mimeType: detected.mimeType, originalFileName: input.file.originalname.slice(0, 255), byteSize: input.file.size, sha256: createHash("sha256").update(input.file.buffer).digest("hex"), storageKey, storageStatus: "available", width: null, height: null, durationSeconds: null, capturedAt: FieldValue.serverTimestamp(), retentionClass: "configuration", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, deletedAt: null, revision: 1 }); await draft.ref.update({ referenceMediaId: mediaId, validationStatus: "not_validated", referenceCapturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return { mediaId, contentUrl: `/api/media/${mediaId}/content`, mimeType: detected.mimeType };
}

export async function uploadV2DraftSourceVideo(input: { siteId: string; draftId: string; file: Express.Multer.File; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); if (draft.data()?.source?.type !== "looped_video") throw new HttpError(409, "Only a looped-video Camera Draft accepts source video."); if (input.file.size > env.videoMaxBytes) throw new HttpError(413, "The video exceeds the configured size limit."); const detected = detectSupportedVideo(input.file.buffer.subarray(0, 16)); validateDeclaredVideoType(input.file.mimetype, detected); const mediaId = firestore.collection("mediaAssets").doc().id; const storageKey = `media/${mediaId}/camera-source.${detected.extension}`; const filePath = await writeMedia(storageKey, input.file.buffer); let probe; try { probe = await probeVideoFile(filePath, detected); } catch (error) { await unlink(filePath).catch(() => undefined); throw error; } if (probe.durationSeconds > env.videoMaxDurationSeconds) { await unlink(filePath).catch(() => undefined); throw new HttpError(413, "The video exceeds the configured duration limit."); } await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: 2, mediaId, siteId: input.siteId, purpose: "camera_source_video", ownerType: "camera_draft", ownerId: input.draftId, cameraId: draft.data()?.cameraId, mimeType: detected.mimeType, originalFileName: input.file.originalname.slice(0, 255), byteSize: input.file.size, sha256: createHash("sha256").update(input.file.buffer).digest("hex"), storageKey, storageStatus: "available", width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, capturedAt: null, retentionClass: "configuration", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, deletedAt: null, revision: 1 }); await draft.ref.update({ "source.sourceMediaId": mediaId, validationStatus: "not_validated", updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return { mediaId, contentUrl: `/api/media/${mediaId}/content`, mimeType: detected.mimeType, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height };
}

export async function saveV2DraftRegistration(input: { siteId: string; draftId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: unknown[]; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); const referenceMediaId = String(draft.data()?.referenceMediaId ?? ""); if (!referenceMediaId) throw new HttpError(409, "Upload a reference image first."); const registration = cameraRegistrationDraftSchema.parse({ schemaVersion: 2, referenceMediaId, referenceSource: { type: "image" }, sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, walkableFloorPolygon: input.walkableFloorPolygon, bins: input.bins, quality: {} }); await draft.ref.update({ registration, validationStatus: "not_validated", updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return registration; }

export async function validateV2CameraDraft(siteId: string, draftId: string) { const draft = await draftForSite(draftId, siteId); const data = draft.data()!; const errors: string[] = []; if (!data.registration) errors.push("registration_required"); if (data.source?.type === "looped_video" && !data.source?.sourceMediaId) errors.push("source_video_required"); if (data.kind === "create" && !data.placement) errors.push("placement_required"); if (data.registration) { try { cameraRegistrationDraftSchema.parse(data.registration); } catch { errors.push("registration_invalid"); } } await draft.ref.update({ validationStatus: errors.length ? "invalid" : "valid", validationErrors: errors, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); return { valid: errors.length === 0, errors };
}

export async function createV2CameraDraft(input: { siteId: string; kind: "create" | "reconfigure"; cameraId?: string; name: string; description?: string | null; source: { type: CameraSourceType; sourceMediaId?: string | null; sampleIntervalSeconds?: number }; placement?: { point: { xMeters: number; yMeters: number } } | null; registration: { referenceMediaId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins?: unknown[] }; actorUid: string }) {
  const draftRef = firestore.collection("cameraDrafts").doc();
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  const cameraId = input.cameraId ?? firestore.collection("cameras").doc().id;
  const existingCamera = input.kind === "reconfigure" ? await firestore.collection("cameras").doc(cameraId).get() : null;
  if (input.kind === "reconfigure" && (!existingCamera?.exists || existingCamera.data()?.siteId !== input.siteId)) throw new HttpError(404, "Camera not found.");
  if (input.kind === "create" && !input.placement) throw new HttpError(400, "Camera Placement is required.");
  const cameraCount = (await firestore.collection("cameras").where("siteId", "==", input.siteId).limit(1).get()).size;
  const existingLaptop = site.data()?.laptopCameraId == null ? null : String(site.data()?.laptopCameraId);
  const sourceCheck = validateCameraSource({ existingCameraCount: cameraCount, existingLaptopCameraId: input.kind === "reconfigure" && input.source.type === "laptop_camera" ? null : existingLaptop, sourceType: input.source.type, sourceMediaId: input.source.sourceMediaId });
  if (!sourceCheck.valid) throw new HttpError(400, sourceCheck.errors.join(", "));
  const activeRevision = await firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).get();
  const zones = await activeRevision.ref.collection("zoneGeometry").get();
  const derivedZoneId = input.placement ? containingPolygon(input.placement.point, zones.docs.map((document) => ({ id: document.id, polygon: document.data().polygon as Polygon }))) : null;
  if (input.placement && !derivedZoneId) throw new HttpError(400, "Camera Placement must be inside exactly one active Zone.");
  const referenceMedia = await firestore.collection("mediaAssets").doc(input.registration.referenceMediaId).get();
  if (!referenceMedia.exists || referenceMedia.data()?.storageStatus !== "available" || referenceMedia.data()?.siteId !== input.siteId || !String(referenceMedia.data()?.mimeType).startsWith("image/")) throw new HttpError(400, "A valid Site reference image is required.");
  if (input.source.type === "looped_video") {
    const sourceMedia = await firestore.collection("mediaAssets").doc(String(input.source.sourceMediaId)).get();
    if (!sourceMedia.exists || sourceMedia.data()?.storageStatus !== "available" || sourceMedia.data()?.siteId !== input.siteId || !String(sourceMedia.data()?.mimeType).startsWith("video/")) throw new HttpError(400, "A valid Site looped video is required.");
  }
  const registration = cameraRegistrationDraftSchema.parse({ schemaVersion: 2, referenceMediaId: input.registration.referenceMediaId, referenceSource: { type: "image" }, sourceWidth: input.registration.sourceWidth, sourceHeight: input.registration.sourceHeight, walkableFloorPolygon: input.registration.walkableFloorPolygon, bins: input.registration.bins ?? [], quality: {} });
  await draftRef.create({ schemaVersion: V2_SCHEMA_VERSION, draftId: draftRef.id, siteId: input.siteId, kind: input.kind, cameraId, baseCameraRevision: existingCamera?.data()?.revision ?? null, baseMapRevisionId: String(site.data()?.activeMapRevisionId ?? ""), name: input.name.trim(), description: input.description?.trim() || null, placement: input.placement ? { point: input.placement.point, zoneId: derivedZoneId } : null, source: { type: input.source.type, sourceMediaId: input.source.sourceMediaId ?? null, browserDeviceHint: null, sampleIntervalSeconds: input.source.sampleIntervalSeconds ?? Number(site.data()?.defaultSampleIntervalSeconds ?? 1), isSimulation: sourceCheck.isSimulation }, registration, validationStatus: "valid", validationErrors: [], referenceCapturedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: 1 });
  return present(draftRef.id, (await draftRef.get()).data()!);
}

export async function publishV2CameraDraft(draftId: string, actorUid: string) {
  const draftRef = firestore.collection("cameraDrafts").doc(draftId);
  const sourceRef = firestore.collection("cameraSourceRevisions").doc();
  const registrationRef = firestore.collection("cameraRegistrationRevisions").doc();
  const rawDraft = await draftRef.get();
  if (!rawDraft.exists) throw new HttpError(404, "Camera Draft not found.");
  const draftData = rawDraft.data()!;
  const sourceMapRevision = await firestore.collection("siteMapRevisions").doc(String(draftData.baseMapRevisionId)).get();
  const [mapZones, mapCameras, mapCleaners] = draftData.kind === "create" ? await Promise.all([sourceMapRevision.ref.collection("zoneGeometry").get(), sourceMapRevision.ref.collection("cameraPlacements").get(), sourceMapRevision.ref.collection("cleanerStations").get()]) : [null, null, null];
  const mapRevisionRef = draftData.kind === "create" ? firestore.collection("siteMapRevisions").doc() : null;
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const draft = await transaction.get(draftRef);
    if (!draft.exists) throw new HttpError(404, "Camera Draft not found.");
    const data = draft.data()!;
    if (data.validationStatus !== "valid") throw new HttpError(409, "Camera Draft must validate before publication.");
    const siteRef = firestore.collection("sites").doc(String(data.siteId));
    const site = await transaction.get(siteRef);
    if (!site.exists || site.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
    const cameraId = String(data.cameraId);
    const existingCameraRef = firestore.collection("cameras").doc(cameraId);
    const existing = await transaction.get(existingCameraRef);
    if (data.kind === "create" && existing.exists) throw new HttpError(409, "Camera already exists.");
    if (data.kind === "reconfigure" && (!existing.exists || existing.data()?.siteId !== data.siteId || existing.data()?.revision !== data.baseCameraRevision)) throw new HttpError(409, "Camera changed after the draft was created.");
    if (data.kind === "create" && site.data()?.activeMapRevisionId !== data.baseMapRevisionId) throw new HttpError(409, "Site Map changed after the Camera Draft was created.");
    const state = publishCameraState({ sourceType: data.source.type as CameraSourceType, previousMonitoringEnabled: existing.data()?.monitoringEnabled, replacement: existing.exists });
    const targetCameraRef = existing.exists ? existingCameraRef : firestore.collection("cameras").doc(cameraId);
    transaction.set(sourceRef, { schemaVersion: V2_SCHEMA_VERSION, sourceRevisionId: sourceRef.id, siteId: data.siteId, cameraId, revisionNumber: Number(existing.data()?.sourceRevisionNumber ?? 0) + 1, type: data.source.type, sourceMediaId: data.source.sourceMediaId ?? null, browserDeviceHint: data.source.browserDeviceHint ?? null, sampleIntervalSeconds: data.source.sampleIntervalSeconds, isSimulation: Boolean(data.source.isSimulation), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, contentHash: `${cameraId}:${sourceRef.id}` });
    transaction.set(registrationRef, { schemaVersion: V2_SCHEMA_VERSION, registrationRevisionId: registrationRef.id, siteId: data.siteId, cameraId, sourceRevisionId: sourceRef.id, revisionNumber: Number(existing.data()?.registrationRevisionNumber ?? 0) + 1, referenceMediaId: data.registration.referenceMediaId, referenceSource: {}, sourceWidth: data.registration.sourceWidth, sourceHeight: data.registration.sourceHeight, walkableFloorPolygon: data.registration.walkableFloorPolygon, bins: data.registration.bins ?? [], quality: data.registration.quality ?? {}, validation: { status: "valid" }, contentHash: `${cameraId}:${registrationRef.id}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
    transaction.set(firestore.collection("cameraRegistrations").doc(cameraId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, cameraId, activeRegistrationRevisionId: registrationRef.id, revisionNumber: Number(existing.data()?.registrationRevisionNumber ?? 0) + 1, status: "ready", referenceMediaId: data.registration.referenceMediaId, binCount: (data.registration.bins ?? []).length, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid });
    transaction.set(targetCameraRef, { schemaVersion: V2_SCHEMA_VERSION, cameraId, siteId: data.siteId, name: data.name, nameNormalized: String(data.name).toLowerCase(), description: data.description ?? null, status: state.status, monitoringEnabled: state.monitoringEnabled, activeSourceRevisionId: sourceRef.id, activeRegistrationRevisionId: registrationRef.id, sourceType: data.source.type, isSimulation: state.isSimulation, createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp(), createdByUid: existing.data()?.createdByUid ?? actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, deactivatedAt: null, deactivatedByUid: null, revision: Number(existing.data()?.revision ?? 0) + 1 });
    if (mapRevisionRef && mapZones && mapCameras && mapCleaners) {
      const revisionNumber = Number(site.data()?.mapRevisionNumber ?? sourceMapRevision.data()?.revisionNumber ?? 0) + 1;
      const provisionalZone = data.provisionalZone as { zoneId: string; zoneNameSnapshot: string; polygon: Polygon } | null | undefined;
      transaction.create(mapRevisionRef, { ...sourceMapRevision.data(), revisionId: mapRevisionRef.id, revisionNumber, parentRevisionId: sourceMapRevision.id, zoneCount: mapZones.size + (provisionalZone ? 1 : 0), cameraPlacementCount: mapCameras.size + 1, contentHash: `${sourceMapRevision.id}:camera:${cameraId}:${provisionalZone?.zoneId ?? "existing-zone"}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, publicationRequestId: draftId });
      for (const zone of mapZones.docs) transaction.create(mapRevisionRef.collection("zoneGeometry").doc(zone.id), { ...zone.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      if (provisionalZone) {
        const centroid = { xMeters: provisionalZone.polygon.reduce((sum, point) => sum + point.xMeters, 0) / provisionalZone.polygon.length, yMeters: provisionalZone.polygon.reduce((sum, point) => sum + point.yMeters, 0) / provisionalZone.polygon.length };
        transaction.create(mapRevisionRef.collection("zoneGeometry").doc(provisionalZone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, zoneId: provisionalZone.zoneId, zoneNameSnapshot: provisionalZone.zoneNameSnapshot, polygon: provisionalZone.polygon, centroid, areaSquareMeters: polygonArea(provisionalZone.polygon), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
        transaction.set(firestore.collection("zones").doc(provisionalZone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, zoneId: provisionalZone.zoneId, siteId: data.siteId, name: provisionalZone.zoneNameSnapshot, nameNormalized: provisionalZone.zoneNameSnapshot.toLowerCase(), description: null, lifecycleStatus: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, retiredAt: null, retiredByUid: null, revision: 1 });
      }
      for (const camera of mapCameras.docs) transaction.create(mapRevisionRef.collection("cameraPlacements").doc(camera.id), { ...camera.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      for (const cleaner of mapCleaners.docs) transaction.create(mapRevisionRef.collection("cleanerStations").doc(cleaner.id), { ...cleaner.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      transaction.create(mapRevisionRef.collection("cameraPlacements").doc(cameraId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, cameraId, cameraNameSnapshot: data.name, point: data.placement.point, zoneId: data.placement.zoneId, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      transaction.update(siteRef, { activeMapRevisionId: mapRevisionRef.id, mapRevisionNumber: revisionNumber, firstCameraCreated: true, laptopCameraId: data.source.type === "laptop_camera" ? cameraId : site.data()?.laptopCameraId ?? null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    } else {
      transaction.update(siteRef, { firstCameraCreated: true, laptopCameraId: data.source.type === "laptop_camera" ? cameraId : site.data()?.laptopCameraId ?? null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    }
    transaction.set(draftRef, { status: "published", publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid }, { merge: true });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: { uid: actorUid, role: "supervisor", authority: data.kind === "create" ? "root" : "regular", displayName: "Supervisor" }, siteId: String(data.siteId), siteNameSnapshot: String(site.data()?.name), action: data.kind === "create" ? "camera_created" : "camera_reconfigured", resourceType: "Camera", resourceId: cameraId, outcome: "succeeded", after: { sourceType: data.source.type, monitoringEnabled: state.monitoringEnabled, registrationRevisionId: registrationRef.id, mapRevisionId: mapRevisionRef?.id ?? data.baseMapRevisionId }, requestId: draftId }));
  });
  return { cameraId: (await draftRef.get()).data()?.cameraId, draftId };
}
