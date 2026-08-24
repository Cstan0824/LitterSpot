import { describe, expect, it } from "vitest";
import { imageUploadRequestFingerprint } from "./imageUploadRequest.js";

const input = {
  cameraId: "camera-1",
  capturedAt: "2026-08-17T00:00:00.000Z",
  isTest: false,
  focusRegion: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
};

describe("image upload request fingerprint", () => {
  it("is deterministic and treats explicit defaults as the same request", () => {
    const implicit = imageUploadRequestFingerprint(input, "sha-1");
    const explicit = imageUploadRequestFingerprint({
      ...input,
      floorConfidence: 0.25,
      binLocalizerConfidence: 0.80,
    }, "sha-1");
    expect(implicit).toBe(explicit);
    expect(implicit).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes for every semantically relevant file or processing input", () => {
    const baseline = imageUploadRequestFingerprint(input, "sha-1");
    for (const changed of [
      imageUploadRequestFingerprint(input, "sha-2"),
      imageUploadRequestFingerprint({ ...input, cameraId: "camera-2" }, "sha-1"),
      imageUploadRequestFingerprint({ ...input, isTest: true }, "sha-1"),
      imageUploadRequestFingerprint({ ...input, floorConfidence: 0.5 }, "sha-1"),
      imageUploadRequestFingerprint({ ...input, capturedAt: "2026-08-18T00:00:00.000Z" }, "sha-1"),
      imageUploadRequestFingerprint({ ...input, focusRegion: [] }, "sha-1"),
    ]) expect(changed).not.toBe(baseline);
  });
});
