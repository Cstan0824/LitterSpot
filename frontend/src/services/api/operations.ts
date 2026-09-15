import { apiRequest } from "./http";
import { createIdempotencyKey } from "./idempotency";
import type { CameraObservation } from "../../../../shared/cameraMonitoring";
import type { SiteBackgroundTransform, SiteMapBackground } from "./siteMap";
import { cachedPageRequest, type ListPage } from "./pagination";

export type OperationsPoint = { xMeters: number; yMeters: number };
export type OperationsZone = { id: string; zoneId: string; zoneNameSnapshot: string; polygon: OperationsPoint[] };
export type OperationsCamera = {
  description?: string | null;
  id: string; name: string; status: "active" | "inactive" | "removed"; monitoringEnabled: boolean; sourceType: "laptop_camera" | "looped_video";
  isSimulation: boolean; placement: { zoneId: string; point: OperationsPoint } | null;
  runtime: { connectionStatus?: string; cleanlinessState?: string; lastPeopleCount?: number; lastSampleAcceptedAt?: string | null } | null;
  source: { contentUrl: string | null; sourceMediaId?: string | null; type?: "laptop_camera" | "looped_video"; durationSeconds?: number; width?: number; height?: number } | null;
  registration: { status?: string; binCount?: number; referenceMediaId?: string | null; sourceWidth?: number; sourceHeight?: number; walkableFloorPolygon?: Array<{ x: number; y: number }>; bins?: RegisteredBin[] } | null;
  revision: number;
};
export type OperationsCleaner = {
  id: string; fullName: string; staffCode: string; phone: string; status: "active" | "inactive"; notes: string | null;
  stationPoint: OperationsPoint | null; stationZoneId: string | null; weeklySchedule: Record<string, { startMinute: number; endMinute: number } | null>;
  availability: { available: boolean; reasons: string[] }; availabilityOverride?: "none" | "unavailable"; activeWorkOrderId: string | null;
  scheduleTimeZone?: string; profileMediaId?: string | null; createdAt?: string | null; updatedAt?: string | null; revision: number;
};
export type OperationsAlert = {
  id: string; issueType: string; observedCondition: string; status: string; severity: "warning" | "critical"; priorityScore: number;
  cameraId: string | null; cameraNameSnapshot: string; zoneId: string | null; zoneNameSnapshot: string; createdAt: string | null; updatedAt: string | null;
  evidence: { mediaId: string; confidence?: number; capturedAt?: string; detections?: unknown[]; observation?: CameraObservation } | null; activeWorkOrderId: string | null; isSimulation: boolean; revision: number;
};
export type OperationsWorkOrder = {
  id: string; origin: "alert" | "manual"; alertId: string | null; managementMode: string; status: string; severity: "warning" | "critical";
  issueType: string; title: string; instructions: string; assignedCleanerId: string; cleanerNameSnapshot: string;
  zoneId: string | null; cameraId: string | null; target: { type: "camera" | "coordinate"; zoneId?: string | null; zoneNameSnapshot: string; point: OperationsPoint | null; cameraNameSnapshot?: string | null };
  assignedAt?: string | null; createdAt: string | null; updatedAt: string | null; submittedAt: string | null; resolvedAt: string | null; completionEvidenceMediaId: string | null;
  latestVerificationId: string | null; latestVerificationOutcome: string | null; reworkCount: number; revision: number;
};
export type OperationsWorkStatusCounts = Record<"assigned" | "in_progress" | "awaiting_review" | "resolved" | "dismissed", number>;
export type OperationsWorkOrderPage = ListPage<OperationsWorkOrder> & { statusCounts: OperationsWorkStatusCounts };
export type OperationsDashboard = {
  counts: { zoneCount: number; cameraCount: number; cleanerCount: number; availableCleanerCount: number; alertCount: number; activeAlertCount: number; workCount: number; activeWorkCount: number; onlineCameraCount: number };
  topAlerts: Array<{ alertId: string; zoneId: string | null; zoneNameSnapshot: string; issueType: string; status: string; severity: string; priority: number; createdAt: string | null }>;
  busyZones: Array<{ zoneId: string; zoneName: string; score: number; rawPeoplePressure: number; activeWorkPoints: number; rank: number }>;
  availableCleaners: OperationsCleaner[];
  assignedWork: OperationsWorkOrder[];
  generatedAt: string;
};
export type OperationsAlertDetail = { alert: OperationsAlert; events: Array<Record<string, unknown>>; occurrences: Array<Record<string, unknown>>; flags: Array<Record<string, unknown>> };
export type OperationsWorkDetail = { workOrder: OperationsWorkOrder; alert?: OperationsAlert; events: Array<Record<string, unknown>>; verifications: Array<Record<string, unknown>> };
export type OperationsCameraDetail = {
  camera: OperationsCamera & { activeMapRevisionId: string };
  currentAssignments: OperationsWorkOrder[];
  recentHistory: Array<{ type: "alert" | "work"; id: string; status: string; severity: string; issueType: string; assignedCleanerName: string | null; occurredAt: string | null; snapshot: { mediaId: string; contentUrl: string } | null }>;
  orchestratorTrace: Array<{ id: string; type: "assignment" | "review"; status: string; resultCode: string | null; alertId: string | null; workOrderId: string | null; selectedCleanerId: string | null; decisionSummary: string | null; decisionFactors: Record<string, unknown>; provider: string | null; model: string | null; errorCode: string | null; startedAt: string | null; completedAt: string | null; createdAt: string | null }>;
  auditEvents: Array<{ id: string; action?: string; outcome?: string; reason?: string | null; occurredAt: string | null }>;
};
export type CameraRemovalResult = { cameraId: string; status: "removed"; mapRevisionId: string; cameraRevision: number; dismissedAlertCount: number; dismissedWorkCount: number; discardedDraftCount: number; replayed: boolean };

export type OperationsReadModel = {
  dashboard: OperationsDashboard;
  siteMap: { siteId: string; siteName: string; activeRevisionId: string; background?: SiteMapBackground | null; revision: { widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId?: string | null; backgroundTransform?: SiteBackgroundTransform | null }; zones: OperationsZone[]; cameraPlacements: Array<{ id: string; cameraId: string; cameraNameSnapshot?: string; zoneId: string; point: OperationsPoint }>; cleanerStations: Array<{ id: string; cleanerId: string; cleanerNameSnapshot?: string; zoneId: string | null; point: OperationsPoint }> };
  alerts: OperationsAlert[];
  cleaners: OperationsCleaner[];
  workOrders: OperationsWorkOrder[];
  cameras: OperationsCamera[];
};

export const getDashboardResource = async (signal?: AbortSignal) => (await apiRequest<{ dashboard: OperationsDashboard }>("/api/dashboard", { signal })).dashboard;
export const getSiteMapResource = async (signal?: AbortSignal) => (await apiRequest<{ map: OperationsReadModel["siteMap"] }>("/api/site-map", { signal })).map;
const pageUrl = (path: string, input: Record<string, string | number | undefined>) => { const query = new URLSearchParams(); Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); }); return `${path}?${query}`; };
const normalizePage = <T>(response: { items?: T[]; nextCursor: string | null; hasMore: boolean; totalCount: number }, fallback: T[]): ListPage<T> => ({ items: response.items ?? fallback, nextCursor: response.nextCursor, hasMore: response.hasMore, totalCount: response.totalCount });
export const getAlertsPage = (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; severity?: string } = {}, signal?: AbortSignal) => { const url = pageUrl("/api/alerts", { limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await apiRequest<{ alerts: OperationsAlert[]; items?: OperationsAlert[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return normalizePage(response, response.alerts); }, 30_000, signal); };
export const getCleanersPage = (input: { limit?: number; cursor?: string; status?: string } = {}, signal?: AbortSignal) => { const url = pageUrl("/api/cleaners", { limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await apiRequest<{ cleaners: OperationsCleaner[]; items?: OperationsCleaner[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return normalizePage(response, response.cleaners); }, 30_000, signal); };
export const getWorkOrdersPage = (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; cleanerId?: string; origin?: string } = {}, signal?: AbortSignal): Promise<OperationsWorkOrderPage> => { const url = pageUrl("/api/work-orders", { status: input.status ?? "all", limit: input.limit ?? 25, ...input }); return cachedPageRequest(url, async () => { const response = await apiRequest<{ workOrders: OperationsWorkOrder[]; items?: OperationsWorkOrder[]; nextCursor: string | null; hasMore: boolean; totalCount: number; statusCounts: OperationsWorkStatusCounts }>(url); return { ...normalizePage(response, response.workOrders), statusCounts: response.statusCounts }; }, 30_000, signal); };
export const getAlertsResource = async (signal?: AbortSignal) => (await getAlertsPage({}, signal)).items;
export const getCleanersResource = async (signal?: AbortSignal) => (await getCleanersPage({}, signal)).items;
export const getWorkOrdersResource = async (signal?: AbortSignal) => (await getWorkOrdersPage({}, signal)).items;
export const getCamerasResource = async (signal?: AbortSignal) => (await apiRequest<{ cameras: OperationsCamera[] }>("/api/camera-creation/cameras", { signal })).cameras;

export async function getOperationsReadModel(signal?: AbortSignal): Promise<OperationsReadModel> {
  const [dashboard, siteMap, alerts, cleaners, workOrders, cameras] = await Promise.all([
    getDashboardResource(signal),
    getSiteMapResource(signal),
    getAlertsResource(signal),
    getCleanersResource(signal),
    getWorkOrdersResource(signal),
    getCamerasResource(signal),
  ]);
  return { dashboard, siteMap, alerts, cleaners, workOrders, cameras };
}

export async function fetchAlertDetail(alertId: string, signal?: AbortSignal) {
  return apiRequest<OperationsAlertDetail>(`/api/alerts/${encodeURIComponent(alertId)}`, { signal });
}

export async function fetchWorkDetail(workOrderId: string, signal?: AbortSignal): Promise<OperationsWorkDetail> {
  const work = await apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(workOrderId)}`, { signal });
  const [events, verifications, alert] = await Promise.all([
    apiRequest<{ events: Array<Record<string, unknown>> }>(`/api/work-orders/${encodeURIComponent(workOrderId)}/history`, { signal }),
    apiRequest<{ verifications: Array<Record<string, unknown>> }>(`/api/work-orders/${encodeURIComponent(workOrderId)}/verifications`, { signal }),
    work.workOrder.alertId ? fetchAlertDetail(work.workOrder.alertId, signal).then((result) => result.alert) : Promise.resolve(undefined),
  ]);
  return { workOrder: work.workOrder, alert, events: events.events, verifications: verifications.verifications };
}

export const fetchCameraDetail = (cameraId: string, signal?: AbortSignal) => apiRequest<OperationsCameraDetail>(`/api/camera-creation/cameras/${encodeURIComponent(cameraId)}/detail`, { signal });
export const removeCameraFromSite = (camera: OperationsCamera & { activeMapRevisionId: string }, reason: string, idempotencyKey = createIdempotencyKey("remove-camera")) => apiRequest<{ removal: CameraRemovalResult }>(`/api/camera-creation/cameras/${encodeURIComponent(camera.id)}/remove`, { method: "POST", json: { reason, confirmation: true, expectedCameraRevision: camera.revision, expectedMapRevisionId: camera.activeMapRevisionId, idempotencyKey } });

export const assignAlertToCleaner = (alertId: string, assignedCleanerId: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/alerts/${encodeURIComponent(alertId)}/manual-assignment`, { method: "POST", json: { assignedCleanerId, idempotencyKey: createIdempotencyKey("assign-alert") } });
export const dismissAlertRecord = (alert: OperationsAlert, reason: string) => apiRequest<{ alertId: string; status: string }>(`/api/alerts/${encodeURIComponent(alert.id)}/dismiss`, { method: "POST", json: { reason, expectedRevision: alert.revision } });
export const createManualWorkOrder = (input: { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: { type: "camera"; cameraId: string } | { type: "coordinate"; point: OperationsPoint } }) => apiRequest<{ workOrder: OperationsWorkOrder }>("/api/work-orders/manual", { method: "POST", json: { ...input, idempotencyKey: createIdempotencyKey("manual-work") } });
export const reassignWorkOrder = (work: OperationsWorkOrder, assignedCleanerId: string, reason: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/reassign`, { method: "POST", json: { assignedCleanerId, reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("reassign-work") } });
export const takeOverWorkOrder = (work: OperationsWorkOrder, reason: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/takeover`, { method: "POST", json: { reason, idempotencyKey: createIdempotencyKey("takeover-work") } });
export const dismissWorkOrder = (work: OperationsWorkOrder, reason: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/dismiss`, { method: "POST", json: { reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("dismiss-work") } });
export const verifyWorkOrder = (work: OperationsWorkOrder, outcome: "passed" | "failed" | "inconclusive", reason?: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/verification`, { method: "POST", json: { outcome, reason: reason ?? null, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("verify-work") } });
export const overrideWorkVerification = (work: OperationsWorkOrder, outcome: "passed" | "failed" | "inconclusive", reason: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/work-orders/${encodeURIComponent(work.id)}/verification/override`, { method: "POST", json: { outcome, reason, expectedRevision: work.revision, idempotencyKey: createIdempotencyKey("override-review") } });

export type WeeklySchedule = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { startMinute: number; endMinute: number } | null>;

export type CreateCleanerInput = {
  staffCode: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  weeklySchedule: WeeklySchedule;
  stationPoint: OperationsPoint;
};

export const createCleanerAccount = (input: CreateCleanerInput) => apiRequest<{ cleaner: OperationsCleaner }>("/api/cleaners", {
  method: "POST",
  json: { ...input, idempotencyKey: createIdempotencyKey("create-cleaner") },
});

export const updateCleanerAccount = (cleaner: OperationsCleaner, input: Partial<Pick<OperationsCleaner, "fullName" | "phone" | "weeklySchedule" | "status">> & { availabilityOverride?: "none" | "unavailable" }) => apiRequest<{ cleaner: OperationsCleaner }>(`/api/cleaners/${encodeURIComponent(cleaner.id)}`, {
  method: "PATCH",
  json: { ...input, expectedRevision: cleaner.revision },
});

export const updateCleanerStation = (cleanerId: string, point: OperationsPoint) => apiRequest<{ station: { cleanerId: string; point: OperationsPoint } }>(`/api/site-map/station-points/${encodeURIComponent(cleanerId)}`, {
  method: "PUT",
  json: { point },
});

export type CameraDraft = {
  id: string;
  cameraId: string;
  kind: "create" | "reconfigure" | "physical_move";
  name: string;
  description: string | null;
  baseMapRevisionId: string;
  placement: { point: OperationsPoint; zoneId: string } | null;
  provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: OperationsPoint[] } | null;
  source: { type: "laptop_camera" | "looped_video"; sourceMediaId: string | null; sampleIntervalSeconds: number; isSimulation: boolean };
  referenceMediaId?: string;
  registration: { referenceMediaId: string; sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: RegisteredBin[] } | null;
  validationStatus: "not_validated" | "valid" | "invalid";
  validationErrors: string[];
  status: "draft" | "published";
};

export type RegisteredBin = { binId: string; displayName: string; binType: "open_top" | "lidded" | "unknown"; binPolygon: Array<{ x: number; y: number }> };
export type CameraReference = { mediaId: string; contentUrl: string; mimeType: string };
export type CameraSource = CameraReference & { durationSeconds: number; width: number; height: number };
export type CameraRegistrationInput = { sourceWidth: number; sourceHeight: number; walkableFloorPolygon: Array<{ x: number; y: number }>; bins: RegisteredBin[] };

export const startCameraDraft = (input: { kind: "create" | "reconfigure"; cameraId?: string; name: string; description?: string | null; sourceType: "laptop_camera" | "looped_video"; placement?: { point: OperationsPoint } | null; provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: OperationsPoint[] } | null }) => apiRequest<{ draft: CameraDraft }>("/api/camera-creation/drafts/start", { method: "POST", json: input });
export const getCameraDraft = (draftId: string) => apiRequest<{ draft: CameraDraft }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}`);
export const getCameraDraftForCamera = (cameraId: string, signal?: AbortSignal) => apiRequest<{ draft: CameraDraft | null }>(`/api/camera-creation/cameras/${encodeURIComponent(cameraId)}/draft`, { signal });
export const uploadCameraDraftReference = (draftId: string, image: File) => { const body = new FormData(); body.append("image", image, image.name); return apiRequest<{ reference: CameraReference }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/reference`, { method: "POST", body }); };
export const uploadCameraDraftSourceVideo = (draftId: string, video: File) => { const body = new FormData(); body.append("video", video, video.name); return apiRequest<{ source: CameraSource }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/source-video`, { method: "POST", body }); };
export const saveCameraDraftRegistration = (draftId: string, input: CameraRegistrationInput) => apiRequest<{ registration: CameraDraft["registration"] }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/registration`, { method: "PUT", json: input });
export const validateCameraDraft = (draftId: string) => apiRequest<{ valid: boolean; errors: string[] }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/validate`, { method: "POST", json: {} });
export const publishCameraDraft = (draftId: string) => apiRequest<{ result: { cameraId: string; draftId: string } }>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}/publish`, { method: "POST", json: {} });
export const deleteCameraDraft = (draftId: string) => apiRequest<void>(`/api/camera-creation/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });

export type SiteMapDraftInput = {
  baseRevisionId: string;
  widthMeters: number;
  heightMeters: number;
  gridSizeMeters: number;
  backgroundMediaId?: string | null;
  backgroundTransform?: Record<string, number> | null;
  zones: Array<{ zoneId: string; zoneNameSnapshot: string; polygon: OperationsPoint[] }>;
  cameraPlacements: Array<{ id: string; point: OperationsPoint }>;
  cleanerStations: Array<{ id: string; point: OperationsPoint }>;
};
export const saveSiteMapDraft = (input: SiteMapDraftInput) => apiRequest<{ draft: Record<string, unknown> }>("/api/site-map/draft", { method: "POST", json: input });
export const validateSiteMapDraft = () => apiRequest<{ valid: boolean; errors: string[] }>("/api/site-map/draft/validate", { method: "POST", json: {} });
export const publishSiteMapDraft = () => apiRequest<{ map: OperationsReadModel["siteMap"] }>("/api/site-map/draft/publish", { method: "POST", json: {} });
export const deleteSiteMapDraft = () => apiRequest<void>("/api/site-map/draft", { method: "DELETE" });
export const setCameraMonitoring = (camera: OperationsCamera, monitoringEnabled: boolean) => apiRequest<{ cameraId: string; monitoringEnabled: boolean }>(`/api/camera-creation/cameras/${encodeURIComponent(camera.id)}/monitoring`, { method: "PATCH", json: { monitoringEnabled, expectedRevision: camera.revision } });

export type MonitoringLease = { sessionId: string; leaseToken: string; leaseSeconds: number };
export type MonitoringEpisode = { episodeId: string; nextSequence: number; isSimulation: boolean };
export type LiveObservation = { peopleCount: number; people: Array<{ confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>; bins: Array<{ binId: string; state: string; confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>; issues: Array<{ issueType: string; condition: string; confidence: number; entityId: string; geometry: unknown }>; image: { width: number; height: number }; processingTimeMs: number; isSimulation: boolean };
export const claimMonitoringSession = () => apiRequest<MonitoringLease>("/api/monitoring/sessions/claim", { method: "POST", json: {} });
export const heartbeatMonitoringSession = (lease: MonitoringLease) => apiRequest<{ ok: true }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/heartbeat`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const releaseMonitoringSession = (lease: MonitoringLease) => apiRequest<{ ok: true }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/release`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const startMonitoringEpisode = (lease: MonitoringLease, cameraId: string) => apiRequest<MonitoringEpisode>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/cameras/${encodeURIComponent(cameraId)}/start`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, json: {} });
export const submitMonitoringSample = (lease: MonitoringLease, cameraId: string, episodeId: string, sequence: number, frame: File) => { const body = new FormData(); body.append("episodeId", episodeId); body.append("sequence", String(sequence)); body.append("capturedAt", new Date().toISOString()); body.append("frame", frame, frame.name); return apiRequest<{ accepted: boolean; sequence: number; observation: LiveObservation }>(`/api/monitoring/sessions/${encodeURIComponent(lease.sessionId)}/cameras/${encodeURIComponent(cameraId)}/samples`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, body }); };
