import { v2Request } from "./http";
import { createIdempotencyKey } from "./idempotency";
import type { CameraObservation } from "../../../../shared/cameraMonitoring";
import type { SiteBackgroundTransform, SiteMapBackground } from "./siteMap";
import { cachedPageRequest, type V2ListPage } from "./pagination";

export type V2Point = { xMeters: number; yMeters: number };
export type V2Zone = { id: string; zoneId: string; zoneNameSnapshot: string; polygon: V2Point[] };
export type V2Camera = {
  description?: string | null;
  id: string; name: string; status: "active" | "inactive" | "removed"; monitoringEnabled: boolean; sourceType: "laptop_camera" | "looped_video";
  isSimulation: boolean; placement: { zoneId: string; point: V2Point } | null;
  runtime: { connectionStatus?: string; cleanlinessState?: string; lastPeopleCount?: number; lastSampleAcceptedAt?: string | null } | null;
  source: { contentUrl: string | null; sourceMediaId?: string | null; type?: "laptop_camera" | "looped_video"; durationSeconds?: number; width?: number; height?: number } | null;
  registration: { status?: string; binCount?: number; referenceMediaId?: string | null; sourceWidth?: number; sourceHeight?: number; walkableFloorPolygon?: Array<{ x: number; y: number }>; bins?: V2RegisteredBin[] } | null;
  revision: number;
};
export type V2Cleaner = {
  id: string; fullName: string; staffCode: string; phone: string; status: "active" | "inactive"; notes: string | null;
  stationPoint: V2Point | null; stationZoneId: string | null; weeklySchedule: Record<string, { startMinute: number; endMinute: number } | null>;
  availability: { available: boolean; reasons: string[] }; availabilityOverride?: "none" | "unavailable"; activeWorkOrderId: string | null;
  scheduleTimeZone?: string; profileMediaId?: string | null; createdAt?: string | null; updatedAt?: string | null; revision: number;
};
export type V2Alert = {
  id: string; issueType: string; observedCondition: string; status: string; severity: "warning" | "critical"; priorityScore: number;
  cameraId: string | null; cameraNameSnapshot: string; zoneId: string | null; zoneNameSnapshot: string; createdAt: string | null; updatedAt: string | null;
  evidence: { mediaId: string; confidence?: number; capturedAt?: string; detections?: unknown[]; observation?: CameraObservation } | null; activeWorkOrderId: string | null; isSimulation: boolean; revision: number;
};
export type V2WorkOrder = {
  id: string; origin: "alert" | "manual"; alertId: string | null; managementMode: string; status: string; severity: "warning" | "critical";
  issueType: string; title: string; instructions: string; assignedCleanerId: string; cleanerNameSnapshot: string;
  zoneId: string | null; cameraId: string | null; target: { type: "camera" | "coordinate"; zoneId?: string | null; zoneNameSnapshot: string; point: V2Point | null; cameraNameSnapshot?: string | null };
  assignedAt?: string | null; createdAt: string | null; updatedAt: string | null; submittedAt: string | null; resolvedAt: string | null; completionEvidenceMediaId: string | null;
  latestVerificationId: string | null; latestVerificationOutcome: string | null; reworkCount: number; revision: number;
};
export type V2WorkStatusCounts = Record<"assigned" | "in_progress" | "awaiting_review" | "resolved" | "dismissed", number>;
export type V2WorkOrderPage = V2ListPage<V2WorkOrder> & { statusCounts: V2WorkStatusCounts };
export type V2Dashboard = {
  counts: { zoneCount: number; cameraCount: number; cleanerCount: number; availableCleanerCount: number; alertCount: number; activeAlertCount: number; workCount: number; activeWorkCount: number; onlineCameraCount: number };
  topAlerts: Array<{ alertId: string; zoneId: string | null; zoneNameSnapshot: string; issueType: string; status: string; severity: string; priority: number; createdAt: string | null }>;
  busyZones: Array<{ zoneId: string; zoneName: string; score: number; rawPeoplePressure: number; activeWorkPoints: number; rank: number }>;
  availableCleaners: V2Cleaner[];
  assignedWork: V2WorkOrder[];
  generatedAt: string;
};
export type V2AlertDetail = { alert: V2Alert; events: Array<Record<string, unknown>>; occurrences: Array<Record<string, unknown>>; flags: Array<Record<string, unknown>> };
export type V2WorkDetail = { workOrder: V2WorkOrder; alert?: V2Alert; events: Array<Record<string, unknown>>; verifications: Array<Record<string, unknown>> };
export type V2CameraDetail = {
  camera: V2Camera & { activeMapRevisionId: string };
  currentAssignments: V2WorkOrder[];
  recentHistory: Array<{ type: "alert" | "work"; id: string; status: string; severity: string; issueType: string; assignedCleanerName: string | null; occurredAt: string | null; snapshot: { mediaId: string; contentUrl: string } | null }>;
  orchestratorTrace: Array<{ id: string; type: "assignment" | "review"; status: string; resultCode: string | null; alertId: string | null; workOrderId: string | null; selectedCleanerId: string | null; decisionSummary: string | null; decisionFactors: Record<string, unknown>; provider: string | null; model: string | null; errorCode: string | null; startedAt: string | null; completedAt: string | null; createdAt: string | null }>;
  auditEvents: Array<{ id: string; action?: string; outcome?: string; reason?: string | null; occurredAt: string | null }>;
};
export type V2CameraRemoval = { cameraId: string; status: "removed"; mapRevisionId: string; cameraRevision: number; dismissedAlertCount: number; dismissedWorkCount: number; discardedDraftCount: number; replayed: boolean };

export type V2OperationsReadModel = {
  dashboard: V2Dashboard;
  siteMap: { siteId: string; siteName: string; activeRevisionId: string; background?: SiteMapBackground | null; revision: { widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId?: string | null; backgroundTransform?: SiteBackgroundTransform | null }; zones: V2Zone[]; cameraPlacements: Array<{ id: string; cameraId: string; cameraNameSnapshot?: string; zoneId: string; point: V2Point }>; cleanerStations: Array<{ id: string; cleanerId: string; cleanerNameSnapshot?: string; zoneId: string | null; point: V2Point }> };
  alerts: V2Alert[];
  cleaners: V2Cleaner[];
  workOrders: V2WorkOrder[];
  cameras: V2Camera[];
};

export const getV2DashboardResource = async (signal?: AbortSignal) => (await v2Request<{ dashboard: V2Dashboard }>("/api/dashboard/v2", { signal })).dashboard;
export const getV2SiteMapResource = async (signal?: AbortSignal) => (await v2Request<{ map: V2OperationsReadModel["siteMap"] }>("/api/site-map", { signal })).map;
const pageUrl = (path: string, input: Record<string, string | number | undefined>) => { const query = new URLSearchParams(); Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); }); return `${path}?${query}`; };
const normalizePage = <T>(response: { items?: T[]; nextCursor: string | null; hasMore: boolean; totalCount: number }, fallback: T[]): V2ListPage<T> => ({ items: response.items ?? fallback, nextCursor: response.nextCursor, hasMore: response.hasMore, totalCount: response.totalCount });
export const getV2AlertsPage = (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; severity?: string } = {}, signal?: AbortSignal) => { const url = pageUrl("/api/alerts", { limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await v2Request<{ alerts: V2Alert[]; items?: V2Alert[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return normalizePage(response, response.alerts); }, 30_000, signal); };
export const getV2CleanersPage = (input: { limit?: number; cursor?: string; status?: string } = {}, signal?: AbortSignal) => { const url = pageUrl("/api/cleaners", { limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await v2Request<{ cleaners: V2Cleaner[]; items?: V2Cleaner[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return normalizePage(response, response.cleaners); }, 30_000, signal); };
export const getV2WorkOrdersPage = (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; cleanerId?: string; origin?: string } = {}, signal?: AbortSignal): Promise<V2WorkOrderPage> => { const url = pageUrl("/api/work-orders", { status: input.status ?? "all", limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await v2Request<{ workOrders: V2WorkOrder[]; items?: V2WorkOrder[]; nextCursor: string | null; hasMore: boolean; totalCount: number; statusCounts: V2WorkStatusCounts }>(url); return { ...normalizePage(response, response.workOrders), statusCounts: response.statusCounts }; }, 30_000, signal); };
export const getV2AlertsResource = async (signal?: AbortSignal) => (await getV2AlertsPage({}, signal)).items;
export const getV2CleanersResource = async (signal?: AbortSignal) => (await getV2CleanersPage({}, signal)).items;
export const getV2WorkOrdersResource = async (signal?: AbortSignal) => (await getV2WorkOrdersPage({}, signal)).items;
export const getV2CamerasResource = async (signal?: AbortSignal) => (await v2Request<{ cameras: V2Camera[] }>("/api/camera-creation/cameras", { signal })).cameras;

export async function getV2OperationsReadModel(signal?: AbortSignal): Promise<V2OperationsReadModel> {
  const [dashboard, siteMap, alerts, cleaners, workOrders, cameras] = await Promise.all([
    getV2DashboardResource(signal),
    getV2SiteMapResource(signal),
    getV2AlertsResource(signal),
    getV2CleanersResource(signal),
    getV2WorkOrdersResource(signal),
    getV2CamerasResource(signal),
  ]);
  return { dashboard, siteMap, alerts, cleaners, workOrders, cameras };
}

export async function getV2AlertDetail(alertId: string, signal?: AbortSignal) {
  return v2Request<V2AlertDetail>(`/api/alerts/${encodeURIComponent(alertId)}`, { signal });
}

export async function getV2WorkDetail(workOrderId: string, signal?: AbortSignal): Promise<V2WorkDetail> {
  const work = await v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(workOrderId)}`, { signal });
  const [events, verifications, alert] = await Promise.all([
    v2Request<{ events: Array<Record<string, unknown>> }>(`/api/work-orders/${encodeURIComponent(workOrderId)}/history`, { signal }),
    v2Request<{ verifications: Array<Record<string, unknown>> }>(`/api/work-orders/${encodeURIComponent(workOrderId)}/verifications`, { signal }),
    work.workOrder.alertId ? getV2AlertDetail(work.workOrder.alertId, signal).then((result) => result.alert) : Promise.resolve(undefined),
  ]);
  return { workOrder: work.workOrder, alert, events: events.events, verifications: verifications.verifications };
}

export const getV2CameraDetail = (cameraId: string, signal?: AbortSignal) => v2Request<V2CameraDetail>(`/api/camera-creation/cameras/${encodeURIComponent(cameraId)}/detail`, { signal });
export const removeV2CameraFromSite = (camera: V2Camera & { activeMapRevisionId: string }, reason: string, idempotencyKey = createIdempotencyKey("remove-camera")) => v2Request<{ removal: V2CameraRemoval }>(`/api/camera-creation/cameras/${encodeURIComponent(camera.id)}/remove`, { method: "POST", json: { reason, confirmation: true, expectedCameraRevision: camera.revision, expectedMapRevisionId: camera.activeMapRevisionId, idempotencyKey } });

export const assignV2Alert = (alertId: string, assignedCleanerId: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/alerts/${encodeURIComponent(alertId)}/manual-assignment`, { method: "POST", json: { assignedCleanerId, idempotencyKey: createIdempotencyKey("assign-alert") } });
export const dismissV2Alert = (alert: V2Alert, reason: string) => v2Request<{ alertId: string; status: string }>(`/api/alerts/${encodeURIComponent(alert.id)}/dismiss`, { method: "POST", json: { reason, expectedRevision: alert.revision } });
export const createV2ManualWork = (input: { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: { type: "camera"; cameraId: string } | { type: "coordinate"; point: V2Point } }) => v2Request<{ workOrder: V2WorkOrder }>("/api/work-orders/manual", { method: "POST", json: { ...input, idempotencyKey: createIdempotencyKey("manual-work") } });
export const reassignV2Work = (work: V2WorkOrder, assignedCleanerId: string, reason: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/reassign`, { method: "POST", json: { assignedCleanerId, reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("reassign-work") } });
export const takeOverV2Work = (work: V2WorkOrder, reason: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/takeover`, { method: "POST", json: { reason, idempotencyKey: createIdempotencyKey("takeover-work") } });
export const dismissV2Work = (work: V2WorkOrder, reason: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/dismiss`, { method: "POST", json: { reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("dismiss-work") } });
export const verifyV2Work = (work: V2WorkOrder, outcome: "passed" | "failed" | "inconclusive", reason?: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/verification`, { method: "POST", json: { outcome, reason: reason ?? null, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("verify-work") } });
export const overrideV2Verification = (work: V2WorkOrder, outcome: "passed" | "failed" | "inconclusive", reason: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/verification/override`, { method: "POST", json: { outcome, reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("override-review") } });

export type V2WeeklySchedule = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { startMinute: number; endMinute: number } | null>;

export type CreateV2CleanerInput = {
  staffCode: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  weeklySchedule: V2WeeklySchedule;
  stationPoint: V2Point;
};

export const createV2Cleaner = (input: CreateV2CleanerInput) => v2Request<{ cleaner: V2Cleaner }>("/api/cleaners", {
  method: "POST",
  json: { ...input, idempotencyKey: createIdempotencyKey("create-cleaner") },
});

export const updateV2Cleaner = (cleaner: V2Cleaner, input: Partial<Pick<V2Cleaner, "fullName" | "phone" | "weeklySchedule" | "status">> & { availabilityOverride?: "none" | "unavailable" }) => v2Request<{ cleaner: V2Cleaner }>(`/api/cleaners/${encodeURIComponent(cleaner.id)}`, {
  method: "PATCH",
  json: { ...input, expectedRevision: cleaner.revision },
});

export const updateV2CleanerStation = (cleanerId: string, point: V2Point) => v2Request<{ station: { cleanerId: string; point: V2Point } }>(`/api/site-map/station-points/${encodeURIComponent(cleanerId)}`, {
  method: "PUT",
  json: { point },
});

export type V2CameraDraft = {
  id: string;
  cameraId: string;
  kind: "create" | "reconfigure" | "physical_move";
  name: string;
  description: string | null;
  baseMapRevisionId: string;
  placement: { point: V2Point; zoneId: string } | null;
  provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: V2Point[] } | null;
  source: { type: "laptop_camera" | "looped_video"; sourceMediaId: string | null; sampleIntervalSeconds: number; isSimulation: boolean };
  referenceMediaId?: string;
  registration: { referenceMediaId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: V2RegisteredBin[] } | null;
  validationStatus: "not_validated" | "valid" | "invalid";
  validationErrors: string[];
  status: "draft" | "published";
};

export type V2RegisteredBin = { binId: string; displayName: string; binType: "open_top" | "lidded" | "unknown"; binPolygon: Array<{ x: number; y: number }> };
export type V2CameraReference = { mediaId: string; contentUrl: string; mimeType: string };
export type V2CameraSource = V2CameraReference & { durationSeconds: number; width: number; height: number };
export type V2CameraRegistrationInput = { sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: V2RegisteredBin[] };

export const startV2CameraDraft = (input: { kind: "create" | "reconfigure"; cameraId?: string; name: string; description?: string | null; sourceType: "laptop_camera" | "looped_video"; placement?: { point: V2Point } | null; provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: V2Point[] } | null }) => v2Request<{ draft: V2CameraDraft }>("/api/camera-creation/drafts/start", { method: "POST", json: input });
export const getV2CameraDraft = (draftId: string) => v2Request<{ draft: V2CameraDraft }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}`);
export const getV2CameraDraftForCamera = (cameraId: string, signal?: AbortSignal) => v2Request<{ draft: V2CameraDraft | null }>(`/api/camera-creation/cameras/${encodeURIComponent(cameraId)}/draft`, { signal });
export const uploadV2CameraDraftReference = (draftId: string, image: File) => { const body = new FormData(); body.append("image", image, image.name); return v2Request<{ reference: V2CameraReference }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/reference`, { method: "POST", body }); };
export const uploadV2CameraDraftSourceVideo = (draftId: string, video: File) => { const body = new FormData(); body.append("video", video, video.name); return v2Request<{ source: V2CameraSource }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/source-video`, { method: "POST", body }); };
export const saveV2CameraDraftRegistration = (draftId: string, input: V2CameraRegistrationInput) => v2Request<{ registration: V2CameraDraft["registration"] }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/registration`, { method: "PUT", json: input });
export const validateV2CameraDraft = (draftId: string) => v2Request<{ valid: boolean; errors: string[] }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/validate`, { method: "POST", json: {} });
export const publishV2CameraDraft = (draftId: string) => v2Request<{ result: { cameraId: string; draftId: string } }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/publish`, { method: "POST", json: {} });
export const deleteV2CameraDraft = (draftId: string) => v2Request<void>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });

export type V2SiteMapDraftInput = {
  baseRevisionId: string;
  widthMeters: number;
  heightMeters: number;
  gridSizeMeters: number;
  backgroundMediaId?: string | null;
  backgroundTransform?: Record<string, number> | null;
  zones: Array<{ zoneId: string; zoneNameSnapshot: string; polygon: V2Point[] }>;
  cameraPlacements: Array<{ id: string; point: V2Point }>;
  cleanerStations: Array<{ id: string; point: V2Point }>;
};
export const saveV2SiteMapDraft = (input: V2SiteMapDraftInput) => v2Request<{ draft: Record<string, unknown> }>("/api/site-map/draft", { method: "POST", json: input });
export const validateV2SiteMapDraft = () => v2Request<{ valid: boolean; errors: string[] }>("/api/site-map/draft/validate", { method: "POST", json: {} });
export const publishV2SiteMapDraft = () => v2Request<{ map: V2OperationsReadModel["siteMap"] }>("/api/site-map/draft/publish", { method: "POST", json: {} });
export const deleteV2SiteMapDraft = () => v2Request<void>("/api/site-map/draft", { method: "DELETE" });
export const setV2CameraMonitoring = (camera: V2Camera, monitoringEnabled: boolean) => v2Request<{ cameraId: string; monitoringEnabled: boolean }>(`/api/camera-creation/cameras/${encodeURIComponent(camera.id)}/monitoring`, { method: "PATCH", json: { monitoringEnabled, expectedRevision: camera.revision } });

export type V2MonitoringLease = { sessionId: string; leaseToken: string; leaseSeconds: number };
export type V2MonitoringEpisode = { episodeId: string; nextSequence: number; isSimulation: boolean };
export type V2LiveObservation = { peopleCount: number; people: Array<{ confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>; bins: Array<{ binId: string; state: string; confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>; issues: Array<{ issueType: string; condition: string; confidence: number; entityId: string; geometry: unknown }>; image: { width: number; height: number }; processingTimeMs: number; isSimulation: boolean };
export const claimV2MonitoringSession = () => v2Request<V2MonitoringLease>("/api/monitoring/sessions/claim", { method: "POST", json: {} });
export const heartbeatV2MonitoringSession = (lease: V2MonitoringLease) => v2Request<{ ok: true }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/heartbeat`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const releaseV2MonitoringSession = (lease: V2MonitoringLease) => v2Request<{ ok: true }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/release`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const startV2MonitoringEpisode = (lease: V2MonitoringLease, cameraId: string) => v2Request<V2MonitoringEpisode>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/cameras/${encodeURIComponent(cameraId)}/start`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const submitV2MonitoringSample = (lease: V2MonitoringLease, cameraId: string, episodeId: string, sequence: number, frame: File) => { const body = new FormData(); body.append("episodeId", episodeId); body.append("sequence", String(sequence)); body.append("capturedAt", new Date().toISOString()); body.append("frame", frame, frame.name); return v2Request<{ accepted: boolean; sequence: number; observation: V2LiveObservation }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/cameras/${encodeURIComponent(cameraId)}/samples`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, body }); };
