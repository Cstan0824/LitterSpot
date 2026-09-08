import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { getCameraListConfiguration } from "./cameraConfigurationCache.js";
import { getDashboardV2 } from "./phase11Service.js";
import { getDailySummaries } from "./phase11Service.js";
import { v2Json } from "./v2Presentation.js";
import { getV2Alert, listV2Alerts } from "./v2AlertService.js";
import { getV2CameraDetail } from "./v2CameraDetailService.js";
import { listV2Cleaners } from "./v2CleanerService.js";
import { getV2Map } from "./v2MapService.js";
import { getV2SystemView } from "./v2SystemService.js";
import { listV2Supervisors } from "./v2IdentityService.js";
import { getV2WorkOrder, listV2Verifications, listV2WorkEvents, listV2WorkOrders } from "./v2WorkOrderService.js";

const timestamp = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;

export function rewriteSuperadminSiteMediaUrls<T>(siteId: string, value: T): T {
  const encodedSite = encodeURIComponent(siteId);
  const rewrite = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(rewrite);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, rewrite(entry)]));
    if (typeof item === "string") {
      const match = item.match(/^\/api\/media\/([^/]+)\/content$/);
      if (match) return `/api/superadmin/sites/${encodedSite}/view/media/${encodeURIComponent(decodeURIComponent(match[1]))}/content`;
    }
    return item;
  };
  return rewrite(value) as T;
}

async function siteDocument(siteId: string) {
  const site = await firestore.collection("sites").doc(siteId).get();
  if (!site.exists || site.data()?.schemaVersion !== 2) throw new HttpError(404, "Site not found.");
  return site;
}

async function rootProjection(rootSupervisorUid: string | null) {
  if (!rootSupervisorUid) return null;
  const [profile, account] = await Promise.all([
    firestore.collection("supervisors").doc(rootSupervisorUid).get(),
    firestore.collection("userAccounts").doc(rootSupervisorUid).get(),
  ]);
  if (!profile.exists || profile.data()?.authority !== "root") return { uid: rootSupervisorUid, fullName: null, email: null, status: "missing" };
  return {
    uid: rootSupervisorUid,
    fullName: String(profile.data()?.fullName ?? account.data()?.displayName ?? "Root Supervisor"),
    email: account.exists ? String(account.data()?.emailNormalized ?? "") || null : null,
    status: String(account.data()?.status ?? profile.data()?.status ?? "inactive"),
  };
}

export async function presentV2SuperadminSite(siteId: string) {
  const site = await siteDocument(siteId);
  const data = site.data()!;
  const revisionId = typeof data.activeMapRevisionId === "string" ? data.activeMapRevisionId : null;
  const [root, revision] = await Promise.all([
    rootProjection(typeof data.rootSupervisorUid === "string" ? data.rootSupervisorUid : null),
    revisionId ? firestore.collection("siteMapRevisions").doc(revisionId).get() : null,
  ]);
  return {
    id: site.id,
    name: String(data.name ?? site.id),
    description: typeof data.description === "string" ? data.description : null,
    timeZone: String(data.timeZone ?? "Asia/Kuala_Lumpur"),
    status: data.status === "inactive" ? "inactive" as const : "active" as const,
    revision: Number(data.revision ?? 0),
    rootSupervisor: root,
    activeMap: revision?.exists ? {
      revisionId: revision.id,
      revisionNumber: Number(revision.data()?.revisionNumber ?? 0),
      widthMeters: Number(revision.data()?.widthMeters ?? 0),
      heightMeters: Number(revision.data()?.heightMeters ?? 0),
      gridSizeMeters: Number(revision.data()?.gridSizeMeters ?? 0),
      zoneCount: Number(revision.data()?.zoneCount ?? 0),
      cameraPlacementCount: Number(revision.data()?.cameraPlacementCount ?? 0),
      publishedAt: timestamp(revision.data()?.publishedAt),
    } : null,
    siteOperationId: typeof data.deactivationOperationId === "string" ? data.deactivationOperationId : null,
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
  };
}

export async function listV2SuperadminSites(status: "active" | "inactive" | "all" = "all") {
  const snapshot = await firestore.collection("sites").limit(200).get();
  const sites = await Promise.all(snapshot.docs
    .filter((site) => site.data()?.schemaVersion === 2 && (status === "all" || site.data()?.status === status))
    .map((site) => presentV2SuperadminSite(site.id)));
  return sites.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export async function getV2SuperadminSiteDetail(siteId: string) {
  const site = await presentV2SuperadminSite(siteId);
  const collections = ["zones", "cameras", "cleaners", "alerts", "workOrders"] as const;
  const counts = await Promise.all(collections.map((collection) => firestore.collection(collection).where("siteId", "==", siteId).where("schemaVersion", "==", 2).count().get()));
  const operation = site.siteOperationId ? await firestore.collection("siteOperations").doc(site.siteOperationId).get() : null;
  return {
    site,
    counts: Object.fromEntries(collections.map((collection, index) => [collection, counts[index].data().count])),
    latestOperation: operation?.exists && operation.data()?.siteId === siteId ? v2Json({ id: operation.id, ...operation.data() }) : null,
  };
}

export async function getV2SuperadminOperationsView(siteId: string) {
  const site = await presentV2SuperadminSite(siteId);
  const [siteMap, alerts, cleaners, supervisors, workOrders, cameraConfiguration, system, dashboardSnapshot] = await Promise.all([
    getV2Map(siteId, { allowInactive: true }),
    listV2Alerts(siteId),
    listV2Cleaners(siteId, "all"),
    listV2Supervisors(siteId, "root"),
    listV2WorkOrders(siteId, { status: "all", limit: 100 }),
    getCameraListConfiguration(siteId),
    getV2SystemView(siteId),
    firestore.collection("dashboardSummaries").doc(siteId).get(),
  ]);
  const dashboard = site.status === "active" ? await getDashboardV2(siteId) : dashboardSnapshot.exists ? v2Json(dashboardSnapshot.data()) : null;
  return rewriteSuperadminSiteMediaUrls(siteId, v2Json({ site, dashboard, siteMap, alerts, cleaners, supervisors, workOrders, cameras: cameraConfiguration.cameras, system }));
}

export const getV2SuperadminAlert = (siteId: string, alertId: string) => getV2Alert(siteId, alertId);
export const getV2SuperadminCamera = (siteId: string, cameraId: string) => getV2CameraDetail(siteId, cameraId);
export async function getV2SuperadminWork(siteId: string, workOrderId: string) {
  const [workOrder, events, verifications] = await Promise.all([
    getV2WorkOrder(siteId, workOrderId), listV2WorkEvents(siteId, workOrderId), listV2Verifications(siteId, workOrderId),
  ]);
  return { workOrder, events, verifications };
}

export async function getV2SuperadminAnalytics(siteId: string, from?: string, to?: string) {
  await siteDocument(siteId);
  const [summaries, snapshot] = await Promise.all([
    getDailySummaries(siteId, from, to),
    firestore.collection("binPlacementSnapshots").doc(siteId).get(),
  ]);
  return { summaries, binPlacement: snapshot.exists && snapshot.data()?.siteId === siteId ? v2Json(snapshot.data()) : null };
}
