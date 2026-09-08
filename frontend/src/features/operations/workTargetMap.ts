import type { V2Point, V2Zone } from "../../services/v2/operations";

function orientation(a: V2Point, b: V2Point, point: V2Point) {
  const value = (b.yMeters - a.yMeters) * (point.xMeters - b.xMeters) - (b.xMeters - a.xMeters) * (point.yMeters - b.yMeters);
  return Math.abs(value) < 1e-9 ? 0 : value > 0 ? 1 : 2;
}

function onSegment(a: V2Point, b: V2Point, point: V2Point) {
  return point.xMeters <= Math.max(a.xMeters, b.xMeters) && point.xMeters >= Math.min(a.xMeters, b.xMeters)
    && point.yMeters <= Math.max(a.yMeters, b.yMeters) && point.yMeters >= Math.min(a.yMeters, b.yMeters);
}

export function workPointInPolygon(point: V2Point, polygon: V2Point[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const a = polygon[prior]; const b = polygon[index];
    if (orientation(a, b, point) === 0 && onSegment(a, b, point)) return true;
    const intersects = (a.yMeters > point.yMeters) !== (b.yMeters > point.yMeters)
      && point.xMeters < ((b.xMeters - a.xMeters) * (point.yMeters - a.yMeters)) / (b.yMeters - a.yMeters) + a.xMeters;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function workZoneAtPoint(point: V2Point, zones: V2Zone[]) {
  const matches = zones.filter((zone) => workPointInPolygon(point, zone.polygon));
  return matches.length === 1 ? matches[0] : null;
}

export function workPointFromFraction(x: number, y: number, size: { widthMeters: number; heightMeters: number }): V2Point {
  return {
    xMeters: Number((Math.max(0, Math.min(1, x)) * size.widthMeters).toFixed(2)),
    yMeters: Number((Math.max(0, Math.min(1, y)) * size.heightMeters).toFixed(2)),
  };
}

export function clampWorkPoint(point: V2Point, size: { widthMeters: number; heightMeters: number }): V2Point {
  return {
    xMeters: Number(Math.max(0, Math.min(size.widthMeters, point.xMeters)).toFixed(2)),
    yMeters: Number(Math.max(0, Math.min(size.heightMeters, point.yMeters)).toFixed(2)),
  };
}

export function workZoneCentroid(zone: V2Zone) {
  return {
    xMeters: zone.polygon.reduce((sum, point) => sum + point.xMeters, 0) / zone.polygon.length,
    yMeters: zone.polygon.reduce((sum, point) => sum + point.yMeters, 0) / zone.polygon.length,
  };
}
