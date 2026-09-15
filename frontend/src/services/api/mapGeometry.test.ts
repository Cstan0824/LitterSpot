import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateZoneConflicts, zonePolygonConflict, type SiteMapPolygon, type ZoneConflictReason } from "./mapGeometry";

describe("frontend Site Map geometry", () => {
  it("matches the backend conformance fixture", () => {
    const repository = resolve(process.cwd(), "..");
    const cases = JSON.parse(readFileSync(resolve(repository, "shared/map-geometry-cases.json"), "utf8")) as Array<{ name: string; expected: ZoneConflictReason | null; left: SiteMapPolygon; right: SiteMapPolygon }>;
    for (const entry of cases) expect(zonePolygonConflict(entry.left, entry.right), entry.name).toBe(entry.expected);
  });

  it("names the conflicting Zone for immediate editor feedback", () => {
    const left = [{ xMeters: 0, yMeters: 0 }, { xMeters: 10, yMeters: 0 }, { xMeters: 10, yMeters: 10 }, { xMeters: 0, yMeters: 10 }];
    const right = [{ xMeters: 10, yMeters: 2 }, { xMeters: 20, yMeters: 2 }, { xMeters: 20, yMeters: 8 }, { xMeters: 10, yMeters: 8 }];
    expect(candidateZoneConflicts({ id: "food", name: "Food Court", polygon: left }, [{ id: "walkway", name: "Main Walkway", polygon: right }])).toEqual([{ zoneIds: ["food", "walkway"], reason: "shared_edge", message: "Food Court shares an edge with Main Walkway." }]);
  });
});
