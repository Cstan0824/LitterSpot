import { describe, expect, it } from "vitest";
import { buildFrameExtractionArguments, VideoFrameExtractionError, videoFrameOffset } from "./videoFrameExtraction.js";

describe("video frame extraction plan", () => {
  it("builds deterministic bounded offsets", () => {
    expect(videoFrameOffset(0, 2, 10)).toBe(0);
    expect(videoFrameOffset(4, 2, 10)).toBe(8);
    expect(videoFrameOffset(5, 2, 10)).toBeCloseTo(9.999);
    expect(() => videoFrameOffset(-1, 2, 10)).toThrow("non-negative");
  });

  it("uses ffmpeg image-pipe extraction without shell interpolation", () => {
    const args = buildFrameExtractionArguments("/tmp/video with spaces.mp4", 2.5);
    expect(args).toContain("/tmp/video with spaces.mp4");
    expect(args).toContain("2.500");
    expect(args.at(-1)).toBe("pipe:1");
  });

  it("marks an individual undecodable frame with a distinct recoverable error", () => {
    const error = new VideoFrameExtractionError(2.5, "bad frame");
    expect(error.status).toBe(422);
    expect(error.details).toMatchObject({ code: "VIDEO_FRAME_EXTRACTION_FAILED" });
  });
});
