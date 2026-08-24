import { describe, expect, it } from "vitest";
import { decideVideoJobClaim } from "./videoJobState.js";

describe("video job claim decisions", () => {
  it("claims queued and expired processing jobs", () => {
    expect(decideVideoJobClaim("queued", null, 1_000)).toBe("claim");
    expect(decideVideoJobClaim("processing", 999, 1_000)).toBe("claim");
    expect(decideVideoJobClaim("processing", null, 1_000)).toBe("claim");
  });

  it("makes completed processing idempotent", () => {
    expect(decideVideoJobClaim("completed", null, 1_000)).toBe("completed");
  });

  it("rejects active leases and non-processable states", () => {
    expect(() => decideVideoJobClaim("processing", 1_001, 1_000)).toThrow("already being handled");
    expect(() => decideVideoJobClaim("uploading", null, 1_000)).toThrow("still being stored");
    expect(() => decideVideoJobClaim("failed", null, 1_000)).toThrow("must be retried");
    expect(() => decideVideoJobClaim("cancelled", null, 1_000)).toThrow("cannot be processed");
    expect(() => decideVideoJobClaim("mystery", null, 1_000)).toThrow("unsupported status");
  });
});
