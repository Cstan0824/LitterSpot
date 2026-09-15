import { describe, expect, it } from "vitest";
import { hasEnoughComparisonDays, interventionExclusionEndsAt, rankBinPlacementFactors } from "./v2BinPlacement.js";
import { siteMidnight, fullDayExclusion, shiftSiteInstant, validLocalDate } from "./phase11Calendar.js";

describe("Phase 11 analytics policies", () => {
  it("uses equal thirds for bin-placement factors", () => {
    expect(rankBinPlacementFactors({ peopleActivity: 10, cleaningFrequency: 5, binServiceFrequency: 0 }, { peopleActivity: 10, cleaningFrequency: 10, binServiceFrequency: 1 }).totalScore).toBeCloseTo(50);
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
