import { describe, expect, it } from "vitest";
import { busyZoneScore, mergeMinuteMetric } from "./v2Analytics.js";
import { hasEnoughComparisonDays, interventionExclusionEndsAt, rankBinPlacementFactors } from "./v2BinPlacement.js";
import { siteMidnight, fullDayExclusion, shiftSiteInstant, validLocalDate } from "./phase11Calendar.js";

describe("Phase 11 analytics policies", () => {
  it("merges minute metrics without losing maxima", () => {
    expect(mergeMinuteMetric({ sampleAttemptCount: 1, successfulSampleCount: 1, failedSampleCount: 0, peopleSum: 2, peopleMax: 2, qualifyingLitterCount: 1, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 0 }, { sampleAttemptCount: 2, successfulSampleCount: 1, failedSampleCount: 1, peopleSum: 5, peopleMax: 4, qualifyingLitterCount: 0, qualifyingSpillCount: 1, qualifyingBinFullCount: 1, qualifyingBinOverflowCount: 0, simulationSampleCount: 1 })).toMatchObject({ sampleAttemptCount: 3, successfulSampleCount: 2, failedSampleCount: 1, peopleSum: 7, peopleMax: 4, qualifyingSpillCount: 1 });
  });
  it("uses equal thirds and deterministic busy-zone weighting", () => {
    expect(rankBinPlacementFactors({ peopleActivity: 10, cleaningFrequency: 5, binServiceFrequency: 0 }, { peopleActivity: 10, cleaningFrequency: 10, binServiceFrequency: 1 }).totalScore).toBeCloseTo(50);
    expect(busyZoneScore({ normalizedPeoplePressure: 1, normalizedActiveWorkPoints: 0 })).toBe(50);
  });
  it("normalizes like factors across Zones rather than normalizing unrelated units", () => {
    const maxima={peopleActivity:1000,cleaningFrequency:10,binServiceFrequency:10};
    expect(rankBinPlacementFactors(maxima,maxima).totalScore).toBeCloseTo(100);
    expect(rankBinPlacementFactors({peopleActivity:10,cleaningFrequency:10,binServiceFrequency:10},maxima).totalScore).toBeCloseTo(67);
  });
  it("uses real calendar dates, fractional offsets and DST day lengths", () => {
    expect(validLocalDate("2026-02-30")).toBe(false);
    expect(siteMidnight("2026-08-31","Asia/Kathmandu").toISOString()).toBe("2026-08-30T18:15:00.000Z");
    expect(+siteMidnight("2026-03-09","America/New_York")-+siteMidnight("2026-03-08","America/New_York")).toBe(23*3600000);
    expect(+siteMidnight("2026-11-02","America/New_York")-+siteMidnight("2026-11-01","America/New_York")).toBe(25*3600000);
    expect(fullDayExclusion(new Date("2026-08-31T02:00:00Z"),"Asia/Kuala_Lumpur").toISOString()).toBe("2026-09-02T16:00:00.000Z");
    expect(shiftSiteInstant(new Date("2026-03-07T17:00:00Z"),2,"America/New_York").toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });
  it("enforces the two-day comparison minimum and exclusion interval", () => {
    expect(hasEnoughComparisonDays(1)).toBe(false);
    expect(interventionExclusionEndsAt(new Date("2026-08-31T00:00:00.000Z")).toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});
