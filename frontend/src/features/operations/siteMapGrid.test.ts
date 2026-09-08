import { describe, expect, it } from "vitest";
import { recommendedSiteMapGridInterval, siteMapGridSummary } from "./siteMapGrid";

describe("Site Map grid recommendation", () => {
  it.each([
    [100, 5],
    [300, 10],
    [450, 15],
    [600, 20],
    [900, 30],
    [1500, 50]
  ])("recommends a practical interval for a %sm-wide map", (widthMeters, intervalMeters) => {
    expect(recommendedSiteMapGridInterval(widthMeters)).toBe(intervalMeters);
  });

  it("extends the practical rounding pattern for unusually large maps", () => {
    expect(recommendedSiteMapGridInterval(3600)).toBe(200);
    expect(recommendedSiteMapGridInterval(15000)).toBe(500);
  });

  it("returns no recommendation for invalid widths", () => {
    expect(recommendedSiteMapGridInterval(0)).toBeNull();
    expect(recommendedSiteMapGridInterval(Number.NaN)).toBeNull();
    expect(recommendedSiteMapGridInterval(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("calculates the live row, column, and cell counts", () => {
    expect(siteMapGridSummary(600, 400, 20)).toEqual({ columns: 30, rows: 20, totalCells: 600 });
    expect(siteMapGridSummary(101, 81, 5)).toEqual({ columns: 21, rows: 17, totalCells: 357 });
  });

  it("does not produce counts for invalid dimensions or intervals", () => {
    expect(siteMapGridSummary(600, 400, 0)).toBeNull();
    expect(siteMapGridSummary(Number.NaN, 400, 20)).toBeNull();
    expect(siteMapGridSummary(600, Number.POSITIVE_INFINITY, 20)).toBeNull();
  });
});
