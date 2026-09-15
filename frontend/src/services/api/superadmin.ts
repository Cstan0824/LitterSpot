import type { OperationsAlert, OperationsCamera, OperationsCameraDetail, OperationsDashboard, OperationsReadModel, OperationsWorkDetail, OperationsWorkOrder, OperationsWorkStatusCounts } from "./operations";
import type { SupervisorManagementItem } from "./supervisors";
import { apiRequest } from "./http";
import type { OrchestratorRunDetail, SystemView } from "./system";
import type { BinPlacementSnapshot } from "./binPlacement";
import { cachedPageRequest, type ListPage } from "./pagination";

export type SuperadminSite = {
  id: string;
  name: string;
  description: string | null;
  timeZone: string;
  status: "active" | "inactive";
  revision: number;
  rootSupervisor: { uid: string; fullName: string | null; email: string | null; status: string } | null;
  activeMap: { revisionId: string; revisionNumber: number; widthMeters: number; heightMeters: number; gridSizeMeters: number; zoneCount: number; cameraPlacementCount: number; publishedAt: string | null } | null;
  siteOperationId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SuperadminSiteDetail = {
  site: SuperadminSite;
  counts: { zones: number; cameras: number; cleaners: number; alerts: number; workOrders: number };
  latestOperation: Record<string, unknown> | null;
};

export type SuperadminAuditEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: "succeeded" | "failed";
  reason: string | null;
  errorCode: string | null;
  actorUid: string;
  actorNameSnapshot: string;
  siteId: string | null;
  siteNameSnapshot: string | null;
  occurredAt: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type SiteOperation = {
  id: string;
  siteId: string;
  type: "deactivate" | "reactivate";
  status: "pending" | "running" | "completed" | "failed";
  reason: string;
  counts?: Record<string, number>;
  cursorState?: { stage?: number; afterId?: string | null };
  lastErrorCode?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

export type CreateSuperadminSiteInput = {
  name: string;
  timeZone: string;
  description?: string | null;
  widthMeters: number;
  heightMeters: number;
  gridSizeMeters: number;
  rootEmail: string;
  rootPassword: string;
  rootDisplayName: string;
  idempotencyKey: string;
};

export type SuperadminOperationsView = {
  site: SuperadminSite;
  dashboard: OperationsDashboard | null;
  siteMap: OperationsReadModel["siteMap"];
  alerts: OperationsAlert[];
  cleaners: OperationsReadModel["cleaners"];
  supervisors: SupervisorManagementItem[];
  workOrders: OperationsWorkOrder[];
  cameras: OperationsCamera[];
  system: SystemView;
  pagination?: Record<"alerts" | "cleaners" | "supervisors" | "workOrders", { nextCursor: string | null; hasMore: boolean; totalCount: number }>;
};

const sitePath = (siteId: string) => `/api/superadmin/sites/${encodeURIComponent(siteId)}`;

export const getSuperadminSites = (status: "active" | "inactive" | "all" = "all", signal?: AbortSignal) => apiRequest<{ sites: SuperadminSite[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(`/api/superadmin/sites?status=${status}&limit=25`, { signal });
export const getSuperadminSitesPage = (status: "active" | "inactive" | "all" = "all", cursor?: string, signal?: AbortSignal): Promise<ListPage<SuperadminSite>> => { const url = `/api/superadmin/sites?status=${status}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`; return cachedPageRequest(url, async () => { const result = await apiRequest<{ sites: SuperadminSite[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.sites, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };
export const getSuperadminSite = (siteId: string, signal?: AbortSignal) => apiRequest<SuperadminSiteDetail>(sitePath(siteId), { signal });
export const getSuperadminOperationsView = (siteId: string, signal?: AbortSignal) => apiRequest<SuperadminOperationsView>(`${sitePath(siteId)}/view/operations`, { signal });
export const getSuperadminListPage = <T>(siteId: string, resource: "alerts" | "work-orders" | "cleaners" | "supervisors" | "runs", input: { limit?: number; cursor?: string; status?: string; zoneId?: string; severity?: string; origin?: string } = {}, signal?: AbortSignal): Promise<ListPage<T> & { statusCounts?: OperationsWorkStatusCounts }> => {
  const query = new URLSearchParams({ limit: String(input.limit ?? 25) });
  for (const [key, value] of Object.entries(input)) if (key !== "limit" && value) query.set(key, String(value));
  const url = `${sitePath(siteId)}/view/lists/${resource}?${query}`;
  return cachedPageRequest(url, async () => { const result = await apiRequest<{ items?: T[]; alerts?: T[]; workOrders?: T[]; cleaners?: T[]; supervisors?: T[]; runs?: T[]; nextCursor: string | null; hasMore: boolean; totalCount: number; statusCounts?: OperationsWorkStatusCounts }>(url); const items = result.items ?? result.alerts ?? result.workOrders ?? result.cleaners ?? result.supervisors ?? result.runs ?? []; return { items, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount, ...(result.statusCounts ? { statusCounts: result.statusCounts } : {}) }; }, 30_000, signal);
};
export const getSuperadminAlert = (siteId: string, alertId: string, signal?: AbortSignal) => apiRequest<import("./operations").OperationsAlertDetail>(`${sitePath(siteId)}/view/alerts/${encodeURIComponent(alertId)}`, { signal });
export const getSuperadminCamera = (siteId: string, cameraId: string, signal?: AbortSignal) => apiRequest<OperationsCameraDetail>(`${sitePath(siteId)}/view/cameras/${encodeURIComponent(cameraId)}`, { signal });
export const getSuperadminWork = (siteId: string, workOrderId: string, signal?: AbortSignal) => apiRequest<OperationsWorkDetail>(`${sitePath(siteId)}/view/work-orders/${encodeURIComponent(workOrderId)}`, { signal });
export const getSuperadminSystemRun = (siteId: string, runId: string, signal?: AbortSignal) => apiRequest<OrchestratorRunDetail>(`${sitePath(siteId)}/view/system/runs/${encodeURIComponent(runId)}`, { signal });
export const getSuperadminAnalytics = (siteId: string, input: { from?: string; to?: string } = {}, signal?: AbortSignal) => {
  const query = new URLSearchParams();
  if (input.from) query.set("from", input.from);
  if (input.to) query.set("to", input.to);
  return apiRequest<{ summaries: Array<Record<string, unknown>>; binPlacement: BinPlacementSnapshot | null }>(`${sitePath(siteId)}/view/analytics${query.size ? `?${query}` : ""}`, { signal });
};
export const getSuperadminSiteAudit = (siteId: string, signal?: AbortSignal) => apiRequest<{ events: Array<Record<string, unknown>> }>(`${sitePath(siteId)}/view/audit-events`, { signal });
export const getSuperadminSiteAuditPage = (siteId: string, cursor?: string, signal?: AbortSignal): Promise<ListPage<SuperadminAuditEvent>> => { const url = `${sitePath(siteId)}/view/audit-events?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`; return cachedPageRequest(url, async () => { const result = await apiRequest<{ events: SuperadminAuditEvent[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.events, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };
export const getSuperadminAudit = (siteId?: string, signal?: AbortSignal) => {
  const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : "";
  return apiRequest<{ events: SuperadminAuditEvent[] }>(`/api/superadmin/audit-events${query}`, { signal });
};
export const getSuperadminAuditPage = (siteId?: string, cursor?: string, signal?: AbortSignal): Promise<ListPage<SuperadminAuditEvent>> => { const query = new URLSearchParams({ limit: "25" }); if (siteId) query.set("siteId", siteId); if (cursor) query.set("cursor", cursor); const url = `/api/superadmin/audit-events?${query}`; return cachedPageRequest(url, async () => { const result = await apiRequest<{ events: SuperadminAuditEvent[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.events, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };
export const createSuperadminSite = (input: CreateSuperadminSiteInput) => apiRequest<{ siteId: string; rootSupervisorUid: string; replayed: boolean }>("/api/superadmin/sites", { method: "POST", json: input });
export const updateSuperadminSiteStatus = (siteId: string, status: "active" | "inactive", reason: string) => apiRequest<{ site: Record<string, unknown> }>(`${sitePath(siteId)}/status`, { method: "PATCH", json: { status, reason } });
export const recoverSuperadminRoot = (siteId: string, input: { mode: "reset_existing" | "replace"; email?: string; password: string; displayName: string; reason: string; idempotencyKey: string }) => apiRequest<{ result: { rootSupervisorUid: string; mode: "reset_existing" | "replace" } }>(`${sitePath(siteId)}/root-recovery`, { method: "POST", json: input });
export const getSuperadminSiteOperation = (siteId: string, operationId: string, signal?: AbortSignal) => apiRequest<{ operation: SiteOperation }>(`${sitePath(siteId)}/operations/${encodeURIComponent(operationId)}`, { signal });
export const reconcileSuperadminSiteOperation = (siteId: string, operationId: string) => apiRequest<{ operation: SiteOperation }>(`${sitePath(siteId)}/operations/${encodeURIComponent(operationId)}/reconcile`, { method: "POST", json: {} });
export const superadminMediaContentUrl = (siteId: string, mediaId: string) => `${sitePath(siteId)}/view/media/${encodeURIComponent(mediaId)}/content`;
export const superadminMediaOverlayUrl = (siteId: string, mediaId: string) => `${sitePath(siteId)}/view/media/${encodeURIComponent(mediaId)}/overlay`;
