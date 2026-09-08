import type { V2Alert, V2Camera, V2CameraDetail, V2Dashboard, V2OperationsReadModel, V2WorkDetail, V2WorkOrder } from "./operations";
import type { V2SupervisorManagementItem } from "./supervisors";
import { v2Request } from "./http";
import type { V2OrchestratorRunDetail, V2SystemView } from "./system";
import type { BinPlacementSnapshot } from "./binPlacement";

export type V2SuperadminSite = {
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

export type V2SuperadminSiteDetail = {
  site: V2SuperadminSite;
  counts: { zones: number; cameras: number; cleaners: number; alerts: number; workOrders: number };
  latestOperation: Record<string, unknown> | null;
};

export type V2SuperadminAuditEvent = {
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

export type V2SiteOperation = {
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

export type CreateV2SuperadminSiteInput = {
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

export type V2SuperadminOperationsView = {
  site: V2SuperadminSite;
  dashboard: V2Dashboard | null;
  siteMap: V2OperationsReadModel["siteMap"];
  alerts: V2Alert[];
  cleaners: V2OperationsReadModel["cleaners"];
  supervisors: V2SupervisorManagementItem[];
  workOrders: V2WorkOrder[];
  cameras: V2Camera[];
  system: V2SystemView;
};

const sitePath = (siteId: string) => `/api/superadmin/sites/${encodeURIComponent(siteId)}`;

export const getV2SuperadminSites = (status: "active" | "inactive" | "all" = "all", signal?: AbortSignal) => v2Request<{ sites: V2SuperadminSite[] }>(`/api/superadmin/sites?status=${status}`, { signal });
export const getV2SuperadminSite = (siteId: string, signal?: AbortSignal) => v2Request<V2SuperadminSiteDetail>(sitePath(siteId), { signal });
export const getV2SuperadminOperationsView = (siteId: string, signal?: AbortSignal) => v2Request<V2SuperadminOperationsView>(`${sitePath(siteId)}/view/operations`, { signal });
export const getV2SuperadminAlert = (siteId: string, alertId: string, signal?: AbortSignal) => v2Request<Record<string, unknown>>(`${sitePath(siteId)}/view/alerts/${encodeURIComponent(alertId)}`, { signal });
export const getV2SuperadminCamera = (siteId: string, cameraId: string, signal?: AbortSignal) => v2Request<V2CameraDetail>(`${sitePath(siteId)}/view/cameras/${encodeURIComponent(cameraId)}`, { signal });
export const getV2SuperadminWork = (siteId: string, workOrderId: string, signal?: AbortSignal) => v2Request<V2WorkDetail>(`${sitePath(siteId)}/view/work-orders/${encodeURIComponent(workOrderId)}`, { signal });
export const getV2SuperadminSystemRun = (siteId: string, runId: string, signal?: AbortSignal) => v2Request<V2OrchestratorRunDetail>(`${sitePath(siteId)}/view/system/runs/${encodeURIComponent(runId)}`, { signal });
export const getV2SuperadminAnalytics = (siteId: string, input: { from?: string; to?: string } = {}, signal?: AbortSignal) => {
  const query = new URLSearchParams();
  if (input.from) query.set("from", input.from);
  if (input.to) query.set("to", input.to);
  return v2Request<{ summaries: Array<Record<string, unknown>>; binPlacement: BinPlacementSnapshot | null }>(`${sitePath(siteId)}/view/analytics${query.size ? `?${query}` : ""}`, { signal });
};
export const getV2SuperadminSiteAudit = (siteId: string, signal?: AbortSignal) => v2Request<{ events: Array<Record<string, unknown>> }>(`${sitePath(siteId)}/view/audit-events`, { signal });
export const getV2SuperadminAudit = (siteId?: string, signal?: AbortSignal) => {
  const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : "";
  return v2Request<{ events: V2SuperadminAuditEvent[] }>(`/api/superadmin/audit-events${query}`, { signal });
};
export const createV2SuperadminSite = (input: CreateV2SuperadminSiteInput) => v2Request<{ siteId: string; rootSupervisorUid: string; replayed: boolean }>("/api/superadmin/sites", { method: "POST", json: input });
export const updateV2SuperadminSiteStatus = (siteId: string, status: "active" | "inactive", reason: string) => v2Request<{ site: Record<string, unknown> }>(`${sitePath(siteId)}/status`, { method: "PATCH", json: { status, reason } });
export const recoverV2SuperadminRoot = (siteId: string, input: { mode: "reset_existing" | "replace"; email?: string; password: string; displayName: string; reason: string; idempotencyKey: string }) => v2Request<{ result: { rootSupervisorUid: string; mode: "reset_existing" | "replace" } }>(`${sitePath(siteId)}/root-recovery`, { method: "POST", json: input });
export const getV2SuperadminSiteOperation = (siteId: string, operationId: string, signal?: AbortSignal) => v2Request<{ operation: V2SiteOperation }>(`${sitePath(siteId)}/operations/${encodeURIComponent(operationId)}`, { signal });
export const reconcileV2SuperadminSiteOperation = (siteId: string, operationId: string) => v2Request<{ operation: V2SiteOperation }>(`${sitePath(siteId)}/operations/${encodeURIComponent(operationId)}/reconcile`, { method: "POST", json: {} });
export const v2SuperadminMediaContentUrl = (siteId: string, mediaId: string) => `${sitePath(siteId)}/view/media/${encodeURIComponent(mediaId)}/content`;
export const v2SuperadminMediaOverlayUrl = (siteId: string, mediaId: string) => `${sitePath(siteId)}/view/media/${encodeURIComponent(mediaId)}/overlay`;
