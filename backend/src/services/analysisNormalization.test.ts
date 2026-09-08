import { describe, expect, it } from "vitest";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { MAX_STORED_POLYGON_POINTS, deterministicDetectionId, normalizeAnalysis, normalizeBox, normalizePolygon, simplifyPolygon } from "./analysisNormalization.js";

const result: PipelineAnalysisResponse = {
  image: { width: 200, height: 100 },
  focusRegion: [],
  peopleCount: 1,
  people: [{ confidence: 0.9, bbox: { x1: 20, y1: 10, x2: 60, y2: 50 } }],
  bins: [{
    binIndex: 1, localizerConfidence: 0.8,
    bbox: { x1: 100, y1: 20, x2: 220, y2: 120 },
    classificationRegion: { x1: 90, y1: 10, x2: 200, y2: 100 },
    state: "overflow", stateConfidence: 0.91,
    signals: { binPresence: 0.9, fullness: 0.8, overflow: 0.91 },
    unknownReasons: [], processingTimeMs: 2,
  }],
  floorHazards: [{
    className: "floor_litter", confidence: 0.82,
    bbox: { x1: 10, y1: 20, x2: 30, y2: 40 },
    polygon: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }],
  }],
  modelVersions: { floorHazard: "floor-v1", people: "people-v1", binLocalizer: "localizer-v1", binState: "state-v1" },
  processingTimeMs: 5,
};

describe("analysis normalization", () => {
  it("normalizes and clamps pixel boxes", () => {
    expect(normalizeBox({ x1: -2, y1: 10, x2: 220, y2: 120 }, 200, 100)).toEqual({ x1: 0, y1: 0.1, x2: 1, y2: 1 });
  });

  it("creates issue detections without creating people detections", () => {
    const normalized = normalizeAnalysis(result, "run-1", 0.25);
    expect(normalized.people).toHaveLength(1);
    expect(normalized.floorHazards[0]).toMatchObject({
      className: "floor_litter",
      bboxNormalized: { x1: 0.05, y1: 0.2, x2: 0.15, y2: 0.4 },
    });
    expect(normalized.detections.map((item) => item.issueType).sort()).toEqual(["bin_overflow", "floor_litter"]);
    expect(normalized.issueCounts).toEqual({ floorLitter: 1, binOverflow: 1, floorSpill: 0 });
  });

  it("lets Node own overflow confirmation from the raw stateless result", () => {
    const normalized = normalizeAnalysis(result, "run-raw", 0.25);
    expect(normalized.issueCounts.binOverflow).toBe(1);
    expect(normalized.detections.find((item) => item.issueType === "bin_overflow"))
      .toMatchObject({ confirmed: null, stale: false });
  });

  it("uses stable detection IDs for retry-safe persistence", () => {
    expect(deterministicDetectionId("run", "floor_litter", "one")).toBe(deterministicDetectionId("run", "floor_litter", "one"));
    expect(deterministicDetectionId("run", "floor_litter", "one")).not.toBe(deterministicDetectionId("run", "floor_litter", "two"));
  });

  it("keeps small polygons and caps dense model masks", () => {
    const small = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPolygon(small)).toEqual(small);
    const dense = Array.from({ length: 1_000 }, (_, index) => ({ x: index, y: index }));
    expect(normalizePolygon(dense, 1_000, 1_000)).toHaveLength(MAX_STORED_POLYGON_POINTS);
  });
});
