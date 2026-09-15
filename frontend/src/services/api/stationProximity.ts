import type { OperationsPoint, OperationsZone } from "./operations";

export type NearestZone = { id: string; name: string; distanceMeters: number };

function pointInPolygon(point: OperationsPoint, polygon: OperationsPoint[]) {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const current = polygon[index]; const previous = polygon[prior];
    if ((current.yMeters > point.yMeters) !== (previous.yMeters > point.yMeters)
      && point.xMeters < (previous.xMeters - current.xMeters) * (point.yMeters - current.yMeters) / (previous.yMeters - current.yMeters) + current.xMeters) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point: OperationsPoint, start: OperationsPoint, end: OperationsPoint) {
  const dx = end.xMeters - start.xMeters; const dy = end.yMeters - start.yMeters;
  if (dx === 0 && dy === 0) return Math.hypot(point.xMeters - start.xMeters, point.yMeters - start.yMeters);
  const t = Math.max(0, Math.min(1, ((point.xMeters - start.xMeters) * dx + (point.yMeters - start.yMeters) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.xMeters - (start.xMeters + t * dx), point.yMeters - (start.yMeters + t * dy));
}

export function nearestZoneForStation(point: OperationsPoint, zones: OperationsZone[]): NearestZone | null {
  const candidates = zones.filter((zone) => zone.polygon.length >= 3).map((zone) => {
    const distanceMeters = pointInPolygon(point, zone.polygon) ? 0 : Math.min(...zone.polygon.map((vertex, index) => pointToSegmentDistance(point, vertex, zone.polygon[(index + 1) % zone.polygon.length])));
    return { id: zone.id, name: zone.zoneNameSnapshot, distanceMeters };
  });
  return candidates.sort((left, right) => left.distanceMeters - right.distanceMeters || left.name.localeCompare(right.name))[0] ?? null;
}
