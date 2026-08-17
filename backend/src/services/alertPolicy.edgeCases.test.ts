import { describe, expect, it } from "vitest";
import { evaluateIssueGroup, type DetectionEvidence, type NormalizedPoint } from "./alertPolicy.js";

function squareEvidence(id: string, x: number, y: number, size = 0.02, confidence = 0.80): DetectionEvidence {
  return {
    id,
    confidence,
    bboxNormalized: { x1: x, y1: y, x2: x + size, y2: y + size },
    polygonNormalized: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe("grouped cleanliness policy edge cases", () => {
  it("does not assign severity to eligible floor litter below the dirty-magnitude threshold", () => {
    const evaluation = evaluateIssueGroup(
      "floor_litter",
      [squareEvidence("small-litter", 0.10, 0.10)],
      false,
    );

    expect(evaluation).toMatchObject({
      createFlag: false,
      alertCandidate: false,
      severity: null,
      reason: "below_dirty_magnitude",
      eligibleDetectionIds: ["small-litter"],
    });
  });

  it("normalizes spatial distribution by cells inside a nonrectangular focus region", () => {
    const triangularRegion: NormalizedPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const detections = [
      squareEvidence("top-left", 0.08, 0.08),
      squareEvidence("top-middle", 0.42, 0.08),
      squareEvidence("middle-left", 0.08, 0.42),
    ];

    const fullFrame = evaluateIssueGroup("floor_litter", detections, false);
    const focused = evaluateIssueGroup("floor_litter", detections, false, triangularRegion);

    expect(focused.metrics.occupiedGridCells).toBe(3);
    expect(focused.metrics.spatialDistribution).toBeGreaterThan(fullFrame.metrics.spatialDistribution);
    expect(focused.metrics.spatialDistribution).toBe(1);
  });

  it("excludes out-of-region evidence from every floor-magnitude component", () => {
    const triangularRegion: NormalizedPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 },
    ];
    const outside = [
      squareEvidence("outside-1", 0.70, 0.70, 0.10),
      squareEvidence("outside-2", 0.82, 0.70, 0.10),
      squareEvidence("outside-3", 0.70, 0.82, 0.10),
    ];

    const evaluation = evaluateIssueGroup("floor_litter", outside, false, triangularRegion);

    expect(evaluation.metrics).toMatchObject({
      detectionCount: 0,
      mergedRegionCount: 0,
      coverageRatio: 0,
      occupiedGridCells: 0,
      spatialDistribution: 0,
      magnitudeScore: null,
    });
    expect(evaluation).toMatchObject({ createFlag: false, severity: null, reason: "outside_analysis_region" });
  });
});
