import { describe, expect, it } from "vitest";
import { analysisListQuerySchema, detectionListQuerySchema, imageUploadSchema, jobListQuerySchema, mediaListQuerySchema, videoUploadSchema } from "./media.js";

describe("media request schemas", () => {
  it("parses a test image upload and normalized focus region", () => {
    const result = imageUploadSchema.parse({
      cameraId: "camera-document-id",
      clientRequestId: "manual-test-001",
      isTest: "true",
      focusRegion: '[{"x":0.1,"y":0.2},{"x":0.9,"y":0.2},{"x":0.5,"y":0.9}]',
    });
    expect(result.isTest).toBe(true);
    expect(result.focusRegion).toHaveLength(3);
  });

  it("does not coerce the string false to true", () => {
    expect(imageUploadSchema.parse({ cameraId: "camera-id", clientRequestId: "request-001", isTest: "false" }).isTest).toBe(false);
  });

  it("rejects traversal-shaped request IDs and incomplete polygons", () => {
    expect(imageUploadSchema.safeParse({ cameraId: "camera-id", clientRequestId: "../../bad" }).success).toBe(false);
    expect(imageUploadSchema.safeParse({ cameraId: "camera-id", clientRequestId: "request-002", focusRegion: '[{"x":0,"y":0}]' }).success).toBe(false);
  });

  it("rejects zero-area and self-intersecting focus polygons", () => {
    const base = { cameraId: "camera-id", clientRequestId: "request-focus-validation" };
    expect(imageUploadSchema.safeParse({ ...base, focusRegion: '[{"x":0,"y":0},{"x":0.5,"y":0.5},{"x":1,"y":1}]' }).success).toBe(false);
    expect(imageUploadSchema.safeParse({ ...base, focusRegion: '[{"x":0,"y":0},{"x":1,"y":1},{"x":0,"y":1},{"x":1,"y":0}]' }).success).toBe(false);
  });

  it("bounds media and job list queries", () => {
    expect(mediaListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(mediaListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(jobListQuerySchema.parse({}).status).toBe("all");
    expect(analysisListQuerySchema.parse({}).limit).toBe(25);
    expect(analysisListQuerySchema.parse({ cursor: "YWJjMTIz" }).cursor).toBe("YWJjMTIz");
    expect(detectionListQuerySchema.parse({ issueType: "floor_litter" }).issueType).toBe("floor_litter");
    expect(mediaListQuerySchema.parse({ cursor: "YWJjMTIz" }).cursor).toBe("YWJjMTIz");
    expect(jobListQuerySchema.safeParse({ cursor: "not+a+cursor" }).success).toBe(false);
    expect(detectionListQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
  });

  it("parses bounded video upload controls and defaults test mode", () => {
    const result = videoUploadSchema.parse({
      cameraId: "camera-id",
      clientRequestId: "video-request-001",
      frameIntervalSeconds: "2",
      isTest: "false",
    });
    expect(result).toMatchObject({ frameIntervalSeconds: 2, isTest: false, focusRegion: [] });
    expect(videoUploadSchema.safeParse({
      cameraId: "camera-id",
      clientRequestId: "video-request-002",
      frameIntervalSeconds: "0.5",
    }).success).toBe(false);
  });
});
