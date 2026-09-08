import { describe, expect, it } from "vitest";
import { nearestZoneForStation } from "./stationProximity";

const zones = [
  { id: "entrance", zoneId: "entrance", zoneNameSnapshot: "Main Entrance", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 10, yMeters: 0 }, { xMeters: 10, yMeters: 10 }, { xMeters: 0, yMeters: 10 }] },
  { id: "food", zoneId: "food", zoneNameSnapshot: "Food Court", polygon: [{ xMeters: 20, yMeters: 0 }, { xMeters: 30, yMeters: 0 }, { xMeters: 30, yMeters: 10 }, { xMeters: 20, yMeters: 10 }] },
];

describe("nearestZoneForStation", () => {
  it("uses zero distance when the Station Point is inside a Zone", () => expect(nearestZoneForStation({ xMeters: 5, yMeters: 5 }, zones)).toMatchObject({ id: "entrance", distanceMeters: 0 }));
  it("measures shortest distance to a Zone boundary for an unzoned Station Point", () => expect(nearestZoneForStation({ xMeters: 15, yMeters: 5 }, zones)).toMatchObject({ id: "food", distanceMeters: 5 }));
});
