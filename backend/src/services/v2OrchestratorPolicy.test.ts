import { describe, expect, it } from "vitest";
import { nextCandidateAfterConflict, selectCandidate, technicalRetryDelays } from "./v2OrchestratorPolicy.js";

describe("V2 Orchestrator policy", () => {
  it("selects the nearest available candidate without eligibility cutoffs", () => {
    const candidates = [{ cleanerId: "far", distanceMeters: 1000, available: true }, { cleanerId: "near", distanceMeters: 10, available: true }, { cleanerId: "busy", distanceMeters: 1, available: false }];
    expect(selectCandidate(candidates, new Set())?.cleanerId).toBe("near");
    expect(nextCandidateAfterConflict(candidates, new Set(), "near")?.cleanerId).toBe("far");
  });
  it("uses the configured technical retry schedule", () => { expect(technicalRetryDelays()).toEqual([1000, 2000, 4000]); });
});

