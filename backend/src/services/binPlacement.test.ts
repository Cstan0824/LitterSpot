import { describe, expect, it } from "vitest";
import { hasEnoughComparisonDays, interventionExclusionEndsAt, rankBinPlacementFactors } from "./binPlacement.js";

describe("Bin Placement", () => {
  it("ranks equal thirds and excludes a Zone for two days", () => {
    expect(rankBinPlacementFactors({ peopleActivity: 1, cleaningFrequency: 1, binServiceFrequency: 1 }).totalScore).toBeCloseTo(100);
    expect(interventionExclusionEndsAt(new Date("2026-08-30T00:00:00.000Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(hasEnoughComparisonDays(2)).toBe(true);
    expect(hasEnoughComparisonDays(1)).toBe(false);
  });
});

