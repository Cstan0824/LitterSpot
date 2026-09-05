import { describe, expect, it } from "vitest";
import { zoneAtPoint } from "./V2CameraCreationPage";

const size = { widthMeters: 100, heightMeters: 100 };
const zones = [
  { id: "left", zoneId: "left", zoneNameSnapshot: "Left Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 45, yMeters: 0 }, { xMeters: 45, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] },
  { id: "right", zoneId: "right", zoneNameSnapshot: "Right Zone", polygon: [{ xMeters: 55, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 55, yMeters: 100 }] },
];

describe("camera existing-zone map selection", () => {
  it("maps a click in a Zone polygon to that Zone", () => {
    expect(zoneAtPoint({ x: 25, y: 50 }, zones, size)?.zoneId).toBe("left");
    expect(zoneAtPoint({ x: 75, y: 50 }, zones, size)?.zoneId).toBe("right");
  });

  it("does not select the unzoned gap between polygons", () => {
    expect(zoneAtPoint({ x: 50, y: 50 }, zones, size)).toBeUndefined();
  });
});
