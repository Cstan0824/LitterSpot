import { describe, expect, it } from "vitest";
import {
  isEligibleAssignmentPair,
  mapDistanceMeters,
  recentLocationStrength,
  technicalRetryDelays,
} from "./orchestratorPolicy.js";

describe("Orchestrator policy", () => {
  it("calculates Site Map distance without applying an eligibility cutoff", () => {
    expect(mapDistanceMeters({ xMeters: 0, yMeters: 0 }, { xMeters: 3, yMeters: 4 })).toBe(5);
  });

  it("uses the provisional recent Work freshness bands", () => {
    expect(recentLocationStrength(5)).toBe("strong");
    expect(recentLocationStrength(5.01)).toBe("weak");
    expect(recentLocationStrength(15)).toBe("weak");
    expect(recentLocationStrength(15.01)).toBe("expired");
  });

  it("accepts only an Alert and Cleaner pair supplied by Node", () => {
    const pairs = [{ alertId: "alert-a", cleanerId: "cleaner-a" }];
    expect(isEligibleAssignmentPair(pairs, "alert-a", "cleaner-a")).toBe(true);
    expect(isEligibleAssignmentPair(pairs, "alert-a", "invented")).toBe(false);
  });

  it("uses the configured technical retry schedule", () => {
    expect(technicalRetryDelays()).toEqual([1000, 2000, 4000]);
  });
});
