import { describe, expect, it } from "vitest";
import {
  detectSupportedVideo,
  parseVideoProbe,
  validateDeclaredVideoType,
} from "./videoUploadValidation.js";

describe("video upload validation", () => {
  it("recognizes MP4 and WebM signatures and rejects mislabeled content", () => {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(8)]);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)]);
    expect(detectSupportedVideo(mp4)).toEqual({ mimeType: "video/mp4", extension: "mp4" });
    expect(detectSupportedVideo(webm)).toEqual({ mimeType: "video/webm", extension: "webm" });
    expect(() => validateDeclaredVideoType("video/webm", detectSupportedVideo(mp4))).toThrow("does not match");
    expect(() => detectSupportedVideo(Buffer.alloc(16))).toThrow("genuine MP4 and WebM");
  });

  it("accepts safe client MIME aliases after content detection", () => {
    const mp4 = { mimeType: "video/mp4", extension: "mp4" } as const;
    const webm = { mimeType: "video/webm", extension: "webm" } as const;

    expect(() => validateDeclaredVideoType("application/octet-stream", mp4)).not.toThrow();
    expect(() => validateDeclaredVideoType("application/mp4", mp4)).not.toThrow();
    expect(() => validateDeclaredVideoType("video/quicktime", mp4)).not.toThrow();
    expect(() => validateDeclaredVideoType("VIDEO/MP4; charset=binary", mp4)).not.toThrow();
    expect(() => validateDeclaredVideoType("application/octet-stream", webm)).not.toThrow();
    expect(() => validateDeclaredVideoType("application/webm", webm)).not.toThrow();

    expect(() => validateDeclaredVideoType("video/webm", mp4)).toThrow("does not match");
    expect(() => validateDeclaredVideoType("video/mp4", webm)).toThrow("does not match");
    expect(() => validateDeclaredVideoType("text/plain", mp4)).toThrow("does not match");
    expect(() => validateDeclaredVideoType("", mp4)).toThrow("does not match");
  });

  it("parses a genuine video stream", () => {
    const probe = parseVideoProbe({
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.1" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
    }, { mimeType: "video/mp4", extension: "mp4" });
    expect(probe).toMatchObject({ durationSeconds: 10.1, width: 1920, height: 1080, codecName: "h264" });
  });

  it("falls back to the container duration when the stream duration is unavailable", () => {
    expect(parseVideoProbe({
      format: { format_name: "webm", duration: "3.25" },
      streams: [{ codec_type: "video", codec_name: "vp9", duration: "N/A", width: 640, height: 360 }],
    }, { mimeType: "video/webm", extension: "webm" }).durationSeconds).toBe(3.25);
  });

  it("rejects audio-only and mismatched container metadata", () => {
    expect(() => parseVideoProbe({
      format: { format_name: "webm", duration: 10 }, streams: [{ codec_type: "audio" }],
    }, { mimeType: "video/webm", extension: "webm" })).toThrow("video stream");
    expect(() => parseVideoProbe({
      format: { format_name: "matroska", duration: 10 }, streams: [{ codec_type: "video", width: 10, height: 10 }],
    }, { mimeType: "video/webm", extension: "webm" })).toThrow("container");
  });
});
