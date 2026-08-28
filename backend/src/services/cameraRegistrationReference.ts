import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { writeMedia } from "./localMediaStorage.js";
import { getMediaContent } from "./mediaService.js";
import { detectSupportedVideo, validateDeclaredVideoType } from "./videoUploadValidation.js";

export type RegistrationReferencePayload = {
  referenceImageBase64: string;
  referenceFileName: string;
  referenceMimeType: string;
};

export type CameraRegistrationReferenceMedia = {
  id: string;
  contentUrl: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
};

export type CameraRegistrationVideoSource = CameraRegistrationReferenceMedia & {
  mediaType: "video";
};

function cleanOriginalName(value: string) {
  const finalSegment = value.replaceAll("\\", "/").split("/").pop() ?? "reference-frame";
  return finalSegment.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "reference-frame";
}

/**
 * Store a clean calibration frame without creating an analysis job.  The
 * resulting media asset belongs to the camera and can be passed unchanged to
 * the registered-frame AI envelope as the comparison reference.
 */
export async function createCameraRegistrationReference(
  cameraId: string,
  file: Express.Multer.File,
  actorUid: string,
): Promise<CameraRegistrationReferenceMedia> {
  const detected = detectSupportedImage(file.buffer);
  validateDeclaredImageType(file.mimetype, detected.mimeType);

  const mediaId = randomUUID();
  const mediaReference = firestore.collection("mediaAssets").doc(mediaId);
  const storageKey = `media/${mediaId}/registration-reference.${detected.extension}`;
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");

  await firestore.runTransaction(async (transaction) => {
    const cameraReference = firestore.collection("cameras").doc(cameraId);
    const cameraSnapshot = await transaction.get(cameraReference);
    const camera = cameraSnapshot.data();
    if (!cameraSnapshot.exists || camera?.status !== "active") {
      throw new HttpError(400, "Camera does not exist or is inactive.");
    }
    transaction.create(mediaReference, {
      kind: "original_upload",
      sourceType: "camera_registration",
      originalFileName: cleanOriginalName(file.originalname),
      storageKey,
      storageStatus: "pending",
      mimeType: detected.mimeType,
      byteSize: file.size,
      sha256,
      width: null,
      height: null,
      durationSeconds: null,
      parentMediaId: null,
      frameIndex: null,
      videoOffsetSeconds: null,
      siteId: String(camera.siteId),
      siteNameSnapshot: String(camera.siteNameSnapshot),
      zoneId: String(camera.zoneId),
      zoneNameSnapshot: String(camera.zoneNameSnapshot),
      cameraId: cameraSnapshot.id,
      cameraCodeSnapshot: String(camera.code),
      cameraNameSnapshot: String(camera.name),
      capturedAt: FieldValue.serverTimestamp(),
      isTest: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
  });

  try {
    await writeMedia(storageKey, file.buffer);
    await mediaReference.update({
      storageStatus: "available",
      storageCheckedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await mediaReference.update({
      storageStatus: "missing",
      storageCheckedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw new HttpError(500, "The registration reference frame could not be stored.");
  }

  return {
    id: mediaId,
    contentUrl: `/api/media/${mediaId}/content`,
    originalFileName: cleanOriginalName(file.originalname),
    mimeType: detected.mimeType,
    byteSize: file.size,
  };
}

/** Store the original registration video alongside the extracted clean frame.
 * The draft points at both assets so reopening the editor can restore
 * continuous video validation instead of silently degrading to image mode. */
export async function createCameraRegistrationVideoSource(
  cameraId: string,
  file: Express.Multer.File,
  actorUid: string,
): Promise<CameraRegistrationVideoSource> {
  if (file.buffer.length < 1) throw new HttpError(400, "The reference video is empty.");
  const detected = detectSupportedVideo(file.buffer.subarray(0, 16));
  validateDeclaredVideoType(file.mimetype, detected);

  const mediaId = randomUUID();
  const mediaReference = firestore.collection("mediaAssets").doc(mediaId);
  const storageKey = `media/${mediaId}/registration-source.${detected.extension}`;
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");

  await firestore.runTransaction(async (transaction) => {
    const cameraReference = firestore.collection("cameras").doc(cameraId);
    const cameraSnapshot = await transaction.get(cameraReference);
    const camera = cameraSnapshot.data();
    if (!cameraSnapshot.exists || camera?.status !== "active") {
      throw new HttpError(400, "Camera does not exist or is inactive.");
    }
    transaction.create(mediaReference, {
      kind: "original_upload",
      sourceType: "camera_registration_video",
      originalFileName: cleanOriginalName(file.originalname),
      storageKey,
      storageStatus: "pending",
      mimeType: detected.mimeType,
      byteSize: file.size,
      sha256,
      width: null,
      height: null,
      durationSeconds: null,
      parentMediaId: null,
      frameIndex: null,
      videoOffsetSeconds: null,
      siteId: String(camera.siteId),
      siteNameSnapshot: String(camera.siteNameSnapshot),
      zoneId: String(camera.zoneId),
      zoneNameSnapshot: String(camera.zoneNameSnapshot),
      cameraId: cameraSnapshot.id,
      cameraCodeSnapshot: String(camera.code),
      cameraNameSnapshot: String(camera.name),
      capturedAt: FieldValue.serverTimestamp(),
      isTest: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
  });

  try {
    await writeMedia(storageKey, file.buffer);
    await mediaReference.update({ storageStatus: "available", storageCheckedAt: FieldValue.serverTimestamp() });
  } catch {
    await mediaReference.update({ storageStatus: "missing", storageCheckedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    throw new HttpError(500, "The registration reference video could not be stored.");
  }

  return {
    id: mediaId,
    contentUrl: `/api/media/${mediaId}/content`,
    originalFileName: cleanOriginalName(file.originalname),
    mimeType: detected.mimeType,
    byteSize: file.size,
    mediaType: "video",
  };
}

/** Load the validated reference once per job; the AI adapter sends it in its
 * registered-frame envelope so the stateless process can compare lid changes. */
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
