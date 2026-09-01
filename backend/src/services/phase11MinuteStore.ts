import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { siteLocalDate } from "./phase11Calendar.js";

export type MinuteContribution = { id: string; zoneId: string; zoneNameSnapshot?: string; mapRevisionId: string; metrics: Record<string, number> };
export async function persistMinuteContributions(siteId: string, start: Date, timeZone: string, incoming: MinuteContribution[]) {
  const bucketId = createHash("sha256").update(`${siteId}:${start.toISOString()}`).digest("hex");
  const ref = firestore.collection("analyticsMinuteBuckets").doc(bucketId);
  await firestore.runTransaction(async tx => {
    const previous = await tx.get(ref);
    const data = previous.data();
    const contributions: Record<string, MinuteContribution> = { ...(data?.contributions ?? {}) };
    // Preserve pre-migration buckets as one baseline contribution per Zone.
    if (data && !data.contributions) for (const [zoneId, metrics] of Object.entries(data.zoneMetrics ?? {})) {
      contributions[`legacy-${zoneId}`] = { id: `legacy-${zoneId}`, zoneId, mapRevisionId: data.mapRevisionIds?.[0] ?? "", metrics: metrics as Record<string, number> };
    }
    for (const item of incoming) {
      const current = contributions[item.id];
      if (!current || item.metrics.sampleAttemptCount === undefined || (current.metrics.sampleAttemptCount ?? -1) <= item.metrics.sampleAttemptCount) contributions[item.id] = item;
    }
    const zones: Record<string, Record<string, any>> = {};
    const totals: Record<string, number> = {};
    for (const item of Object.values(contributions)) {
      const zone = zones[item.zoneId] ??= { zoneNameSnapshot: item.zoneNameSnapshot ?? item.zoneId };
      for (const [field, raw] of Object.entries(item.metrics)) {
        if (typeof raw !== "number") continue;
        zone[field] = field === "peopleMax" ? Math.max(zone[field] ?? 0, raw) : (zone[field] ?? 0) + raw;
      }
    }
    for (const zone of Object.values(zones)) for (const [key, value] of Object.entries(zone)) if (typeof value === "number") totals[key] = key === "peopleMax" ? Math.max(totals[key] ?? 0, value) : (totals[key] ?? 0) + value;
    tx.set(ref, { schemaVersion: 2, bucketId, siteId, bucketStart: Timestamp.fromDate(start), bucketEnd: Timestamp.fromMillis(+start + 60000),
      siteLocalDate: siteLocalDate(start, timeZone), timeZoneSnapshot: timeZone,
      contributions, zoneMetrics: zones, siteTotals: totals, mapRevisionIds: [...new Set(Object.values(contributions).map(x => x.mapRevisionId))],
      aggregationVersion: "minute-v3", finalizedAt: FieldValue.serverTimestamp(), lastReconciledAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(+start + 60000 + 90 * 86400000) });
  });
  return bucketId;
}

export async function persistCameraCoverageMinute(siteId: string, start: Date) {
  const site = await firestore.collection("sites").doc(siteId).get(); if (site.data()?.status!=="active") return 0;
  const mapId=String(site.data()?.activeMapRevisionId??""),end=+start+60000;
  const cameras=await firestore.collection("cameras").where("siteId","==",siteId).get();
  const contributions:MinuteContribution[]=[];
  for(const camera of cameras.docs){const data=camera.data();if(data.schemaVersion!==2||data.status!=="active"||!data.monitoringEnabled)continue;
    const [placement,runtime]=await Promise.all([firestore.collection("siteMapRevisions").doc(mapId).collection("cameraPlacements").doc(camera.id).get(),firestore.collection("cameraRuntimeStates").doc(camera.id).get()]);
    if(!placement.exists)continue;const sample=runtime.data()?.lastSampleAcceptedAt?.toMillis?.()??0;
    contributions.push({id:`coverage:${camera.id}`,zoneId:String(placement.data()?.zoneId),zoneNameSnapshot:String(placement.data()?.zoneNameSnapshot??placement.data()?.zoneId),mapRevisionId:mapId,
      metrics:{eligibleCameraCount:1,offlineCameraSeconds:sample>=+start?0:60}});
  }
  if(contributions.length)await persistMinuteContributions(siteId,start,String(site.data()?.timeZone??"Asia/Kuala_Lumpur"),contributions);
  return contributions.length;
}
