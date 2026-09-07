import { containingZoneId, pointInSiteMapBoundary, validateZoneCandidate, type ZoneCandidateIssue } from "../../services/v2/mapGeometry";
import type { SiteMapBackground, SiteMapDraft, SiteMapDraftSave } from "../../services/v2/siteMap";

export type SiteDraftIssue = ZoneCandidateIssue & { kind: "map" | "zone" | "camera" | "station" | "background" };

export function siteMapDraftIssues(draft: SiteMapDraft, background: SiteMapBackground | null): SiteDraftIssue[] {
  const boundary = { widthMeters: draft.widthMeters, heightMeters: draft.heightMeters };
  const zones = draft.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon }));
  const issues: SiteDraftIssue[] = [];
  if (!Number.isFinite(draft.widthMeters) || draft.widthMeters <= 0 || !Number.isFinite(draft.heightMeters) || draft.heightMeters <= 0) issues.push({ code: "invalid_boundary", kind: "map", message: "Site Map width and height must be positive." });
  if (!Number.isFinite(draft.gridSizeMeters) || draft.gridSizeMeters <= 0 || draft.gridSizeMeters > Math.max(draft.widthMeters, draft.heightMeters)) issues.push({ code: "invalid_grid", kind: "map", message: "Grid size must be positive and cannot exceed the Site boundary." });
  for (const zone of zones) {
    if (!zone.name.trim()) issues.push({ code: `zone_${zone.id}_name_required`, kind: "zone", message: "Every active Zone needs a name.", zoneIds: [zone.id] });
    issues.push(...validateZoneCandidate(zone, zones, boundary).map((issue) => ({ ...issue, kind: "zone" as const })));
  }
  for (const camera of draft.cameraPlacements) if (!containingZoneId(camera.point, zones)) issues.push({ code: `camera_${camera.cameraId}_outside_zone`, kind: "camera", message: `${camera.cameraNameSnapshot || "Camera"} must remain inside exactly one active Zone.` });
  for (const station of draft.cleanerStations) if (!pointInSiteMapBoundary(station.point, boundary)) issues.push({ code: `station_${station.cleanerId}_outside_boundary`, kind: "station", message: `${station.cleanerNameSnapshot || "Cleaner Station Point"} is outside the Site Map boundary.` });
  if (draft.backgroundMediaId && (!background || !draft.backgroundTransform)) issues.push({ code: "background_alignment_missing", kind: "background", message: "The selected Site background needs a valid alignment." });
  if (background && draft.backgroundTransform) {
    const transform = draft.backgroundTransform;
    const sourceRatio = background.width / background.height;
    const renderedRatio = transform.widthMeters / transform.heightMeters;
    if (Math.abs(sourceRatio - renderedRatio) / sourceRatio > .001) issues.push({ code: "background_aspect_ratio", kind: "background", message: "Background alignment must preserve the image aspect ratio." });
    if (transform.xMeters < 0 || transform.yMeters < 0 || transform.xMeters + transform.widthMeters > draft.widthMeters || transform.yMeters + transform.heightMeters > draft.heightMeters) issues.push({ code: "background_outside_boundary", kind: "background", message: "The full background image must remain inside the Site Map boundary." });
  }
  const unique = new Map(issues.map((issue) => [`${issue.code}:${[...(issue.zoneIds ?? [])].sort().join(":")}`, issue]));
  return [...unique.values()];
}

export function siteMapDraftSaveInput(draft: SiteMapDraft): SiteMapDraftSave {
  return {
    baseRevisionId: draft.baseRevisionId,
    expectedRevision: draft.revision,
    widthMeters: draft.widthMeters,
    heightMeters: draft.heightMeters,
    gridSizeMeters: draft.gridSizeMeters,
    backgroundMediaId: draft.backgroundMediaId,
    backgroundTransform: draft.backgroundTransform,
    zones: draft.zones.map((zone) => ({ zoneId: zone.zoneId, zoneNameSnapshot: zone.zoneNameSnapshot, polygon: zone.polygon })),
    cameraPlacements: draft.cameraPlacements.map((placement) => ({ id: placement.cameraId || placement.id, point: placement.point })),
    cleanerStations: draft.cleanerStations.map((station) => ({ id: station.cleanerId || station.id, point: station.point })),
  };
}
