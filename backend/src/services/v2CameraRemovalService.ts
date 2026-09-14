import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { publishSiteCameraControl } from "./cameraLiveEvents.js";
import { deleteStoredMedia } from "./localMediaStorage.js";
import { activeRuntimeEpisode } from "./monitoringRuntimeRegistry.js";
import { v2AuditEventData, type AuditActor } from "./v2AuditService.js";
import { dismissActiveCameraOperations } from "./v2CameraMovementOperations.js";
import { endMonitoringEpisode } from "./v2LiveMonitoringService.js";
import { enqueueV2OrchestratorTriggerInTransaction } from "./v2OrchestratorTriggers.js";
import { canonicalHash, operationKeyId, requestBodyHash } from "./v2Persistence.js";
import { clearV2CameraVerificationCollectors } from "./v2WorkOrderService.js";

type RemoveCameraInput = {
  siteId: string;
  cameraId: string;
  reason: string;
  expectedCameraRevision: number;
  expectedMapRevisionId: string;
  idempotencyKey: string;
  actor: AuditActor;
  requestId: string;
};

type RemoveCameraResult = {
  cameraId: string;
  status: "removed";
  mapRevisionId: string;
  cameraRevision: number;
  dismissedAlertCount: number;
  dismissedWorkCount: number;
  discardedDraftCount: number;
  replayed: boolean;
};

export async function removeV2CameraFromSite(input: RemoveCameraInput): Promise<RemoveCameraResult> {
  if (input.actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const cameraRef = firestore.collection("cameras").doc(input.cameraId);
  const mapRef = firestore.collection("siteMapRevisions").doc(input.expectedMapRevisionId);
  const mapDraftRef = firestore.collection("siteMapDrafts").doc(input.siteId);
  const draftLockRef = firestore.collection("cameraDraftLocks").doc(input.cameraId);
  const operationRef = firestore.collection("operationKeys").doc(operationKeyId(input.actor.uid, "remove_camera", input.idempotencyKey));
  const fingerprint = requestBodyHash({ siteId: input.siteId, cameraId: input.cameraId, reason: input.reason, expectedCameraRevision: input.expectedCameraRevision, expectedMapRevisionId: input.expectedMapRevisionId });
  const [existingOperation, site, camera, map, zones, placements, stations, draftSnapshot, draftLock] = await Promise.all([
    operationRef.get(), siteRef.get(), cameraRef.get(), mapRef.get(), mapRef.collection("zoneGeometry").get(),
    mapRef.collection("cameraPlacements").get(), mapRef.collection("cleanerStations").get(),
    firestore.collection("cameraDrafts").where("siteId", "==", input.siteId).limit(101).get(), draftLockRef.get(),
  ]);
  if (existingOperation.exists) {
    if (existingOperation.data()?.requestBodyHash !== fingerprint) throw new HttpError(409, "The idempotency key was already used with different Camera removal details.");
    return { ...(existingOperation.data()?.result as Omit<RemoveCameraResult, "replayed">), replayed: true };
  }
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (!camera.exists || camera.data()?.schemaVersion !== V2_SCHEMA_VERSION || camera.data()?.siteId !== input.siteId || camera.data()?.status !== "active") throw new HttpError(404, "Active Camera not found.");
  if (camera.data()?.revision !== input.expectedCameraRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
  if (site.data()?.activeMapRevisionId !== input.expectedMapRevisionId) throw new HttpError(409, "The Site Map changed. Refresh and retry.");
  if (site.data()?.mapDraftExists || (await mapDraftRef.get()).exists) throw new HttpError(409, "Finish or discard the current Site Map draft before removing a Camera.", { code: "site_map_draft_exists" });
  if (!map.exists || map.data()?.siteId !== input.siteId) throw new HttpError(409, "The active Site Map revision is missing.");
  const placement = placements.docs.find((document) => document.id === input.cameraId);
  if (!placement) throw new HttpError(409, "The active Camera Placement is missing.");
  if (zones.size + placements.size + stations.size > 100) throw new HttpError(413, "This Site Map has more than 100 structural records and cannot be replaced in one Camera removal.", { code: "camera_removal_map_limit" });
  if (draftSnapshot.size > 100) throw new HttpError(413, "This Site has too many Camera drafts to verify removal safely.", { code: "camera_removal_draft_scan_limit" });

  const unfinishedDrafts = draftSnapshot.docs.filter((document) => document.data()?.cameraId === input.cameraId && document.data()?.status !== "published");
  if (unfinishedDrafts.length > 10) throw new HttpError(413, "This Camera has too many unfinished drafts to remove safely.", { code: "camera_removal_draft_limit" });
  const draftMediaIds = [...new Set(unfinishedDrafts.flatMap((document) => [document.data()?.referenceMediaId, document.data()?.source?.sourceMediaId]).filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const draftMedia = (await Promise.all(draftMediaIds.map((mediaId) => firestore.collection("mediaAssets").doc(mediaId).get())))
    .filter((document) => document.exists && unfinishedDrafts.some((draft) => document.data()?.ownerType === "camera_draft" && document.data()?.ownerId === draft.id));
  const replacementMapRef = firestore.collection("siteMapRevisions").doc();
  const auditRef = firestore.collection("auditEvents").doc();
  const result = await firestore.runTransaction<RemoveCameraResult>(async (transaction) => {
    const [operation, currentSite, currentCamera, currentMapDraft, currentDraftLock, currentDraftQuery, ...currentDraftMedia] = await Promise.all([
      transaction.get(operationRef), transaction.get(siteRef), transaction.get(cameraRef), transaction.get(mapDraftRef), transaction.get(draftLockRef),
      transaction.get(firestore.collection("cameraDrafts").where("siteId", "==", input.siteId).limit(101)),
      ...draftMedia.map((document) => transaction.get(document.ref)),
    ]);
    if (operation.exists) {
      if (operation.data()?.requestBodyHash !== fingerprint) throw new HttpError(409, "The idempotency key was already used with different Camera removal details.");
      return { ...(operation.data()?.result as Omit<RemoveCameraResult, "replayed">), replayed: true };
    }
    if (!currentSite.exists || currentSite.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
    if (!currentCamera.exists || currentCamera.data()?.siteId !== input.siteId || currentCamera.data()?.status !== "active") throw new HttpError(409, "The Camera is no longer active.");
    if (currentCamera.data()?.revision !== input.expectedCameraRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
    if (currentSite.data()?.activeMapRevisionId !== input.expectedMapRevisionId) throw new HttpError(409, "The Site Map changed. Refresh and retry.");
    if (currentSite.data()?.mapDraftExists || currentMapDraft.exists) throw new HttpError(409, "Finish or discard the current Site Map draft before removing a Camera.", { code: "site_map_draft_exists" });
    const currentUnfinishedDrafts = currentDraftQuery.docs.filter((document) => document.data()?.cameraId === input.cameraId && document.data()?.status !== "published");
    const expectedDraftIds = unfinishedDrafts.map((document) => document.id).sort();
    const currentDraftIds = currentUnfinishedDrafts.map((document) => document.id).sort();
    if (JSON.stringify(currentDraftIds) !== JSON.stringify(expectedDraftIds)) throw new HttpError(409, "The Camera draft state changed. Retry removal.");
    const currentDraftMediaIds = [...new Set(currentUnfinishedDrafts.flatMap((document) => [document.data()?.referenceMediaId, document.data()?.source?.sourceMediaId]).filter((value): value is string => typeof value === "string" && Boolean(value)))].sort();
    if (JSON.stringify(currentDraftMediaIds) !== JSON.stringify([...draftMediaIds].sort())) throw new HttpError(409, "The Camera draft media changed. Retry removal.");
    if (currentDraftLock.exists && !currentDraftIds.includes(String(currentDraftLock.data()?.draftId ?? ""))) throw new HttpError(409, "The Camera draft lock changed. Retry removal.");
    if (draftLock.exists !== currentDraftLock.exists || draftLock.exists && draftLock.data()?.draftId !== currentDraftLock.data()?.draftId) throw new HttpError(409, "The Camera draft state changed. Retry removal.");
    const expectedMediaIds = draftMedia.map((document) => document.id).sort();
    const currentOwnedMediaIds = currentDraftMedia.filter((document) => document.exists && currentUnfinishedDrafts.some((draft) => document.data()?.ownerType === "camera_draft" && document.data()?.ownerId === draft.id)).map((document) => document.id).sort();
    if (JSON.stringify(currentOwnedMediaIds) !== JSON.stringify(expectedMediaIds)) throw new HttpError(409, "The Camera draft media changed. Retry removal.");

    const dismissed = await dismissActiveCameraOperations(transaction, {
      siteId: input.siteId, cameraId: input.cameraId, publicationKey: replacementMapRef.id, requestId: input.requestId,
      reasonCode: "camera_removed", notificationBody: "This task was dismissed because its Camera was removed from the Site.",
    });
    const revisionNumber = Number(currentSite.data()?.mapRevisionNumber ?? map.data()?.revisionNumber ?? 0) + 1;
    transaction.create(replacementMapRef, {
      ...map.data(), schemaVersion: V2_SCHEMA_VERSION, revisionId: replacementMapRef.id, revisionNumber,
      parentRevisionId: map.id, cameraPlacementCount: placements.size - 1,
      contentHash: canonicalHash("camera-removal-map", map.id, input.cameraId, replacementMapRef.id),
      publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid, publicationRequestId: input.requestId,
    });
    for (const zone of zones.docs) transaction.create(replacementMapRef.collection("zoneGeometry").doc(zone.id), { ...zone.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    for (const cameraPlacement of placements.docs) if (cameraPlacement.id !== input.cameraId) transaction.create(replacementMapRef.collection("cameraPlacements").doc(cameraPlacement.id), { ...cameraPlacement.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    for (const station of stations.docs) transaction.create(replacementMapRef.collection("cleanerStations").doc(station.id), { ...station.data(), publishedAt: FieldValue.serverTimestamp(), publishedByUid: input.actor.uid });
    for (const draft of currentUnfinishedDrafts) transaction.delete(draft.ref);
    for (const media of currentDraftMedia) if (media.exists) transaction.delete(media.ref);
    if (currentDraftLock.exists) transaction.delete(currentDraftLock.ref);
    transaction.update(cameraRef, {
      status: "removed", monitoringEnabled: false, removedAt: FieldValue.serverTimestamp(), removedByUid: input.actor.uid,
      removalReason: input.reason, removedFromMapRevisionId: map.id, removalMapRevisionId: replacementMapRef.id,
      updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1),
    });
    transaction.set(firestore.collection("cameraRuntimeStates").doc(input.cameraId), {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: input.cameraId, connectionStatus: "offline",
      monitoringSessionId: null, monitoringEpisodeId: null, sourceErrorCode: "camera_removed", sourceErrorMessage: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(siteRef, {
      activeMapRevisionId: replacementMapRef.id, mapRevisionNumber: revisionNumber,
      enabledLaptopCameraId: currentSite.data()?.enabledLaptopCameraId === input.cameraId ? null : currentSite.data()?.enabledLaptopCameraId ?? null,
      laptopCameraId: currentSite.data()?.laptopCameraId === input.cameraId ? null : currentSite.data()?.laptopCameraId ?? null,
      updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1),
    });
    if (dismissed.workCount > 0) enqueueV2OrchestratorTriggerInTransaction(transaction, {
      siteId: input.siteId, type: "retry_waiting_alerts", aggregateType: "site", aggregateId: input.siteId,
      triggerType: "cleaner_released_by_camera_removal", uniquenessKey: `camera-removal:${replacementMapRef.id}`,
    });
    transaction.create(auditRef, v2AuditEventData({
      auditEventId: auditRef.id, actor: input.actor, siteId: input.siteId, siteNameSnapshot: String(currentSite.data()?.name ?? input.siteId),
      action: "camera_removed", resourceType: "Camera", resourceId: input.cameraId, outcome: "succeeded", reason: input.reason,
      before: { status: currentCamera.data()?.status, monitoringEnabled: Boolean(currentCamera.data()?.monitoringEnabled), placement: placement.data(), mapRevisionId: map.id, sourceRevisionId: currentCamera.data()?.activeSourceRevisionId, registrationRevisionId: currentCamera.data()?.activeRegistrationRevisionId },
      after: { status: "removed", monitoringEnabled: false, mapRevisionId: replacementMapRef.id, dismissedAlertCount: dismissed.alertCount, dismissedWorkCount: dismissed.workCount, discardedDraftCount: currentUnfinishedDrafts.length }, requestId: input.requestId,
    }));
    const storedResult: Omit<RemoveCameraResult, "replayed"> = {
      cameraId: input.cameraId, status: "removed", mapRevisionId: replacementMapRef.id, cameraRevision: input.expectedCameraRevision + 1,
      dismissedAlertCount: dismissed.alertCount, dismissedWorkCount: dismissed.workCount, discardedDraftCount: currentUnfinishedDrafts.length,
    };
    transaction.create(operationRef, {
      schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, actorUid: input.actor.uid, operation: "remove_camera",
      idempotencyKey: input.idempotencyKey, requestBodyHash: fingerprint, resourceType: "Camera", resourceId: input.cameraId,
      responseStatus: 200, result: storedResult, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
    });
    return { ...storedResult, replayed: false };
  });

  if (!result.replayed) {
    await Promise.all(draftMedia.map(async (document) => {
      const storageKey = document.data()?.storageKey;
      if (typeof storageKey === "string") await deleteStoredMedia(storageKey).catch(() => undefined);
    }));
    clearV2CameraVerificationCollectors(input.cameraId);
    const episode = activeRuntimeEpisode(input.cameraId);
    if (episode) await endMonitoringEpisode(input.siteId, input.cameraId, episode.episodeId, episode.monitoringSessionId, "camera_removed");
    publishSiteCameraControl(input.siteId);
  }
  return result;
}
