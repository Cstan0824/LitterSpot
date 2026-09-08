import { describe, expect, it } from "vitest";
import { alertZoneDisplayName } from "./alertPresentation";

describe("Alert Zone presentation", () => {
  const id = "da819384-347a-4b5a-8a53-65e013956d8a";
  const names = new Map([[id, "Food Court"]]);

  it("keeps a historical Zone name snapshot", () => {
    expect(alertZoneDisplayName({ zoneId: id, zoneNameSnapshot: "Old Food Hall" }, names)).toBe("Old Food Hall");
  });

  it("replaces an ID or UUID snapshot with the current Zone name", () => {
    expect(alertZoneDisplayName({ zoneId: id, zoneNameSnapshot: id }, names)).toBe("Food Court");
    expect(alertZoneDisplayName({ zoneId: id, zoneNameSnapshot: "e68a4a51-d640-4144-a51e-fcf8aeb0d8a2" }, names)).toBe("Food Court");
  });

  it("never exposes an unresolved internal Zone ID", () => {
    expect(alertZoneDisplayName({ zoneId: "missing-zone", zoneNameSnapshot: "missing-zone" }, new Map())).toBe("Unknown Zone");
  });
});
