export type MapPoint = { xMeters: number; yMeters: number };
export type Polygon = MapPoint[];

function cross(a: MapPoint, b: MapPoint, c: MapPoint) {
  return (b.xMeters - a.xMeters) * (c.yMeters - a.yMeters) - (b.yMeters - a.yMeters) * (c.xMeters - a.xMeters);
}

export function polygonArea(polygon: Polygon) {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.xMeters * next.yMeters - next.xMeters * current.yMeters;
  }
  return Math.abs(area) / 2;
}

function orientation(a: MapPoint, b: MapPoint, c: MapPoint) {
  const value = cross(a, b, c);
  return Math.abs(value) < 1e-9 ? 0 : value > 0 ? 1 : -1;
}

function onSegment(a: MapPoint, b: MapPoint, point: MapPoint) {
  return Math.min(a.xMeters, b.xMeters) - 1e-9 <= point.xMeters && point.xMeters <= Math.max(a.xMeters, b.xMeters) + 1e-9
    && Math.min(a.yMeters, b.yMeters) - 1e-9 <= point.yMeters && point.yMeters <= Math.max(a.yMeters, b.yMeters) + 1e-9;
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
}

export function polygonSelfIntersects(polygon: Polygon) {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === i || (j + 1) % polygon.length === i || (i + 1) % polygon.length === j) continue;
      if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
}

export function pointInPolygon(point: MapPoint, polygon: Polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (orientation(a, b, point) === 0 && onSegment(a, b, point)) return true;
    const intersects = ((a.yMeters > point.yMeters) !== (b.yMeters > point.yMeters))
      && point.xMeters < ((b.xMeters - a.xMeters) * (point.yMeters - a.yMeters)) / (b.yMeters - a.yMeters) + a.xMeters;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function containingPolygon(point: MapPoint, polygons: Array<{ id: string; polygon: Polygon }>) {
  const matches = polygons.filter((candidate) => pointInPolygon(point, candidate.polygon));
  return matches.length === 1 ? matches[0].id : null;
}

export function pointInMapBounds(point: MapPoint, widthMeters: number, heightMeters: number) {
  return Number.isFinite(point.xMeters) && Number.isFinite(point.yMeters)
    && point.xMeters >= 0 && point.yMeters >= 0 && point.xMeters <= widthMeters && point.yMeters <= heightMeters;
}

export function polygonsOverlap(left: Polygon, right: Polygon) {
  if (left.some((point) => pointInPolygon(point, right)) || right.some((point) => pointInPolygon(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (segmentsIntersect(left[leftIndex], left[(leftIndex + 1) % left.length], right[rightIndex], right[(rightIndex + 1) % right.length])) return true;
    }
  }
  return false;
}

export function validateMapGeometry(input: { widthMeters: number; heightMeters: number; zones: Array<{ id: string; polygon: Polygon }>; points?: Array<{ point: MapPoint; label: string; requiresZone?: boolean }> }) {
  const errors: string[] = [];
  if (!Number.isFinite(input.widthMeters) || input.widthMeters <= 0) errors.push("width_must_be_positive");
  if (!Number.isFinite(input.heightMeters) || input.heightMeters <= 0) errors.push("height_must_be_positive");
  for (const zone of input.zones) {
    if (zone.polygon.length < 3) errors.push(`zone_${zone.id}_needs_three_points`);
    if (zone.polygon.some((point) => point.xMeters < 0 || point.yMeters < 0 || point.xMeters > input.widthMeters || point.yMeters > input.heightMeters)) errors.push(`zone_${zone.id}_outside_bounds`);
    if (polygonArea(zone.polygon) <= 0) errors.push(`zone_${zone.id}_zero_area`);
    if (polygonSelfIntersects(zone.polygon)) errors.push(`zone_${zone.id}_self_intersects`);
  }
  for (let i = 0; i < input.zones.length; i += 1) {
    for (let j = i + 1; j < input.zones.length; j += 1) {
      const left = input.zones[i];
      const right = input.zones[j];
      if (polygonsOverlap(left.polygon, right.polygon)) errors.push(`zones_${left.id}_${right.id}_overlap`);
    }
  }
  for (const target of input.points ?? []) {
    if (!pointInMapBounds(target.point, input.widthMeters, input.heightMeters)) errors.push(`${target.label}_outside_bounds`);
    if (target.requiresZone !== false && !containingPolygon(target.point, input.zones)) errors.push(`${target.label}_not_in_exactly_one_zone`);
  }
  return { valid: errors.length === 0, errors };
}
