export type SiteMapPoint = { xMeters: number; yMeters: number };
export type SiteMapPolygon = SiteMapPoint[];
export type ZoneConflictReason = "edges_cross" | "shared_edge" | "boundary_touch" | "containment" | "area_overlap";
export type ZoneConflict = { zoneIds: [string, string]; reason: ZoneConflictReason; message: string };

const EPSILON_METERS = 1e-9;

function cross(a: SiteMapPoint, b: SiteMapPoint, c: SiteMapPoint) {
  return (b.xMeters - a.xMeters) * (c.yMeters - a.yMeters) - (b.yMeters - a.yMeters) * (c.xMeters - a.xMeters);
}

function orientation(a: SiteMapPoint, b: SiteMapPoint, c: SiteMapPoint) {
  const value = cross(a, b, c);
  return Math.abs(value) < EPSILON_METERS ? 0 : value > 0 ? 1 : -1;
}

function onSegment(a: SiteMapPoint, b: SiteMapPoint, point: SiteMapPoint) {
  return Math.min(a.xMeters, b.xMeters) - EPSILON_METERS <= point.xMeters && point.xMeters <= Math.max(a.xMeters, b.xMeters) + EPSILON_METERS
    && Math.min(a.yMeters, b.yMeters) - EPSILON_METERS <= point.yMeters && point.yMeters <= Math.max(a.yMeters, b.yMeters) + EPSILON_METERS;
}

function segmentContact(a: SiteMapPoint, b: SiteMapPoint, c: SiteMapPoint, d: SiteMapPoint): "none" | "touch" | "cross" | "overlap" {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0 && abC !== abD && cdA !== cdB) return "cross";
  if (abC === 0 && abD === 0 && cdA === 0 && cdB === 0) {
    const useX = Math.abs(a.xMeters - b.xMeters) >= Math.abs(a.yMeters - b.yMeters);
    const [a1, a2] = useX ? [a.xMeters, b.xMeters] : [a.yMeters, b.yMeters];
    const [c1, c2] = useX ? [c.xMeters, d.xMeters] : [c.yMeters, d.yMeters];
    const overlap = Math.min(Math.max(a1, a2), Math.max(c1, c2)) - Math.max(Math.min(a1, a2), Math.min(c1, c2));
    return overlap > EPSILON_METERS ? "overlap" : overlap >= -EPSILON_METERS ? "touch" : "none";
  }
  return (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d)) || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b)) ? "touch" : "none";
}

function samePoint(left: SiteMapPoint, right: SiteMapPoint) {
  return Math.abs(left.xMeters - right.xMeters) <= EPSILON_METERS && Math.abs(left.yMeters - right.yMeters) <= EPSILON_METERS;
}

export function siteMapPolygonArea(polygon: SiteMapPolygon) {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.xMeters * next.yMeters - next.xMeters * point.yMeters;
  }, 0)) / 2;
}

function onBoundary(point: SiteMapPoint, polygon: SiteMapPolygon) {
  return polygon.some((vertex, index) => orientation(vertex, polygon[(index + 1) % polygon.length], point) === 0 && onSegment(vertex, polygon[(index + 1) % polygon.length], point));
}

export function pointInSiteMapPolygon(point: SiteMapPoint, polygon: SiteMapPolygon) {
  if (onBoundary(point, polygon)) return true;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index], b = polygon[previous];
    if ((a.yMeters > point.yMeters) !== (b.yMeters > point.yMeters)
      && point.xMeters < ((b.xMeters - a.xMeters) * (point.yMeters - a.yMeters)) / (b.yMeters - a.yMeters) + a.xMeters) inside = !inside;
  }
  return inside;
}

export function zonePolygonConflict(left: SiteMapPolygon, right: SiteMapPolygon): ZoneConflictReason | null {
  let boundaryTouch = false, sharedEdge = false;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const contact = segmentContact(left[leftIndex], left[(leftIndex + 1) % left.length], right[rightIndex], right[(rightIndex + 1) % right.length]);
      if (contact === "cross") return "edges_cross";
      if (contact === "overlap") sharedEdge = true;
      if (contact === "touch") boundaryTouch = true;
    }
  }
  if (sharedEdge) return "shared_edge";
  const leftInside = left.filter((point) => !onBoundary(point, right) && pointInSiteMapPolygon(point, right));
  const rightInside = right.filter((point) => !onBoundary(point, left) && pointInSiteMapPolygon(point, left));
  if (leftInside.length || rightInside.length) return left.every((point) => pointInSiteMapPolygon(point, right)) || right.every((point) => pointInSiteMapPolygon(point, left)) ? "containment" : "area_overlap";
  return boundaryTouch ? "boundary_touch" : null;
}

export function pointInSiteMapBoundary(point: SiteMapPoint, boundary: { widthMeters: number; heightMeters: number }) {
  return Number.isFinite(point.xMeters) && Number.isFinite(point.yMeters) && point.xMeters >= 0 && point.yMeters >= 0 && point.xMeters <= boundary.widthMeters && point.yMeters <= boundary.heightMeters;
}

export function siteMapPolygonSelfIntersects(polygon: SiteMapPolygon) {
  for (let first = 0; first < polygon.length; first += 1) {
    for (let second = first + 1; second < polygon.length; second += 1) {
      if (second === first || (second + 1) % polygon.length === first || (first + 1) % polygon.length === second) continue;
      if (segmentContact(polygon[first], polygon[(first + 1) % polygon.length], polygon[second], polygon[(second + 1) % polygon.length]) !== "none") return true;
    }
  }
  return false;
}

export type ZoneCandidateIssue = { code: string; message: string; zoneIds?: string[] };

export function validateZoneCandidate(candidate: { id: string; name: string; polygon: SiteMapPolygon }, activeZones: Array<{ id: string; name: string; polygon: SiteMapPolygon }>, boundary: { widthMeters: number; heightMeters: number }) {
  const issues: ZoneCandidateIssue[] = [];
  const unique = candidate.polygon.filter((point, index, all) => all.findIndex((other) => samePoint(point, other)) === index);
  if (unique.length < 3) issues.push({ code: "needs_three_unique_points", message: `${candidate.name} needs at least three unique boundary points.`, zoneIds: [candidate.id] });
  if (unique.length !== candidate.polygon.length) issues.push({ code: "duplicate_vertex", message: `${candidate.name} contains a duplicate boundary point.`, zoneIds: [candidate.id] });
  if (candidate.polygon.some((point) => !pointInSiteMapBoundary(point, boundary))) issues.push({ code: "outside_bounds", message: `${candidate.name} extends outside the Site Map boundary.`, zoneIds: [candidate.id] });
  if (siteMapPolygonArea(candidate.polygon) <= EPSILON_METERS) issues.push({ code: "zero_area", message: `${candidate.name} has no usable area.`, zoneIds: [candidate.id] });
  if (candidate.polygon.length >= 3 && siteMapPolygonSelfIntersects(candidate.polygon)) issues.push({ code: "self_intersects", message: `${candidate.name} crosses itself.`, zoneIds: [candidate.id] });
  issues.push(...candidateZoneConflicts(candidate, activeZones).map((conflict) => ({ ...conflict, code: conflict.reason })));
  return issues;
}

export function containingZoneId(point: SiteMapPoint, zones: Array<{ id: string; polygon: SiteMapPolygon }>) {
  const matches = zones.filter((zone) => pointInSiteMapPolygon(point, zone.polygon));
  return matches.length === 1 ? matches[0].id : null;
}

export function candidateZoneConflicts(candidate: { id: string; name: string; polygon: SiteMapPolygon }, activeZones: Array<{ id: string; name: string; polygon: SiteMapPolygon }>) {
  return activeZones.filter((zone) => zone.id !== candidate.id).flatMap((zone): ZoneConflict[] => {
    const reason = zonePolygonConflict(candidate.polygon, zone.polygon);
    if (!reason) return [];
    const action = reason === "shared_edge" ? "shares an edge with" : reason === "boundary_touch" ? "touches" : reason === "containment" ? "contains or is contained by" : "overlaps";
    return [{ zoneIds: [candidate.id, zone.id], reason, message: `${candidate.name} ${action} ${zone.name}.` }];
  });
}
