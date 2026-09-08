import { describe, expect, it } from "vitest";
import { clampWorkPoint, workPointFromFraction, workPointInPolygon, workZoneAtPoint } from "./workTargetMap";

const zone = { id: "zone-1", zoneId: "zone-1", zoneNameSnapshot: "Food Court", polygon: [{ xMeters: 10, yMeters: 10 }, { xMeters: 40, yMeters: 10 }, { xMeters: 40, yMeters: 40 }, { xMeters: 10, yMeters: 40 }] };

describe("Manual Work target map", () => {
  it("derives the containing Zone but permits an Unzoned Area", () => {
    expect(workZoneAtPoint({ xMeters: 20, yMeters: 20 }, [zone])?.zoneNameSnapshot).toBe("Food Court");
    expect(workZoneAtPoint({ xMeters: 80, yMeters: 80 }, [zone])).toBeNull();
  });

  it("treats Zone boundaries as inside to match backend geometry", () => {
    expect(workPointInPolygon({ xMeters: 10, yMeters: 25 }, zone.polygon)).toBe(true);
  });

  it("converts and clamps pointer and keyboard coordinates to the Site Map", () => {
    expect(workPointFromFraction(.25, .75, { widthMeters: 200, heightMeters: 100 })).toEqual({ xMeters: 50, yMeters: 75 });
    expect(clampWorkPoint({ xMeters: 205, yMeters: -2 }, { widthMeters: 200, heightMeters: 100 })).toEqual({ xMeters: 200, yMeters: 0 });
  });
});
