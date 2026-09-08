import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { containingPolygon, pointInPolygon, polygonConflict, polygonsOverlap, validateMapGeometry, type Polygon, type ZoneConflictReason } from "./v2MapGeometry.js";

const square = [{ xMeters: 0, yMeters: 0 }, { xMeters: 10, yMeters: 0 }, { xMeters: 10, yMeters: 10 }, { xMeters: 0, yMeters: 10 }];

describe("V2 map geometry", () => {
  it("contains boundary and interior points", () => {
    expect(pointInPolygon({ xMeters: 5, yMeters: 5 }, square)).toBe(true);
    expect(pointInPolygon({ xMeters: 0, yMeters: 5 }, square)).toBe(true);
    expect(pointInPolygon({ xMeters: 11, yMeters: 5 }, square)).toBe(false);
  });

  it("requires points to resolve to exactly one zone", () => {
    expect(containingPolygon({ xMeters: 5, yMeters: 5 }, [{ id: "z1", polygon: square }])).toBe("z1");
    expect(containingPolygon({ xMeters: 20, yMeters: 20 }, [{ id: "z1", polygon: square }])).toBeNull();
  });

  it("rejects overlaps, self intersections and out of bounds geometry", () => {
    const result = validateMapGeometry({
      widthMeters: 20,
      heightMeters: 20,
      zones: [
        { id: "z1", polygon: square },
        { id: "z2", polygon: [{ xMeters: 5, yMeters: 5 }, { xMeters: 15, yMeters: 5 }, { xMeters: 15, yMeters: 15 }] },
      ],
      points: [{ label: "camera_c1", point: { xMeters: 25, yMeters: 1 } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["zones_z1_z2_edges_cross", "camera_c1_outside_bounds", "camera_c1_not_in_exactly_one_zone"]));
  });

  it("allows a Cleaner Station Point in an unzoned but in-bounds part of the Site Map", () => {
    const result = validateMapGeometry({ widthMeters: 20, heightMeters: 20, zones: [{ id: "z1", polygon: square }], points: [{ label: "cleaner_c1", point: { xMeters: 15, yMeters: 15 }, requiresZone: false }] });
    expect(result).toMatchObject({ valid: true, errors: [], issues: [], zoneConflicts: [] });
  });

  it("detects crossing polygons even when neither contains another polygon's vertex", () => {
    const horizontal = [{ xMeters: 0, yMeters: 4 }, { xMeters: 10, yMeters: 4 }, { xMeters: 10, yMeters: 6 }, { xMeters: 0, yMeters: 6 }];
    const vertical = [{ xMeters: 4, yMeters: 0 }, { xMeters: 6, yMeters: 0 }, { xMeters: 6, yMeters: 10 }, { xMeters: 4, yMeters: 10 }];
    expect(polygonsOverlap(horizontal, vertical)).toBe(true);
  });

  it("uses the shared conformance cases for every Zone contact class", () => {
    const root = process.cwd().endsWith("backend") ? resolve(process.cwd(), "..") : process.cwd();
    const cases = JSON.parse(readFileSync(resolve(root, "shared/map-geometry-cases.json"), "utf8")) as Array<{ name: string; expected: ZoneConflictReason | null; left: Polygon; right: Polygon }>;
    for (const entry of cases) expect(polygonConflict(entry.left, entry.right), entry.name).toBe(entry.expected);
  });

  it("rejects duplicate vertices and fewer than three unique points", () => {
    const result = validateMapGeometry({ widthMeters: 20, heightMeters: 20, zones: [{ id: "duplicate", polygon: [square[0], square[1], square[1], square[0]] }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["zone_duplicate_needs_three_unique_points", "zone_duplicate_duplicate_vertex", "zone_duplicate_zero_area"]));
  });

  it("returns safe structured conflict details for the editor", () => {
    const right = [{ xMeters: 10, yMeters: 2 }, { xMeters: 18, yMeters: 2 }, { xMeters: 18, yMeters: 8 }, { xMeters: 10, yMeters: 8 }];
    const result = validateMapGeometry({ widthMeters: 30, heightMeters: 30, zones: [{ id: "food-court", polygon: square }, { id: "walkway", polygon: right }] });
    expect(result.zoneConflicts).toEqual([expect.objectContaining({ kind: "zone_conflict", zoneIds: ["food-court", "walkway"], reason: "shared_edge", message: "Zones food-court and walkway share a boundary edge." })]);
  });
});
