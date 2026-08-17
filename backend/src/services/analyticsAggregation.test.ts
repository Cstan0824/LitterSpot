import { describe, expect, it } from "vitest";
import {
  applyPersistenceObservation,
  deriveRunAnalyticsContribution,
  hourlyBucketBounds,
} from "./analyticsAggregation.js";

describe("hourly analytics aggregation", () => {
  it("uses UTC hour boundaries", () => {
    const result = hourlyBucketBounds(Date.parse("2026-08-13T12:34:56.789Z"));
    expect(new Date(result.bucketStartMs).toISOString()).toBe("2026-08-13T12:00:00.000Z");
    expect(new Date(result.bucketEndMs).toISOString()).toBe("2026-08-13T13:00:00.000Z");
  });

  it("counts positive samples and qualifying entities without counting negative groups", () => {
    const result = deriveRunAnalyticsContribution({
      id: "run-1",
      siteId: "site-1",
      zoneId: "zone-1",
      cameraId: "camera-1",
      capturedAtMs: 10_000,
      peopleCount: 4,
      modelVersions: ["people-v1", "floor-v1", "floor-v1"],
      observations: [
        { issueType: "floor_litter", positive: true, eligibleDetectionCount: 3 },
        { issueType: "floor_spill", positive: false, eligibleDetectionCount: 2 },
        { issueType: "bin_overflow", positive: false, eligibleDetectionCount: 1 },
      ],
    }, {});
    expect(result.contribution).toMatchObject({
      successfulSampleCount: 1,
      peopleCountSum: 4,
      peoplePresentSamples: 1,
      litterPositiveSamples: 1,
      litterDetectionCount: 3,
      spillPositiveSamples: 0,
      spillDetectionCount: 0,
      overflowPositiveSamples: 0,
      overflowDetectionCount: 0,
      modelVersions: ["floor-v1", "people-v1"],
    });
  });

  it("approximates persistence only between consecutive positive samples within the issue horizon", () => {
    const previous = { lastAnalysisRunId: "run-1", lastCapturedAtMs: 1_000, lastPositive: true };
    expect(applyPersistenceObservation(previous, {
      analysisRunId: "run-2", capturedAtMs: 601_000, positive: true, issueType: "floor_litter",
    }).persistenceSeconds).toBe(600);
    expect(applyPersistenceObservation(previous, {
      analysisRunId: "run-2", capturedAtMs: 1_802_000, positive: true, issueType: "floor_litter",
    }).persistenceSeconds).toBe(0);
    expect(applyPersistenceObservation(previous, {
      analysisRunId: "run-2", capturedAtMs: 601_000, positive: false, issueType: "floor_litter",
    }).persistenceSeconds).toBe(0);
  });

  it("does not mutate the series or add persistence for out-of-order samples", () => {
    const previous = { lastAnalysisRunId: "newer", lastCapturedAtMs: 20_000, lastPositive: true };
    const result = applyPersistenceObservation(previous, {
      analysisRunId: "older", capturedAtMs: 10_000, positive: true, issueType: "bin_overflow",
    });
    expect(result).toEqual({ next: previous, persistenceSeconds: 0, outOfOrder: true });
  });
});

