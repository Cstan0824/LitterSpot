import { createHash } from "node:crypto";

export type VideoUploadRequestFingerprintInput = {
  cameraId: string;
  capturedAt?: string;
  isTest: boolean;
  frameIntervalSeconds?: number;
  floorConfidence?: number;
  binLocalizerConfidence?: number;
  focusRegion: Array<{ x: number; y: number }>;
};

export function videoUploadRequestFingerprint(
  input: VideoUploadRequestFingerprintInput,
  sourceSha256: string,
  effectiveFrameIntervalSeconds: number,
) {
  const canonical = {
    cameraId: input.cameraId,
    capturedAt: input.capturedAt ? new Date(input.capturedAt).toISOString() : null,
    isTest: input.isTest,
    frameIntervalSeconds: effectiveFrameIntervalSeconds,
    floorConfidence: input.floorConfidence ?? null,
    binLocalizerConfidence: input.binLocalizerConfidence ?? null,
    focusRegionNormalized: input.focusRegion.map(({ x, y }) => ({ x, y })),
    sourceSha256,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
