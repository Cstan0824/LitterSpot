import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { v2AuditEventData, type AuditActor } from "./v2AuditService.js";
import { publishCameraControl } from "./cameraLiveEvents.js";
import { endMonitoringEpisode } from "./v2LiveMonitoringService.js";
import { activeRuntimeEpisode } from "./monitoringRuntimeRegistry.js";

export async function controlCamera(input: { siteId: string; cameraId: string; expectedRevision: number; monitoringEnabled: boolean; deactivate?: boolean; actor: AuditActor; requestId: string }) {
  const ref = firestore.collection("cameras").doc(input.cameraId);
  const siteRef = firestore.collection("sites").doc(input.siteId);
  const result = await firestore.runTransaction(async tx => {
    const [camera, site] = await Promise.all([tx.get(ref), tx.get(siteRef)]);
    const data = camera.data();
    if (!data || data.schemaVersion !== 2 || data.siteId !== input.siteId) throw new HttpError(404, "Camera not found.");
    if (site.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
    if (data.revision !== input.expectedRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
    if (data.status !== "active") throw new HttpError(409, "Camera is inactive.");
    if (input.deactivate && input.actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
    const enabled = input.deactivate ? false : input.monitoringEnabled;
    // Read existing records as well as the reservation to support previously published Cameras.
    // All mutations contend on the Site document, including concurrent laptop enablement.
    if (enabled && data.sourceType === "laptop_camera") {
      const cameras = await tx.get(firestore.collection("cameras").where("siteId", "==", input.siteId));
      const conflict = cameras.docs.find(c => c.id !== ref.id && c.data().status === "active" && c.data().monitoringEnabled && c.data().sourceType === "laptop_camera");
      if (conflict) throw new HttpError(409, `Disable ${conflict.data().name} before enabling this laptop Camera.`, { code: "laptop_camera_in_use", cameraId: conflict.id, cameraName: conflict.data().name });
    }
    const reserved = site.data()?.enabledLaptopCameraId;
    tx.update(siteRef, { enabledLaptopCameraId: enabled && data.sourceType === "laptop_camera" ? ref.id : reserved === ref.id ? null : reserved ?? null });
    tx.update(ref, { monitoringEnabled: enabled, ...(input.deactivate ? { status: "inactive", deactivatedAt: FieldValue.serverTimestamp(), deactivatedByUid: input.actor.uid } : {}), updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actor.uid, revision: FieldValue.increment(1) });
    const auditRef = firestore.collection("auditEvents").doc();
    tx.create(auditRef, v2AuditEventData({ auditEventId: auditRef.id, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name ?? ""), actor: input.actor, action: input.deactivate ? "camera_deactivated" : enabled ? "camera_monitoring_enabled" : "camera_monitoring_disabled", resourceType: "Camera", resourceId: ref.id, outcome: "succeeded", before: { monitoringEnabled: data.monitoringEnabled }, after: { monitoringEnabled: enabled }, requestId: input.requestId }));
    return { cameraId: ref.id, monitoringEnabled: enabled, revision: input.expectedRevision + 1 };
  });
  if (!result.monitoringEnabled) {
    const episode = activeRuntimeEpisode(input.cameraId);
    if (episode) await endMonitoringEpisode(input.siteId, input.cameraId, episode.episodeId, episode.monitoringSessionId, input.deactivate ? "deactivated" : "disabled");
  }
  publishCameraControl(input.siteId, input.cameraId);
  return result;
}
