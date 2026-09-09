import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { getCameraListConfiguration } from "./cameraConfigurationCache.js";
import { getDashboardV2 } from "./phase11Service.js";
import { getDailySummaries } from "./phase11Service.js";
import { v2Json } from "./v2Presentation.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { getV2Alert, listV2AlertsPage } from "./v2AlertService.js";
import { getV2CameraDetail } from "./v2CameraDetailService.js";
import { listV2CleanersPage } from "./v2CleanerService.js";
import { getV2Map } from "./v2MapService.js";
import { getV2SystemView } from "./v2SystemService.js";
import { listV2SupervisorsPage } from "./v2IdentityService.js";
import { getV2WorkOrder, listV2Verifications, listV2WorkEvents, listV2WorkOrdersPage } from "./v2WorkOrderService.js";
import { listV2OrchestratorRunsPage } from "./v2OrchestratorService.js";

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
  return (await listV2SuperadminSitesPage({ status, limit: 100 })).items;
}

export async function listV2SuperadminSitesPage(input: { status: "active" | "inactive" | "all"; limit: number; cursor?: string }) {
  const filters = { status: input.status };
  let query: FirebaseFirestore.Query = firestore.collection("sites").where("schemaVersion", "==", 2);
  if (input.status !== "all") query = query.where("status", "==", input.status);
  const page = await queryCursorPage({ query, totalQuery: query, resource: "superadminSites", orderField: "name", direction: "asc", filters, limit: input.limit, cursor: input.cursor, present: (document) => document.id });
  return { ...page, items: await Promise.all(page.items.map(presentV2SuperadminSite)) };
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
  const [siteMap, alertPage, cleanerPage, supervisorPage, workPage, cameraConfiguration, system, dashboardSnapshot] = await Promise.all([
    getV2Map(siteId, { allowInactive: true }),
    listV2AlertsPage(siteId, { limit: 25 }),
    listV2CleanersPage(siteId, { status: "all", limit: 25 }),
    listV2SupervisorsPage(siteId, "root", { status: "all", limit: 25 }),
    listV2WorkOrdersPage(siteId, { status: "all", limit: 25 }),
    getCameraListConfiguration(siteId),
    getV2SystemView(siteId),
    firestore.collection("dashboardSummaries").doc(siteId).get(),
  ]);
  const dashboard = site.status === "active" ? await getDashboardV2(siteId) : dashboardSnapshot.exists ? v2Json(dashboardSnapshot.data()) : null;
  return rewriteSuperadminSiteMediaUrls(siteId, v2Json({ site, dashboard, siteMap, alerts: alertPage.items, cleaners: cleanerPage.items, supervisors: supervisorPage.items, workOrders: workPage.items, cameras: cameraConfiguration.cameras, system, pagination: { alerts: { nextCursor: alertPage.nextCursor, hasMore: alertPage.hasMore, totalCount: alertPage.totalCount }, cleaners: { nextCursor: cleanerPage.nextCursor, hasMore: cleanerPage.hasMore, totalCount: cleanerPage.totalCount }, supervisors: { nextCursor: supervisorPage.nextCursor, hasMore: supervisorPage.hasMore, totalCount: supervisorPage.totalCount }, workOrders: { nextCursor: workPage.nextCursor, hasMore: workPage.hasMore, totalCount: workPage.totalCount } } }));
}

export async function getV2SuperadminListPage(siteId: string, resource: "alerts" | "work-orders" | "cleaners" | "supervisors" | "runs", input: { limit: number; cursor?: string; status?: string; zoneId?: string; severity?: string; origin?: "alert" | "manual" }) {
  await presentV2SuperadminSite(siteId);
  if (resource === "alerts") return listV2AlertsPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status, zoneId: input.zoneId, severity: input.severity });
  if (resource === "work-orders") return listV2WorkOrdersPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status ?? "all", zoneId: input.zoneId, origin: input.origin });
  if (resource === "cleaners") return listV2CleanersPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status === "active" || input.status === "inactive" ? input.status : "all" });
  if (resource === "runs") return listV2OrchestratorRunsPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status });
  return listV2SupervisorsPage(siteId, "root", { limit: input.limit, cursor: input.cursor, status: input.status === "active" || input.status === "inactive" ? input.status : "all" });
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
