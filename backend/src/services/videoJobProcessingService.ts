import { createHash, randomUUID } from "node:crypto";
import axios from "axios";
import { FieldPath, FieldValue, Timestamp, type DocumentData, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import { evaluateAnalysisRunDetections } from "./alertWorkflowService.js";
import { applyCompletedAnalysisAnalytics } from "./analyticsService.js";
import { normalizeAnalysis } from "./analysisNormalization.js";
import { inferFrame } from "./frameInferenceClient.js";
import {
  cleanupStaleTemporaryMedia,
  deleteStoredMedia,
  discardStagedMedia,
  inspectMedia,
  inspectMediaIntegrity,
  inspectStagedMedia,
  moveStagedMedia,
  writeMedia,
} from "./localMediaStorage.js";
import { getProcessingJob } from "./mediaService.js";
import { SerialJobQueue } from "./serialJobQueue.js";
import { trackVideoBins, type VideoBinTrackingState } from "./videoBinTracking.js";
import { extractVideoFrame, VideoFrameExtractionError, videoFrameOffset } from "./videoFrameExtraction.js";
import { decideVideoJobClaim } from "./videoJobState.js";
import { recordOperationalFailure, recoverOperationalEvent } from "./dependencyEventMonitor.js";

type VideoClaim = { completed: true } | { completed: false; claimToken: string; job: DocumentData };

function hashId(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

export function deterministicVideoFrameMediaId(jobId: string, frameIndex: number) {
  return hashId("video-frame-media-v1", jobId, String(frameIndex));
}

export function deterministicVideoAnalysisRunId(jobId: string, frameIndex: number) {
  return hashId("video-analysis-run-v1", jobId, String(frameIndex));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function trackingState(value: unknown): VideoBinTrackingState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<VideoBinTrackingState>;
  if (candidate.version !== "video-bin-tracking-v1" || typeof candidate.nextId !== "number"
    || !candidate.tracks || typeof candidate.tracks !== "object" || Array.isArray(candidate.tracks)) return null;
  return candidate as VideoBinTrackingState;
}

function failure(error: unknown) {
  if (error instanceof HttpError) return { code: "VIDEO_PROCESSING_FAILED", message: error.message };
  if (axios.isAxiosError(error)) return { code: "INFERENCE_FAILED", message: "The AI inference service failed during video processing." };
  return { code: "VIDEO_PROCESSING_FAILED", message: error instanceof Error ? error.message : "Video processing failed." };
}

async function claimVideoJob(jobId: string): Promise<VideoClaim> {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const claimToken = randomUUID();
  const outcome = await firestore.runTransaction(async (transaction): Promise<VideoClaim> => {
    const snapshot = await transaction.get(jobReference);
    if (!snapshot.exists) throw new HttpError(404, "Processing job not found.");
    const data = snapshot.data()!;
    if (data.type !== "video") throw new HttpError(409, "This processor only accepts video jobs.");
    const now = Date.now();
    const leaseExpiresAt = data.leaseExpiresAt instanceof Timestamp ? data.leaseExpiresAt.toMillis() : null;
    if (decideVideoJobClaim(data.status, leaseExpiresAt, now) === "completed") return { completed: true };
    transaction.update(jobReference, {
      status: "processing",
      claimToken,
      leaseExpiresAt: Timestamp.fromMillis(now + env.videoLeaseSeconds * 1_000),
      startedAt: data.startedAt ?? FieldValue.serverTimestamp(),
      completedAt: null,
      error: null,
      attemptCount: Number(data.attemptCount ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { completed: false, claimToken, job: data };
  });
  return outcome;
}

async function renewVideoLease(jobId: string, claimToken: string) {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobReference);
    if (!snapshot.exists || snapshot.data()?.claimToken !== claimToken || snapshot.data()?.status !== "processing") {
      throw new HttpError(409, "Video processing claim expired.");
    }
    transaction.update(jobReference, {
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + env.videoLeaseSeconds * 1_000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function failVideoJob(jobId: string, claimToken: string, error: unknown) {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const details = failure(error);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobReference);
    if (!snapshot.exists || snapshot.data()?.claimToken !== claimToken) return false;
    transaction.update(jobReference, {
      status: "failed",
      error: { ...details, occurredAt: FieldValue.serverTimestamp() },
      claimToken: null,
      leaseExpiresAt: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function recordFrameFailure(jobId: string, claimToken: string, frameIndex: number, offsetSeconds: number, error: unknown) {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const failureReference = jobReference.collection("frameFailures").doc(String(frameIndex));
  return firestore.runTransaction(async (transaction) => {
    const [job, existing] = await Promise.all([transaction.get(jobReference), transaction.get(failureReference)]);
    if (!job.exists || job.data()?.claimToken !== claimToken) throw new HttpError(409, "Video processing claim expired.");
    if (existing.exists) return false;
    const details = failure(error);
    transaction.create(failureReference, {
      frameIndex,
      videoOffsetSeconds: offsetSeconds,
      error: details,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(jobReference, {
      "progress.processedFrames": FieldValue.increment(1),
      "progress.failedFrames": FieldValue.increment(1),
      "progress.lastFrameIndex": frameIndex,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function finalizeVideoFrame(options: {
  jobId: string;
  claimToken: string;
  runId: string;
  frameIndex: number;
  detectionCount: number;
  flagIds: string[];
  alertIds: string[];
  trackingStateAfter: VideoBinTrackingState;
}) {
  const jobReference = firestore.collection("processingJobs").doc(options.jobId);
  const runReference = firestore.collection("analysisRuns").doc(options.runId);
  await firestore.runTransaction(async (transaction) => {
    const [job, run] = await Promise.all([transaction.get(jobReference), transaction.get(runReference)]);
    if (!job.exists || job.data()?.claimToken !== options.claimToken) throw new HttpError(409, "Video processing claim expired.");
    if (!run.exists) throw new HttpError(409, "Video analysis run disappeared before progress was saved.");
    if (run.data()?.videoJobAppliedAt) return;
    transaction.update(runReference, { videoJobAppliedAt: FieldValue.serverTimestamp() });
    transaction.update(jobReference, {
      "progress.processedFrames": FieldValue.increment(1),
      "progress.successfulFrames": FieldValue.increment(1),
      "progress.lastFrameIndex": options.frameIndex,
      "summary.analysisRunCount": FieldValue.increment(1),
      "summary.detectionCount": FieldValue.increment(options.detectionCount),
      "summary.flagCount": FieldValue.increment(options.flagIds.length),
      ...(options.alertIds.length > 0 ? { "summary.alertIds": FieldValue.arrayUnion(...options.alertIds) } : {}),
      videoTrackingState: options.trackingStateAfter,
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + env.videoLeaseSeconds * 1_000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function resumePersistedFrame(options: {
  jobId: string;
  claimToken: string;
  runId: string;
  frameIndex: number;
}) {
  const runSnapshot = await firestore.collection("analysisRuns").doc(options.runId).get();
  if (!runSnapshot.exists) return false;
  const run = runSnapshot.data()!;
  if (run.jobId !== options.jobId || run.frameIndex !== options.frameIndex || run.alertWorkflowVersion !== ALERT_WORKFLOW_VERSION) {
    throw new HttpError(409, "A conflicting video analysis run already exists.");
  }
  const detectionSnapshot = await firestore.collection("detections").where("analysisRunId", "==", options.runId).get();
  const alertEvaluation = run.alertEvaluationStatus === "completed"
    ? { flagIds: stringArray(run.flagIds), alertIds: stringArray(run.alertIds) }
    : await evaluateAnalysisRunDetections(options.runId);
  await applyCompletedAnalysisAnalytics(options.runId, alertEvaluation.alertIds);
  const stateAfter = trackingState(run.videoTrackingStateAfter);
  if (!stateAfter) throw new HttpError(409, "Persisted video frame is missing its tracking checkpoint.");
  await finalizeVideoFrame({
    ...options,
    detectionCount: detectionSnapshot.size,
    flagIds: alertEvaluation.flagIds,
    alertIds: alertEvaluation.alertIds,
    trackingStateAfter: stateAfter,
  });
  return true;
}

async function processVideoFrame(options: {
  jobId: string;
  claimToken: string;
  job: DocumentData;
  mediaId: string;
  media: DocumentData;
  sourcePath: string;
  frameIndex: number;
  offsetSeconds: number;
  currentTrackingState: VideoBinTrackingState | null;
}) {
  const runId = deterministicVideoAnalysisRunId(options.jobId, options.frameIndex);
  if (await resumePersistedFrame({ jobId: options.jobId, claimToken: options.claimToken, runId, frameIndex: options.frameIndex })) {
    const persisted = (await firestore.collection("analysisRuns").doc(runId).get()).data()!;
    return trackingState(persisted.videoTrackingStateAfter)!;
  }

  const contents = await extractVideoFrame(options.sourcePath, options.offsetSeconds);
  const jobOptions = options.job.options && typeof options.job.options === "object"
    ? options.job.options as Record<string, unknown> : {};
  const floorConfidence = typeof jobOptions.floorConfidence === "number" ? jobOptions.floorConfidence : 0.25;
  const binLocalizerConfidence = typeof jobOptions.binLocalizerConfidence === "number" ? jobOptions.binLocalizerConfidence : 0.80;
  const focusRegion = Array.isArray(jobOptions.focusRegionNormalized)
    ? jobOptions.focusRegionNormalized as Array<{ x: number; y: number }> : [];
  const inferred = await inferFrame({
    contents,
    fileName: `frame-${String(options.frameIndex).padStart(6, "0")}.jpg`,
    mimeType: "image/jpeg",
    floorConfidence,
    binLocalizerConfidence,
    focusRegion,
  });
  const tracked = trackVideoBins({ bins: inferred.bins, image: inferred.image, state: options.currentTrackingState });
  const result = { ...inferred, bins: tracked.bins };
  const normalized = normalizeAnalysis(result, runId, floorConfidence);
  const frameMediaId = deterministicVideoFrameMediaId(options.jobId, options.frameIndex);
  const frameMediaReference = firestore.collection("mediaAssets").doc(frameMediaId);
  const frameStorageKey = `media/${frameMediaId}/frame-${options.claimToken}.jpg`;
  // Inference may consume most of a lease. Revalidate the claim immediately
  // before creating evidence so an expired worker cannot publish over a winner.
  await renewVideoLease(options.jobId, options.claimToken);
  await writeMedia(frameStorageKey, contents);
  const sourceCapturedAt = options.media.capturedAt instanceof Timestamp ? options.media.capturedAt : Timestamp.now();
  const capturedAt = Timestamp.fromMillis(sourceCapturedAt.toMillis() + Math.round(options.offsetSeconds * 1_000));
  const runReference = firestore.collection("analysisRuns").doc(runId);
  const jobReference = firestore.collection("processingJobs").doc(options.jobId);
  const cameraReference = firestore.collection("cameras").doc(String(options.job.cameraId));

  try {
    await firestore.runTransaction(async (transaction) => {
      const [job, existingRun, existingFrame, camera] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(runReference),
        transaction.get(frameMediaReference),
        transaction.get(cameraReference),
      ]);
      if (!job.exists || job.data()?.claimToken !== options.claimToken || job.data()?.status !== "processing") {
        throw new HttpError(409, "Video processing claim expired.");
      }
      if (existingRun.exists) throw new HttpError(409, "Video analysis frame was persisted concurrently; retry the job to resume.");
      if (existingFrame.exists) throw new HttpError(409, "Video frame media exists without its analysis run.");
      const location = {
      siteId: String(options.job.siteId),
      siteNameSnapshot: String(options.media.siteNameSnapshot ?? ""),
      zoneId: String(options.job.zoneId),
      zoneNameSnapshot: String(options.media.zoneNameSnapshot ?? ""),
      cameraId: String(options.job.cameraId),
      cameraCodeSnapshot: String(options.media.cameraCodeSnapshot ?? ""),
      cameraNameSnapshot: String(options.media.cameraNameSnapshot ?? ""),
    };
      transaction.create(frameMediaReference, {
        kind: "extracted_frame",
        sourceType: "video_upload",
        originalFileName: `frame-${String(options.frameIndex).padStart(6, "0")}.jpg`,
        storageKey: frameStorageKey,
        storageStatus: "available",
        mimeType: "image/jpeg",
        byteSize: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
        width: result.image.width,
        height: result.image.height,
        durationSeconds: null,
        parentMediaId: options.mediaId,
        frameIndex: options.frameIndex,
        videoOffsetSeconds: options.offsetSeconds,
        ...location,
        capturedAt,
        isTest: Boolean(options.job.isTest),
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: String(options.job.requestedByUid),
      });
      transaction.create(runReference, {
      jobId: options.jobId,
      sourceMediaId: options.mediaId,
      frameMediaId,
      evidenceMediaId: frameMediaId,
      sourceType: "video_upload",
      siteId: location.siteId,
      siteName: location.siteNameSnapshot,
      zoneId: location.zoneId,
      zoneName: location.zoneNameSnapshot,
      cameraId: location.cameraId,
      cameraCode: location.cameraCodeSnapshot,
      cameraName: location.cameraNameSnapshot,
      capturedAt,
      frameIndex: options.frameIndex,
      videoOffsetSeconds: options.offsetSeconds,
      image: result.image,
      focusRegionNormalized: result.focusRegion,
      peopleCount: result.peopleCount,
      people: normalized.people,
      bins: normalized.bins,
      issueKinds: normalized.issueKinds,
      issueCounts: normalized.issueCounts,
      modelVersions: result.modelVersions,
      processingTimeMs: result.processingTimeMs,
      analyticsEligible: Boolean(options.job.analyticsEligible),
      analyticsAppliedAt: null,
      isTest: Boolean(options.job.isTest),
      alertWorkflowVersion: ALERT_WORKFLOW_VERSION,
      alertEvaluationStatus: "pending",
      alertEvaluationPolicyVersion: null,
      alertEvaluationAt: null,
      videoTrackingStateAfter: tracked.state,
      videoJobAppliedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      });
      for (const detection of normalized.detections) {
        transaction.create(firestore.collection("detections").doc(detection.id), {
        analysisRunId: runId,
        jobId: options.jobId,
        sourceMediaId: options.mediaId,
        evidenceMediaId: frameMediaId,
        sourceType: "video_upload",
        siteId: location.siteId,
        siteName: location.siteNameSnapshot,
        zoneId: location.zoneId,
        zoneName: location.zoneNameSnapshot,
        cameraId: location.cameraId,
        cameraCode: location.cameraCodeSnapshot,
        cameraName: location.cameraNameSnapshot,
        issueType: detection.issueType,
        confidence: detection.confidence,
        bboxNormalized: detection.bboxNormalized,
        polygonNormalized: detection.polygonNormalized,
        entityId: detection.entityId,
        modelKey: detection.modelKey,
        modelVersion: detection.modelVersion,
        capturedAt,
        thresholdApplied: detection.thresholdApplied,
        localizerConfidence: "localizerConfidence" in detection ? detection.localizerConfidence : null,
        signals: "signals" in detection ? detection.signals : null,
        confirmed: "confirmed" in detection ? detection.confirmed : null,
        stale: "stale" in detection ? detection.stale : null,
        qualificationStatus: "pending_evaluation",
        qualifiedForFlag: null,
        qualificationReason: "alert_policy_pending",
        qualificationEvaluatedAt: null,
        flagId: null,
        analyticsEligible: Boolean(options.job.analyticsEligible),
        isTest: Boolean(options.job.isTest),
        createdAt: FieldValue.serverTimestamp(),
        });
      }
      const currentLatest = camera.data()?.latestCapturedAt;
      const cameraStillOwnsJobLocation = camera.exists
        && camera.data()?.siteId === options.job.siteId
        && camera.data()?.zoneId === options.job.zoneId;
      if (cameraStillOwnsJobLocation
        && (!(currentLatest instanceof Timestamp) || capturedAt.toMillis() >= currentLatest.toMillis())) {
        transaction.update(cameraReference, {
        latestAnalysisRunId: runId,
        latestAnalysisAt: FieldValue.serverTimestamp(),
        latestCapturedAt: capturedAt,
        availability: "available",
        });
      }
    });
  } catch (error) {
    // A transaction may commit even when its response is interrupted, or a
    // concurrent claimant may win. Firestore reads are strongly consistent:
    // resume the winner when present; otherwise remove only this claim's
    // unreferenced evidence and propagate the failure.
    let persistedRun;
    try {
      persistedRun = await runReference.get();
    } catch {
      throw error;
    }
    if (!persistedRun.exists) {
      await deleteStoredMedia(frameStorageKey).catch(() => undefined);
      throw error;
    }
    const persistedFrame = await frameMediaReference.get().catch(() => null);
    if (!persistedFrame?.exists || persistedFrame.data()?.storageKey !== frameStorageKey) {
      await deleteStoredMedia(frameStorageKey).catch(() => undefined);
    }
    if (await resumePersistedFrame({
      jobId: options.jobId,
      claimToken: options.claimToken,
      runId,
      frameIndex: options.frameIndex,
    })) {
      return trackingState(persistedRun.data()?.videoTrackingStateAfter)!;
    }
    throw error;
  }

  const alertEvaluation = await evaluateAnalysisRunDetections(runId);
  await applyCompletedAnalysisAnalytics(runId, alertEvaluation.alertIds);
  await finalizeVideoFrame({
    jobId: options.jobId,
    claimToken: options.claimToken,
    runId,
    frameIndex: options.frameIndex,
    detectionCount: normalized.detections.length,
    flagIds: alertEvaluation.flagIds,
    alertIds: alertEvaluation.alertIds,
    trackingStateAfter: tracked.state,
  });
  return tracked.state;
}

export async function processVideoJob(jobId: string) {
  const claim = await claimVideoJob(jobId);
  if (claim.completed) return getProcessingJob(jobId);
  const { claimToken, job } = claim;
  try {
    const mediaReference = firestore.collection("mediaAssets").doc(String(job.sourceMediaId));
    const mediaSnapshot = await mediaReference.get();
    if (!mediaSnapshot.exists) throw new HttpError(404, "Source media asset not found.");
    const media = mediaSnapshot.data()!;
    if (media.storageStatus !== "available") throw new HttpError(410, "Source video file is unavailable.");
    const stored = await inspectMedia(String(media.storageKey));
    const durationSeconds = Number(job.video?.durationSeconds ?? media.durationSeconds);
    const intervalSeconds = Number(job.options?.frameIntervalSeconds ?? env.videoDefaultFrameIntervalSeconds);
    const plannedFrames = Number(job.progress?.plannedFrames);
    if (!Number.isInteger(plannedFrames) || plannedFrames < 1) throw new HttpError(422, "Video job has an invalid frame plan.");
    let currentTrackingState = trackingState(job.videoTrackingState);
    const lastFrameIndex = Number.isInteger(job.progress?.lastFrameIndex) ? Number(job.progress.lastFrameIndex) : -1;
    for (let frameIndex = lastFrameIndex + 1; frameIndex < plannedFrames; frameIndex += 1) {
      await renewVideoLease(jobId, claimToken);
      const offsetSeconds = videoFrameOffset(frameIndex, intervalSeconds, durationSeconds);
      try {
        currentTrackingState = await processVideoFrame({
          jobId,
          claimToken,
          job,
          mediaId: mediaSnapshot.id,
          media,
          sourcePath: stored.filePath,
          frameIndex,
          offsetSeconds,
          currentTrackingState,
        });
      } catch (error) {
        // Only an explicitly identified, non-persisted ffmpeg frame decode error
        // is safe to skip. Infrastructure, alert, Firestore, and claim errors
        // abort so retry can resume any partially persisted analysis run.
        if (!(error instanceof VideoFrameExtractionError)) throw error;
        await recordFrameFailure(jobId, claimToken, frameIndex, offsetSeconds, error);
      }
    }
    await firestore.runTransaction(async (transaction) => {
      const jobReference = firestore.collection("processingJobs").doc(jobId);
      const snapshot = await transaction.get(jobReference);
      if (!snapshot.exists || snapshot.data()?.claimToken !== claimToken) throw new HttpError(409, "Video processing claim expired.");
      const successfulFrames = Number(snapshot.data()?.progress?.successfulFrames ?? 0);
      if (successfulFrames < 1) throw new HttpError(422, "No video frames were processed successfully.");
      transaction.update(jobReference, {
        status: "completed",
        claimToken: null,
        leaseExpiresAt: null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await recoverOperationalEvent({
      identity: {
        dependency: "video_processing",
        eventCode: "job_failed",
        scope: { type: "job", id: jobId },
      },
      recoveryId: `video-recovery-${claimToken}`,
      safeDetails: {
        operation: "process_video_job",
        jobId,
        siteId: String(job.siteId),
        attemptCount: Number(job.attemptCount ?? 0) + 1,
      },
    });
    return getProcessingJob(jobId);
  } catch (error) {
    const didFail = await failVideoJob(jobId, claimToken, error);
    if (didFail) {
      const details = failure(error);
      await recordOperationalFailure({
        identity: {
          dependency: "video_processing",
          eventCode: "job_failed",
          scope: { type: "job", id: jobId },
        },
        occurrenceId: `video-attempt-${claimToken}`,
        severity: "warning",
        safeDetails: {
          operation: "process_video_job",
          reasonCode: details.code === "INFERENCE_FAILED" ? "inference_failed" : "processing_failed",
          retryable: true,
          jobId,
          siteId: String(job.siteId),
          attemptCount: Number(job.attemptCount ?? 0) + 1,
        },
      });
    }
    throw error;
  }
}

export async function retryVideoJob(jobId: string) {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobReference);
    if (!snapshot.exists) throw new HttpError(404, "Processing job not found.");
    if (snapshot.data()?.type !== "video") throw new HttpError(409, "This retry endpoint expected a video job.");
    if (snapshot.data()?.status !== "failed") throw new HttpError(409, "Only failed jobs can be retried.");
    transaction.update(jobReference, {
      status: "queued",
      error: null,
      completedAt: null,
      claimToken: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const enqueued = videoJobQueue.requeue(jobId);
  return { job: await getProcessingJob(jobId), enqueued };
}

const videoJobQueue = new SerialJobQueue(
  async (jobId) => { await processVideoJob(jobId); },
  (jobId, error) => console.error(`Video job ${jobId} failed:`, error),
);

export function enqueueVideoJob(jobId: string) {
  return videoJobQueue.enqueue(jobId);
}

export function waitForVideoJobsToFinish() {
  return videoJobQueue.whenIdle();
}

async function integrityAvailable(check: () => Promise<unknown>) {
  try {
    await check();
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) return false;
    throw error;
  }
}

async function markInterruptedUpload(
  document: QueryDocumentSnapshot,
  sourceMediaId: string,
  expectedStagingName: string | null,
) {
  const mediaReference = firestore.collection("mediaAssets").doc(sourceMediaId);
  return firestore.runTransaction(async (transaction) => {
    const [latestJob, latestMedia] = await Promise.all([
      transaction.get(document.ref),
      transaction.get(mediaReference),
    ]);
    if (!latestJob.exists || latestJob.data()?.status !== "uploading"
      || latestJob.data()?.sourceMediaId !== sourceMediaId) return false;
    const currentStagingName = latestMedia.data()?.stagingName;
    // A new idempotent retry may have installed a fresh staging generation
    // while recovery inspected the previous one. Let that owner/recovery win.
    if (typeof currentStagingName === "string" && currentStagingName !== expectedStagingName) return false;
    if (latestMedia.exists) {
      transaction.update(mediaReference, {
        storageStatus: "missing",
        stagingName: FieldValue.delete(),
        storageCheckedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(document.ref, {
      status: "failed",
      error: {
        code: "INTERRUPTED_UPLOAD",
        message: "The server stopped before the accepted source video reached durable storage.",
        occurredAt: FieldValue.serverTimestamp(),
      },
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function recoverUploadingVideoJob(
  document: QueryDocumentSnapshot,
  data: DocumentData,
  preserveStagingNames: Set<string>,
) {
  if (typeof data.sourceMediaId !== "string" || !data.sourceMediaId) {
    return { status: "failed" as const, stagingName: null };
  }
  const mediaReference = firestore.collection("mediaAssets").doc(data.sourceMediaId);
  const mediaSnapshot = await mediaReference.get();
  if (!mediaSnapshot.exists) {
    await markInterruptedUpload(document, data.sourceMediaId, null);
    return { status: "failed" as const, stagingName: null };
  }
  const media = mediaSnapshot.data()!;
  const storageKey = typeof media.storageKey === "string" ? media.storageKey : "";
  const stagingName = typeof media.stagingName === "string" ? media.stagingName : null;
  if (stagingName) preserveStagingNames.add(stagingName);
  const byteSize = Number(media.byteSize);
  const sha256 = typeof media.sha256 === "string" ? media.sha256 : "";
  if (!storageKey || !Number.isInteger(byteSize) || byteSize < 1 || !sha256) {
    await markInterruptedUpload(document, data.sourceMediaId, stagingName);
    return { status: "failed" as const, stagingName };
  }

  let finalAvailable = await integrityAvailable(() => inspectMediaIntegrity(storageKey, byteSize, sha256));
  if (!finalAvailable && stagingName) {
    const stagedAvailable = await integrityAvailable(() => inspectStagedMedia(stagingName, byteSize, sha256));
    if (stagedAvailable) {
      try {
        await moveStagedMedia(stagingName, storageKey);
      } catch {
        // An interrupted earlier publish may have completed the final file.
        // Re-check before treating the move as a transient recovery failure.
        finalAvailable = await integrityAvailable(() => inspectMediaIntegrity(storageKey, byteSize, sha256));
        if (!finalAvailable) throw new HttpError(503, "The staged video could not be recovered into media storage.");
      }
      finalAvailable = true;
    }
  }
  if (!finalAvailable) {
    await markInterruptedUpload(document, data.sourceMediaId, stagingName);
    return { status: "failed" as const, stagingName };
  }

  const clearedStagingName = await firestore.runTransaction(async (transaction) => {
    const [latestJob, latestMedia] = await Promise.all([
      transaction.get(document.ref),
      transaction.get(mediaReference),
    ]);
    if (!latestJob.exists || latestJob.data()?.status !== "uploading"
      || latestJob.data()?.sourceMediaId !== data.sourceMediaId || !latestMedia.exists) return null;
    const currentStagingName = typeof latestMedia.data()?.stagingName === "string"
      ? String(latestMedia.data()!.stagingName) : null;
    transaction.update(mediaReference, {
      storageStatus: "available",
      stagingName: FieldValue.delete(),
      storageCheckedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(document.ref, { status: "queued", updatedAt: FieldValue.serverTimestamp() });
    return currentStagingName;
  });
  if (clearedStagingName) await discardStagedMedia(clearedStagingName).catch(() => undefined);
  return { status: "queued" as const, stagingName };
}

export async function recoverVideoJobs() {
  const now = Date.now();
  const preserveStagingNames = new Set<string>();
  let queued = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = firestore.collection("processingJobs").orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      let data = document.data();
      if (data.type !== "video") continue;
      if (data.status === "uploading") {
        try {
          const recovered = await recoverUploadingVideoJob(document, data, preserveStagingNames);
          if (recovered.stagingName) preserveStagingNames.add(recovered.stagingName);
          data = { ...data, status: recovered.status };
        } catch (error) {
          console.error(`Video upload ${document.id} recovery is still pending:`, error);
          continue;
        }
      }
      const expired = data.status === "processing"
        && (!(data.leaseExpiresAt instanceof Timestamp) || data.leaseExpiresAt.toMillis() <= now);
      if (data.status === "queued" || expired) {
        if (enqueueVideoJob(document.id)) queued += 1;
      }
    }
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < 100) break;
  } while (cursor);

  // Orphans can exist when a process dies before its first Firestore commit.
  // A one-hour age gate avoids racing active uploads on the same host.
  await cleanupStaleTemporaryMedia({
    preserveNames: preserveStagingNames,
    olderThanMillis: 60 * 60 * 1_000,
  }).catch((error) => console.error("Stale video staging cleanup failed:", error));
  return queued;
}
