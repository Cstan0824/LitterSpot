import { describe, expect, it } from "vitest";
import { shouldAdmitOperationalSample } from "./liveMonitoringService.js";

describe("live monitoring operational cadence", () => {
  it("keeps higher presentation inference from accelerating business rules", () => {
    expect(shouldAdmitOperationalSample(null, 1_000)).toBe(true);
    expect(shouldAdmitOperationalSample(1_000, 1_500)).toBe(false);
    expect(shouldAdmitOperationalSample(1_000, 1_900)).toBe(true);
  });
});
