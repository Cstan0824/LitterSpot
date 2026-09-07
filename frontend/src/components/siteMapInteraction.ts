export type SiteMapGestureCompletion =
  | { type: "add-zone-point" }
  | { type: "place-point" }
  | { type: "select-zone"; zoneId: string }
  | null;

export const SITE_MAP_WHEEL_LISTENER_OPTIONS = { passive: false } as const;

export function completedSiteMapGesture({ moved, pointerCount, pressedZoneId, drawingZone, placingPoint }: {
  moved: boolean;
  pointerCount: number;
  pressedZoneId?: string;
  drawingZone: boolean;
  placingPoint: boolean;
}): SiteMapGestureCompletion {
  if (moved || pointerCount !== 1) return null;
  if (drawingZone) return { type: "add-zone-point" };
  if (placingPoint) return { type: "place-point" };
  return pressedZoneId ? { type: "select-zone", zoneId: pressedZoneId } : null;
}

export function siteMapDrawingPoints<T extends { id: string; polygon: Array<{ xMeters: number; yMeters: number }> }>(zones: T[], drawingZoneId?: string | null) {
  if (!drawingZoneId) return [];
  return zones.find((zone) => zone.id === drawingZoneId)?.polygon ?? [];
}

export function siteMapGestureShouldPan({ drawingZone, placingPoint, screenDistance, mapDistance }: {
  drawingZone: boolean;
  placingPoint: boolean;
  screenDistance: number;
  mapDistance: number;
}) {
  return drawingZone || placingPoint ? screenDistance > 5 : mapDistance > .5;
}

export function siteMapButtonZoomFactor(direction: "in" | "out") {
  const step = 1.15;
  return direction === "in" ? step : 1 / step;
}

export function siteMapWheelZoomFactor(deltaY: number, deltaMode: number) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const modeMultiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1;
  const proportionalFactor = Math.exp(-deltaY * modeMultiplier * .0012);
  return Math.min(1.1, Math.max(.9, proportionalFactor));
}

export function siteMapCameraMarkerScale(screenScale: number) {
  return Number.isFinite(screenScale) && screenScale > 0 ? 1 / screenScale : 1;
}
