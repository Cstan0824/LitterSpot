import { describe, expect, it } from "vitest";
import {
  ALERT_POLICY,
  evaluateIssueGroup,
  evaluateTemporalConfirmation,
  type DetectionEvidence,
} from "./alertPolicy.js";

function litter(id: string, x: number, y: number, size = 0.02, confidence = 0.80): DetectionEvidence {
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

describe("grouped cleanliness policy", () => {
  it("excludes test detections without creating a flag", () => {
    const result = evaluateIssueGroup("floor_litter", [litter("one", 0.1, 0.1)], true);
    expect(result).toMatchObject({ createFlag: false, alertCandidate: false, reason: "test_data" });
    expect(result.metrics.detectionCount).toBe(1);
  });

  it("retains below-confidence detections without a flag", () => {
    const result = evaluateIssueGroup("bin_overflow", [litter("one", 0.1, 0.1, 0.1, 0.49)], false);
    expect(result).toMatchObject({ createFlag: false, reason: "below_detection_confidence" });
    expect(result.rejectedDetectionIds).toEqual(["one"]);
  });

  it("records one or two small litter detections without creating a dirty-condition flag", () => {
    const one = evaluateIssueGroup("floor_litter", [litter("one", 0.1, 0.1)], false);
    const two = evaluateIssueGroup("floor_litter", [litter("one", 0.1, 0.1), litter("two", 0.7, 0.7)], false);
    expect(one).toMatchObject({ createFlag: false, alertCandidate: false, reason: "below_dirty_magnitude" });
    expect(two.alertCandidate).toBe(false);
  });

  it("uses merged regions, coverage, and distribution for a floor-litter dirty score", () => {
    const result = evaluateIssueGroup("floor_litter", [
      litter("one", 0.05, 0.05),
      litter("two", 0.45, 0.45),
      litter("three", 0.80, 0.80),
    ], false);
    expect(result).toMatchObject({ createFlag: true, alertCandidate: true, reason: "alert_candidate" });
    expect(result.metrics).toMatchObject({ detectionCount: 3, mergedRegionCount: 3, occupiedGridCells: 3 });
    expect(result.metrics.magnitudeScore).toBeGreaterThanOrEqual(ALERT_POLICY.rules.floor_litter.magnitudeThreshold);
  });

  it("merges nearby litter boxes instead of inflating the spatial burden", () => {
    const result = evaluateIssueGroup("floor_litter", [
      litter("one", 0.10, 0.10),
      litter("two", 0.115, 0.115),
      litter("three", 0.13, 0.13),
    ], false);
    expect(result.metrics.mergedRegionCount).toBe(1);
    expect(result.metrics.occupiedGridCells).toBe(1);
    expect(result.alertCandidate).toBe(false);
  });

  it("does not double-count overlapping polygon coverage", () => {
    const first = litter("one", 0.10, 0.10, 0.10);
    const duplicate = { ...first, id: "duplicate" };
    const single = evaluateIssueGroup("floor_litter", [first], false);
    const overlap = evaluateIssueGroup("floor_litter", [first, duplicate], false);
    expect(overlap.metrics.coverageRatio).toBe(single.metrics.coverageRatio);
  });

  it("uses the focus region as the floor-coverage denominator", () => {
    const detection = litter("one", 0.10, 0.10, 0.10);
    const full = evaluateIssueGroup("floor_litter", [detection], false);
    const focused = evaluateIssueGroup("floor_litter", [detection], false, [
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 },
    ]);
    expect(focused.metrics.coverageRatio).toBeGreaterThan(full.metrics.coverageRatio);
  });

  it("does not count litter wholly outside the selected floor region", () => {
    const result = evaluateIssueGroup("floor_litter", [
      litter("outside-one", 0.70, 0.70, 0.10),
      litter("outside-two", 0.80, 0.70, 0.10),
      litter("outside-three", 0.70, 0.80, 0.10),
    ], false, [
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 },
    ]);
    expect(result).toMatchObject({ createFlag: false, reason: "outside_analysis_region" });
    expect(result.metrics.detectionCount).toBe(0);
  });

  it("clips a straddling litter region into the selected floor metrics", () => {
    const result = evaluateIssueGroup("floor_litter", [litter("straddling", 0.45, 0.45, 0.10)], false, [
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 },
    ]);
    expect(result.metrics.detectionCount).toBe(1);
    expect(result.metrics.coverageRatio).toBeGreaterThan(0);
    expect(result.metrics.occupiedGridCells).toBe(1);
  });

  it("creates one overflow candidate using the strongest grouped confidence", () => {
    const result = evaluateIssueGroup("bin_overflow", [
      litter("bin-one", 0.1, 0.1, 0.2, 0.60),
      litter("bin-two", 0.6, 0.1, 0.2, 0.90),
    ], false);
    expect(result).toMatchObject({ createFlag: true, alertCandidate: true, severity: "critical" });
    expect(result.metrics).toMatchObject({ detectionCount: 2, maximumConfidence: 0.9 });
  });
});

describe("issue-specific temporal confirmation", () => {
  it("confirms floor litter when three of the latest five observations are dirty", () => {
    expect(evaluateTemporalConfirmation("floor_litter", [true, false, true, false, true]).confirmed).toBe(true);
    expect(evaluateTemporalConfirmation("floor_litter", [true, false, true, false, false]).confirmed).toBe(false);
  });

  it("confirms overflow faster at two of three observations", () => {
    expect(evaluateTemporalConfirmation("bin_overflow", [true, false, true])).toMatchObject({ confirmed: true, positiveCount: 2 });
  });

  it("requires two consecutive spill observations", () => {
    expect(evaluateTemporalConfirmation("floor_spill", [true, true]).confirmed).toBe(true);
    expect(evaluateTemporalConfirmation("floor_spill", [true, false, true]).confirmed).toBe(false);
  });
});
