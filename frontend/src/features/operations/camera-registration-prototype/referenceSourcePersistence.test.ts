import { describe, expect, it } from "vitest";
import type { CameraRegistrationWorkspace } from "../../../services/locationAPI";
import { restorableVideoSource } from "./referenceSourcePersistence";

describe("restorableVideoSource", () => {
  it("restores video behavior from a reopened registration workspace", () => {
    const workspace = {
      registration: {
        schemaVersion: 2,
        referenceMediaId: "frame-1",
        referenceSource: { type: "video", mediaId: "video-1", capturedFrameTimeSeconds: 2.25 },
        sourceWidth: 1280,
        sourceHeight: 720,
        walkableFloorPolygon: [],
        bins: [],
      },
      sourceMedia: {
        id: "video-1",
        contentUrl: "/api/media/video-1/content",
        originalFileName: "camera.mp4",
        mimeType: "video/mp4",
        byteSize: 1024,
        durationSeconds: 4,
        available: true,
      },
    } as unknown as CameraRegistrationWorkspace;

    expect(restorableVideoSource(workspace)).toEqual({
      mediaId: "video-1",
      contentUrl: "/api/media/video-1/content",
      fileName: "camera.mp4",
      mimeType: "video/mp4",
      duration: 4,
      capturedFrameTime: 2.25,
    });
  });

  it("does not reinterpret an image registration as video", () => {
    expect(restorableVideoSource({
      registration: { referenceSource: { type: "image" } },
      sourceMedia: null,
    } as unknown as CameraRegistrationWorkspace)).toBeUndefined();
  });
});
