import { HttpError } from "../shared/httpError.js";

export type SupportedImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export function detectSupportedImage(buffer: Buffer): SupportedImage {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  throw new HttpError(415, "The uploaded file is not a valid JPEG, PNG, or WebP image.");
}

export function validateDeclaredImageType(declaredType: string, detectedType: SupportedImage["mimeType"]) {
  const normalized = declaredType.trim().toLowerCase() === "image/jpg" ? "image/jpeg" : declaredType.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream" || normalized === "binary/octet-stream") return;
  if (normalized !== detectedType) {
    throw new HttpError(415, "The image content does not match its declared media type.");
  }
}
