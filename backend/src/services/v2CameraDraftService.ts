import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { cameraIdentityChangeAllowed, publishCameraState, validateCameraSource, type CameraSourceType } from "./v2CameraPolicy.js";
import { cameraRegistrationDraftSchema } from "../schemas/cameraRegistration.js";
import { containingPolygon, polygonArea, validateMapGeometry, type Polygon } from "./v2MapGeometry.js";
import { v2AuditEventData, type AuditActor } from "./v2AuditService.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { detectSupportedVideo, probeVideoFile, validateDeclaredVideoType } from "./videoUploadValidation.js";
import { deleteStoredMedia, writeMedia } from "./localMediaStorage.js";
import { env } from "../config/env.js";
import { publishCameraControl } from "./cameraLiveEvents.js";

function timestamp(value: unknown) { return value instanceof Timestamp ? value.toDate().toISOString() : null; }
function present(id: string, data: Record<string, unknown>) { return { id, ...data, createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) }; }

async function draftForSite(draftId: string, siteId: string) { const draft = await firestore.collection("cameraDrafts").doc(draftId).get(); if (!draft.exists || draft.data()?.siteId !== siteId || draft.data()?.status === "published") throw new HttpError(404, "Camera Draft not found."); return draft; }

export async function startV2CameraDraft(input: { siteId: string; kind: "create" | "reconfigure" | "physical_move"; cameraId?: string; name: string; description?: string | null; sourceType: CameraSourceType; placement?: { point: { xMeters: number; yMeters: number } } | null; provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: Polygon } | null; moveReason?: string | null; actorUid: string }) {
  const site = await firestore.collection("sites").doc(input.siteId).get(); if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if ((input.kind === "create" || input.kind === "physical_move") && site.data()?.mapDraftExists) throw new HttpError(409, "Finish or discard the current Site Map draft before changing Camera placement.", { code: "site_map_draft_exists" });
  const cameraId = input.cameraId ?? firestore.collection("cameras").doc().id; const existing = input.kind !== "create" ? await firestore.collection("cameras").doc(cameraId).get() : null; if (input.kind !== "create" && (!existing?.exists || existing.data()?.siteId !== input.siteId)) throw new HttpError(404, "Camera not found."); if ((input.kind === "create" || input.kind === "physical_move") && !input.placement) throw new HttpError(400, "Camera Placement is required.");
  if (input.kind !== "create" && input.provisionalZone) throw new HttpError(400, "A provisional Zone is only supported while creating a Camera.");
  if (input.kind === "reconfigure" && input.placement) throw new HttpError(400, "Camera Placement cannot change during Camera View reconfiguration.", { code: "camera_placement_root_move_only" });
  if (input.kind === "physical_move" && (!input.moveReason || input.moveReason.trim().length < 3)) throw new HttpError(400, "A reason is required for a Physical Camera Move.");
  const activeRevision = firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId));
  const activeSourceRef = existing?.exists && existing.data()?.activeSourceRevisionId ? firestore.collection("cameraSourceRevisions").doc(String(existing.data()?.activeSourceRevisionId)) : null;
  const activeRegistrationRef = existing?.exists && existing.data()?.activeRegistrationRevisionId ? firestore.collection("cameraRegistrationRevisions").doc(String(existing.data()?.activeRegistrationRevisionId)) : null;
  const [revision, zoneSnapshot, previousPlacement, activeSource, activeRegistration] = await Promise.all([activeRevision.get(), activeRevision.collection("zoneGeometry").get(), activeRevision.collection("cameraPlacements").doc(cameraId).get(), activeSourceRef?.get() ?? Promise.resolve(null), activeRegistrationRef?.get() ?? Promise.resolve(null)]);
  if (!revision.exists) throw new HttpError(409, "Active Site Map revision is missing.");
  const mapZones = zoneSnapshot.docs.map((document) => ({ id: document.id, polygon: document.data().polygon as Polygon }));
  if (input.provisionalZone) {
    if (zoneSnapshot.docs.some((document) => document.id === input.provisionalZone?.zoneId)) throw new HttpError(409, "The provisional Zone ID is already in use.");
    const validation = validateMapGeometry({ widthMeters: Number(revision.data()?.widthMeters), heightMeters: Number(revision.data()?.heightMeters), zones: [...mapZones, { id: input.provisionalZone.zoneId, polygon: input.provisionalZone.polygon }], points: input.placement ? [{ label: "camera_placement", point: input.placement.point, requiresZone: true }] : [] });
    if (!validation.valid) throw new HttpError(422, "Provisional Zone geometry is invalid.", { code: "provisional_zone_geometry_invalid", errors: validation.errors, issues: validation.issues, zoneConflicts: validation.zoneConflicts });
  }
  let placement: Record<string, unknown> | null = null; if (input.placement) { const candidates = input.provisionalZone ? [...mapZones, { id: input.provisionalZone.zoneId, polygon: input.provisionalZone.polygon }] : mapZones; const zoneId = containingPolygon(input.placement.point, candidates); if (!zoneId) throw new HttpError(400, "Camera Placement must be inside exactly one active or provisional Zone."); placement = { point: input.placement.point, zoneId }; }
  const preservedSource = input.kind !== "create" && activeSource?.exists && activeSource.data()?.type === input.sourceType ? activeSource.data() : null;
  const preservedRegistration = input.kind === "reconfigure" && preservedSource && activeRegistration?.exists ? activeRegistration.data() : null;
  const reference = firestore.collection("cameraDrafts").doc();
  const draftData = { schemaVersion: V2_SCHEMA_VERSION, draftId: reference.id, siteId: input.siteId, kind: input.kind, cameraId, baseCameraRevision: existing?.data()?.revision ?? null, baseMapRevisionId: String(site.data()?.activeMapRevisionId ?? ""), name: input.name.trim(), description: input.description?.trim() || null, placement, previousPlacement: input.kind === "physical_move" && previousPlacement.exists ? { point: previousPlacement.data()?.point, zoneId: previousPlacement.data()?.zoneId ?? null } : null, moveReason: input.kind === "physical_move" ? input.moveReason?.trim() : null, provisionalZone: input.provisionalZone ?? null, source: { type: input.sourceType, sourceMediaId: preservedSource?.sourceMediaId ?? null, browserDeviceHint: preservedSource?.browserDeviceHint ?? null, sampleIntervalSeconds: Number(preservedSource?.sampleIntervalSeconds ?? site.data()?.defaultSampleIntervalSeconds ?? 1), isSimulation: input.sourceType === "looped_video" }, referenceMediaId: preservedRegistration?.referenceMediaId ?? null, registration: preservedRegistration ? { schemaVersion: preservedRegistration.schemaVersion ?? V2_SCHEMA_VERSION, referenceMediaId: preservedRegistration.referenceMediaId, referenceSource: preservedRegistration.referenceSource ?? { type: "image" }, sourceWidth: preservedRegistration.sourceWidth, sourceHeight: preservedRegistration.sourceHeight, walkableFloorPolygon: preservedRegistration.walkableFloorPolygon, bins: preservedRegistration.bins ?? [], quality: preservedRegistration.quality ?? {} } : null, validationStatus: "not_validated", validationErrors: [], referenceCapturedAt: preservedRegistration?.publishedAt ?? null, status: "draft", createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: 1 };
  if (input.kind === "create") await reference.create(draftData);
  else {
    const lockRef = firestore.collection("cameraDraftLocks").doc(cameraId);
    await firestore.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
      if (lock.exists) throw new HttpError(409, "This Camera already has an unfinished configuration draft.", { code: "camera_draft_exists", draftId: lock.data()?.draftId });
      transaction.create(reference, draftData);
      transaction.create(lockRef, { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId, draftId: reference.id, kind: input.kind, createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid });
    });
  }
  return present(reference.id, (await reference.get()).data()!);
}

export async function cancelV2CameraDraft(siteId: string, draftId: string, actor?: AuditActor, requestId?: string) {
  const draft = await draftForSite(draftId, siteId);
  const mediaIds = [draft.data()?.referenceMediaId, draft.data()?.source?.sourceMediaId].filter((value): value is string => typeof value === "string" && value.length > 0);
  const media = await Promise.all(mediaIds.map((mediaId) => firestore.collection("mediaAssets").doc(mediaId).get()));
  const ownedMedia = media.filter((document) => document.exists && document.data()?.ownerType === "camera_draft" && document.data()?.ownerId === draftId);
  const lockRef = firestore.collection("cameraDraftLocks").doc(String(draft.data()?.cameraId ?? ""));
  await firestore.runTransaction(async (transaction) => {
    const [latest, site, lock] = await Promise.all([transaction.get(draft.ref), actor && requestId ? transaction.get(firestore.collection("sites").doc(siteId)) : Promise.resolve(null), transaction.get(lockRef)]);
    if (!latest.exists || latest.data()?.siteId !== siteId || latest.data()?.status === "published") throw new HttpError(404, "Camera Draft not found.");
    for (const document of ownedMedia) transaction.delete(document.ref);
    transaction.delete(draft.ref);
    if (lock.exists && lock.data()?.draftId === draftId) transaction.delete(lockRef);
    if (actor && requestId) {
      const auditRef = firestore.collection("auditEvents").doc();
      transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(site?.data()?.name ?? siteId), action: latest.data()?.kind === "physical_move" ? "camera_physical_move_cancelled" : "camera_draft_cancelled", resourceType: "CameraDraft", resourceId: draftId, outcome: "succeeded", reason: latest.data()?.kind === "physical_move" ? String(latest.data()?.moveReason ?? "") : null, before: { kind: latest.data()?.kind, cameraId: latest.data()?.cameraId, placement: latest.data()?.placement }, requestId }));
    }
  });
  await Promise.all(ownedMedia.map(async (document) => {
    const storageKey = document.data()?.storageKey;
    if (typeof storageKey === "string") await deleteStoredMedia(storageKey).catch(() => undefined);
  }));
}

export async function uploadV2DraftReference(input: { siteId: string; draftId: string; file: Express.Multer.File; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); const detected = detectSupportedImage(input.file.buffer); validateDeclaredImageType(input.file.mimetype, detected.mimeType); const mediaId = firestore.collection("mediaAssets").doc().id; const storageKey = `media/${mediaId}/camera-reference.${detected.extension}`; await writeMedia(storageKey, input.file.buffer); await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: 2, mediaId, siteId: input.siteId, purpose: "camera_reference", ownerType: "camera_draft", ownerId: input.draftId, cameraId: draft.data()?.cameraId, mimeType: detected.mimeType, originalFileName: input.file.originalname.slice(0, 255), byteSize: input.file.size, sha256: createHash("sha256").update(input.file.buffer).digest("hex"), storageKey, storageStatus: "available", width: null, height: null, durationSeconds: null, capturedAt: FieldValue.serverTimestamp(), retentionClass: "configuration", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, deletedAt: null, revision: 1 }); await draft.ref.update({ referenceMediaId: mediaId, validationStatus: "not_validated", referenceCapturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return { mediaId, contentUrl: `/api/media/${mediaId}/content`, mimeType: detected.mimeType };
}

export async function uploadV2DraftSourceVideo(input: { siteId: string; draftId: string; file: Express.Multer.File; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); if (draft.data()?.source?.type !== "looped_video") throw new HttpError(409, "Only a looped-video Camera Draft accepts source video."); if (input.file.size > env.videoMaxBytes) throw new HttpError(413, "The video exceeds the configured size limit."); const detected = detectSupportedVideo(input.file.buffer.subarray(0, 16)); validateDeclaredVideoType(input.file.mimetype, detected); const mediaId = firestore.collection("mediaAssets").doc().id; const storageKey = `media/${mediaId}/camera-source.${detected.extension}`; const filePath = await writeMedia(storageKey, input.file.buffer); let probe; try { probe = await probeVideoFile(filePath, detected); } catch (error) { await unlink(filePath).catch(() => undefined); throw error; } if (probe.durationSeconds > env.videoMaxDurationSeconds) { await unlink(filePath).catch(() => undefined); throw new HttpError(413, "The video exceeds the configured duration limit."); } await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: 2, mediaId, siteId: input.siteId, purpose: "camera_source_video", ownerType: "camera_draft", ownerId: input.draftId, cameraId: draft.data()?.cameraId, mimeType: detected.mimeType, originalFileName: input.file.originalname.slice(0, 255), byteSize: input.file.size, sha256: createHash("sha256").update(input.file.buffer).digest("hex"), storageKey, storageStatus: "available", width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, capturedAt: null, retentionClass: "configuration", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: input.actorUid, deletedAt: null, revision: 1 }); await draft.ref.update({ "source.sourceMediaId": mediaId, validationStatus: "not_validated", updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return { mediaId, contentUrl: `/api/media/${mediaId}/content`, mimeType: detected.mimeType, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height };
}

export async function saveV2DraftRegistration(input: { siteId: string; draftId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: unknown[]; actorUid: string }) { const draft = await draftForSite(input.draftId, input.siteId); const referenceMediaId = String(draft.data()?.referenceMediaId ?? ""); if (!referenceMediaId) throw new HttpError(409, "Upload a reference image first."); const registration = cameraRegistrationDraftSchema.parse({ schemaVersion: 2, referenceMediaId, referenceSource: { type: "image" }, sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, walkableFloorPolygon: input.walkableFloorPolygon, bins: input.bins, quality: {} }); await draft.ref.update({ registration, validationStatus: "not_validated", updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) }); return registration; }

export async function validateV2CameraDraft(siteId: string, draftId: string) { const draft = await draftForSite(draftId, siteId); const data = draft.data()!; const errors: string[] = []; if (!data.registration) errors.push("registration_required"); if (data.source?.type === "looped_video" && !data.source?.sourceMediaId) errors.push("source_video_required"); if ((data.kind === "create" || data.kind === "physical_move") && !data.placement) errors.push("placement_required"); if (data.kind === "physical_move" && !data.moveReason) errors.push("move_reason_required"); if (data.registration) { try { cameraRegistrationDraftSchema.parse(data.registration); } catch { errors.push("registration_invalid"); } } await draft.ref.update({ validationStatus: errors.length ? "invalid" : "valid", validationErrors: errors, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); return { valid: errors.length === 0, errors };
}

export async function createV2CameraDraft(input: { siteId: string; kind: "create" | "reconfigure"; cameraId?: string; name: string; description?: string | null; source: { type: CameraSourceType; sourceMediaId?: string | null; sampleIntervalSeconds?: number }; placement?: { point: { xMeters: number; yMeters: number } } | null; registration: { referenceMediaId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins?: unknown[] }; actorUid: string }) {
  const draftRef = firestore.collection("cameraDrafts").doc();
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (input.kind === "create" && site.data()?.mapDraftExists) throw new HttpError(409, "Finish or discard the current Site Map draft before creating a Camera.", { code: "site_map_draft_exists" });
  const cameraId = input.cameraId ?? firestore.collection("cameras").doc().id;
  const existingCamera = input.kind === "reconfigure" ? await firestore.collection("cameras").doc(cameraId).get() : null;
  if (input.kind === "reconfigure" && (!existingCamera?.exists || existingCamera.data()?.siteId !== input.siteId)) throw new HttpError(404, "Camera not found.");
  if (input.kind === "create" && !input.placement) throw new HttpError(400, "Camera Placement is required.");
  const sourceCheck = validateCameraSource({ existingCameraCount: 0, sourceType: input.source.type, sourceMediaId: input.source.sourceMediaId });
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

export async function publishV2CameraDraft(draftId: string, actor: AuditActor, requestId: string) {
  const actorUid = actor.uid;
  const draftRef = firestore.collection("cameraDrafts").doc(draftId);
  const sourceRef = firestore.collection("cameraSourceRevisions").doc();
  const registrationRef = firestore.collection("cameraRegistrationRevisions").doc();
  const rawDraft = await draftRef.get();
  if (!rawDraft.exists) throw new HttpError(404, "Camera Draft not found.");
  const draftData = rawDraft.data()!;
  const draftLockRef = firestore.collection("cameraDraftLocks").doc(String(draftData.cameraId));
  const sourceMapRevision = await firestore.collection("siteMapRevisions").doc(String(draftData.baseMapRevisionId)).get();
  const changesMap = draftData.kind === "create" || draftData.kind === "physical_move";
  const [mapZones, mapCameras, mapCleaners] = changesMap ? await Promise.all([sourceMapRevision.ref.collection("zoneGeometry").get(), sourceMapRevision.ref.collection("cameraPlacements").get(), sourceMapRevision.ref.collection("cleanerStations").get()]) : [null, null, null];
  const mapRevisionRef = changesMap ? firestore.collection("siteMapRevisions").doc() : null;
  if (changesMap) {
    if (!sourceMapRevision.exists || !mapZones || !draftData.placement) throw new HttpError(409, "The Camera Draft is missing valid Site Map context.");
    const provisionalZone = draftData.kind === "create" ? draftData.provisionalZone as { zoneId: string; polygon: Polygon } | null | undefined : null;
    const zoneGeometry = [...mapZones.docs.map((document) => ({ id: document.id, polygon: document.data()?.polygon as Polygon })), ...(provisionalZone ? [{ id: provisionalZone.zoneId, polygon: provisionalZone.polygon }] : [])];
    const placementValidation = validateMapGeometry({ widthMeters: Number(sourceMapRevision.data()?.widthMeters), heightMeters: Number(sourceMapRevision.data()?.heightMeters), zones: zoneGeometry, points: [{ point: draftData.placement.point, label: `camera_${String(draftData.cameraId)}`, requiresZone: true }] });
    const resolvedZoneId = containingPolygon(draftData.placement.point, zoneGeometry);
    if (!placementValidation.valid || resolvedZoneId !== draftData.placement.zoneId) throw new HttpError(409, "Camera Placement or provisional Zone geometry is no longer valid.", { code: "camera_map_geometry_invalid", errors: placementValidation.errors, issues: placementValidation.issues, zoneConflicts: placementValidation.zoneConflicts });
  }
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const [draft, draftLock] = await Promise.all([transaction.get(draftRef), transaction.get(draftLockRef)]);
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
    if (data.kind !== "create" && (!existing.exists || existing.data()?.siteId !== data.siteId || existing.data()?.revision !== data.baseCameraRevision)) throw new HttpError(409, "Camera changed after the draft was created.");
    if (!cameraIdentityChangeAllowed({ authority: actor.authority, kind: String(data.kind), previousName: existing.data()?.name, previousDescription: existing.data()?.description, nextName: data.name, nextDescription: data.description })) throw new HttpError(403, "Root Supervisor access is required to change Camera identity.", { code: "camera_identity_root_only" });
    if (existing.exists && existing.data()?.monitoringEnabled && existing.data()?.sourceType !== data.source.type) throw new HttpError(409, "Disable the Camera before changing its source type.");
    if ((data.kind === "create" || data.kind === "physical_move") && site.data()?.activeMapRevisionId !== data.baseMapRevisionId) throw new HttpError(409, "Site Map changed after the Camera Draft was created.");
    if (data.kind === "physical_move" && actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
    if (data.kind === "physical_move" && existing.data()?.monitoringEnabled) throw new HttpError(409, "Disable Camera monitoring before publishing a Physical Camera Move.", { code: "camera_monitoring_must_be_disabled" });
    const state = publishCameraState({ sourceType: data.source.type as CameraSourceType, previousMonitoringEnabled: existing.data()?.monitoringEnabled, replacement: existing.exists });
    const targetCameraRef = existing.exists ? existingCameraRef : firestore.collection("cameras").doc(cameraId);
    transaction.set(sourceRef, { schemaVersion: V2_SCHEMA_VERSION, sourceRevisionId: sourceRef.id, siteId: data.siteId, cameraId, revisionNumber: Number(existing.data()?.sourceRevisionNumber ?? 0) + 1, type: data.source.type, sourceMediaId: data.source.sourceMediaId ?? null, browserDeviceHint: data.source.browserDeviceHint ?? null, sampleIntervalSeconds: data.source.sampleIntervalSeconds, isSimulation: Boolean(data.source.isSimulation), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, contentHash: `${cameraId}:${sourceRef.id}` });
    transaction.set(registrationRef, { schemaVersion: V2_SCHEMA_VERSION, registrationRevisionId: registrationRef.id, siteId: data.siteId, cameraId, sourceRevisionId: sourceRef.id, revisionNumber: Number(existing.data()?.registrationRevisionNumber ?? 0) + 1, referenceMediaId: data.registration.referenceMediaId, referenceSource: {}, sourceWidth: data.registration.sourceWidth, sourceHeight: data.registration.sourceHeight, walkableFloorPolygon: data.registration.walkableFloorPolygon, bins: data.registration.bins ?? [], quality: data.registration.quality ?? {}, validation: { status: "valid" }, contentHash: `${cameraId}:${registrationRef.id}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
    transaction.set(firestore.collection("cameraRegistrations").doc(cameraId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, cameraId, activeRegistrationRevisionId: registrationRef.id, revisionNumber: Number(existing.data()?.registrationRevisionNumber ?? 0) + 1, status: "ready", referenceMediaId: data.registration.referenceMediaId, binCount: (data.registration.bins ?? []).length, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid });
    transaction.set(targetCameraRef, { schemaVersion: V2_SCHEMA_VERSION, cameraId, siteId: data.siteId, name: data.name, nameNormalized: String(data.name).toLowerCase(), description: data.description ?? null, status: existing.data()?.status ?? state.status, monitoringEnabled: existing.data()?.status === "inactive" ? false : state.monitoringEnabled, activeSourceRevisionId: sourceRef.id, activeRegistrationRevisionId: registrationRef.id, sourceType: data.source.type, isSimulation: state.isSimulation, createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp(), createdByUid: existing.data()?.createdByUid ?? actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, deactivatedAt: existing.data()?.deactivatedAt ?? null, deactivatedByUid: existing.data()?.deactivatedByUid ?? null, revision: Number(existing.data()?.revision ?? 0) + 1 });
    if (mapRevisionRef && mapZones && mapCameras && mapCleaners) {
      const revisionNumber = Number(site.data()?.mapRevisionNumber ?? sourceMapRevision.data()?.revisionNumber ?? 0) + 1;
      const provisionalZone = data.provisionalZone as { zoneId: string; zoneNameSnapshot: string; polygon: Polygon } | null | undefined;
      transaction.create(mapRevisionRef, { ...sourceMapRevision.data(), revisionId: mapRevisionRef.id, revisionNumber, parentRevisionId: sourceMapRevision.id, zoneCount: mapZones.size + (provisionalZone ? 1 : 0), cameraPlacementCount: data.kind === "create" ? mapCameras.size + 1 : mapCameras.size, contentHash: `${sourceMapRevision.id}:camera:${cameraId}:${data.kind}:${provisionalZone?.zoneId ?? "existing-zone"}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, publicationRequestId: draftId });
      for (const zone of mapZones.docs) transaction.create(mapRevisionRef.collection("zoneGeometry").doc(zone.id), { ...zone.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      if (provisionalZone) {
        const centroid = { xMeters: provisionalZone.polygon.reduce((sum, point) => sum + point.xMeters, 0) / provisionalZone.polygon.length, yMeters: provisionalZone.polygon.reduce((sum, point) => sum + point.yMeters, 0) / provisionalZone.polygon.length };
        transaction.create(mapRevisionRef.collection("zoneGeometry").doc(provisionalZone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, zoneId: provisionalZone.zoneId, zoneNameSnapshot: provisionalZone.zoneNameSnapshot, polygon: provisionalZone.polygon, centroid, areaSquareMeters: polygonArea(provisionalZone.polygon), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
        transaction.set(firestore.collection("zones").doc(provisionalZone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, zoneId: provisionalZone.zoneId, siteId: data.siteId, name: provisionalZone.zoneNameSnapshot, nameNormalized: provisionalZone.zoneNameSnapshot.toLowerCase(), description: null, lifecycleStatus: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, retiredAt: null, retiredByUid: null, revision: 1 });
      }
      for (const camera of mapCameras.docs) if (data.kind !== "physical_move" || camera.id !== cameraId) transaction.create(mapRevisionRef.collection("cameraPlacements").doc(camera.id), { ...camera.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      for (const cleaner of mapCleaners.docs) transaction.create(mapRevisionRef.collection("cleanerStations").doc(cleaner.id), { ...cleaner.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      transaction.create(mapRevisionRef.collection("cameraPlacements").doc(cameraId), { schemaVersion: V2_SCHEMA_VERSION, siteId: data.siteId, cameraId, cameraNameSnapshot: data.name, point: data.placement.point, zoneId: data.placement.zoneId, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
      transaction.update(siteRef, { activeMapRevisionId: mapRevisionRef.id, mapRevisionNumber: revisionNumber, firstCameraCreated: true, enabledLaptopCameraId: site.data()?.enabledLaptopCameraId ?? null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    } else {
      transaction.update(siteRef, { firstCameraCreated: true, enabledLaptopCameraId: site.data()?.enabledLaptopCameraId ?? null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    }
    transaction.set(draftRef, { status: "published", publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid }, { merge: true });
    if (draftLock.exists && draftLock.data()?.draftId === draftId) transaction.delete(draftLockRef);
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId: String(data.siteId), siteNameSnapshot: String(site.data()?.name), action: data.kind === "create" ? "camera_created" : data.kind === "physical_move" ? "camera_physically_moved" : "camera_reconfigured", resourceType: "Camera", resourceId: cameraId, outcome: "succeeded", reason: data.kind === "physical_move" ? String(data.moveReason) : null, before: data.kind === "physical_move" ? { placement: data.previousPlacement, mapRevisionId: data.baseMapRevisionId, registrationRevisionId: existing.data()?.activeRegistrationRevisionId } : null, after: { placement: data.kind === "physical_move" ? data.placement : null, sourceType: data.source.type, monitoringEnabled: state.monitoringEnabled, registrationRevisionId: registrationRef.id, mapRevisionId: mapRevisionRef?.id ?? data.baseMapRevisionId }, requestId }));
  });
  publishCameraControl(String(draftData.siteId), String(draftData.cameraId));
  return { cameraId: draftData.cameraId, draftId };
}
