import { Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { presentDetection } from "./analysisPresentation.js";
import { getMedia, getProcessingJob } from "./mediaService.js";
import { pinnedRegistrationFromJob } from "./processingRegistration.js";

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function document(snapshot: QueryDocumentSnapshot): Record<string, unknown> & { id: string } {
  return { id: snapshot.id, ...jsonValue(snapshot.data()) as Record<string, unknown> };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numeric(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function assembleProcessingJobResults(options: {
  processingJob: Awaited<ReturnType<typeof getProcessingJob>>;
  sourceMedia: Awaited<ReturnType<typeof getMedia>>;
  registration: ReturnType<typeof pinnedRegistrationFromJob>;
  analysisRuns: Array<Record<string, unknown> & { id: string }>;
  detections: Array<Record<string, unknown> & { id: string }>;
}) {
  const detectionsByRun = new Map<string, Array<Record<string, unknown>>>();
  for (const detection of options.detections) {
    const analysisRunId = String(detection.analysisRunId ?? "");
    const bucket = detectionsByRun.get(analysisRunId) ?? [];
    bucket.push(detection);
    detectionsByRun.set(analysisRunId, bucket);
  }

  const frames = options.analysisRuns.map((run) => {
    const detections = detectionsByRun.get(run.id) ?? [];
    const storedHazards = array(run.floorHazards);
    const floorHazards = storedHazards.length > 0 ? storedHazards : detections
      .filter((item) => item.issueType === "floor_litter" || item.issueType === "floor_spill")
      .map((item) => ({
        entityId: item.entityId,
        className: item.issueType,
        confidence: item.confidence,
        bboxNormalized: item.bboxNormalized,
        polygonNormalized: item.polygonNormalized,
      }));
    return {
      analysisRunId: run.id,
      capturedAt: run.capturedAt ?? null,
      frameIndex: numeric(run.frameIndex),
      videoOffsetSeconds: numeric(run.videoOffsetSeconds),
      image: run.image ?? null,
      evidenceMediaId: run.evidenceMediaId ?? null,
      evidenceContentUrl: typeof run.evidenceMediaId === "string" ? `/api/media/${run.evidenceMediaId}/content` : null,
      cameraRegistrationRevision: numeric(run.cameraRegistrationRevision),
      inferenceContractVersion: run.inferenceContractVersion ?? null,
      walkableFloorPolygonNormalized: array(run.walkableFloorPolygonNormalized ?? run.focusRegionNormalized),
      peopleCount: numeric(run.peopleCount) ?? 0,
      people: array(run.people),
      bins: array(run.bins),
      floorHazards,
      detections,
      issueKinds: array(run.issueKinds),
      issueCounts: run.issueCounts ?? {},
      modelVersions: run.modelVersions ?? {},
      processingTimeMs: numeric(run.processingTimeMs) ?? 0,
    };
  }).sort((left, right) => (
    (left.videoOffsetSeconds ?? left.frameIndex ?? 0) - (right.videoOffsetSeconds ?? right.frameIndex ?? 0)
  ));

  const registration = options.registration ? {
    cameraId: options.registration.cameraId,
    revision: options.registration.revision,
    status: options.registration.status,
    referenceMediaId: options.registration.referenceMediaId,
    referenceContentUrl: `/api/media/${options.registration.referenceMediaId}/content`,
    sourceWidth: options.registration.sourceWidth,
    sourceHeight: options.registration.sourceHeight,
    walkableFloorPolygon: options.registration.walkableFloorPolygon,
    bins: options.registration.bins,
  } : null;

  return {
    processingJob: options.processingJob,
    sourceMedia: options.sourceMedia,
    registration,
    frames,
  };
}

export async function getProcessingJobResults(jobId: string) {
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const jobSnapshot: DocumentSnapshot = await jobReference.get();
  if (!jobSnapshot.exists) throw new HttpError(404, "Processing job not found.");
  const rawJob = jobSnapshot.data()!;
  const sourceMediaId = typeof rawJob.sourceMediaId === "string" ? rawJob.sourceMediaId : "";
  if (!sourceMediaId) throw new HttpError(409, "Processing job does not reference source media.");

  const [processingJob, sourceMedia, analysisSnapshot, detectionSnapshot] = await Promise.all([
    getProcessingJob(jobId),
    getMedia(sourceMediaId),
    firestore.collection("analysisRuns").where("jobId", "==", jobId).get(),
    firestore.collection("detections").where("jobId", "==", jobId).get(),
  ]);
  const detections = detectionSnapshot.docs.map((item) => {
    const value = document(item);
    const { id, ...data } = value;
    return presentDetection(id, data, true);
  });
  return assembleProcessingJobResults({
    processingJob,
    sourceMedia,
    registration: pinnedRegistrationFromJob(rawJob),
    analysisRuns: analysisSnapshot.docs.map(document),
    detections,
  });
}
