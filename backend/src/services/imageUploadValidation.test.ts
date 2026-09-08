import { describe, expect, it } from "vitest";
import { detectSupportedImage, readImageDimensions } from "./imageUploadValidation.js";

function png(width: number, height: number) {
  const value = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(value, 0);
  value.write("IHDR", 12, "ascii");
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

describe("image dimensions", () => {
  it("reads the uploaded Site background dimensions from PNG content", () => {
    const image = png(1536, 1024);
    const type = detectSupportedImage(image);
    expect(readImageDimensions(image, type)).toEqual({ width: 1536, height: 1024 });
  });

  it("rejects truncated image metadata", () => {
    expect(() => readImageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrow("missing its dimensions");
  });
});
