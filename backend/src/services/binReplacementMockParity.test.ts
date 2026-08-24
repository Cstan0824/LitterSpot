import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateBinReplacement, type BinReplacementObservation } from "./binReplacementPolicy.js";

type Fixture = {
  rows: Array<{
    createdAt: string;
    peopleCount: number;
    payload: {
      image?: { width?: number; height?: number };
      bins?: Array<Record<string, unknown>>;
      floorHazards?: Array<Record<string, unknown>>;
    };
  }>;
};

function fixtureRows(name: string): BinReplacementObservation[] {
  const fixtureRoot = fileURLToPath(new URL("../../../mock-data/bin-placement-prototype/", import.meta.url));
  const path = resolve(fixtureRoot, name);
  const fixture = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  return fixture.rows.map((row) => {
    const width = Number(row.payload.image?.width ?? 1);
    const height = Number(row.payload.image?.height ?? 1);
    return {
      createdAt: row.createdAt,
      peopleCount: row.peopleCount,
      isTest: false,
      bins: (row.payload.bins ?? []).map((bin) => ({
        state: bin.state === "normal" || bin.state === "full" || bin.state === "overflow" || bin.state === "unknown" ? bin.state : "unknown",
        stableState: bin.stableState === "normal" || bin.stableState === "full" || bin.stableState === "overflow" || bin.stableState === "unknown" ? bin.stableState : null,
        confirmed: typeof bin.confirmed === "boolean" ? bin.confirmed : null,
        stale: Boolean(bin.stale),
      })),
      floorHazards: (row.payload.floorHazards ?? []).flatMap((hazard) => {
        if (hazard.className !== "floor_litter" && hazard.className !== "floor_spill") return [];
        const box = hazard.bbox as Record<string, unknown> | undefined;
        const coordinates = box ? ["x1", "y1", "x2", "y2"].map((key) => Number(box[key])) : [];
        return [{
          className: hazard.className,
          bboxNormalized: coordinates.every(Number.isFinite)
            ? { x1: coordinates[0] / width, y1: coordinates[1] / height, x2: coordinates[2] / width, y2: coordinates[3] / height }
            : null,
        }];
      }),
    };
  });
}

describe("Firestore policy parity against the short-window mock oracle", () => {
  it.each([
    ["replacement-needed.json", 95, "replacement_recommended"],
    ["keep-current-bin.json", 13.3, "keep_current_bin"],
    ["temporary-crowd.json", 12.5, "keep_current_bin"],
    ["insufficient-coverage.json", 53.3, "insufficient_evidence"],
  ])("matches %s benchmark after hysteresis", (fixture, expectedScore, expectedDecision) => {
    const rows = fixtureRows(fixture);
    const evaluatedAt = new Date("2026-08-25T12:09:00.000Z");
    const first = evaluateBinReplacement("zone-a", rows, null, { evaluatedAt });
    const second = evaluateBinReplacement("zone-a", rows, {
      recommended: first.recommended,
      triggerReason: first.triggerReason,
      raiseStreak: first.raiseStreak,
      clearStreak: first.clearStreak,
    }, { evaluatedAt });
    expect(second.score).toBe(expectedScore);
    expect(second.decision).toBe(expectedDecision);
  });
});
