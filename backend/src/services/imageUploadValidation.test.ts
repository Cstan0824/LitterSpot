import { describe, expect, it } from "vitest";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";

describe("image upload content validation", () => {
  it("detects JPEG, PNG, and WebP by their byte signatures", () => {
    expect(detectSupportedImage(Buffer.from([0xff, 0xd8, 0xff])).mimeType).toBe("image/jpeg");
    expect(detectSupportedImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).mimeType).toBe("image/png");
    expect(detectSupportedImage(Buffer.from("RIFF0000WEBP", "ascii")).mimeType).toBe("image/webp");
  });

  it("accepts Postman's generic binary declaration after signature validation", () => {
    expect(() => validateDeclaredImageType("application/octet-stream", "image/jpeg")).not.toThrow();
    expect(() => validateDeclaredImageType("binary/octet-stream", "image/png")).not.toThrow();
  });

  it("normalizes image/jpg and rejects a real declared-type mismatch", () => {
    expect(() => validateDeclaredImageType("image/jpg", "image/jpeg")).not.toThrow();
    expect(() => validateDeclaredImageType("image/png", "image/jpeg")).toThrow("does not match");
  });

  it("rejects unsupported image contents", () => {
    expect(() => detectSupportedImage(Buffer.from("not an image"))).toThrow("not a valid JPEG, PNG, or WebP");
  });
});
