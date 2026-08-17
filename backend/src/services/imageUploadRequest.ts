import { createHash } from "node:crypto";

export type ImageUploadRequestFingerprintInput = {
  cameraId: string;
  capturedAt?: string;
  isTest: boolean;
  floorConfidence?: number;
  binLocalizerConfidence?: number;
  focusRegion: Array<{ x: number; y: number }>;
};

export function imageUploadRequestFingerprint(
  input: ImageUploadRequestFingerprintInput,
  sourceSha256: string,
) {
  const canonical = {
    cameraId: input.cameraId,
    capturedAt: input.capturedAt ? new Date(input.capturedAt).toISOString() : null,
    isTest: input.isTest,
    floorConfidence: input.floorConfidence ?? 0.25,
    binLocalizerConfidence: input.binLocalizerConfidence ?? 0.80,
    focusRegionNormalized: input.focusRegion.map(({ x, y }) => ({ x, y })),
    sourceSha256,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
