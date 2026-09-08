import { describe, expect, it } from "vitest";
import { initialBinPlacementLookback, lookbackFromSnapshot } from "./binPlacementLookback";

describe("Bin Placement lookback memory", () => {
  it("waits for the stored snapshot instead of assuming 30 days", () => {
    expect(initialBinPlacementLookback()).toBe("");
  });

  it("restores the last successful lookback from the persisted snapshot", () => {
    expect(lookbackFromSnapshot({ requestedLookbackDays: 7 })).toBe("7");
    expect(lookbackFromSnapshot({ requestedLookbackDays: 30 })).toBe("30");
  });
});
