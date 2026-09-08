import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { CameraPlacementChange } from "../schemas/siteMap.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { publishSiteCameraControl } from "./cameraLiveEvents.js";
import { startV2CameraDraft } from "./v2CameraDraftService.js";
import { containingPolygon, pointInMapBounds, type Polygon } from "./v2MapGeometry.js";
import { v2AuditEventData, writeV2AuditEvent, type AuditActor } from "./v2AuditService.js";

type PlacementInput = CameraPlacementChange & { siteId: string; cameraId: string; actor: AuditActor; requestId: string };

function samePoint(left: { xMeters: number; yMeters: number }, right: { xMeters: number; yMeters: number }) {
  return left.xMeters === right.xMeters && left.yMeters === right.yMeters;
}

export async function changeV2CameraPlacement(input: PlacementInput) {
  if (input.actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const cameraRef = firestore.collection("cameras").doc(input.cameraId);
  const [site, camera] = await Promise.all([siteRef.get(), cameraRef.get()]);
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (!camera.exists || camera.data()?.siteId !== input.siteId || camera.data()?.status !== "active") throw new HttpError(404, "Active Camera not found.");
  if (camera.data()?.revision !== input.expectedCameraRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
  if (site.data()?.activeMapRevisionId !== input.expectedMapRevisionId) throw new HttpError(409, "The Site Map changed. Refresh and retry.");
  if (site.data()?.mapDraftExists) throw new HttpError(409, "Finish or discard the current Site Map draft before moving a Camera.", { code: "site_map_draft_exists" });
  const sourceType = camera.data()?.sourceType;
  if (sourceType !== "laptop_camera" && sourceType !== "looped_video") throw new HttpError(409, "The Camera source configuration is invalid.");
  const sourceRevision = firestore.collection("siteMapRevisions").doc(input.expectedMapRevisionId);
  const [revision, zones, cameraPlacements, cleanerStations] = await Promise.all([
    sourceRevision.get(), sourceRevision.collection("zoneGeometry").get(), sourceRevision.collection("cameraPlacements").get(), sourceRevision.collection("cleanerStations").get(),
  ]);
  if (!revision.exists || revision.data()?.siteId !== input.siteId) throw new HttpError(409, "Active Site Map revision is missing.");
  if (!pointInMapBounds(input.point, Number(revision.data()?.widthMeters), Number(revision.data()?.heightMeters))) throw new HttpError(422, "Camera Placement must remain inside the Site Map boundary.", { code: "camera_placement_outside_bounds" });
  const zoneId = containingPolygon(input.point, zones.docs.map((document) => ({ id: document.id, polygon: document.data()?.polygon as Polygon })));
  if (!zoneId) throw new HttpError(422, "Camera Placement must be inside exactly one active Zone.", { code: "camera_placement_not_in_exactly_one_zone" });
  const previous = cameraPlacements.docs.find((document) => document.id === input.cameraId);
  if (!previous) throw new HttpError(409, "The active Camera Placement is missing.");
  if (samePoint(previous.data()?.point, input.point)) throw new HttpError(400, "Choose a different Camera position.");
  if (cameraPlacements.size + cleanerStations.size + zones.size > 100) throw new HttpError(413, "This Site Map has more than 100 structural records and cannot be replaced in one Camera move operation.");

  if (input.mode === "physical_camera_move") {
    if (camera.data()?.monitoringEnabled) throw new HttpError(409, "Disable Camera monitoring before recording a Physical Camera Move.", { code: "camera_monitoring_must_be_disabled" });
    const draft = await startV2CameraDraft({
      siteId: input.siteId,
      kind: "physical_move",
      cameraId: input.cameraId,
      name: String(camera.data()?.name ?? input.cameraId),
      description: typeof camera.data()?.description === "string" ? camera.data()!.description : null,
      sourceType,
      placement: { point: input.point },
      moveReason: input.reason,
      actorUid: input.actor.uid,
    });
    await writeV2AuditEvent({ actor: input.actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name ?? input.siteId), action: "camera_physical_move_started", resourceType: "CameraDraft", resourceId: String(draft.id), outcome: "succeeded", reason: input.reason, before: { point: previous.data()?.point, zoneId: previous.data()?.zoneId, mapRevisionId: revision.id }, after: { point: input.point, zoneId, cameraId: input.cameraId }, requestId: input.requestId });
    return { mode: input.mode, status: "registration_required" as const, cameraId: input.cameraId, zoneId, point: input.point, draft };
  }

  const replacementRevision = firestore.collection("siteMapRevisions").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  await firestore.runTransaction(async (transaction) => {
    const [latestSite, latestCamera] = await Promise.all([transaction.get(siteRef), transaction.get(cameraRef)]);
    if (!latestSite.exists || latestSite.data()?.activeMapRevisionId !== revision.id) throw new HttpError(409, "The Site Map changed. Refresh and retry.");
    if (!latestCamera.exists || latestCamera.data()?.revision !== input.expectedCameraRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
    const revisionNumber = Number(latestSite.data()?.mapRevisionNumber ?? revision.data()?.revisionNumber ?? 0) + 1;
    transaction.create(replacementRevision, {
      ...revision.data(),
      schemaVersion: V2_SCHEMA_VERSION,
      revisionId: replacementRevision.id,
      revisionNumber,
      parentRevisionId: revision.id,
      coordinateOrigin: "top_left",
      xAxisDirection: "right",
      yAxisDirection: "down",
      contentHash: `${revision.id}:camera-position-correction:${input.cameraId}:${input.point.xMeters}:${input.point.yMeters}`,
      publishedAt: FieldValue.serverTimestamp(),
      publishedByUid: input.actor.uid,
      publicationRequestId: input.requestId,
    });
    for (const zone of zones.docs) transaction.create(replacementRevision.collection("zoneGeometry").doc(zone.id), { ...zone.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    for (const placement of cameraPlacements.docs) transaction.create(replacementRevision.collection("cameraPlacements").doc(placement.id), placement.id === input.cameraId ? { ...placement.data(), point: input.point, zoneId, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid } : { ...placement.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    for (const station of cleanerStations.docs) transaction.create(replacementRevision.collection("cleanerStations").doc(station.id), { ...station.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    transaction.update(siteRef, { activeMapRevisionId: replacementRevision.id, mapRevisionNumber: revisionNumber, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1) });
    transaction.update(cameraRef, { placementMapRevisionId: replacementRevision.id, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1) });
    transaction.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, actor: input.actor, siteId: input.siteId, siteNameSnapshot: String(latestSite.data()?.name ?? input.siteId), action: "camera_map_position_corrected", resourceType: "Camera", resourceId: input.cameraId, outcome: "succeeded", reason: input.reason, before: { point: previous.data()?.point, zoneId: previous.data()?.zoneId, mapRevisionId: revision.id }, after: { point: input.point, zoneId, mapRevisionId: replacementRevision.id }, requestId: input.requestId }));
  });
  publishSiteCameraControl(input.siteId);
  return { mode: input.mode, status: "published" as const, cameraId: input.cameraId, zoneId, point: input.point, mapRevisionId: replacementRevision.id, cameraRevision: input.expectedCameraRevision + 1 };
}
