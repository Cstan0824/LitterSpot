import { describe, expect, it } from "vitest";
import { InMemoryBinReplacementRepository } from "./binReplacementRepository.js";
import { evaluateZoneBinReplacement, getPreviousZoneBinReplacement } from "./binReplacementService.js";
import type { BinReplacementObservation } from "./binReplacementPolicy.js";

function observation(minute: number): BinReplacementObservation {
  return {
    createdAt: `2026-08-25T12:${String(minute).padStart(2, "0")}:00.000Z`,
    peopleCount: 0,
    isTest: false,
    bins: [{ state: "normal", stableState: "normal", confirmed: true, stale: false }],
    floorHazards: [],
  };
}

describe("Firestore repository seam", () => {
  it("persists the current decision and carries its hysteresis state into the next evaluation", async () => {
    const repository = new InMemoryBinReplacementRepository({
      "zone-a": Array.from({ length: 10 }, (_, minute) => ({
        ...observation(minute),
        peopleCount: 3,
        bins: [{ state: "full", stableState: "full", confirmed: true, stale: false }],
        floorHazards: minute === 0 || minute === 3 || minute === 6
          ? [{ className: "floor_litter", bboxNormalized: null }]
          : minute === 2
            ? [{ className: "floor_spill", bboxNormalized: null }]
            : [],
      })),
    });
    const evaluatedAt = "2026-08-25T12:09:00.000Z";
    const first = await evaluateZoneBinReplacement("zone-a", { windowMinutes: 10, includeTestData: false, evaluatedAt }, repository);
    const second = await evaluateZoneBinReplacement("zone-a", { windowMinutes: 10, includeTestData: false, evaluatedAt }, repository);

    expect(first.raiseStreak).toBe(1);
    expect(second.recommended).toBe(true);
    expect(repository.getSavedRecommendation("zone-a")).toMatchObject({
      zoneId: "zone-a",
      decision: "replacement_recommended",
    });
    await expect(getPreviousZoneBinReplacement("zone-a", repository)).resolves.toMatchObject({
      zoneId: "zone-a",
      decision: "replacement_recommended",
      coverage: { validSamples: 10 },
    });
  });

  it("does not include test observations unless explicitly requested", async () => {
    const repository = new InMemoryBinReplacementRepository({
      "zone-a": Array.from({ length: 10 }, (_, minute) => ({ ...observation(minute), isTest: true })),
    });
    const evaluatedAt = "2026-08-25T12:09:00.000Z";
    const result = await evaluateZoneBinReplacement("zone-a", { windowMinutes: 10, includeTestData: false, evaluatedAt }, repository);
    expect(result.coverage.observedSamples).toBe(0);
    expect(result.decision).toBe("insufficient_evidence");
  });
});
