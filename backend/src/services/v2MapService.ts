import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { containingPolygon, pointInMapBounds, polygonArea, validateMapGeometry, type MapPoint, type Polygon } from "./v2MapGeometry.js";
import { v2AuditEventData } from "./v2AuditService.js";

type ZoneDraft = { zoneId: string; zoneNameSnapshot: string; polygon: Polygon };
type PointDraft = { id: string; point: MapPoint; label: string };

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

export async function getV2Map(siteId: string) {
  const site = await siteForPrincipal(siteId);
  const revisionId = String(site.activeMapRevisionId ?? "");
  const revision = await firestore.collection("siteMapRevisions").doc(revisionId).get();
  if (!revision.exists) throw new HttpError(409, "Active Site Map revision is missing.");
  const [zones, cameras, cleaners] = await Promise.all([
    revision.ref.collection("zoneGeometry").get(), revision.ref.collection("cameraPlacements").get(), revision.ref.collection("cleanerStations").get(),
  ]);
  return { siteId, siteName: String(site.name ?? siteId), activeRevisionId: revision.id, revision: { id: revision.id, ...revision.data(), publishedAt: timestamp(revision.data()?.publishedAt) }, zones: zones.docs.map((doc) => ({ id: doc.id, ...doc.data() })), cameraPlacements: cameras.docs.map((doc) => ({ id: doc.id, ...doc.data() })), cleanerStations: cleaners.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
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

export async function saveV2MapDraft(input: { siteId: string; baseRevisionId: string; widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId?: string | null; backgroundTransform?: Record<string, number> | null; zones: ZoneDraft[]; cameraPlacements?: PointDraft[]; cleanerStations?: PointDraft[]; actorUid: string }) {
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (site.data()?.activeMapRevisionId !== input.baseRevisionId) throw new HttpError(409, "Map draft must start from the Active Map Revision.");
  const zoneIds = new Set(input.zones.map((zone) => zone.zoneId));
  if (zoneIds.size !== input.zones.length) throw new HttpError(400, "Zone IDs must be unique in a map draft.");
  const points = [...(input.cameraPlacements ?? []).map((value) => ({ ...value, requiresZone: true })), ...(input.cleanerStations ?? []).map((value) => ({ ...value, requiresZone: false }))];
  const validation = validateMapGeometry({ widthMeters: input.widthMeters, heightMeters: input.heightMeters, zones: input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon })), points });
  const draftRef = firestore.collection("siteMapDrafts").doc(input.siteId);
  const [oldZones, oldCameras, oldCleaners] = await Promise.all([draftRef.collection("zoneGeometry").get(), draftRef.collection("cameraPlacements").get(), draftRef.collection("cleanerStations").get()]);
  const suppliedZones = new Set(input.zones.map((value) => value.zoneId));
  const suppliedCameras = new Set((input.cameraPlacements ?? []).map((value) => value.id));
  const suppliedCleaners = new Set((input.cleanerStations ?? []).map((value) => value.id));
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(draftRef);
    const draftData = { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, baseRevisionId: input.baseRevisionId, widthMeters: input.widthMeters, heightMeters: input.heightMeters, gridSizeMeters: input.gridSizeMeters, backgroundMediaId: input.backgroundMediaId ?? null, backgroundTransform: input.backgroundTransform ?? null, validationStatus: validation.valid ? "valid" : "invalid", validationErrors: validation.errors, createdAt: current.exists ? current.data()?.createdAt : FieldValue.serverTimestamp(), createdByUid: current.exists ? current.data()?.createdByUid : input.actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: Number(current.data()?.revision ?? 0) + 1 };
    transaction.set(draftRef, draftData, { merge: true });
    transaction.update(site.ref, { mapDraftExists: true, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid, revision: FieldValue.increment(1) });
    for (const document of oldZones.docs) if (!suppliedZones.has(document.id)) transaction.delete(document.ref);
    for (const document of oldCameras.docs) if (!suppliedCameras.has(document.id)) transaction.delete(document.ref);
    for (const document of oldCleaners.docs) if (!suppliedCleaners.has(document.id)) transaction.delete(document.ref);
    for (const zone of input.zones) transaction.set(draftRef.collection("zoneGeometry").doc(zone.zoneId), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon, centroid: { xMeters: zone.polygon.reduce((sum, point) => sum + point.xMeters, 0) / zone.polygon.length, yMeters: zone.polygon.reduce((sum, point) => sum + point.yMeters, 0) / zone.polygon.length }, areaSquareMeters: polygonArea(zone.polygon), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid });
    for (const placement of input.cameraPlacements ?? []) transaction.set(draftRef.collection("cameraPlacements").doc(placement.id), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: placement.id, point: placement.point, zoneId: containingPolygon(placement.point, input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon }))), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid });
    for (const station of input.cleanerStations ?? []) transaction.set(draftRef.collection("cleanerStations").doc(station.id), { schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cleanerId: station.id, point: station.point, zoneId: containingPolygon(station.point, input.zones.map((zone) => ({ id: zone.zoneId, polygon: zone.polygon }))), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid });
  });
  return readDraft(input.siteId);
}

export async function validateV2MapDraft(siteId: string) {
  const { data, zones, cameraPlacements, cleanerStations } = await readDraft(siteId);
  const validation = validateMapGeometry({ widthMeters: Number(data.widthMeters), heightMeters: Number(data.heightMeters), zones: zones.docs.map((doc) => ({ id: doc.id, polygon: (doc.data().polygon ?? []) as Polygon })), points: [...cameraPlacements.docs.map((doc) => ({ id: doc.id, point: doc.data().point as MapPoint, label: `camera_${doc.id}`, requiresZone: true })), ...cleanerStations.docs.map((doc) => ({ id: doc.id, point: doc.data().point as MapPoint, label: `cleaner_${doc.id}`, requiresZone: false }))] });
  await firestore.collection("siteMapDrafts").doc(siteId).update({ validationStatus: validation.valid ? "valid" : "invalid", validationErrors: validation.errors, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
  return validation;
}

export async function publishV2MapDraft(siteId: string, actorUid: string) {
  const { draft, data, zones, cameraPlacements, cleanerStations } = await readDraft(siteId);
  if (data.validationStatus !== "valid") throw new HttpError(409, "Map draft must validate before publication.");
  const siteRef = firestore.collection("sites").doc(siteId);
  const revisionRef = firestore.collection("siteMapRevisions").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  const priorZones = await firestore.collection("zones").where("siteId", "==", siteId).get();
  await firestore.runTransaction(async (transaction) => {
    const [site, latestDraft] = await Promise.all([transaction.get(siteRef), transaction.get(draft.ref)]);
    if (!site.exists || site.data()?.activeMapRevisionId !== data.baseRevisionId) throw new HttpError(409, "Map draft is based on a stale revision.");
    if (!latestDraft.exists || latestDraft.data()?.revision !== data.revision || latestDraft.data()?.validationStatus !== "valid") throw new HttpError(409, "Map draft changed after validation.");
    const currentRevision = Number(site.data()?.mapRevisionNumber ?? 0) + 1;
    transaction.create(revisionRef, { schemaVersion: V2_SCHEMA_VERSION, revisionId: revisionRef.id, siteId, revisionNumber: currentRevision, parentRevisionId: data.baseRevisionId, widthMeters: data.widthMeters, heightMeters: data.heightMeters, gridSizeMeters: data.gridSizeMeters, backgroundMediaId: data.backgroundMediaId ?? null, backgroundTransform: data.backgroundTransform ?? null, zoneCount: zones.size, cameraPlacementCount: cameraPlacements.size, cleanerStationCount: cleanerStations.size, contentHash: `${siteId}:${currentRevision}:${data.revision}`, publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid, publicationRequestId: `${siteId}:${data.revision}` });
    for (const collection of [zones, cameraPlacements, cleanerStations]) for (const doc of collection.docs) transaction.create(revisionRef.collection(doc.ref.parent.id).doc(doc.id), { ...doc.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: actorUid });
    const activeZoneIds = new Set(zones.docs.map((document) => document.id));
    for (const zone of zones.docs) transaction.set(firestore.collection("zones").doc(zone.id), { schemaVersion: V2_SCHEMA_VERSION, zoneId: zone.id, siteId, name: zone.data().zoneNameSnapshot, nameNormalized: String(zone.data().zoneNameSnapshot).toLowerCase(), description: null, lifecycleStatus: "active", createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, retiredAt: null, retiredByUid: null, revision: FieldValue.increment(1) }, { merge: true });
    for (const zone of priorZones.docs) if (!activeZoneIds.has(zone.id)) transaction.update(zone.ref, { lifecycleStatus: "retired", retiredAt: FieldValue.serverTimestamp(), retiredByUid: actorUid, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.update(siteRef, { activeMapRevisionId: revisionRef.id, mapDraftExists: false, mapRevisionNumber: currentRevision, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.delete(draft.ref);
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: { uid: actorUid, role: "supervisor", authority: "root", displayName: "Root Supervisor" }, siteId, siteNameSnapshot: String(site.data()?.name), action: "site_map_published", resourceType: "SiteMapRevision", resourceId: revisionRef.id, outcome: "succeeded", before: { activeMapRevisionId: site.data()?.activeMapRevisionId }, after: { activeMapRevisionId: revisionRef.id, revisionNumber: currentRevision }, requestId: String(data.revision) }));
  });
  await firestore.recursiveDelete(draft.ref).catch(() => undefined);
  return getV2Map(siteId);
}

export async function deleteV2MapDraft(siteId: string, actorUid: string) {
  const siteRef = firestore.collection("sites").doc(siteId);
  const draftRef = firestore.collection("siteMapDrafts").doc(siteId);
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const [site, draft] = await Promise.all([transaction.get(siteRef), transaction.get(draftRef)]);
    if (!site.exists || !draft.exists) throw new HttpError(404, "Site Map draft not found.");
    transaction.delete(draftRef);
    transaction.update(siteRef, { mapDraftExists: false, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: { uid: actorUid, role: "supervisor", authority: "root", displayName: "Root Supervisor" }, siteId, siteNameSnapshot: String(site.data()?.name), action: "site_map_draft_deleted", resourceType: "SiteMapDraft", resourceId: siteId, outcome: "succeeded", requestId: String(draft.data()?.revision) }));
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
  return { mapRevisionId: revisionRef.id, cleanerId: input.cleanerId, zoneId, point: input.point };
}
