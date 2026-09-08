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

export function readImageDimensions(buffer: Buffer, type = detectSupportedImage(buffer)) {
  if (type.mimeType === "image/png") {
    if (buffer.length < 24) throw new HttpError(415, "The PNG image is missing its dimensions.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type.mimeType === "image/jpeg") {
    let offset = 2;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (startOfFrame.has(marker)) return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
      offset += length;
    }
    throw new HttpError(415, "The JPEG image is missing its dimensions.");
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
    const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);
    return { width, height };
  }
  if (chunk === "VP8 " && buffer.length >= 30) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const width = 1 + buffer[21] + ((buffer[22] & 0x3f) << 8);
    const height = 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10);
    return { width, height };
  }
  throw new HttpError(415, "The WebP image is missing its dimensions.");
}
