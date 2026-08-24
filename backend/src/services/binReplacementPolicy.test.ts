import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIN_REPLACEMENT_POLICY,
  evaluateBinReplacement,
  type BinReplacementObservation,
} from "./binReplacementPolicy.js";

function row(minute: number, overrides: Partial<BinReplacementObservation> = {}): BinReplacementObservation {
  return {
    createdAt: `2026-08-25T12:${String(minute).padStart(2, "0")}:00.000Z`,
    peopleCount: 3,
    isTest: false,
    bins: [{ state: "full", stableState: "full", confirmed: true, stale: false }],
    floorHazards: [],
    ...overrides,
  };
}

function replacementRows(): BinReplacementObservation[] {
  return Array.from({ length: 10 }, (_, minute) => row(minute, {
    peopleCount: minute === 8 ? 0 : 3,
    floorHazards: minute === 0 || minute === 3 || minute === 6
      ? [{ className: "floor_litter", bboxNormalized: { x1: 0.2 + minute / 100, y1: 0.7, x2: 0.24 + minute / 100, y2: 0.74 } }]
      : minute === 2
        ? [{ className: "floor_spill", bboxNormalized: { x1: 0.7, y1: 0.7, x2: 0.76, y2: 0.76 } }]
        : [],
  }));
}

describe("evaluateBinReplacement", () => {
  it("requires two consecutive passing evaluations before raising", () => {
    const first = evaluateBinReplacement("zone-a", replacementRows(), null, {
      evaluatedAt: new Date("2026-08-25T12:09:00.000Z"),
    });
    const second = evaluateBinReplacement("zone-a", replacementRows(), {
      recommended: first.recommended,
      triggerReason: first.triggerReason,
      raiseStreak: first.raiseStreak,
      clearStreak: first.clearStreak,
    }, { evaluatedAt: new Date("2026-08-25T12:09:00.000Z") });

    expect(first.decision).toBe("keep_current_bin");
    expect(first.raiseStreak).toBe(1);
    expect(second.decision).toBe("replacement_recommended");
    expect(second.recommended).toBe(true);
    expect(second.score).toBe(95);
    expect(second.highSignals).toEqual(["bin_pressure", "litter_pressure", "spill_pressure", "human_popularity"]);
  });

  it("does not treat one-frame raw overflow as capacity pressure", () => {
    const rows = Array.from({ length: 10 }, (_, minute) => row(minute, {
      bins: [{ state: "overflow", stableState: null, confirmed: false, stale: false }],
      peopleCount: 0,
    }));
    const result = evaluateBinReplacement("zone-a", rows, null, {
      evaluatedAt: new Date("2026-08-25T12:09:00.000Z"),
    });
    expect(result.signals.binPressure).toBe(0);
    expect(result.recommended).toBe(false);
    expect(result.decision).toBe("keep_current_bin");
  });

  it("honors a stable unknown over a raw full state and protects the prior decision when evidence degrades", () => {
    const rows = Array.from({ length: 10 }, (_, minute) => row(minute, {
      bins: [{ state: "full", stableState: "unknown", confirmed: false, stale: false }],
    }));
    const result = evaluateBinReplacement("zone-a", rows, {
      recommended: true,
      triggerReason: "capacity_pressure",
      raiseStreak: 0,
      clearStreak: 0,
    }, { evaluatedAt: new Date("2026-08-25T12:09:00.000Z") });
    expect(result.coverage.coverageReady).toBe(false);
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.recommended).toBe(true);
  });

  it("returns insufficient evidence for a short observation window", () => {
    const result = evaluateBinReplacement("zone-a", replacementRows().slice(0, 5), null, {
      evaluatedAt: new Date("2026-08-25T12:04:00.000Z"),
    });
    expect(result.coverage.coverageReady).toBe(false);
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.policyVersion).toBe(DEFAULT_BIN_REPLACEMENT_POLICY.version);
  });
});
