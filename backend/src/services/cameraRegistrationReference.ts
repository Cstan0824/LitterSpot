import { readFile } from "node:fs/promises";
import { getMediaContent } from "./mediaService.js";

export type RegistrationReferencePayload = {
  referenceImageBase64: string;
  referenceFileName: string;
  referenceMimeType: string;
};

/** Load the registered reference image for frame inference. */
export async function loadRegistrationReference(registration: Record<string, unknown> | null | undefined): Promise<RegistrationReferencePayload | null> {
  const mediaId = typeof registration?.referenceMediaId === "string" ? registration.referenceMediaId : "";
  if (!mediaId) return null;
  const media = await getMediaContent(mediaId);
  const contents = await readFile(media.filePath);
  return {
    referenceImageBase64: contents.toString("base64"),
    referenceFileName: media.originalFileName,
    referenceMimeType: media.mimeType,
  };
}
