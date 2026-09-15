import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { getCameraListConfiguration } from "./cameraConfigurationCache.js";
import { getDashboard } from "./phase11Service.js";
import { getDailySummaries } from "./phase11Service.js";
import { serializeFirestore } from "./presentation.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { getAlert, listAlertsPage } from "./alertService.js";
import { getCameraDetail } from "./cameraDetailService.js";
import { listCleanersPage } from "./cleanerService.js";
import { getMap } from "./mapService.js";
import { getSystemView } from "./systemService.js";
import { listSupervisorsPage } from "./identityService.js";
import { getWorkOrder, listVerifications, listWorkEvents, listWorkOrdersPage } from "./workOrderService.js";
import { listOrchestratorRunsPage } from "./orchestratorService.js";

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

export async function presentSuperadminSite(siteId: string) {
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

export async function listSuperadminSites(status: "active" | "inactive" | "all" = "all") {
  return (await listSuperadminSitesPage({ status, limit: 100 })).items;
}

export async function listSuperadminSitesPage(input: { status: "active" | "inactive" | "all"; limit: number; cursor?: string }) {
  const filters = { status: input.status };
  let query: FirebaseFirestore.Query = firestore.collection("sites").where("schemaVersion", "==", 2);
  if (input.status !== "all") query = query.where("status", "==", input.status);
  const page = await queryCursorPage({ query, totalQuery: query, resource: "superadminSites", orderField: "name", direction: "asc", filters, limit: input.limit, cursor: input.cursor, present: (document) => document.id });
  return { ...page, items: await Promise.all(page.items.map(presentSuperadminSite)) };
}

export async function getSuperadminSiteDetail(siteId: string) {
  const site = await presentSuperadminSite(siteId);
  const collections = ["zones", "cameras", "cleaners", "alerts", "workOrders"] as const;
  const counts = await Promise.all(collections.map((collection) => firestore.collection(collection).where("siteId", "==", siteId).where("schemaVersion", "==", 2).count().get()));
  const operation = site.siteOperationId ? await firestore.collection("siteOperations").doc(site.siteOperationId).get() : null;
  return {
    site,
    counts: Object.fromEntries(collections.map((collection, index) => [collection, counts[index].data().count])),
    latestOperation: operation?.exists && operation.data()?.siteId === siteId ? serializeFirestore({ id: operation.id, ...operation.data() }) : null,
  };
}

export async function getSuperadminOperationsView(siteId: string) {
  const site = await presentSuperadminSite(siteId);
  const [siteMap, alertPage, cleanerPage, supervisorPage, workPage, cameraConfiguration, system, dashboardSnapshot] = await Promise.all([
    getMap(siteId, { allowInactive: true }),
    listAlertsPage(siteId, { limit: 25 }),
    listCleanersPage(siteId, { status: "all", limit: 25 }),
    listSupervisorsPage(siteId, "root", { status: "all", limit: 25 }),
    listWorkOrdersPage(siteId, { status: "all", limit: 25 }),
    getCameraListConfiguration(siteId),
    getSystemView(siteId),
    firestore.collection("dashboardSummaries").doc(siteId).get(),
  ]);
  const dashboard = site.status === "active" ? await getDashboard(siteId) : dashboardSnapshot.exists ? serializeFirestore(dashboardSnapshot.data()) : null;
  return rewriteSuperadminSiteMediaUrls(siteId, serializeFirestore({ site, dashboard, siteMap, alerts: alertPage.items, cleaners: cleanerPage.items, supervisors: supervisorPage.items, workOrders: workPage.items, cameras: cameraConfiguration.cameras, system, pagination: { alerts: { nextCursor: alertPage.nextCursor, hasMore: alertPage.hasMore, totalCount: alertPage.totalCount }, cleaners: { nextCursor: cleanerPage.nextCursor, hasMore: cleanerPage.hasMore, totalCount: cleanerPage.totalCount }, supervisors: { nextCursor: supervisorPage.nextCursor, hasMore: supervisorPage.hasMore, totalCount: supervisorPage.totalCount }, workOrders: { nextCursor: workPage.nextCursor, hasMore: workPage.hasMore, totalCount: workPage.totalCount } } }));
}

export async function getSuperadminListPage(siteId: string, resource: "alerts" | "work-orders" | "cleaners" | "supervisors" | "runs", input: { limit: number; cursor?: string; status?: string; zoneId?: string; severity?: string; origin?: "alert" | "manual" }) {
  await presentSuperadminSite(siteId);
  if (resource === "alerts") return listAlertsPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status, zoneId: input.zoneId, severity: input.severity });
  if (resource === "work-orders") return listWorkOrdersPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status ?? "all", zoneId: input.zoneId, origin: input.origin });
  if (resource === "cleaners") return listCleanersPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status === "active" || input.status === "inactive" ? input.status : "all" });
  if (resource === "runs") return listOrchestratorRunsPage(siteId, { limit: input.limit, cursor: input.cursor, status: input.status });
  return listSupervisorsPage(siteId, "root", { limit: input.limit, cursor: input.cursor, status: input.status === "active" || input.status === "inactive" ? input.status : "all" });
}

export const getSuperadminAlert = (siteId: string, alertId: string) => getAlert(siteId, alertId);
export const getSuperadminCamera = (siteId: string, cameraId: string) => getCameraDetail(siteId, cameraId);
export async function getSuperadminWork(siteId: string, workOrderId: string) {
  const [workOrder, events, verifications] = await Promise.all([
    getWorkOrder(siteId, workOrderId), listWorkEvents(siteId, workOrderId), listVerifications(siteId, workOrderId),
  ]);
  return { workOrder, events, verifications };
}

export async function getSuperadminAnalytics(siteId: string, from?: string, to?: string) {
  await siteDocument(siteId);
  const [summaries, snapshot] = await Promise.all([
    getDailySummaries(siteId, from, to),
    firestore.collection("binPlacementSnapshots").doc(siteId).get(),
  ]);
  return { summaries, binPlacement: snapshot.exists && snapshot.data()?.siteId === siteId ? serializeFirestore(snapshot.data()) : null };
}
