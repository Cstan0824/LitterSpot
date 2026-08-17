import { describe, expect, it } from "vitest";
import { cameraLatestPointerReset } from "./cameraLocationState.js";

describe("camera location state", () => {
  it("clears every latest-run pointer whenever the zone changes", () => {
    expect(cameraLatestPointerReset("zone-1", "zone-2")).toEqual({
      latestAnalysisRunId: null,
      latestAnalysisAt: null,
      latestCapturedAt: null,
    });
  });

  it("preserves latest-run pointers when the camera remains in its zone", () => {
    expect(cameraLatestPointerReset("zone-1", "zone-1")).toEqual({});
    expect(cameraLatestPointerReset("zone-1", undefined)).toEqual({});
  });
});
