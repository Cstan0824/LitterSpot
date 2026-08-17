import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { z } from "zod";
import type { imageUploadSchema } from "../schemas/media.js";
import { HttpError } from "../shared/httpError.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { imageUploadRequestFingerprint } from "./imageUploadRequest.js";
import { inspectMedia, writeMedia } from "./localMediaStorage.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

type ImageUploadInput = z.infer<typeof imageUploadSchema>;
type JobStatus = "uploading" | "queued" | "processing" | "completed" | "failed" | "cancelled";

function serializeTimestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function assertExists(snapshot: DocumentSnapshot, label: string) {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return snapshot.data()!;
}

function serializeMedia(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Media asset");
  return {
    id: snapshot.id,
    kind: String(data.kind),
    sourceType: String(data.sourceType),
    originalFileName: String(data.originalFileName),
    storageStatus: String(data.storageStatus),
    mimeType: String(data.mimeType),
    byteSize: Number(data.byteSize),
    sha256: String(data.sha256),
    width: data.width == null ? null : Number(data.width),
    height: data.height == null ? null : Number(data.height),
    durationSeconds: data.durationSeconds == null ? null : Number(data.durationSeconds),
    parentMediaId: data.parentMediaId == null ? null : String(data.parentMediaId),
    frameIndex: data.frameIndex == null ? null : Number(data.frameIndex),
    videoOffsetSeconds: data.videoOffsetSeconds == null ? null : Number(data.videoOffsetSeconds),
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot),
    zoneId: String(data.zoneId),
    zoneName: String(data.zoneNameSnapshot),
    cameraId: String(data.cameraId),
    cameraCode: String(data.cameraCodeSnapshot),
    cameraName: String(data.cameraNameSnapshot),
    capturedAt: serializeTimestamp(data.capturedAt),
    isTest: Boolean(data.isTest),
    contentUrl: `/api/media/${snapshot.id}/content`,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

function serializeJob(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Processing job");
  const error = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : null;
  return {
    id: snapshot.id,
    type: String(data.type),
    status: data.status as JobStatus,
    sourceMediaId: String(data.sourceMediaId),
    sourceType: String(data.sourceType),
    siteId: String(data.siteId),
    zoneId: String(data.zoneId),
    cameraId: String(data.cameraId),
    requestedByUid: String(data.requestedByUid),
    requestedAt: serializeTimestamp(data.requestedAt),
    captureStartedAt: serializeTimestamp(data.captureStartedAt),
    startedAt: serializeTimestamp(data.startedAt),
    completedAt: serializeTimestamp(data.completedAt),
    analyticsEligible: Boolean(data.analyticsEligible),
    isTest: Boolean(data.isTest),
    clientRequestId: String(data.clientRequestId),
    options: data.options,
    progress: data.progress,
    summary: data.summary,
    error: error ? {
      code: String(error.code),
      message: String(error.message),
      occurredAt: serializeTimestamp(error.occurredAt),
    } : null,
    attemptCount: Number(data.attemptCount ?? 0),
    analysisRunId: data.analysisRunId == null ? null : String(data.analysisRunId),
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function cleanOriginalName(value: string) {
  const finalSegment = value.replaceAll("\\", "/").split("/").pop() ?? "upload";
  return finalSegment.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "upload";
}

function deterministicJobId(uid: string, clientRequestId: string) {
  return createHash("sha256").update(uid).update("\0").update(clientRequestId).digest("hex");
}

async function getMediaSnapshot(mediaId: string) {
  return firestore.collection("mediaAssets").doc(mediaId).get();
}

async function getJobSnapshot(jobId: string) {
  return firestore.collection("processingJobs").doc(jobId).get();
}

export async function getMedia(mediaId: string) {
  return serializeMedia(await getMediaSnapshot(mediaId));
}

export async function getProcessingJob(jobId: string) {
  return serializeJob(await getJobSnapshot(jobId));
}

export async function listMedia(filters: { cameraId?: string; isTest?: boolean; limit: number; cursor?: string }) {
  let query: Query<DocumentData> = firestore.collection("mediaAssets");
  if (filters.cameraId) query = query.where("cameraId", "==", filters.cameraId);
  if (filters.isTest !== undefined) query = query.where("isTest", "==", filters.isTest);
  return queryCursorPage({
    query,
    resource: "media-assets",
    orderField: "createdAt",
    filters: { cameraId: filters.cameraId, isTest: filters.isTest },
    limit: filters.limit,
    cursor: filters.cursor,
    present: serializeMedia,
  });
}

export async function listProcessingJobs(filters: { status: JobStatus | "all"; limit: number; cursor?: string }) {
  let query: Query<DocumentData> = firestore.collection("processingJobs");
  if (filters.status !== "all") query = query.where("status", "==", filters.status);
  return queryCursorPage({
    query,
    resource: "processing-jobs",
    orderField: "createdAt",
    filters: { status: filters.status },
    limit: filters.limit,
    cursor: filters.cursor,
    present: serializeJob,
  });
}

export async function getMediaContent(mediaId: string) {
  const reference = firestore.collection("mediaAssets").doc(mediaId);
  const snapshot = await reference.get();
  const data = assertExists(snapshot, "Media asset");
  if (data.storageStatus !== "available") throw new HttpError(410, "Stored media file is unavailable.");
  try {
    const stored = await inspectMedia(String(data.storageKey));
    return {
      ...stored,
      mimeType: String(data.mimeType),
      originalFileName: String(data.originalFileName),
    };
  } catch (error) {
    await reference.update({ storageStatus: "missing", storageCheckedAt: FieldValue.serverTimestamp() });
    throw error;
  }
}

export async function createImageUpload(file: Express.Multer.File, input: ImageUploadInput, actorUid: string) {
  const detected = detectSupportedImage(file.buffer);
  validateDeclaredImageType(file.mimetype, detected.mimeType);

  const jobId = deterministicJobId(actorUid, input.clientRequestId);
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const mediaReference = firestore.collection("mediaAssets").doc(randomUUID());
  const storageKey = `media/${mediaReference.id}/original.${detected.extension}`;
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  const requestFingerprint = imageUploadRequestFingerprint(input, sha256);
  const uploadToken = randomUUID();
  const capturedAt = input.capturedAt ? Timestamp.fromDate(new Date(input.capturedAt)) : Timestamp.now();
  const outcome = await firestore.runTransaction(async (transaction): Promise<{
    created: boolean;
    sourceMediaId: string;
    storageKey: string | null;
    publish: boolean;
  }> => {
    const existingJob = await transaction.get(jobReference);
    if (existingJob.exists) {
      const data = existingJob.data()!;
      const sourceMediaId = typeof data.sourceMediaId === "string" ? data.sourceMediaId : "";
      if (data.type !== "image" || data.requestedByUid !== actorUid || data.cameraId !== input.cameraId || !sourceMediaId) {
        throw new HttpError(409, "clientRequestId is already used by a different processing request.");
      }
      const existingMediaReference = firestore.collection("mediaAssets").doc(sourceMediaId);
      const existingMedia = await transaction.get(existingMediaReference);
      if (!existingMedia.exists || existingMedia.data()?.sha256 !== sha256) {
        throw new HttpError(409, "clientRequestId is already used by a different image file.");
      }
      if (typeof data.requestFingerprint === "string" && data.requestFingerprint !== requestFingerprint) {
        throw new HttpError(409, "clientRequestId is already used with different image processing options.");
      }
      if (typeof data.requestFingerprint !== "string") {
        const options = data.options && typeof data.options === "object" ? data.options as Record<string, unknown> : {};
        const effectiveFloor = typeof options.floorConfidence === "number" ? options.floorConfidence : 0.25;
        const effectiveBin = typeof options.binLocalizerConfidence === "number" ? options.binLocalizerConfidence : 0.80;
        const focus = Array.isArray(options.focusRegionNormalized) ? options.focusRegionNormalized : [];
        const capturedAtCompatible = !input.capturedAt
          || data.captureStartedAt instanceof Timestamp
            && data.captureStartedAt.toDate().toISOString() === new Date(input.capturedAt).toISOString();
        if (Boolean(data.isTest) !== input.isTest
          || effectiveFloor !== (input.floorConfidence ?? 0.25)
          || effectiveBin !== (input.binLocalizerConfidence ?? 0.80)
          || JSON.stringify(focus) !== JSON.stringify(input.focusRegion)
          || !capturedAtCompatible) {
          throw new HttpError(409, "clientRequestId is already used with different image processing options.");
        }
      }
      if (data.status === "uploading") {
        const existingStorageKey = existingMedia.data()?.storageKey;
        if (typeof existingStorageKey !== "string" || !existingStorageKey) {
          throw new HttpError(409, "Existing image job is missing valid source media storage metadata.");
        }
        transaction.update(existingMediaReference, { uploadToken });
        transaction.update(jobReference, { uploadToken, sourceSha256: sha256, requestFingerprint });
        return { created: false, sourceMediaId, storageKey: existingStorageKey, publish: true };
      }
      return { created: false, sourceMediaId, storageKey: null, publish: false };
    }

    const cameraReference = firestore.collection("cameras").doc(input.cameraId);
    const cameraSnapshot = await transaction.get(cameraReference);
    const camera = cameraSnapshot.data();
    if (!cameraSnapshot.exists || camera?.status !== "active") {
      throw new HttpError(400, "Camera does not exist or is inactive.");
    }

    const commonLocation = {
      siteId: String(camera.siteId),
      siteNameSnapshot: String(camera.siteNameSnapshot),
      zoneId: String(camera.zoneId),
      zoneNameSnapshot: String(camera.zoneNameSnapshot),
      cameraId: cameraSnapshot.id,
      cameraCodeSnapshot: String(camera.code),
      cameraNameSnapshot: String(camera.name),
    };
    transaction.create(mediaReference, {
      kind: "original_upload",
      sourceType: "image_upload",
      originalFileName: cleanOriginalName(file.originalname),
      storageKey,
      storageStatus: "pending",
      uploadToken,
      mimeType: detected.mimeType,
      byteSize: file.size,
      sha256,
      width: null,
      height: null,
      durationSeconds: null,
      parentMediaId: null,
      frameIndex: null,
      videoOffsetSeconds: null,
      ...commonLocation,
      capturedAt,
      isTest: input.isTest,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
    transaction.create(jobReference, {
      type: "image",
      status: "uploading",
      sourceMediaId: mediaReference.id,
      sourceType: "image_upload",
      siteId: commonLocation.siteId,
      zoneId: commonLocation.zoneId,
      cameraId: commonLocation.cameraId,
      requestedByUid: actorUid,
      requestedAt: FieldValue.serverTimestamp(),
      captureStartedAt: capturedAt,
      startedAt: null,
      completedAt: null,
      analyticsEligible: !input.isTest,
      isTest: input.isTest,
      clientRequestId: input.clientRequestId,
      sourceSha256: sha256,
      requestFingerprint,
      uploadToken,
      options: {
        frameIntervalSeconds: null,
        floorConfidence: input.floorConfidence ?? null,
        binLocalizerConfidence: input.binLocalizerConfidence ?? null,
        focusRegionNormalized: input.focusRegion,
      },
      progress: { plannedFrames: 1, processedFrames: 0, successfulFrames: 0, failedFrames: 0, lastFrameIndex: null },
      summary: { analysisRunCount: 0, detectionCount: 0, flagCount: 0, alertIds: [] },
      error: null,
      attemptCount: 0,
      claimToken: null,
      leaseExpiresAt: null,
      analysisRunId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { created: true, sourceMediaId: mediaReference.id, storageKey, publish: true };
  });

  if (!outcome.publish || !outcome.storageKey) {
    const job = await getProcessingJob(jobId);
    if (!outcome.sourceMediaId || outcome.sourceMediaId !== job.sourceMediaId) {
      throw new HttpError(409, "The idempotency key belongs to an incompatible processing job.");
    }
    return { media: await getMedia(job.sourceMediaId), job, idempotent: true };
  }

  const acceptedMediaReference = firestore.collection("mediaAssets").doc(outcome.sourceMediaId);
  try {
    await writeMedia(outcome.storageKey, file.buffer);
    await firestore.runTransaction(async (transaction) => {
      const [latestJob, latestMedia] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(acceptedMediaReference),
      ]);
      if (!latestJob.exists || !latestMedia.exists) throw new HttpError(409, "The accepted image upload disappeared.");
      if (latestJob.data()?.uploadToken !== uploadToken || latestMedia.data()?.uploadToken !== uploadToken) return;
      transaction.update(acceptedMediaReference, {
        storageStatus: "available",
        uploadToken: FieldValue.delete(),
        storageCheckedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(jobReference, {
        status: "queued",
        uploadToken: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The uploaded file could not be stored.";
    await firestore.runTransaction(async (transaction) => {
      const [latestJob, latestMedia] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(acceptedMediaReference),
      ]);
      if (!latestJob.exists || !latestMedia.exists
        || latestJob.data()?.uploadToken !== uploadToken
        || latestMedia.data()?.uploadToken !== uploadToken) return;
      transaction.update(acceptedMediaReference, {
        storageStatus: "missing",
        uploadToken: FieldValue.delete(),
        storageCheckedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(jobReference, {
        status: "failed",
        uploadToken: FieldValue.delete(),
        error: { code: "STORAGE_WRITE_FAILED", message, occurredAt: FieldValue.serverTimestamp() },
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    throw new HttpError(500, "The uploaded file could not be stored.");
  }

  return {
    media: await getMedia(outcome.sourceMediaId),
    job: await getProcessingJob(jobId),
    idempotent: !outcome.created,
  };
}
