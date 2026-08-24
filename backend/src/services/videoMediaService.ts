import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { z } from "zod";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import type { videoUploadSchema } from "../schemas/media.js";
import { HttpError } from "../shared/httpError.js";
import {
  discardTemporaryMedia,
  inspectMediaIntegrity,
  moveStagedMedia,
  temporaryMediaName,
} from "./localMediaStorage.js";
import { getMedia, getProcessingJob } from "./mediaService.js";
import { plannedVideoFrames, validateVideoUploadFile } from "./videoUploadValidation.js";
import { VIDEO_BIN_TRACKING_VERSION } from "./videoBinTracking.js";
import { videoUploadRequestFingerprint } from "./videoUploadRequest.js";

type VideoUploadInput = z.infer<typeof videoUploadSchema>;

function deterministicJobId(uid: string, clientRequestId: string) {
  return createHash("sha256").update(uid).update("\0").update(clientRequestId).digest("hex");
}

function cleanOriginalName(value: string) {
  const finalSegment = value.replaceAll("\\", "/").split("/").pop() ?? "upload";
  return finalSegment.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "upload";
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function createVideoUpload(file: Express.Multer.File, input: VideoUploadInput, actorUid: string) {
  let acceptedForRecovery = false;
  try {
    return await createVideoUploadOwned(file, input, actorUid, () => { acceptedForRecovery = true; });
  } finally {
    // Until Firestore accepts the staging name, this request owns cleanup. Once
    // accepted, publish/failure/recovery owns it so an HTTP error cannot erase
    // the only recoverable source file.
    if (!acceptedForRecovery) await discardTemporaryMedia(file.path).catch(() => undefined);
  }
}

async function createVideoUploadOwned(
  file: Express.Multer.File,
  input: VideoUploadInput,
  actorUid: string,
  acceptForRecovery: () => void,
) {
  const probe = await validateVideoUploadFile(file);
  const [sha256] = await Promise.all([sha256File(file.path)]);
  const jobId = deterministicJobId(actorUid, input.clientRequestId);
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const newMediaReference = firestore.collection("mediaAssets").doc(randomUUID());
  const newStorageKey = `media/${newMediaReference.id}/original.${probe.extension}`;
  const capturedAt = input.capturedAt ? Timestamp.fromDate(new Date(input.capturedAt)) : Timestamp.now();
  const frameIntervalSeconds = input.frameIntervalSeconds ?? env.videoDefaultFrameIntervalSeconds;
  const plannedFrames = plannedVideoFrames(probe.durationSeconds, frameIntervalSeconds);
  const stagingName = temporaryMediaName(file.path);
  const requestFingerprint = videoUploadRequestFingerprint(input, sha256, frameIntervalSeconds);
  const outcome = await firestore.runTransaction(async (transaction): Promise<{
    created: true;
    sourceMediaId: string;
    storageKey: string;
    publish: true;
  } | {
    created: false;
    sourceMediaId: string;
    storageKey: string | null;
    publish: boolean;
  }> => {
    const existingJob = await transaction.get(jobReference);
    if (existingJob.exists) {
      const data = existingJob.data()!;
      if (data.type !== "video" || data.cameraId !== input.cameraId) {
        throw new HttpError(409, "clientRequestId is already used by a different processing request.");
      }
      if (data.sourceSha256 !== sha256) {
        throw new HttpError(409, "clientRequestId is already used by a different video file.");
      }
      if (typeof data.requestFingerprint === "string" && data.requestFingerprint !== requestFingerprint) {
        throw new HttpError(409, "clientRequestId is already used with different video processing options.");
      }
      if (typeof data.sourceMediaId !== "string" || !data.sourceMediaId) {
        throw new HttpError(409, "Existing video job is missing its source media.");
      }
      if (data.status === "uploading") {
        const existingMediaReference = firestore.collection("mediaAssets").doc(data.sourceMediaId);
        const existingMedia = await transaction.get(existingMediaReference);
        const existingStorageKey = existingMedia.data()?.storageKey;
        if (!existingMedia.exists || typeof existingStorageKey !== "string" || !existingStorageKey) {
          throw new HttpError(409, "Existing video job is missing valid source media storage metadata.");
        }
        transaction.update(existingMediaReference, { stagingName });
        return {
          created: false,
          sourceMediaId: data.sourceMediaId,
          storageKey: existingStorageKey,
          publish: true,
        };
      }
      return { created: false, sourceMediaId: data.sourceMediaId, storageKey: null, publish: false };
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
    transaction.create(newMediaReference, {
      kind: "original_upload",
      sourceType: "video_upload",
      originalFileName: cleanOriginalName(file.originalname),
      storageKey: newStorageKey,
      storageStatus: "pending",
      stagingName,
      mimeType: probe.mimeType,
      byteSize: file.size,
      sha256,
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.durationSeconds,
      codecName: probe.codecName,
      formatName: probe.formatName,
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
      type: "video",
      status: "uploading",
      sourceMediaId: newMediaReference.id,
      sourceType: "video_upload",
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
      video: {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        codecName: probe.codecName,
        formatName: probe.formatName,
      },
      options: {
        frameIntervalSeconds,
        floorConfidence: input.floorConfidence ?? null,
        binLocalizerConfidence: input.binLocalizerConfidence ?? null,
        focusRegionNormalized: input.focusRegion,
      },
      progress: { plannedFrames, processedFrames: 0, successfulFrames: 0, failedFrames: 0, lastFrameIndex: null },
      summary: { analysisRunCount: 0, detectionCount: 0, flagCount: 0, alertIds: [] },
      error: null,
      attemptCount: 0,
      claimToken: null,
      leaseExpiresAt: null,
      analysisRunId: null,
      videoTrackingState: { version: VIDEO_BIN_TRACKING_VERSION, nextId: 1, tracks: {} },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      created: true,
      sourceMediaId: newMediaReference.id,
      storageKey: newStorageKey,
      publish: true,
    };
  });

  if (!outcome.publish || !outcome.storageKey) {
    return {
      media: await getMedia(outcome.sourceMediaId),
      job: await getProcessingJob(jobId),
      idempotent: true,
    };
  }
  acceptForRecovery();

  const mediaReference = firestore.collection("mediaAssets").doc(outcome.sourceMediaId);
  const storageKey = outcome.storageKey;

  try {
    await moveStagedMedia(stagingName, storageKey);
  } catch (moveError) {
    const alreadyPublished = await inspectMediaIntegrity(storageKey, file.size, sha256)
      .then(() => true)
      .catch(() => false);
    if (!alreadyPublished) {
      const markedFailed = await firestore.runTransaction(async (transaction) => {
        const [latest, latestMedia] = await Promise.all([
          transaction.get(jobReference),
          transaction.get(mediaReference),
        ]);
        if (!latest.exists || latest.data()?.status !== "uploading"
          || !latestMedia.exists || latestMedia.data()?.stagingName !== stagingName) return false;
        transaction.update(mediaReference, {
          storageStatus: "missing",
          stagingName: FieldValue.delete(),
          storageCheckedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(jobReference, {
          status: "failed",
          error: {
            code: "STORAGE_WRITE_FAILED",
            message: "The staged video could not be published to local media storage.",
            occurredAt: FieldValue.serverTimestamp(),
          },
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (markedFailed) await discardTemporaryMedia(file.path).catch(() => undefined);
      throw new HttpError(500, "The uploaded video could not be stored.");
    }
  }

  try {
    await firestore.runTransaction(async (transaction) => {
      const [latestJob, latestMedia] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(mediaReference),
      ]);
      if (!latestJob.exists || !latestMedia.exists) throw new HttpError(409, "The accepted video upload disappeared.");
      if (latestJob.data()?.status === "queued" && latestMedia.data()?.storageStatus === "available") return;
      if (latestJob.data()?.status !== "uploading" || latestJob.data()?.sourceMediaId !== outcome.sourceMediaId) {
        throw new HttpError(409, "The video upload changed state while storage was finalized.");
      }
      transaction.update(mediaReference, {
        storageStatus: "available",
        stagingName: FieldValue.delete(),
        storageCheckedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(jobReference, { status: "queued", updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    // The final file is durable. Keep the job in `uploading` so startup recovery
    // can complete this database transition instead of falsely marking it lost.
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "The video was stored, but its processing job is awaiting recovery.");
  }

  // The common move path already removed the source. This also cleans up a
  // fresh idempotent retry when the correct final asset already existed.
  await discardTemporaryMedia(file.path).catch(() => undefined);

  return {
    media: await getMedia(outcome.sourceMediaId),
    job: await getProcessingJob(jobId),
    idempotent: !outcome.created,
  };
}
