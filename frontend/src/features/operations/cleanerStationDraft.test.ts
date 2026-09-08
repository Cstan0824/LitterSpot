import { describe, expect, it } from "vitest";
import { initialCleanerStation } from "./cleanerStationDraft";

describe("initialCleanerStation", () => {
  it("does not invent a Station Point for a new Cleaner", () => {
    expect(initialCleanerStation()).toBeNull();
  });

  it("preserves the saved Station Point while editing a Cleaner", () => {
    const station = { xMeters: 120, yMeters: 80 };
    expect(initialCleanerStation(station)).toEqual(station);
  });
});
