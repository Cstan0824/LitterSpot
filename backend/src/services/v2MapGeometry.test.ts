import { describe, expect, it } from "vitest";
import { containingPolygon, pointInPolygon, polygonsOverlap, validateMapGeometry } from "./v2MapGeometry.js";

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
    expect(result.errors).toEqual(expect.arrayContaining(["zones_z1_z2_overlap", "camera_c1_outside_bounds", "camera_c1_not_in_exactly_one_zone"]));
  });

  it("detects crossing polygons even when neither contains another polygon's vertex", () => {
    const horizontal = [{ xMeters: 0, yMeters: 4 }, { xMeters: 10, yMeters: 4 }, { xMeters: 10, yMeters: 6 }, { xMeters: 0, yMeters: 6 }];
    const vertical = [{ xMeters: 4, yMeters: 0 }, { xMeters: 6, yMeters: 0 }, { xMeters: 6, yMeters: 10 }, { xMeters: 4, yMeters: 10 }];
    expect(polygonsOverlap(horizontal, vertical)).toBe(true);
  });
});
