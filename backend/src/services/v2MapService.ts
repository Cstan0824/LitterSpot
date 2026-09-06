import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { containingPolygon, pointInMapBounds, polygonArea, validateMapGeometry, type MapPoint, type Polygon } from "./v2MapGeometry.js";
import { v2AuditEventData, type AuditActor } from "./v2AuditService.js";
import { publishSiteCameraControl } from "./cameraLiveEvents.js";
import { assertV2SiteBackground } from "./v2SiteBackgroundService.js";
import type { SiteBackgroundTransform } from "../schemas/siteMap.js";

type ZoneDraft = { zoneId: string; zoneNameSnapshot: string; polygon: Polygon };
type PointDraft = { id: string; point: MapPoint; label: string };
type CameraPlacementCorrection = { cameraId: string; mode: "map_position_correction"; reason: string; confirmation: true };

function timestamp(value: unknown) { return value instanceof Timestamp ? value.toDate().toISOString() : null; }
async function siteForPrincipal(siteId: string) {
  const site = await firestore.collection("sites").doc(siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  return site.data()!;
}

async function readDraft(siteId: string) {
  const draft = await firestore.collection("siteMapDrafts").doc(siteId).get();
  if (!draft.exists) throw new HttpError(404, "Site Map draft not found.");
  const zones = await draft.ref.collection("zoneGeometry").get();
  const cameraPlacements = await draft.ref.collection("cameraPlacements").get();
  const cleanerStations = await draft.ref.collection("cleanerStations").get();
  return { draft, data: draft.data()!, zones, cameraPlacements, cleanerStations };
}

function presentDraft(value: Awaited<ReturnType<typeof readDraft>>) {
  return {
    id: value.draft.id,
    ...value.data,
    createdAt: timestamp(value.data.createdAt),
    updatedAt: timestamp(value.data.updatedAt),
    zones: value.zones.docs.map((document) => ({ id: document.id, ...document.data() })),
    cameraPlacements: value.cameraPlacements.docs.map((document) => ({ id: document.id, ...document.data() })),
    cleanerStations: value.cleanerStations.docs.map((document) => ({ id: document.id, ...document.data() })),
  };
}

async function validateActiveCameraCoverage(siteId: string, placementIds: Set<string>) {
  const cameras = await firestore.collection("cameras").where("siteId", "==", siteId).get();
  const activeIds = new Set(cameras.docs.filter((document) => document.data()?.status === "active").map((document) => document.id));
  const missing = [...activeIds].filter((cameraId) => !placementIds.has(cameraId));
  if (missing.length) throw new HttpError(422, "Every active Camera requires a placement in the Site Map draft.", { code: "active_camera_placement_missing", cameraIds: missing.slice(0, 100) });
}

function validationInput(value: Awaited<ReturnType<typeof readDraft>>) {
  return {
    widthMeters: Number(value.data.widthMeters),
    heightMeters: Number(value.data.heightMeters),
    zones: value.zones.docs.map((document) => ({ id: document.id, polygon: (document.data().polygon ?? []) as Polygon })),
    points: [
      ...value.cameraPlacements.docs.map((document) => ({ point: document.data().point as MapPoint, label: `camera_${document.id}`, requiresZone: true })),
      ...value.cleanerStations.docs.map((document) => ({ point: document.data().point as MapPoint, label: `cleaner_${document.id}`, requiresZone: false })),
    ],
  };
}

function mapContentHash(value: Awaited<ReturnType<typeof readDraft>>) {
  const sort = <T extends { id: string }>(items: T[]) => items.sort((left, right) => left.id.localeCompare(right.id));
  const rawTransform = value.data.backgroundTransform as SiteBackgroundTransform | null | undefined;
  const content = {
    widthMeters: Number(value.data.widthMeters),
    heightMeters: Number(value.data.heightMeters),
    gridSizeMeters: Number(value.data.gridSizeMeters),
    backgroundMediaId: value.data.backgroundMediaId ?? null,
    backgroundTransform: rawTransform ? { xMeters: rawTransform.xMeters, yMeters: rawTransform.yMeters, widthMeters: rawTransform.widthMeters, heightMeters: rawTransform.heightMeters, opacity: rawTransform.opacity } : null,
    zones: sort(value.zones.docs.map((document) => ({ id: document.id, name: document.data()?.zoneNameSnapshot ?? null, polygon: document.data()?.polygon ?? [] }))),
    cameras: sort(value.cameraPlacements.docs.map((document) => ({ id: document.id, point: document.data()?.point ?? null, zoneId: document.data()?.zoneId ?? null, changeMode: document.data()?.changeMode ?? null, changeReason: document.data()?.changeReason ?? null }))),
    cleaners: sort(value.cleanerStations.docs.map((document) => ({ id: document.id, point: document.data()?.point ?? null, zoneId: document.data()?.zoneId ?? null }))),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export async function startV2MapDraft(siteId: string, actor: AuditActor, requestId: string) {
  const siteRef = firestore.collection("sites").doc(siteId);
  const draftRef = firestore.collection("siteMapDrafts").doc(siteId);
  const site = await siteRef.get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  const revisionRef = firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId ?? ""));
  const [revision, zones, cameraPlacements, cleanerStations] = await Promise.all([
    revisionRef.get(), revisionRef.collection("zoneGeometry").get(), revisionRef.collection("cameraPlacements").get(), revisionRef.collection("cleanerStations").get(),
  ]);
  if (!revision.exists || revision.data()?.siteId !== siteId) throw new HttpError(409, "Active Site Map revision is missing.");
  if (zones.size + cameraPlacements.size + cleanerStations.size > 100) throw new HttpError(413, "This Site Map has more than 100 structural records and cannot be copied into one draft operation.");
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const [latestSite, existingDraft] = await Promise.all([transaction.get(siteRef), transaction.get(draftRef)]);
    if (!latestSite.exists || latestSite.data()?.activeMapRevisionId !== revision.id) throw new HttpError(409, "Active Site Map changed. Refresh and retry.");
    if (existingDraft.exists) throw new HttpError(409, "A Site Map draft already exists.", { code: "site_map_draft_exists", draftRevision: existingDraft.data()?.revision });
    transaction.create(draftRef, {
      schemaVersion: V2_SCHEMA_VERSION,
      siteId,
      baseRevisionId: revision.id,
      widthMeters: revision.data()?.widthMeters,
      heightMeters: revision.data()?.heightMeters,
      gridSizeMeters: revision.data()?.gridSizeMeters,
      backgroundMediaId: revision.data()?.backgroundMediaId ?? null,
      backgroundTransform: revision.data()?.backgroundTransform ?? null,
      coordinateOrigin: "top_left",
      xAxisDirection: "right",
      yAxisDirection: "down",
      validationStatus: "not_validated",
      validationErrors: [],
      validationIssues: [],
      validatedContentHash: null,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
      revision: 1,
    });
    for (const collection of [zones, cameraPlacements, cleanerStations]) for (const document of collection.docs) transaction.create(draftRef.collection(document.ref.parent.id).doc(document.id), { ...document.data(), updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid });
    transaction.update(siteRef, { mapDraftExists: true, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(latestSite.data()?.name ?? siteId), action: "site_map_draft_started", resourceType: "SiteMapDraft", resourceId: siteId, outcome: "succeeded", before: { activeMapRevisionId: revision.id }, after: { draftRevision: 1 }, requestId }));
  });
  return presentDraft(await readDraft(siteId));
}

export async function getV2Map(siteId: string) {
  const site = await siteForPrincipal(siteId);
  const revisionId = String(site.activeMapRevisionId ?? "");
  const revision = await firestore.collection("siteMapRevisions").doc(revisionId).get();
  if (!revision.exists) throw new HttpError(409, "Active Site Map revision is missing.");
  const backgroundMediaId = typeof revision.data()?.backgroundMediaId === "string" ? String(revision.data()?.backgroundMediaId) : null;
  const [zones, cameras, cleaners, background] = await Promise.all([
    revision.ref.collection("zoneGeometry").get(), revision.ref.collection("cameraPlacements").get(), revision.ref.collection("cleanerStations").get(), backgroundMediaId ? firestore.collection("mediaAssets").doc(backgroundMediaId).get() : null,
  ]);
  return {
    siteId,
    siteName: String(site.name ?? siteId),
    siteStatus: String(site.status),
    timeZone: String(site.timeZone ?? "Asia/Kuala_Lumpur"),
    activeRevisionId: revision.id,
    revision: { id: revision.id, ...revision.data(), coordinateOrigin: revision.data()?.coordinateOrigin ?? "top_left", xAxisDirection: revision.data()?.xAxisDirection ?? "right", yAxisDirection: revision.data()?.yAxisDirection ?? "down", publishedAt: timestamp(revision.data()?.publishedAt) },
    background: background?.exists && background.data()?.siteId === siteId ? { mediaId: background.id, contentUrl: `/api/media/${background.id}/content`, mimeType: background.data()?.mimeType ?? null, width: background.data()?.width ?? null, height: background.data()?.height ?? null, storageStatus: background.data()?.storageStatus ?? "missing" } : null,
    zones: zones.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    cameraPlacements: cameras.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    cleanerStations: cleaners.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

/**
 * A deliberately narrow active-map projection for the authenticated Cleaner.
 * It exposes the geometry needed to orient that Cleaner and their Coordinate
 * Work without giving the browser any map-draft or other-personnel data.
 */
export async function getV2CleanerMap(siteId: string, cleanerId: string) {
  const site = await firestore.collection("sites").doc(siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site Map not found.");
  const activeRevisionId = String(site.data()?.activeMapRevisionId ?? "");
  if (!activeRevisionId) throw new HttpError(409, "The Site has no Active Map Revision.");
  const revision = await firestore.collection("siteMapRevisions").doc(activeRevisionId).get();
  if (!revision.exists || revision.data()?.siteId !== siteId) throw new HttpError(409, "The Active Site Map is unavailable.");
  const [zones, station] = await Promise.all([
    revision.ref.collection("zoneGeometry").get(),
    revision.ref.collection("cleanerStations").doc(cleanerId).get(),
  ]);
  return {
    siteId,
    siteName: String(site.data()?.name ?? siteId),
    activeRevisionId,
    revision: {
      widthMeters: Number(revision.data()?.widthMeters),
      heightMeters: Number(revision.data()?.heightMeters),
      gridSizeMeters: Number(revision.data()?.gridSizeMeters),
      backgroundMediaId: typeof revision.data()?.backgroundMediaId === "string" ? revision.data()!.backgroundMediaId : null,
      backgroundTransform: revision.data()?.backgroundTransform ?? null,
    },
    zones: zones.docs.map((document) => ({ id: document.id, zoneId: String(document.data()?.zoneId ?? document.id), zoneNameSnapshot: String(document.data()?.zoneNameSnapshot ?? document.id), polygon: document.data()?.polygon ?? [] })),
    station: station.exists ? { point: station.data()?.point ?? null, zoneId: station.data()?.zoneId ?? null, mapRevisionId: activeRevisionId } : null,
  };
}

export async function getV2MapDraft(siteId: string) { return readDraft(siteId); }

export async function listV2MapRevisions(siteId: string) {
  await siteForPrincipal(siteId);
  try {
    const snapshot = await firestore.collection("siteMapRevisions").where("siteId", "==", siteId).orderBy("revisionNumber", "desc").limit(100).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data(), publishedAt: timestamp(document.data().publishedAt) }));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : null;
    if (code !== 9) throw error;
    const fallback = await firestore.collection("siteMapRevisions").where("siteId", "==", siteId).limit(101).get();
    if (fallback.size > 100) throw new HttpError(503, "Site Map revision history requires its Firestore index to finish building.");
    return fallback.docs
      .map((document) => ({ id: document.id, ...document.data(), publishedAt: timestamp(document.data().publishedAt) }))
      .sort((left, right) => Number((right as Record<string, unknown>).revisionNumber ?? 0) - Number((left as Record<string, unknown>).revisionNumber ?? 0));
  }
}

export async function saveV2MapDraft(input: { siteId: string; baseRevisionId: string; expectedRevision?: number; widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId?: string | null; backgroundTransform?: SiteBackgroundTransform | null; zones: ZoneDraft[]; cameraPlacements?: PointDraft[]; cameraPlacementChanges?: CameraPlacementCorrection[]; cleanerStations?: PointDraft[]; actor: AuditActor; requestId: string }) {
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (site.data()?.activeMapRevisionId !== input.baseRevisionId) throw new HttpError(409, "Map draft must start from the Active Map Revision.");
  const zoneIds = new Set(input.zones.map((zone) => zone.zoneId));
  if (zoneIds.size !== input.zones.length) throw new HttpError(400, "Zone IDs must be unique in a map draft.");
  const suppliedCameras = new Set((input.cameraPlacements ?? []).map((value) => value.id));
  const suppliedCleaners = new Set((input.cleanerStations ?? []).map((value) => value.id));
  if (suppliedCameras.size !== (input.cameraPlacements ?? []).length) throw new HttpError(400, "Camera Placement IDs must be unique in a map draft.");
  if (suppliedCleaners.size !== (input.cleanerStations ?? []).length) throw new HttpError(400, "Cleaner Station Point IDs must be unique in a map draft.");
  const correctionByCameraId = new Map((input.cameraPlacementChanges ?? []).map((change) => [change.cameraId, change]));
  if (correctionByCameraId.size !== (input.cameraPlacementChanges ?? []).length) throw new HttpError(400, "Camera Placement change IDs must be unique in a map draft.");
  await Promise.all([
    validateActiveCameraCoverage(input.siteId, suppliedCameras),
    assertV2SiteBackground(input.siteId, input.backgroundMediaId, input.backgroundTransform, { widthMeters: input.widthMeters, heightMeters: input.heightMeters }),
  ]);
  const points = [...(input.cameraPlacements ?? []).map((value) => ({ ...value, requiresZone: true })), ...(input.cleanerStations ?? []).map((value) => ({ ...value, requiresZone: false }))];
  const validation = validateMapGeometry({ widthMeters: input.widthMeters, heightMeters: input.heightMeters, zones: input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon })), points });
  if (!validation.valid) throw new HttpError(422, "Site Map geometry is invalid.", { code: "site_map_geometry_invalid", errors: validation.errors, issues: validation.issues, zoneConflicts: validation.zoneConflicts });
  const draftRef = firestore.collection("siteMapDrafts").doc(input.siteId);
  const baseRevisionRef = firestore.collection("siteMapRevisions").doc(input.baseRevisionId);
  const [oldZones, oldCameras, oldCleaners, baseCameras] = await Promise.all([draftRef.collection("zoneGeometry").get(), draftRef.collection("cameraPlacements").get(), draftRef.collection("cleanerStations").get(), baseRevisionRef.collection("cameraPlacements").get()]);
  const baseCameraById = new Map(baseCameras.docs.map((document) => [document.id, document.data()]));
  const changedCameraIds = new Set<string>();
  for (const placement of input.cameraPlacements ?? []) {
    const base = baseCameraById.get(placement.id);
    const changed = !base || Number(base.point?.xMeters) !== placement.point.xMeters || Number(base.point?.yMeters) !== placement.point.yMeters;
    if (!changed) continue;
    changedCameraIds.add(placement.id);
    if (!correctionByCameraId.has(placement.id)) throw new HttpError(422, "Camera Placement changes require a confirmed Map Position Correction with a reason.", { code: "camera_placement_change_requires_correction", cameraId: placement.id });
  }
  const unusedCorrections = [...correctionByCameraId.keys()].filter((cameraId) => !changedCameraIds.has(cameraId));
  if (unusedCorrections.length) throw new HttpError(400, "Camera Placement correction metadata was supplied for an unchanged Camera.", { code: "camera_placement_correction_without_change", cameraIds: unusedCorrections });
  const suppliedZones = new Set(input.zones.map((value) => value.zoneId));
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(draftRef);
    if (!current.exists) throw new HttpError(409, "Start a Site Map draft before saving changes.", { code: "site_map_draft_required" });
    if (current.data()?.baseRevisionId !== input.baseRevisionId) throw new HttpError(409, "The Site Map draft is based on a different active revision.");
    if (input.expectedRevision !== undefined && current.data()?.revision !== input.expectedRevision) throw new HttpError(409, "The Site Map draft changed. Refresh and retry.", { code: "site_map_draft_revision_conflict", currentRevision: current.data()?.revision });
    const nextRevision = Number(current.data()?.revision ?? 0) + 1;
    const draftData = { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, baseRevisionId: input.baseRevisionId, widthMeters: input.widthMeters, heightMeters: input.heightMeters, gridSizeMeters: input.gridSizeMeters, backgroundMediaId: input.backgroundMediaId ?? null, backgroundTransform: input.backgroundTransform ?? null, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down", validationStatus: "not_validated", validationErrors: [], validationIssues: [], validatedContentHash: null, createdAt: current.data()?.createdAt, createdByUid: current.data()?.createdByUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: nextRevision };
    transaction.set(draftRef, draftData, { merge: true });
    transaction.update(site.ref, { mapDraftExists: true, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1) });
    for (const document of oldZones.docs) if (!suppliedZones.has(document.id)) transaction.delete(document.ref);
    for (const document of oldCameras.docs) if (!suppliedCameras.has(document.id)) transaction.delete(document.ref);
    for (const document of oldCleaners.docs) if (!suppliedCleaners.has(document.id)) transaction.delete(document.ref);
    for (const zone of input.zones) transaction.set(draftRef.collection("zoneGeometry").doc(zone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon, centroid: { xMeters: zone.polygon.reduce((sum, point) => sum + point.xMeters, 0) / zone.polygon.length, yMeters: zone.polygon.reduce((sum, point) => sum + point.yMeters, 0) / zone.polygon.length }, areaSquareMeters: polygonArea(zone.polygon), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid });
    for (const placement of input.cameraPlacements ?? []) {
      const correction = correctionByCameraId.get(placement.id);
      const base = baseCameraById.get(placement.id);
      transaction.set(draftRef.collection("cameraPlacements").doc(placement.id), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: placement.id, point: placement.point, zoneId: containingPolygon(placement.point, input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon }))), changeMode: correction?.mode ?? null, changeReason: correction?.reason ?? null, previousPoint: correction ? base?.point ?? null : null, previousZoneId: correction ? base?.zoneId ?? null : null, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid });
    }
    for (const station of input.cleanerStations ?? []) transaction.set(draftRef.collection("cleanerStations").doc(station.id), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cleanerId: station.id, point: station.point, zoneId: containingPolygon(station.point, input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon }))), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid });
    const auditRef = firestore.collection("auditEvents").doc();
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: input.actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name ?? input.siteId), action: "site_map_draft_saved", resourceType: "SiteMapDraft", resourceId: input.siteId, outcome: "succeeded", before: { draftRevision: current.data()?.revision, widthMeters: current.data()?.widthMeters, heightMeters: current.data()?.heightMeters }, after: { draftRevision: nextRevision, widthMeters: input.widthMeters, heightMeters: input.heightMeters, zoneCount: input.zones.length, cameraPlacementCount: suppliedCameras.size, cleanerStationCount: suppliedCleaners.size, backgroundMediaId: input.backgroundMediaId ?? null }, requestId: input.requestId }));
  });
  return readDraft(input.siteId);
}

export async function validateV2MapDraft(siteId: string, actor: AuditActor, requestId: string) {
  const value = await readDraft(siteId);
  const validation = validateMapGeometry(validationInput(value));
  const contentHash = mapContentHash(value);
  await Promise.all([
    validateActiveCameraCoverage(siteId, new Set(value.cameraPlacements.docs.map((document) => document.id))),
    assertV2SiteBackground(siteId, typeof value.data.backgroundMediaId === "string" ? value.data.backgroundMediaId : null, value.data.backgroundTransform as SiteBackgroundTransform | null | undefined, { widthMeters: Number(value.data.widthMeters), heightMeters: Number(value.data.heightMeters) }),
  ]);
  const site = await firestore.collection("sites").doc(siteId).get();
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(value.draft.ref);
    if (!current.exists || current.data()?.revision !== value.data.revision) throw new HttpError(409, "The Site Map draft changed. Refresh and validate again.");
    transaction.update(value.draft.ref, { validationStatus: validation.valid ? "valid" : "invalid", validationErrors: validation.errors, validationIssues: validation.issues, validatedContentHash: validation.valid ? contentHash : null, validatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(site.data()?.name ?? siteId), action: validation.valid ? "site_map_draft_validation_succeeded" : "site_map_draft_validation_failed", resourceType: "SiteMapDraft", resourceId: siteId, outcome: validation.valid ? "succeeded" : "failed", reason: validation.valid ? null : "Site Map geometry is invalid.", after: { draftRevision: Number(value.data.revision ?? 0) + 1, errors: validation.errors }, errorCode: validation.valid ? null : "site_map_geometry_invalid", requestId }));
  });
  return validation;
}

export async function publishV2MapDraft(siteId: string, actor: AuditActor, requestId: string) {
  const actorUid = actor.uid;
  const value = await readDraft(siteId);
  const { draft, data, zones, cameraPlacements, cleanerStations } = value;
  if (data.validationStatus !== "valid") throw new HttpError(409, "Map draft must validate before publication.");
  const contentHash = mapContentHash(value);
  if (data.validatedContentHash !== contentHash) throw new HttpError(409, "The Site Map draft changed after validation. Validate it again.", { code: "site_map_validated_content_changed" });
  const publicationValidation = validateMapGeometry(validationInput(value));
  if (!publicationValidation.valid) throw new HttpError(409, "Site Map geometry changed or is invalid. Validate the draft again.", { code: "site_map_geometry_invalid", errors: publicationValidation.errors, issues: publicationValidation.issues, zoneConflicts: publicationValidation.zoneConflicts });
  await Promise.all([
    validateActiveCameraCoverage(siteId, new Set(cameraPlacements.docs.map((document) => document.id))),
    assertV2SiteBackground(siteId, typeof data.backgroundMediaId === "string" ? data.backgroundMediaId : null, data.backgroundTransform as SiteBackgroundTransform | null | undefined, { widthMeters: Number(data.widthMeters), heightMeters: Number(data.heightMeters) }),
  ]);
  const siteRef = firestore.collection("sites").doc(siteId);
  const revisionRef = firestore.collection("siteMapRevisions").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  const placementCorrections = cameraPlacements.docs.filter((document) => document.data()?.changeMode === "map_position_correction");
  const placementAuditRefs = placementCorrections.map(() => firestore.collection("auditEvents").doc());
  const priorZones = await firestore.collection("zones").where("siteId", "==", siteId).get();
  await firestore.runTransaction(async (transaction) => {
    const [site, latestDraft, currentCameras] = await Promise.all([transaction.get(siteRef), transaction.get(draft.ref), transaction.get(firestore.collection("cameras").where("siteId", "==", siteId))]);
    if (!site.exists || site.data()?.activeMapRevisionId !== data.baseRevisionId) throw new HttpError(409, "Map draft is based on a stale revision.");
    if (!latestDraft.exists || latestDraft.data()?.revision !== data.revision || latestDraft.data()?.validationStatus !== "valid") throw new HttpError(409, "Map draft changed after validation.");
    const placementIds = new Set(cameraPlacements.docs.map((document) => document.id));
    const missingActiveCameraIds = currentCameras.docs.filter((document) => document.data()?.status === "active" && !placementIds.has(document.id)).map((document) => document.id);
    if (missingActiveCameraIds.length) throw new HttpError(409, "An active Camera is missing from the validated Site Map draft. Refresh and retry.", { code: "active_camera_placement_missing", cameraIds: missingActiveCameraIds.slice(0, 100) });
    const currentRevision = Number(site.data()?.mapRevisionNumber ?? 0) + 1;
    transaction.create(revisionRef, { schemaVersion: V2_SCHEMA_VERSION, revisionId: revisionRef.id, siteId, revisionNumber: currentRevision, parentRevisionId: data.baseRevisionId, widthMeters: data.widthMeters, heightMeters: data.heightMeters, gridSizeMeters: data.gridSizeMeters, backgroundMediaId: data.backgroundMediaId ?? null, backgroundTransform: data.backgroundTransform ?? null, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down", zoneCount: zones.size, cameraPlacementCount: cameraPlacements.size, cleanerStationCount: cleanerStations.size, contentHash, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, publicationRequestId: `${siteId}:${data.revision}` });
    for (const collection of [zones, cameraPlacements, cleanerStations]) for (const doc of collection.docs) transaction.create(revisionRef.collection(doc.ref.parent.id).doc(doc.id), { ...doc.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
    const activeZoneIds = new Set(zones.docs.map((document) => document.id));
    for (const zone of zones.docs) transaction.set(firestore.collection("zones").doc(zone.id), { schemaVersion: V2_SCHEMA_VERSION, zoneId: zone.id, siteId, name: zone.data().zoneNameSnapshot, nameNormalized: String(zone.data().zoneNameSnapshot).toLowerCase(), description: null, lifecycleStatus: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, retiredAt: null, retiredByUid: null, revision: FieldValue.increment(1) }, { merge: true });
    for (const zone of priorZones.docs) if (!activeZoneIds.has(zone.id)) transaction.update(zone.ref, { lifecycleStatus: "retired", retiredAt: FieldValue.serverTimestamp(), retiredByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.update(siteRef, { activeMapRevisionId: revisionRef.id, mapDraftExists: false, mapRevisionNumber: currentRevision, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.delete(draft.ref);
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(site.data()?.name), action: "site_map_published", resourceType: "SiteMapRevision", resourceId: revisionRef.id, outcome: "succeeded", before: { activeMapRevisionId: site.data()?.activeMapRevisionId }, after: { activeMapRevisionId: revisionRef.id, revisionNumber: currentRevision }, requestId }));
    placementCorrections.forEach((placement, index) => transaction.create(placementAuditRefs[index], v2AuditEventData({ auditEventId: placementAuditRefs[index].id, actor, siteId, siteNameSnapshot: String(site.data()?.name), action: "camera_map_position_corrected", resourceType: "Camera", resourceId: placement.id, outcome: "succeeded", reason: String(placement.data()?.changeReason ?? ""), before: { point: placement.data()?.previousPoint ?? null, zoneId: placement.data()?.previousZoneId ?? null, mapRevisionId: data.baseRevisionId }, after: { point: placement.data()?.point, zoneId: placement.data()?.zoneId, mapRevisionId: revisionRef.id }, requestId })));
  });
  await firestore.recursiveDelete(draft.ref).catch(() => undefined);
  publishSiteCameraControl(siteId);
  return getV2Map(siteId);
}

export async function deleteV2MapDraft(siteId: string, actor: AuditActor, requestId: string) {
  const actorUid = actor.uid;
  const siteRef = firestore.collection("sites").doc(siteId);
  const draftRef = firestore.collection("siteMapDrafts").doc(siteId);
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const [site, draft] = await Promise.all([transaction.get(siteRef), transaction.get(draftRef)]);
    if (!site.exists || !draft.exists) throw new HttpError(404, "Site Map draft not found.");
    transaction.delete(draftRef);
    transaction.update(siteRef, { mapDraftExists: false, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor, siteId, siteNameSnapshot: String(site.data()?.name), action: "site_map_draft_deleted", resourceType: "SiteMapDraft", resourceId: siteId, outcome: "succeeded", requestId }));
  });
  await firestore.recursiveDelete(draftRef).catch(() => undefined);
}

export async function publishV2CleanerStation(input: { siteId: string; cleanerId: string; point: MapPoint; actorUid: string; actorAuthority: "root" | "regular"; actorName: string; requestId: string }) {
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const [site, cleaner] = await Promise.all([siteRef.get(), firestore.collection("cleaners").doc(input.cleanerId).get()]);
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (!cleaner.exists || cleaner.data()?.siteId !== input.siteId || cleaner.data()?.status !== "active") throw new HttpError(404, "Active Cleaner not found.");
  const sourceRevision = await firestore.collection("siteMapRevisions").doc(String(site.data()?.activeMapRevisionId)).get();
  if (!sourceRevision.exists) throw new HttpError(409, "Active Site Map revision is missing.");
  const [zones, cameras, stations] = await Promise.all([sourceRevision.ref.collection("zoneGeometry").get(), sourceRevision.ref.collection("cameraPlacements").get(), sourceRevision.ref.collection("cleanerStations").get()]);
  const zoneId = containingPolygon(input.point, zones.docs.map((document) => ({ id: document.id, polygon: document.data().polygon as Polygon })));
  if (!pointInMapBounds(input.point, Number(sourceRevision.data()?.widthMeters), Number(sourceRevision.data()?.heightMeters))) throw new HttpError(400, "Cleaner Station Point must be inside the active Site Map boundary.");
  const revisionRef = firestore.collection("siteMapRevisions").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const latestSite = await transaction.get(siteRef);
    if (!latestSite.exists || latestSite.data()?.activeMapRevisionId !== sourceRevision.id) throw new HttpError(409, "Active Site Map changed. Refresh and retry.");
    const revisionNumber = Number(latestSite.data()?.mapRevisionNumber ?? sourceRevision.data()?.revisionNumber ?? 0) + 1;
    transaction.create(revisionRef, { ...sourceRevision.data(), revisionId: revisionRef.id, revisionNumber, parentRevisionId: sourceRevision.id, cleanerStationCount: new Set([...stations.docs.map((document) => document.id), input.cleanerId]).size, contentHash: `${sourceRevision.id}:station:${input.cleanerId}:${input.point.xMeters}:${input.point.yMeters}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actorUid, publicationRequestId: input.requestId });
    for (const zone of zones.docs) transaction.create(revisionRef.collection("zoneGeometry").doc(zone.id), { ...zone.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actorUid });
    for (const camera of cameras.docs) transaction.create(revisionRef.collection("cameraPlacements").doc(camera.id), { ...camera.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actorUid });
    for (const station of stations.docs) if (station.id !== input.cleanerId) transaction.create(revisionRef.collection("cleanerStations").doc(station.id), { ...station.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actorUid });
    transaction.create(revisionRef.collection("cleanerStations").doc(input.cleanerId), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cleanerId: input.cleanerId, cleanerNameSnapshot: String(cleaner.data()?.fullName), point: input.point, zoneId, publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actorUid });
    transaction.update(siteRef, { activeMapRevisionId: revisionRef.id, mapRevisionNumber: revisionNumber, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: { uid: input.actorUid, role: "supervisor", authority: input.actorAuthority, displayName: input.actorName }, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "cleaner_station_updated", resourceType: "Cleaner", resourceId: input.cleanerId, outcome: "succeeded", after: { mapRevisionId: revisionRef.id, zoneId, point: input.point }, requestId: input.requestId }));
  });
  publishSiteCameraControl(input.siteId);
  return { mapRevisionId: revisionRef.id, cleanerId: input.cleanerId, zoneId, point: input.point };
}
