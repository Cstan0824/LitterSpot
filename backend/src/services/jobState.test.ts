import { describe, expect, it } from "vitest";
import { assertImageJobCanRetry, decideImageJobClaim, shouldAdvanceCameraLatestPointer } from "./jobState.js";

describe("image processing job transitions", () => {
  it("claims queued jobs and processing jobs whose lease expired", () => {
    expect(decideImageJobClaim("queued", null, 1_000)).toBe("claim");
    expect(decideImageJobClaim("processing", 999, 1_000)).toBe("claim");
  });

  it("makes completed processing idempotent", () => {
    expect(decideImageJobClaim("completed", null, 1_000)).toBe("completed");
  });

  it("rejects an active processing lease", () => {
    expect(() => decideImageJobClaim("processing", 1_001, 1_000)).toThrow("already being handled");
  });

  it("requires failed jobs to enter through retry", () => {
    expect(() => decideImageJobClaim("failed", null, 1_000)).toThrow("must be retried");
    expect(() => assertImageJobCanRetry("completed")).toThrow("Only failed jobs");
    expect(() => assertImageJobCanRetry("failed")).not.toThrow();
  });

  it("advances a camera latest pointer only for a matching location and non-older capture", () => {
    const matching = { cameraSiteId: "site-1", cameraZoneId: "zone-1", runSiteId: "site-1", runZoneId: "zone-1" };
    expect(shouldAdvanceCameraLatestPointer({ ...matching, latestCapturedAtMs: null, runCapturedAtMs: 100 })).toBe(true);
    expect(shouldAdvanceCameraLatestPointer({ ...matching, latestCapturedAtMs: 100, runCapturedAtMs: 100 })).toBe(true);
    expect(shouldAdvanceCameraLatestPointer({ ...matching, latestCapturedAtMs: 101, runCapturedAtMs: 100 })).toBe(false);
    expect(shouldAdvanceCameraLatestPointer({ ...matching, cameraZoneId: "zone-2", latestCapturedAtMs: null, runCapturedAtMs: 100 })).toBe(false);
    expect(shouldAdvanceCameraLatestPointer({ ...matching, cameraSiteId: "site-2", latestCapturedAtMs: null, runCapturedAtMs: 100 })).toBe(false);
  });
});
