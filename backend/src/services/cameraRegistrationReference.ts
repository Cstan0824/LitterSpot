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

export type CameraRegistrationAttachment = CameraRegistrationReferenceMedia & {
  mediaType: "image" | "video";
  createdAt: string | null;
};

function cleanOriginalName(value: string) {
  const finalSegment = value.replaceAll("\\", "/").split("/").pop() ?? "reference-frame";
  return finalSegment.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "reference-frame";
}

function attachmentMediaType(mimeType: string): "image" | "video" {
  return mimeType.startsWith("image/") ? "image" : "video";
}

function serializeAttachment(snapshot: FirebaseFirestore.QueryDocumentSnapshot): CameraRegistrationAttachment {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    contentUrl: `/api/media/${snapshot.id}/content`,
    originalFileName: String(data.originalFileName ?? "camera-attachment"),
    mimeType: String(data.mimeType ?? "application/octet-stream"),
    byteSize: Number(data.byteSize ?? 0),
    mediaType: attachmentMediaType(String(data.mimeType ?? "")),
    createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
  };
}

function attachmentFileType(file: Express.Multer.File) {
  if (file.buffer.length < 1) throw new HttpError(400, "The camera attachment is empty.");
  try {
    const image = detectSupportedImage(file.buffer);
    validateDeclaredImageType(file.mimetype, image.mimeType);
    return { ...image, mediaType: "image" as const };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 415) throw error;
  }
  const video = detectSupportedVideo(file.buffer.subarray(0, 16));
  validateDeclaredVideoType(file.mimetype, video);
  return { ...video, mediaType: "video" as const };
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

/** Store optional demonstration evidence on a camera without creating an
 * inference job. These attachments are intentionally separate from the clean
 * reference media used for registered-bin state comparison. */
export async function createCameraRegistrationAttachment(
  cameraId: string,
  file: Express.Multer.File,
  actorUid: string,
): Promise<CameraRegistrationAttachment> {
  const detected = attachmentFileType(file);
  const mediaId = randomUUID();
  const mediaReference = firestore.collection("mediaAssets").doc(mediaId);
  const storageKey = `media/${mediaId}/camera-demo.${detected.extension}`;
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");

  await firestore.runTransaction(async (transaction) => {
    const cameraReference = firestore.collection("cameras").doc(cameraId);
    const cameraSnapshot = await transaction.get(cameraReference);
    const camera = cameraSnapshot.data();
    if (!cameraSnapshot.exists || camera?.status !== "active") {
      throw new HttpError(400, "Camera does not exist or is inactive.");
    }
    transaction.create(mediaReference, {
      kind: "camera_attachment",
      sourceType: "camera_registration_attachment",
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
      isTest: true,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
  });

  try {
    await writeMedia(storageKey, file.buffer);
    await mediaReference.update({ storageStatus: "available", storageCheckedAt: FieldValue.serverTimestamp() });
  } catch {
    await mediaReference.update({ storageStatus: "missing", storageCheckedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    throw new HttpError(500, "The camera demonstration attachment could not be stored.");
  }

  return {
    id: mediaId,
    contentUrl: `/api/media/${mediaId}/content`,
    originalFileName: cleanOriginalName(file.originalname),
    mimeType: detected.mimeType,
    byteSize: file.size,
    mediaType: detected.mediaType,
    createdAt: new Date().toISOString(),
  };
}

export async function listCameraRegistrationAttachments(cameraId: string): Promise<CameraRegistrationAttachment[]> {
  const snapshot = await firestore.collection("mediaAssets").where("cameraId", "==", cameraId).limit(100).get();
  return snapshot.docs
    .filter((item) => item.data().sourceType === "camera_registration_attachment" && item.data().storageStatus === "available")
    .map(serializeAttachment)
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
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
