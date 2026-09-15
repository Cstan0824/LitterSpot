import { apiRequest } from "./http";
import type { SiteMapPoint, SiteMapPolygon, ZoneConflictReason } from "./mapGeometry";

export type SiteBackgroundTransform = { xMeters: number; yMeters: number; widthMeters: number; heightMeters: number; opacity: number };
export type SiteMapZone = { id: string; zoneId: string; zoneNameSnapshot: string; polygon: SiteMapPolygon; centroid?: SiteMapPoint | null; areaSquareMeters?: number | null; retiredAt?: string | null };
export type SiteMapCameraPlacement = { id: string; cameraId: string; cameraNameSnapshot?: string; point: SiteMapPoint; zoneId: string; changeMode?: "map_position_correction" | null; changeReason?: string | null; previousPoint?: SiteMapPoint | null; previousZoneId?: string | null };
export type SiteMapCleanerStation = { id: string; cleanerId: string; cleanerNameSnapshot?: string; point: SiteMapPoint; zoneId: string | null };
export type SiteMapRevision = { id: string; revisionNumber: number; widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId: string | null; backgroundTransform: SiteBackgroundTransform | null; coordinateOrigin: "top_left"; xAxisDirection: "right"; yAxisDirection: "down"; publishedAt: string | null };
export type SiteMapBackground = { mediaId: string; contentUrl: string; mimeType: string; width: number; height: number; storageStatus: string };
export type ActiveSiteMap = { siteId: string; siteName: string; siteStatus: string; timeZone: string; activeRevisionId: string; revision: SiteMapRevision; background: SiteMapBackground | null; zones: SiteMapZone[]; cameraPlacements: SiteMapCameraPlacement[]; cleanerStations: SiteMapCleanerStation[] };
export type SiteMapDraft = { id: string; siteId: string; baseRevisionId: string; widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId: string | null; backgroundTransform: SiteBackgroundTransform | null; background?: SiteMapBackground | null; coordinateOrigin: "top_left"; xAxisDirection: "right"; yAxisDirection: "down"; validationStatus: "not_validated" | "valid" | "invalid"; validationErrors: string[]; validationIssues?: SiteMapValidationIssue[]; revision: number; createdAt?: string | null; updatedAt?: string | null; zones: SiteMapZone[]; cameraPlacements: SiteMapCameraPlacement[]; cleanerStations: SiteMapCleanerStation[] };
export type SiteMapValidationIssue = { code: string; kind: "map" | "zone" | "zone_conflict" | "point"; message: string; zoneIds?: string[]; pointLabel?: string; reason?: ZoneConflictReason };
export type SiteMapValidation = { valid: boolean; errors: string[]; issues: SiteMapValidationIssue[]; zoneConflicts: SiteMapValidationIssue[] };
export type SiteMapAuditEvent = { id: string; action: string; resourceType: string; resourceId: string | null; outcome: "succeeded" | "failed"; reason: string | null; errorCode: string | null; actorUid: string; actorRole: string; actorAuthority: string | null; actorNameSnapshot: string; occurredAt: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

export function siteMapBackgroundCacheKey(background: SiteMapBackground | null, sourceUrl: string | null) {
  return `site-map-background:${background?.mediaId ?? sourceUrl ?? "none"}`;
}

export type SiteMapDraftSave = {
  baseRevisionId: string;
  expectedRevision: number;
  widthMeters: number;
  heightMeters: number;
  gridSizeMeters: number;
  backgroundMediaId: string | null;
  backgroundTransform: SiteBackgroundTransform | null;
  zones: Array<{ zoneId: string; zoneNameSnapshot: string; polygon: SiteMapPolygon }>;
  cameraPlacements: Array<{ id: string; point: SiteMapPoint }>;
  cameraPlacementChanges?: Array<{ cameraId: string; mode: "map_position_correction"; reason: string; confirmation: true }>;
  cleanerStations: Array<{ id: string; point: SiteMapPoint }>;
};

function normalizeDraft(response: { draft: Omit<SiteMapDraft, "zones" | "cameraPlacements" | "cleanerStations"> & Partial<Pick<SiteMapDraft, "zones" | "cameraPlacements" | "cleanerStations">>; background?: SiteMapBackground | null; zones?: SiteMapZone[]; cameraPlacements?: SiteMapCameraPlacement[]; cleanerStations?: SiteMapCleanerStation[] }): SiteMapDraft {
  return { ...response.draft, background: response.background ?? response.draft.background ?? null, zones: response.zones ?? response.draft.zones ?? [], cameraPlacements: response.cameraPlacements ?? response.draft.cameraPlacements ?? [], cleanerStations: response.cleanerStations ?? response.draft.cleanerStations ?? [] };
}

export const getActiveSiteMap = (signal?: AbortSignal) => apiRequest<{ map: ActiveSiteMap }>("/api/site-map", { signal }).then((response) => response.map);
export const getSiteMapDraft = (signal?: AbortSignal) => apiRequest<Parameters<typeof normalizeDraft>[0]>("/api/site-map/draft", { signal }).then(normalizeDraft);
export const getRetiredSiteMapZones = (signal?: AbortSignal) => apiRequest<{ zones: SiteMapZone[] }>("/api/site-map/retired-zones", { signal }).then((response) => response.zones);
export const startSiteMapDraft = () => apiRequest<{ draft: SiteMapDraft }>("/api/site-map/draft/start", { method: "POST", json: {} }).then((response) => normalizeDraft({ draft: response.draft }));
export const saveSiteMapDraft = (input: SiteMapDraftSave) => apiRequest<Parameters<typeof normalizeDraft>[0]>("/api/site-map/draft", { method: "POST", json: input }).then(normalizeDraft);
export const validateSiteMapDraft = () => apiRequest<SiteMapValidation>("/api/site-map/draft/validate", { method: "POST", json: {} });
export const publishSiteMapDraft = () => apiRequest<{ map: ActiveSiteMap }>("/api/site-map/draft/publish", { method: "POST", json: {} }).then((response) => response.map);
export const discardSiteMapDraft = () => apiRequest<void>("/api/site-map/draft", { method: "DELETE" });
export const uploadSiteMapBackground = (image: File) => { const body = new FormData(); body.append("image", image, image.name); return apiRequest<{ background: SiteMapBackground }>("/api/site-map/background", { method: "POST", body }).then((response) => response.background); };
export const getSiteMapAuditEvents = (signal?: AbortSignal) => apiRequest<{ events: SiteMapAuditEvent[] }>("/api/operations/v2/audit-events", { signal }).then((response) => response.events);
export type CameraPlacementChangeResult = { mode: "map_position_correction" | "physical_camera_move"; status: "published" | "registration_required"; cameraId: string; zoneId: string; point: SiteMapPoint; mapRevisionId?: string; cameraRevision?: number; draft?: import("./operations").CameraDraft };
export const changeSiteMapCameraPlacement = (input: { cameraId: string; point: SiteMapPoint; mode: "map_position_correction" | "physical_camera_move"; reason: string; expectedCameraRevision: number; expectedMapRevisionId: string; provisionalZone?: { zoneId: string; zoneNameSnapshot: string; polygon: SiteMapPolygon } | null }) => apiRequest<{ placement: CameraPlacementChangeResult }>(`/api/site-map/camera-placements/${encodeURIComponent(input.cameraId)}`, { method: "POST", json: { point: input.point, mode: input.mode, reason: input.reason, expectedCameraRevision: input.expectedCameraRevision, expectedMapRevisionId: input.expectedMapRevisionId, confirmation: true, ...(input.provisionalZone ? { provisionalZone: input.provisionalZone } : {}) } }).then((response) => response.placement);
