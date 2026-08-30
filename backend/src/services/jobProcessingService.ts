import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import axios from "axios";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { normalizeAnalysis } from "./analysisNormalization.js";
import { inferFrame } from "./frameInferenceClient.js";
import { inspectMedia } from "./localMediaStorage.js";
import { getProcessingJob } from "./mediaService.js";
import { assertImageJobCanRetry, decideImageJobClaim, shouldAdvanceCameraLatestPointer } from "./jobState.js";
import { buildProcessResponse, presentAnalysisRun, presentDetection } from "./analysisPresentation.js";
import { ALERT_WORKFLOW_VERSION, evaluateAnalysisRunDetections } from "./alertWorkflowService.js";
import { applyCompletedAnalysisAnalytics } from "./analyticsService.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { getCameraRegistration } from "./cameraRegistrationService.js";
import { loadRegistrationReference } from "./cameraRegistrationReference.js";
import {
  assertRegistrationFrameDimensions,
  pinCameraRegistration,
  pinnedRegistrationFromJob,
  REGISTERED_FRAME_INFERENCE_CONTRACT_VERSION,
} from "./processingRegistration.js";

type ClaimResult = { completedRunId: string } | { claimToken: string; job: DocumentData };

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}

function serializeDocument(snapshot: DocumentSnapshot, label: string): Record<string, unknown> & { id: string } {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return { id: snapshot.id, ...jsonValue(snapshot.data()) as Record<string, unknown> };
}

function failureDetails(error: unknown) {
  if (error instanceof HttpError) {
    const code = error.details && typeof error.details === "object" && "code" in error.details
      ? String(error.details.code) : "MEDIA_UNAVAILABLE";
    return { code, message: error.message };
  }
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" && "detail" in error.response.data
      ? String(error.response.data.detail)
      : "The AI inference service failed.";
    return { code: "INFERENCE_FAILED", message: detail };
  }
  return { code: "PROCESSING_FAILED", message: error instanceof Error ? error.message : "Image processing failed." };
}

async function claimImageJob(jobId: string): Promise<ClaimResult> {
  const reference = firestore.collection("processingJobs").doc(jobId);
  const claimToken = randomUUID();
  return firestore.runTransaction(async (transaction): Promise<ClaimResult> => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpError(404, "Processing job not found.");
    const data = snapshot.data()!;
    if (data.type !== "image") throw new HttpError(409, "Only image jobs are supported by this processor.");
    const lease = data.leaseExpiresAt;
    const decision = decideImageJobClaim(data.status, lease instanceof Timestamp ? lease.toMillis() : null, Date.now());
    if (decision === "completed") {
      return { completedRunId: String(data.analysisRunId ?? jobId) };
    }
    transaction.update(reference, {
      status: "processing",
      claimToken,
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 2 * 60_000),
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      error: null,
      attemptCount: Number(data.attemptCount ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimToken, job: data };
  });
}

async function markFailed(jobId: string, claimToken: string, error: unknown) {
  const reference = firestore.collection("processingJobs").doc(jobId);
  const failure = failureDetails(error);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data()?.claimToken !== claimToken) return;
    transaction.update(reference, {
      status: "failed",
      error: { ...failure, occurredAt: FieldValue.serverTimestamp() },
      progress: { plannedFrames: 1, processedFrames: 1, successfulFrames: 0, failedFrames: 1, lastFrameIndex: 0 },
      claimToken: null,
      leaseExpiresAt: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function completeClaimedImageJob(options: {
  jobId: string;
  claimToken: string;
  analysisRunId: string;
  detectionCount: number;
  flagIds: string[];
  alertIds: string[];
}) {
  const jobReference = firestore.collection("processingJobs").doc(options.jobId);
  await firestore.runTransaction(async (transaction) => {
    const latestJob = await transaction.get(jobReference);
    if (!latestJob.exists || latestJob.data()?.claimToken !== options.claimToken) {
      throw new HttpError(409, "Processing claim expired before the job could be completed.");
    }
    transaction.update(jobReference, {
      status: "completed",
      analysisRunId: options.analysisRunId,
      progress: { plannedFrames: 1, processedFrames: 1, successfulFrames: 1, failedFrames: 0, lastFrameIndex: 0 },
      summary: {
        analysisRunCount: 1,
        detectionCount: options.detectionCount,
        flagCount: options.flagIds.length,
        alertIds: options.alertIds,
      },
      claimToken: null,
      leaseExpiresAt: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function completedProcessResponse(jobId: string, analysisRunId: string, alreadyCompleted: boolean) {
  const [job, analysisRun, detections] = await Promise.all([
    getProcessingJob(jobId),
    getAnalysisRun(analysisRunId),
    listDetections({ analysisRunId, limit: 100 }),
  ]);
  return buildProcessResponse(job, analysisRun, detections.items, alreadyCompleted);
}

export async function getAnalysisRun(runId: string) {
  const document = serializeDocument(await firestore.collection("analysisRuns").doc(runId).get(), "Analysis run");
  const { id, ...data } = document;
  return presentAnalysisRun(id, data);
}

export async function listAnalysisRuns(filters: {
  jobId?: string;
  cameraId?: string;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("analysisRuns");
  const ownershipFilter = filters.jobId
    ? { field: "jobId", value: filters.jobId }
    : filters.cameraId
      ? { field: "cameraId", value: filters.cameraId }
      : null;
  if (ownershipFilter) query = query.where(ownershipFilter.field, "==", ownershipFilter.value);
  return queryCursorPage({
    query,
    resource: "analysis-runs",
    orderField: "createdAt",
    filters: { ownershipFilter },
    limit: filters.limit,
    cursor: filters.cursor,
    present: (item) => {
      const document = serializeDocument(item, "Analysis run");
      const { id, ...data } = document;
      return presentAnalysisRun(id, data);
    },
  });
}

export async function getDetection(detectionId: string) {
  const document = serializeDocument(await firestore.collection("detections").doc(detectionId).get(), "Detection");
  const { id, ...data } = document;
  return presentDetection(id, data, true);
}

export async function listDetections(filters: {
  analysisRunId?: string;
  jobId?: string;
  cameraId?: string;
  issueType?: string;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("detections");
  // Preserve the established ownership-filter precedence for callers that pass
  // more than one of these fields.
  const ownershipFilter = filters.analysisRunId
    ? { field: "analysisRunId", value: filters.analysisRunId }
    : filters.jobId
      ? { field: "jobId", value: filters.jobId }
      : filters.cameraId
        ? { field: "cameraId", value: filters.cameraId }
        : null;
  if (ownershipFilter) query = query.where(ownershipFilter.field, "==", ownershipFilter.value);
  if (filters.issueType) query = query.where("issueType", "==", filters.issueType);
  return queryCursorPage({
    query,
    resource: "detections",
    orderField: "createdAt",
    filters: { ownershipFilter, issueType: filters.issueType },
    limit: filters.limit,
    cursor: filters.cursor,
    present: (item) => {
      const document = serializeDocument(item, "Detection");
      const { id, ...data } = document;
      return presentDetection(id, data, false);
    },
  });
}

export async function processImageJob(jobId: string) {
  const claim = await claimImageJob(jobId);
  if ("completedRunId" in claim) {
    return completedProcessResponse(jobId, claim.completedRunId, true);
  }

  const { claimToken, job } = claim;
  try {
    const analysisRunId = jobId;
    const analysisReference = firestore.collection("analysisRuns").doc(analysisRunId);
    const persistedRunSnapshot = await analysisReference.get();
    if (persistedRunSnapshot.exists) {
      const persistedRun = persistedRunSnapshot.data()!;
      if (persistedRun.alertWorkflowVersion !== ALERT_WORKFLOW_VERSION || persistedRun.jobId !== jobId) {
        throw new HttpError(409, "A conflicting analysis run already exists for this processing job.");
      }
      const detectionSnapshot = await firestore.collection("detections").where("analysisRunId", "==", analysisRunId).get();
      const alertEvaluation = persistedRun.alertEvaluationStatus === "completed"
        ? { flagIds: stringArray(persistedRun.flagIds), alertIds: stringArray(persistedRun.alertIds) }
        : await evaluateAnalysisRunDetections(analysisRunId);
      await applyCompletedAnalysisAnalytics(analysisRunId, alertEvaluation.alertIds);
      await completeClaimedImageJob({
        jobId,
        claimToken,
        analysisRunId,
        detectionCount: detectionSnapshot.size,
        flagIds: alertEvaluation.flagIds,
        alertIds: alertEvaluation.alertIds,
      });
      return completedProcessResponse(jobId, analysisRunId, false);
    }

    const mediaReference = firestore.collection("mediaAssets").doc(String(job.sourceMediaId));
    const mediaSnapshot = await mediaReference.get();
    if (!mediaSnapshot.exists) throw new HttpError(404, "Source media asset not found.");
    const media = mediaSnapshot.data()!;
    if (media.storageStatus !== "available") throw new HttpError(410, "Source media file is unavailable.");
    const stored = await inspectMedia(String(media.storageKey));
    const contents = await readFile(stored.filePath);
    const options = job.options && typeof job.options === "object" ? job.options as Record<string, unknown> : {};
    const floorConfidence = typeof options.floorConfidence === "number" ? options.floorConfidence : 0.25;
    const binLocalizerConfidence = typeof options.binLocalizerConfidence === "number" ? options.binLocalizerConfidence : 0.80;
    const focusRegion = Array.isArray(options.focusRegionNormalized) ? options.focusRegionNormalized as Array<{ x: number; y: number }> : [];
    const registration = pinnedRegistrationFromJob(job)
      ?? pinCameraRegistration(String(job.cameraId), await getCameraRegistration(String(job.cameraId)) ?? undefined);
    const reference = await loadRegistrationReference(registration);
    const result = await inferFrame({
      contents,
      fileName: String(media.originalFileName),
      mimeType: String(media.mimeType),
      floorConfidence,
      binLocalizerConfidence,
      focusRegion,
      registration,
      reference,
      binReviewEnabled: false,
    });
    assertRegistrationFrameDimensions(registration, result.image);
    const normalized = normalizeAnalysis(result, analysisRunId, floorConfidence, {
      requireConfirmedOverflow: Boolean(registration),
    });
    const capturedAt = media.capturedAt instanceof Timestamp ? media.capturedAt : Timestamp.now();

    await firestore.runTransaction(async (transaction) => {
      const cameraReference = firestore.collection("cameras").doc(String(job.cameraId));
      const [latestJob, latestRun, latestCamera] = await Promise.all([
        transaction.get(firestore.collection("processingJobs").doc(jobId)),
        transaction.get(analysisReference),
        transaction.get(cameraReference),
      ]);
      if (!latestJob.exists || latestJob.data()?.claimToken !== claimToken) {
        throw new HttpError(409, "Processing claim expired before results could be saved.");
      }
      if (latestRun.exists) {
        throw new HttpError(409, "An analysis run was already persisted; retry the job to resume alert evaluation.");
      }
      if (!latestCamera.exists) throw new HttpError(404, "Camera not found.");
      const latestCapturedAt = latestCamera.data()?.latestCapturedAt;
      const advanceCameraPointer = shouldAdvanceCameraLatestPointer({
        cameraSiteId: latestCamera.data()?.siteId,
        cameraZoneId: latestCamera.data()?.zoneId,
        runSiteId: String(job.siteId),
        runZoneId: String(job.zoneId),
        latestCapturedAtMs: latestCapturedAt instanceof Timestamp ? latestCapturedAt.toMillis() : null,
        runCapturedAtMs: capturedAt.toMillis(),
      });
      transaction.set(analysisReference, {
        jobId,
        sourceMediaId: mediaSnapshot.id,
        frameMediaId: null,
        evidenceMediaId: mediaSnapshot.id,
        sourceType: "image_upload",
        siteId: String(job.siteId),
        siteName: String(media.siteNameSnapshot),
        zoneId: String(job.zoneId),
        zoneName: String(media.zoneNameSnapshot),
        cameraId: String(job.cameraId),
        cameraRegistrationRevision: registration.revision,
        inferenceContractVersion: REGISTERED_FRAME_INFERENCE_CONTRACT_VERSION,
        cameraCode: String(media.cameraCodeSnapshot),
        cameraName: String(media.cameraNameSnapshot),
        capturedAt,
        frameIndex: null,
        videoOffsetSeconds: null,
        image: result.image,
        focusRegionNormalized: registration.walkableFloorPolygon,
        walkableFloorPolygonNormalized: registration.walkableFloorPolygon,
        peopleCount: result.peopleCount,
        people: normalized.people,
        bins: normalized.bins,
        floorHazards: normalized.floorHazards,
        issueKinds: normalized.issueKinds,
        issueCounts: normalized.issueCounts,
        modelVersions: result.modelVersions,
        processingTimeMs: result.processingTimeMs,
        analyticsEligible: Boolean(job.analyticsEligible),
        analyticsAppliedAt: null,
        isTest: Boolean(job.isTest),
        alertWorkflowVersion: ALERT_WORKFLOW_VERSION,
        alertEvaluationStatus: "pending",
        alertEvaluationPolicyVersion: null,
        alertEvaluationAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const detection of normalized.detections) {
        transaction.set(firestore.collection("detections").doc(detection.id), {
          analysisRunId,
          jobId,
          sourceMediaId: mediaSnapshot.id,
          evidenceMediaId: mediaSnapshot.id,
          sourceType: "image_upload",
          siteId: String(job.siteId),
          siteName: String(media.siteNameSnapshot),
          zoneId: String(job.zoneId),
          zoneName: String(media.zoneNameSnapshot),
          cameraId: String(job.cameraId),
          cameraCode: String(media.cameraCodeSnapshot),
          cameraName: String(media.cameraNameSnapshot),
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
          analyticsEligible: Boolean(job.analyticsEligible),
          isTest: Boolean(job.isTest),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(mediaReference, { width: result.image.width, height: result.image.height, latestAnalysisRunId: analysisRunId });
      transaction.update(cameraReference, {
        availability: "available",
        ...(advanceCameraPointer ? {
          latestAnalysisRunId: analysisRunId,
          latestAnalysisAt: FieldValue.serverTimestamp(),
          latestCapturedAt: capturedAt,
        } : {}),
      });
      transaction.update(firestore.collection("processingJobs").doc(jobId), {
        status: "processing",
        progress: { plannedFrames: 1, processedFrames: 1, successfulFrames: 1, failedFrames: 0, lastFrameIndex: 0 },
        summary: { analysisRunCount: 1, detectionCount: normalized.detections.length, flagCount: 0, alertIds: [] },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    const alertEvaluation = await evaluateAnalysisRunDetections(analysisRunId);
    await applyCompletedAnalysisAnalytics(analysisRunId, alertEvaluation.alertIds);
    await completeClaimedImageJob({
      jobId,
      claimToken,
      analysisRunId,
      detectionCount: normalized.detections.length,
      flagIds: alertEvaluation.flagIds,
      alertIds: alertEvaluation.alertIds,
    });
    return completedProcessResponse(jobId, analysisRunId, false);
  } catch (error) {
    await markFailed(jobId, claimToken, error);
    throw error;
  }
}

export async function retryImageJob(jobId: string) {
  const reference = firestore.collection("processingJobs").doc(jobId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpError(404, "Processing job not found.");
    assertImageJobCanRetry(snapshot.data()?.status);
    transaction.update(reference, {
      status: "queued",
      error: null,
      completedAt: null,
      claimToken: null,
      leaseExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return processImageJob(jobId);
}
