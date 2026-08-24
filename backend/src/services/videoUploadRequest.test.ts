import { describe, expect, it } from "vitest";
import { videoUploadRequestFingerprint } from "./videoUploadRequest.js";

const request = {
  cameraId: "camera-1",
  capturedAt: "2026-08-13T00:00:00+08:00",
  isTest: true,
  frameIntervalSeconds: 2,
  floorConfidence: 0.25,
  focusRegion: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
};

describe("video upload request fingerprint", () => {
  it("is deterministic and canonicalizes equivalent capture timestamps", () => {
    const first = videoUploadRequestFingerprint(request, "abc", 2);
    const equivalent = videoUploadRequestFingerprint({
      ...request,
      capturedAt: "2026-08-12T16:00:00.000Z",
    }, "abc", 2);
    expect(equivalent).toBe(first);
  });

  it("changes when any behavior-affecting input changes", () => {
    const baseline = videoUploadRequestFingerprint(request, "abc", 2);
    expect(videoUploadRequestFingerprint({ ...request, isTest: false }, "abc", 2)).not.toBe(baseline);
    expect(videoUploadRequestFingerprint(request, "different", 2)).not.toBe(baseline);
    expect(videoUploadRequestFingerprint(request, "abc", 3)).not.toBe(baseline);
    expect(videoUploadRequestFingerprint({ ...request, focusRegion: [] }, "abc", 2)).not.toBe(baseline);
  });
});
