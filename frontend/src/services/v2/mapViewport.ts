import type { SiteMapPoint } from "./mapGeometry";

export type ViewerPoint = { x: number; y: number };
export type MapViewportTransform = { pixelsPerMeter: number; offsetX: number; offsetY: number };

export function fitSiteMap(boundary: { widthMeters: number; heightMeters: number }, viewer: { width: number; height: number }, padding = 0): MapViewportTransform {
  if (boundary.widthMeters <= 0 || boundary.heightMeters <= 0 || viewer.width <= padding * 2 || viewer.height <= padding * 2) throw new Error("Site Map and viewer dimensions must be positive.");
  const pixelsPerMeter = Math.min((viewer.width - padding * 2) / boundary.widthMeters, (viewer.height - padding * 2) / boundary.heightMeters);
  return {
    pixelsPerMeter,
    offsetX: (viewer.width - boundary.widthMeters * pixelsPerMeter) / 2,
    offsetY: (viewer.height - boundary.heightMeters * pixelsPerMeter) / 2,
  };
}

export function mapPointToViewer(point: SiteMapPoint, transform: MapViewportTransform): ViewerPoint {
  return { x: transform.offsetX + point.xMeters * transform.pixelsPerMeter, y: transform.offsetY + point.yMeters * transform.pixelsPerMeter };
}

export function viewerPointToMap(point: ViewerPoint, transform: MapViewportTransform): SiteMapPoint {
  return { xMeters: (point.x - transform.offsetX) / transform.pixelsPerMeter, yMeters: (point.y - transform.offsetY) / transform.pixelsPerMeter };
}

export function panMap(transform: MapViewportTransform, movement: ViewerPoint): MapViewportTransform {
  return { ...transform, offsetX: transform.offsetX + movement.x, offsetY: transform.offsetY + movement.y };
}

export function zoomMapAt(transform: MapViewportTransform, factor: number, anchor: ViewerPoint, limits = { minimum: transform.pixelsPerMeter, maximum: transform.pixelsPerMeter * 16 }): MapViewportTransform {
  const pixelsPerMeter = Math.min(limits.maximum, Math.max(limits.minimum, transform.pixelsPerMeter * factor));
  const mapAtAnchor = viewerPointToMap(anchor, transform);
  return { pixelsPerMeter, offsetX: anchor.x - mapAtAnchor.xMeters * pixelsPerMeter, offsetY: anchor.y - mapAtAnchor.yMeters * pixelsPerMeter };
}

export function roundStoredMapPoint(point: SiteMapPoint): SiteMapPoint {
  return { xMeters: Number(point.xMeters.toFixed(2)), yMeters: Number(point.yMeters.toFixed(2)) };
}
