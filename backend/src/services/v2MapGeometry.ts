export type MapPoint = { xMeters: number; yMeters: number };
export type Polygon = MapPoint[];

export type ZoneConflictReason = "edges_cross" | "shared_edge" | "boundary_touch" | "containment" | "area_overlap";
export type MapValidationIssue = {
  code: string;
  kind: "map" | "zone" | "zone_conflict" | "point";
  message: string;
  zoneIds?: [string, string] | [string];
  pointLabel?: string;
  reason?: ZoneConflictReason;
};

const EPSILON_METERS = 1e-9;

function cross(a: MapPoint, b: MapPoint, c: MapPoint) {
  return (b.xMeters - a.xMeters) * (c.yMeters - a.yMeters) - (b.yMeters - a.yMeters) * (c.xMeters - a.xMeters);
}

function samePoint(left: MapPoint, right: MapPoint) {
  return Math.abs(left.xMeters - right.xMeters) <= EPSILON_METERS
    && Math.abs(left.yMeters - right.yMeters) <= EPSILON_METERS;
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
  return Math.abs(value) < EPSILON_METERS ? 0 : value > 0 ? 1 : -1;
}

function onSegment(a: MapPoint, b: MapPoint, point: MapPoint) {
  return Math.min(a.xMeters, b.xMeters) - EPSILON_METERS <= point.xMeters && point.xMeters <= Math.max(a.xMeters, b.xMeters) + EPSILON_METERS
    && Math.min(a.yMeters, b.yMeters) - EPSILON_METERS <= point.yMeters && point.yMeters <= Math.max(a.yMeters, b.yMeters) + EPSILON_METERS;
}

type SegmentContact = "none" | "touch" | "cross" | "overlap";

function collinearOverlap(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): SegmentContact {
  const useX = Math.abs(a.xMeters - b.xMeters) >= Math.abs(a.yMeters - b.yMeters);
  const [a1, a2] = useX ? [a.xMeters, b.xMeters] : [a.yMeters, b.yMeters];
  const [c1, c2] = useX ? [c.xMeters, d.xMeters] : [c.yMeters, d.yMeters];
  const overlap = Math.min(Math.max(a1, a2), Math.max(c1, c2)) - Math.max(Math.min(a1, a2), Math.min(c1, c2));
  if (overlap > EPSILON_METERS) return "overlap";
  if (overlap >= -EPSILON_METERS) return "touch";
  return "none";
}

function segmentContact(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): SegmentContact {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0 && abC !== abD && cdA !== cdB) return "cross";
  if (abC === 0 && abD === 0 && cdA === 0 && cdB === 0) return collinearOverlap(a, b, c, d);
  if ((abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b))) return "touch";
  return "none";
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  return segmentContact(a, b, c, d) !== "none";
}

function uniquePointCount(polygon: Polygon) {
  const unique: MapPoint[] = [];
  for (const point of polygon) if (!unique.some((candidate) => samePoint(candidate, point))) unique.push(point);
  return unique.length;
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

export function pointOnPolygonBoundary(point: MapPoint, polygon: Polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (orientation(a, b, point) === 0 && onSegment(a, b, point)) return true;
  }
  return false;
}

export function pointInPolygon(point: MapPoint, polygon: Polygon) {
  if (pointOnPolygonBoundary(point, polygon)) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.yMeters > point.yMeters) !== (b.yMeters > point.yMeters))
      && point.xMeters < ((b.xMeters - a.xMeters) * (point.yMeters - a.yMeters)) / (b.yMeters - a.yMeters) + a.xMeters;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointStrictlyInPolygon(point: MapPoint, polygon: Polygon) {
  return !pointOnPolygonBoundary(point, polygon) && pointInPolygon(point, polygon);
}

export function containingPolygon(point: MapPoint, polygons: Array<{ id: string; polygon: Polygon }>) {
  const matches = polygons.filter((candidate) => pointInPolygon(point, candidate.polygon));
  return matches.length === 1 ? matches[0].id : null;
}

export function pointInMapBounds(point: MapPoint, widthMeters: number, heightMeters: number) {
  return Number.isFinite(point.xMeters) && Number.isFinite(point.yMeters)
    && point.xMeters >= 0 && point.yMeters >= 0 && point.xMeters <= widthMeters && point.yMeters <= heightMeters;
}

export function polygonConflict(left: Polygon, right: Polygon): ZoneConflictReason | null {
  let boundaryTouch = false;
  let sharedEdge = false;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const contact = segmentContact(left[leftIndex], left[(leftIndex + 1) % left.length], right[rightIndex], right[(rightIndex + 1) % right.length]);
      if (contact === "cross") return "edges_cross";
      if (contact === "overlap") sharedEdge = true;
      if (contact === "touch") boundaryTouch = true;
    }
  }
  if (sharedEdge) return "shared_edge";
  const leftInside = left.filter((point) => pointStrictlyInPolygon(point, right));
  const rightInside = right.filter((point) => pointStrictlyInPolygon(point, left));
  if (leftInside.length || rightInside.length) {
    const leftContained = left.every((point) => pointInPolygon(point, right));
    const rightContained = right.every((point) => pointInPolygon(point, left));
    return leftContained || rightContained ? "containment" : "area_overlap";
  }
  return boundaryTouch ? "boundary_touch" : null;
}

export function polygonsOverlap(left: Polygon, right: Polygon) {
  return polygonConflict(left, right) !== null;
}

function conflictMessage(leftId: string, rightId: string, reason: ZoneConflictReason) {
  if (reason === "edges_cross") return `Zones ${leftId} and ${rightId} have crossing boundaries.`;
  if (reason === "shared_edge") return `Zones ${leftId} and ${rightId} share a boundary edge.`;
  if (reason === "boundary_touch") return `Zones ${leftId} and ${rightId} touch at their boundaries.`;
  if (reason === "containment") return `Zone ${leftId} or ${rightId} is contained by the other Zone.`;
  return `Zones ${leftId} and ${rightId} overlap.`;
}

export function validateMapGeometry(input: { widthMeters: number; heightMeters: number; zones: Array<{ id: string; polygon: Polygon }>; points?: Array<{ point: MapPoint; label: string; requiresZone?: boolean }> }) {
  const issues: MapValidationIssue[] = [];
  const add = (issue: MapValidationIssue) => issues.push(issue);
  if (!Number.isFinite(input.widthMeters) || input.widthMeters <= 0) add({ code: "width_must_be_positive", kind: "map", message: "Site Map width must be positive." });
  if (!Number.isFinite(input.heightMeters) || input.heightMeters <= 0) add({ code: "height_must_be_positive", kind: "map", message: "Site Map height must be positive." });
  for (const zone of input.zones) {
    if (zone.polygon.length < 3 || uniquePointCount(zone.polygon) < 3) add({ code: `zone_${zone.id}_needs_three_unique_points`, kind: "zone", zoneIds: [zone.id], message: `Zone ${zone.id} needs at least three unique points.` });
    if (uniquePointCount(zone.polygon) !== zone.polygon.length) add({ code: `zone_${zone.id}_duplicate_vertex`, kind: "zone", zoneIds: [zone.id], message: `Zone ${zone.id} contains a duplicate vertex.` });
    if (zone.polygon.some((point) => !pointInMapBounds(point, input.widthMeters, input.heightMeters))) add({ code: `zone_${zone.id}_outside_bounds`, kind: "zone", zoneIds: [zone.id], message: `Zone ${zone.id} extends outside the Site Map boundary.` });
    if (polygonArea(zone.polygon) <= EPSILON_METERS) add({ code: `zone_${zone.id}_zero_area`, kind: "zone", zoneIds: [zone.id], message: `Zone ${zone.id} has no usable area.` });
    if (polygonSelfIntersects(zone.polygon)) add({ code: `zone_${zone.id}_self_intersects`, kind: "zone", zoneIds: [zone.id], message: `Zone ${zone.id} intersects itself.` });
  }
  for (let i = 0; i < input.zones.length; i += 1) {
    for (let j = i + 1; j < input.zones.length; j += 1) {
      const left = input.zones[i];
      const right = input.zones[j];
      const reason = polygonConflict(left.polygon, right.polygon);
      if (reason) add({ code: `zones_${left.id}_${right.id}_${reason}`, kind: "zone_conflict", zoneIds: [left.id, right.id], reason, message: conflictMessage(left.id, right.id, reason) });
    }
  }
  for (const target of input.points ?? []) {
    if (!pointInMapBounds(target.point, input.widthMeters, input.heightMeters)) add({ code: `${target.label}_outside_bounds`, kind: "point", pointLabel: target.label, message: `${target.label} is outside the Site Map boundary.` });
    if (target.requiresZone !== false && !containingPolygon(target.point, input.zones)) add({ code: `${target.label}_not_in_exactly_one_zone`, kind: "point", pointLabel: target.label, message: `${target.label} must be inside exactly one active Zone.` });
  }
  return { valid: issues.length === 0, errors: issues.map((issue) => issue.code), issues, zoneConflicts: issues.filter((issue) => issue.kind === "zone_conflict") };
}
