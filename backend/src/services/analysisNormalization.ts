import { createHash } from "node:crypto";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";

type Box = { x1: number; y1: number; x2: number; y2: number };
type Point = { x: number; y: number };

export const MAX_STORED_POLYGON_POINTS = 128;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function normalizeBox(box: Box, width: number, height: number) {
  return {
    x1: clamp(box.x1 / width),
    y1: clamp(box.y1 / height),
    x2: clamp(box.x2 / width),
    y2: clamp(box.y2 / height),
  };
}

export function simplifyPolygon(points: Point[], maxPoints = MAX_STORED_POLYGON_POINTS) {
  if (points.length <= maxPoints) return points;
  return Array.from({ length: maxPoints }, (_, index) => points[Math.floor(index * points.length / maxPoints)]);
}

export function normalizePolygon(points: Point[], width: number, height: number) {
  const normalized = points.map((point) => ({ x: clamp(point.x / width), y: clamp(point.y / height) }));
  return simplifyPolygon(normalized);
}

export function deterministicDetectionId(runId: string, issueType: string, entityId: string) {
  return createHash("sha256").update(runId).update("\0").update(issueType).update("\0").update(entityId).digest("hex");
}

export function normalizeAnalysis(result: PipelineAnalysisResponse, runId: string, floorThreshold: number) {
  const { width, height } = result.image;
  const people = result.people.map((person) => ({
    confidence: person.confidence,
    bboxNormalized: normalizeBox(person.bbox, width, height),
  }));
  const bins = result.bins.map((bin) => {
    const tracking = bin as typeof bin & {
      trackingId?: string | null;
      confirmed?: boolean;
      stale?: boolean;
      stableState?: "normal" | "full" | "overflow" | "unknown" | null;
    };
    return ({
    entityId: tracking.trackingId ?? `bin-${bin.binIndex}`,
    state: bin.state,
    stableState: tracking.stableState ?? null,
    confidence: bin.stateConfidence,
    localizerConfidence: bin.localizerConfidence,
    bboxNormalized: normalizeBox(bin.bbox, width, height),
    classificationRegionNormalized: normalizeBox(bin.classificationRegion, width, height),
    signals: bin.signals,
    confirmed: tracking.confirmed ?? null,
    stale: tracking.stale ?? false,
  });
  });
  const floorDetections = result.floorHazards.map((hazard, index) => {
    const entityId = `floor-${index + 1}`;
    return {
      id: deterministicDetectionId(runId, hazard.className, entityId),
      issueType: hazard.className,
      confidence: hazard.confidence,
      bboxNormalized: normalizeBox(hazard.bbox, width, height),
      polygonNormalized: normalizePolygon(hazard.polygon, width, height),
      entityId,
      modelKey: "floor_hazard",
      modelVersion: result.modelVersions.floorHazard,
      thresholdApplied: floorThreshold,
    };
  });
  const overflowDetections = result.bins.filter((bin) => {
    const tracking = bin as typeof bin & { stale?: boolean };
    return bin.state === "overflow" && !tracking.stale;
  }).map((bin) => {
    const tracking = bin as typeof bin & { trackingId?: string | null; confirmed?: boolean; stale?: boolean };
    const entityId = tracking.trackingId ?? `bin-${bin.binIndex}`;
    return {
      id: deterministicDetectionId(runId, "bin_overflow", entityId),
      issueType: "bin_overflow" as const,
      confidence: bin.stateConfidence,
      bboxNormalized: normalizeBox(bin.bbox, width, height),
      polygonNormalized: [],
      entityId,
      modelKey: "bin_state",
      modelVersion: result.modelVersions.binState,
      thresholdApplied: null,
      localizerConfidence: bin.localizerConfidence,
      signals: bin.signals,
      confirmed: tracking.confirmed ?? null,
      stale: tracking.stale ?? false,
    };
  });
  const detections = [...floorDetections, ...overflowDetections];
  return {
    people,
    bins,
    detections,
    issueKinds: [...new Set(detections.map((item) => item.issueType))],
    issueCounts: {
      floorLitter: detections.filter((item) => item.issueType === "floor_litter").length,
      binOverflow: detections.filter((item) => item.issueType === "bin_overflow").length,
      floorSpill: detections.filter((item) => item.issueType === "floor_spill").length,
    },
  };
}
