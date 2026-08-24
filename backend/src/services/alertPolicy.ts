export type IssueType = "floor_litter" | "floor_spill" | "bin_overflow";
export type AlertSeverity = "warning" | "critical";

export type NormalizedPoint = { x: number; y: number };
export type NormalizedBox = { x1: number; y1: number; x2: number; y2: number };

export type DetectionEvidence = {
  id: string;
  confidence: number;
  bboxNormalized: NormalizedBox;
  polygonNormalized?: NormalizedPoint[];
};

type ConfirmationRule = {
  mode: "at_least" | "consecutive";
  requiredPositive: number;
  windowSize: number;
  maximumWindowSeconds: number;
};

export const ALERT_POLICY = {
  version: "cleanliness-v2",
  activeAlertScope: "zone_issue",
  rules: {
    floor_litter: {
      minimumDetectionConfidence: 0.50,
      magnitudeThreshold: 0.40,
      criticalMagnitudeThreshold: 0.75,
      magnitude: {
        mergedRegionTarget: 5,
        coverageTarget: 0.02,
        occupiedCellTarget: 4,
        gridColumns: 3,
        gridRows: 3,
        coverageGridSize: 100,
        mergeGap: 0.02,
        weights: { mergedRegions: 0.40, coverage: 0.40, distribution: 0.20 },
      },
      confirmation: {
        mode: "at_least",
        requiredPositive: 3,
        windowSize: 5,
        maximumWindowSeconds: 30 * 60,
      } satisfies ConfirmationRule,
    },
    floor_spill: {
      minimumDetectionConfidence: 0.50,
      criticalConfidence: 0.75,
      confirmation: {
        mode: "consecutive",
        requiredPositive: 2,
        windowSize: 2,
        maximumWindowSeconds: 10 * 60,
      } satisfies ConfirmationRule,
    },
    bin_overflow: {
      minimumDetectionConfidence: 0.50,
      criticalConfidence: 0.75,
      confirmation: {
        mode: "at_least",
        requiredPositive: 2,
        windowSize: 3,
        maximumWindowSeconds: 15 * 60,
      } satisfies ConfirmationRule,
    },
  },
} as const;

export type GroupMetrics = {
  detectionCount: number;
  maximumConfidence: number;
  meanConfidence: number;
  mergedRegionCount: number;
  coverageRatio: number;
  occupiedGridCells: number;
  spatialDistribution: number;
  magnitudeScore: number | null;
};

export type GroupEvaluation = {
  issueType: IssueType;
  createFlag: boolean;
  alertCandidate: boolean;
  severity: AlertSeverity | null;
  reason: "test_data" | "below_detection_confidence" | "outside_analysis_region" | "below_dirty_magnitude" | "alert_candidate";
  eligibleDetectionIds: string[];
  rejectedDetectionIds: string[];
  minimumDetectionConfidence: number;
  alertThreshold: number | null;
  metrics: GroupMetrics;
};

export type ConfirmationEvaluation = {
  confirmed: boolean;
  mode: ConfirmationRule["mode"];
  requiredPositive: number;
  windowSize: number;
  evaluatedObservationCount: number;
  positiveCount: number;
  reason: "confirmed" | "awaiting_more_positive_observations" | "awaiting_consecutive_observations";
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function normalizeBox(box: NormalizedBox): NormalizedBox {
  const x1 = clamp(Math.min(box.x1, box.x2));
  const y1 = clamp(Math.min(box.y1, box.y2));
  const x2 = clamp(Math.max(box.x1, box.x2));
  const y2 = clamp(Math.max(box.y1, box.y2));
  return { x1, y1, x2, y2 };
}

function boxesTouch(left: NormalizedBox, right: NormalizedBox, gap: number) {
  return left.x1 - gap <= right.x2
    && left.x2 + gap >= right.x1
    && left.y1 - gap <= right.y2
    && left.y2 + gap >= right.y1;
}

function mergedRegionCount(boxes: NormalizedBox[], gap: number) {
  if (boxes.length === 0) return 0;
  const visited = new Set<number>();
  let components = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    if (visited.has(index)) continue;
    components += 1;
    const pending = [index];
    visited.add(index);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (let candidate = 0; candidate < boxes.length; candidate += 1) {
        if (visited.has(candidate) || !boxesTouch(boxes[current], boxes[candidate], gap)) continue;
        visited.add(candidate);
        pending.push(candidate);
      }
    }
  }
  return components;
}

function polygonArea(points: NormalizedPoint[]) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += clamp(current.x) * clamp(next.y) - clamp(next.x) * clamp(current.y);
  }
  return Math.abs(sum) / 2;
}

function pointInPolygon(point: NormalizedPoint, polygon: NormalizedPoint[]) {
  let inside = false;
  for (let left = 0, right = polygon.length - 1; left < polygon.length; right = left, left += 1) {
    const a = polygon[left];
    const b = polygon[right];
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInEvidence(point: NormalizedPoint, detection: DetectionEvidence, box: NormalizedBox) {
  const polygon = detection.polygonNormalized ?? [];
  return polygon.length >= 3
    ? pointInPolygon(point, polygon)
    : point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2;
}

function orientation(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsIntersect(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint, d: NormalizedPoint) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return (first === 0 || second === 0 || Math.sign(first) !== Math.sign(second))
    && (third === 0 || fourth === 0 || Math.sign(third) !== Math.sign(fourth));
}

function boxPolygon(box: NormalizedBox): NormalizedPoint[] {
  return [
    { x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 },
    { x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 },
  ];
}

function polygonsIntersect(left: NormalizedPoint[], right: NormalizedPoint[]) {
  if (left.some((point) => pointInPolygon(point, right)) || right.some((point) => pointInPolygon(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % left.length;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % right.length;
      if (segmentsIntersect(left[leftIndex], left[leftNext], right[rightIndex], right[rightNext])) return true;
    }
  }
  return false;
}

function evidenceIntersectsRegion(detection: DetectionEvidence, box: NormalizedBox, region: NormalizedPoint[]) {
  if (region.length < 3) return true;
  const evidencePolygon = (detection.polygonNormalized ?? []).length >= 3
    ? detection.polygonNormalized!
    : boxPolygon(box);
  return polygonsIntersect(evidencePolygon, region);
}

function analysisBounds(region: NormalizedPoint[]) {
  if (region.length < 3) return { x1: 0, y1: 0, x2: 1, y2: 1 };
  return normalizeBox({
    x1: Math.min(...region.map((point) => point.x)),
    y1: Math.min(...region.map((point) => point.y)),
    x2: Math.max(...region.map((point) => point.x)),
    y2: Math.max(...region.map((point) => point.y)),
  });
}

function effectiveEvidenceBox(detection: DetectionEvidence, box: NormalizedBox, region: NormalizedPoint[]) {
  if (region.length < 3) return box;
  const evidencePolygon = (detection.polygonNormalized ?? []).length >= 3
    ? detection.polygonNormalized!
    : boxPolygon(box);
  const candidates = [
    ...evidencePolygon.filter((point) => pointInPolygon(point, region)),
    ...region.filter((point) => pointInEvidence(point, detection, box)),
  ];
  const regionBounds = analysisBounds(region);
  if (candidates.length === 0) {
    return normalizeBox({
      x1: Math.max(box.x1, regionBounds.x1),
      y1: Math.max(box.y1, regionBounds.y1),
      x2: Math.min(box.x2, regionBounds.x2),
      y2: Math.min(box.y2, regionBounds.y2),
    });
  }
  return normalizeBox({
    x1: Math.min(...candidates.map((point) => point.x)),
    y1: Math.min(...candidates.map((point) => point.y)),
    x2: Math.max(...candidates.map((point) => point.x)),
    y2: Math.max(...candidates.map((point) => point.y)),
  });
}

function evidenceCentroidInRegion(detection: DetectionEvidence, box: NormalizedBox, region: NormalizedPoint[]) {
  const gridSize = 20;
  const points: NormalizedPoint[] = [];
  for (let row = 0; row < gridSize; row += 1) {
    const y = box.y1 + (row + 0.5) / gridSize * Math.max(0, box.y2 - box.y1);
    for (let column = 0; column < gridSize; column += 1) {
      const x = box.x1 + (column + 0.5) / gridSize * Math.max(0, box.x2 - box.x1);
      const point = { x, y };
      if ((region.length < 3 || pointInPolygon(point, region)) && pointInEvidence(point, detection, box)) points.push(point);
    }
  }
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function approximateUnionCoverage(detections: DetectionEvidence[], boxes: NormalizedBox[], region: NormalizedPoint[]) {
  const gridSize = ALERT_POLICY.rules.floor_litter.magnitude.coverageGridSize;
  const bounds = analysisBounds(region);
  let denominator = 0;
  let covered = 0;
  for (let row = 0; row < gridSize; row += 1) {
    const y = bounds.y1 + (row + 0.5) / gridSize * (bounds.y2 - bounds.y1);
    for (let column = 0; column < gridSize; column += 1) {
      const x = bounds.x1 + (column + 0.5) / gridSize * (bounds.x2 - bounds.x1);
      const point = { x, y };
      if (region.length >= 3 && !pointInPolygon(point, region)) continue;
      denominator += 1;
      if (detections.some((detection, index) => pointInEvidence(point, detection, boxes[index]))) covered += 1;
    }
  }
  if (denominator === 0) {
    const regionArea = polygonArea(region);
    if (regionArea <= 0) return 0;
    const summed = detections.reduce((total, detection) => total + polygonArea(detection.polygonNormalized ?? []), 0);
    return clamp(summed / regionArea);
  }
  return covered / denominator;
}

function emptyMetrics(): GroupMetrics {
  return {
    detectionCount: 0,
    maximumConfidence: 0,
    meanConfidence: 0,
    mergedRegionCount: 0,
    coverageRatio: 0,
    occupiedGridCells: 0,
    spatialDistribution: 0,
    magnitudeScore: null,
  };
}

function calculateMetrics(issueType: IssueType, detections: DetectionEvidence[], analysisRegion: NormalizedPoint[]): GroupMetrics {
  if (detections.length === 0) return emptyMetrics();
  const sourceBoxes = detections.map((detection) => normalizeBox(detection.bboxNormalized));
  const boxes = detections.map((detection, index) => effectiveEvidenceBox(detection, sourceBoxes[index], analysisRegion));
  const maximumConfidence = Math.max(...detections.map((detection) => detection.confidence));
  const meanConfidence = detections.reduce((total, detection) => total + detection.confidence, 0) / detections.length;
  const coverageRatio = approximateUnionCoverage(detections, sourceBoxes, analysisRegion);
  const floorMagnitude = ALERT_POLICY.rules.floor_litter.magnitude;
  const bounds = analysisBounds(analysisRegion);
  const boundsWidth = Math.max(Number.EPSILON, bounds.x2 - bounds.x1);
  const boundsHeight = Math.max(Number.EPSILON, bounds.y2 - bounds.y1);
  const occupied = new Set<string>();
  for (const [index, box] of boxes.entries()) {
    const centroid = evidenceCentroidInRegion(detections[index], sourceBoxes[index], analysisRegion);
    if (!centroid) continue;
    const centerX = clamp((centroid.x - bounds.x1) / boundsWidth, 0, 0.999999);
    const centerY = clamp((centroid.y - bounds.y1) / boundsHeight, 0, 0.999999);
    occupied.add(`${Math.floor(centerX * floorMagnitude.gridColumns)}:${Math.floor(centerY * floorMagnitude.gridRows)}`);
  }
  const regions = mergedRegionCount(boxes, floorMagnitude.mergeGap);
  let validGridCells = 0;
  for (let row = 0; row < floorMagnitude.gridRows; row += 1) {
    for (let column = 0; column < floorMagnitude.gridColumns; column += 1) {
      const point = {
        x: bounds.x1 + (column + 0.5) / floorMagnitude.gridColumns * boundsWidth,
        y: bounds.y1 + (row + 0.5) / floorMagnitude.gridRows * boundsHeight,
      };
      if (analysisRegion.length < 3 || pointInPolygon(point, analysisRegion)) validGridCells += 1;
    }
  }
  validGridCells = Math.max(1, validGridCells);
  const spatialDistribution = occupied.size / validGridCells;
  const magnitudeScore = issueType === "floor_litter"
    ? floorMagnitude.weights.mergedRegions * clamp(regions / floorMagnitude.mergedRegionTarget)
      + floorMagnitude.weights.coverage * clamp(coverageRatio / floorMagnitude.coverageTarget)
      + floorMagnitude.weights.distribution * clamp(occupied.size / Math.min(floorMagnitude.occupiedCellTarget, validGridCells))
    : null;
  return {
    detectionCount: detections.length,
    maximumConfidence: round(maximumConfidence),
    meanConfidence: round(meanConfidence),
    mergedRegionCount: regions,
    coverageRatio: round(coverageRatio),
    occupiedGridCells: occupied.size,
    spatialDistribution: round(spatialDistribution),
    magnitudeScore: magnitudeScore === null ? null : round(clamp(magnitudeScore)),
  };
}

export function evaluateIssueGroup(
  issueType: IssueType,
  detections: DetectionEvidence[],
  isTest: boolean,
  analysisRegion: NormalizedPoint[] = [],
): GroupEvaluation {
  const rule = ALERT_POLICY.rules[issueType];
  const minimumDetectionConfidence = rule.minimumDetectionConfidence;
  const confidenceEligible = detections.filter((detection) => Number.isFinite(detection.confidence) && detection.confidence >= minimumDetectionConfidence);
  const eligible = confidenceEligible.filter((detection) => issueType === "bin_overflow"
    || evidenceIntersectsRegion(detection, normalizeBox(detection.bboxNormalized), analysisRegion));
  const rejected = detections.filter((detection) => !eligible.includes(detection));
  const metrics = calculateMetrics(issueType, eligible, analysisRegion);
  if (isTest) {
    return {
      issueType,
      createFlag: false,
      alertCandidate: false,
      severity: null,
      reason: "test_data",
      eligibleDetectionIds: eligible.map((detection) => detection.id),
      rejectedDetectionIds: rejected.map((detection) => detection.id),
      minimumDetectionConfidence,
      alertThreshold: null,
      metrics,
    };
  }
  if (eligible.length === 0) {
    return {
      issueType,
      createFlag: false,
      alertCandidate: false,
      severity: null,
      reason: confidenceEligible.length > 0 ? "outside_analysis_region" : "below_detection_confidence",
      eligibleDetectionIds: [],
      rejectedDetectionIds: rejected.map((detection) => detection.id),
      minimumDetectionConfidence,
      alertThreshold: null,
      metrics,
    };
  }

  if (issueType === "floor_litter") {
    const alertCandidate = (metrics.magnitudeScore ?? 0) >= ALERT_POLICY.rules.floor_litter.magnitudeThreshold;
    return {
      issueType,
      createFlag: alertCandidate,
      alertCandidate,
      severity: alertCandidate
        ? (metrics.magnitudeScore ?? 0) >= ALERT_POLICY.rules.floor_litter.criticalMagnitudeThreshold ? "critical" : "warning"
        : null,
      reason: alertCandidate ? "alert_candidate" : "below_dirty_magnitude",
      eligibleDetectionIds: eligible.map((detection) => detection.id),
      rejectedDetectionIds: rejected.map((detection) => detection.id),
      minimumDetectionConfidence,
      alertThreshold: ALERT_POLICY.rules.floor_litter.magnitudeThreshold,
      metrics,
    };
  }

  const criticalConfidence = issueType === "floor_spill"
    ? ALERT_POLICY.rules.floor_spill.criticalConfidence
    : ALERT_POLICY.rules.bin_overflow.criticalConfidence;
  return {
    issueType,
    createFlag: true,
    alertCandidate: true,
    severity: metrics.maximumConfidence >= criticalConfidence ? "critical" : "warning",
    reason: "alert_candidate",
    eligibleDetectionIds: eligible.map((detection) => detection.id),
    rejectedDetectionIds: rejected.map((detection) => detection.id),
    minimumDetectionConfidence,
    alertThreshold: minimumDetectionConfidence,
    metrics,
  };
}

export function evaluateTemporalConfirmation(issueType: IssueType, newestFirstCandidates: boolean[]): ConfirmationEvaluation {
  const rule = ALERT_POLICY.rules[issueType].confirmation;
  const window = newestFirstCandidates.slice(0, rule.windowSize);
  const positiveCount = window.filter(Boolean).length;
  const confirmed = rule.mode === "consecutive"
    ? window.length >= rule.requiredPositive && window.slice(0, rule.requiredPositive).every(Boolean)
    : positiveCount >= rule.requiredPositive;
  return {
    confirmed,
    mode: rule.mode,
    requiredPositive: rule.requiredPositive,
    windowSize: rule.windowSize,
    evaluatedObservationCount: window.length,
    positiveCount,
    reason: confirmed
      ? "confirmed"
      : rule.mode === "consecutive"
        ? "awaiting_consecutive_observations"
        : "awaiting_more_positive_observations",
  };
}
