import { apiFetch, readApiError } from "./apiClient";

export type NormalizedBox = { x1: number; y1: number; x2: number; y2: number };
export type NormalizedPoint = { x: number; y: number };
export type ProcessingJobStatus = "uploading" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export type ProcessingJob = {
  id: string;
  type: "image" | "video";
  status: ProcessingJobStatus;
  sourceMediaId: string;
  cameraId: string;
  cameraRegistrationRevision: number | null;
  progress: { plannedFrames: number; processedFrames: number; successfulFrames: number; failedFrames: number; lastFrameIndex: number | null };
  summary: { analysisRunCount: number; detectionCount: number; flagCount: number; alertIds: string[] };
  error: { code: string; message: string; occurredAt: string | null } | null;
};

export type ProcessingFrame = {
  analysisRunId: string;
  capturedAt: string | null;
  frameIndex: number | null;
  videoOffsetSeconds: number | null;
  image: { width: number; height: number } | null;
  evidenceContentUrl: string | null;
  cameraRegistrationRevision: number | null;
  inferenceContractVersion: string | null;
  walkableFloorPolygonNormalized: NormalizedPoint[];
  peopleCount: number;
  people: Array<{ confidence: number; bboxNormalized: NormalizedBox }>;
  bins: Array<{
    entityId: string;
    binId: string | null;
    state: "normal" | "full" | "overflow" | "review" | "unknown";
    stableState: "normal" | "full" | "overflow" | "review" | "unknown" | null;
    confidence: number;
    bboxNormalized: NormalizedBox;
    confirmed: boolean | null;
    stale: boolean;
  }>;
  floorHazards: Array<{
    entityId: string;
    className: "floor_litter" | "floor_spill";
    confidence: number;
    bboxNormalized: NormalizedBox;
    polygonNormalized: NormalizedPoint[];
  }>;
  detections: Array<{ id: string; issueType: string; confidence: number; bboxNormalized: NormalizedBox }>;
  issueKinds: string[];
  issueCounts: { floorLitter?: number; binOverflow?: number; floorSpill?: number };
  modelVersions: Record<string, string>;
  processingTimeMs: number;
};

export type ProcessingJobResults = {
  processingJob: ProcessingJob;
  sourceMedia: {
    id: string;
    originalFileName: string;
    mimeType: string;
    contentUrl: string;
    durationSeconds: number | null;
  };
  registration: {
    cameraId: string;
    revision: number;
    status: "ready";
    referenceMediaId: string;
    referenceContentUrl: string;
    sourceWidth: number;
    sourceHeight: number;
    walkableFloorPolygon: NormalizedPoint[];
    bins: Array<{ binId: string; displayName: string; binType: string; binPolygon: NormalizedPoint[] }>;
  } | null;
  frames: ProcessingFrame[];
};

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json() as T;
}

function requestId() {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `model-test-${id}`;
}

export async function uploadTestMedia(options: {
  file: File;
  cameraId: string;
  type: "image" | "video";
  frameIntervalSeconds: number;
}) {
  const form = new FormData();
  form.append(options.type, options.file, options.file.name);
  form.append("cameraId", options.cameraId);
  form.append("clientRequestId", requestId());
  form.append("isTest", "true");
  if (options.type === "video") form.append("frameIntervalSeconds", String(options.frameIntervalSeconds));
  return responseJson<{ media: ProcessingJobResults["sourceMedia"]; job: ProcessingJob; idempotent: boolean }>(
    await apiFetch(`/api/media/${options.type === "image" ? "images" : "videos"}`, { method: "POST", body: form }),
  );
}

export async function startProcessingJob(jobId: string) {
  return responseJson<unknown>(await apiFetch(`/api/processing-jobs/${encodeURIComponent(jobId)}/process`, { method: "POST" }));
}

export async function getProcessingJob(jobId: string) {
  return (await responseJson<{ processingJob: ProcessingJob }>(
    await apiFetch(`/api/processing-jobs/${encodeURIComponent(jobId)}`),
  )).processingJob;
}

export async function getProcessingJobResults(jobId: string) {
  return responseJson<ProcessingJobResults>(
    await apiFetch(`/api/processing-jobs/${encodeURIComponent(jobId)}/results`),
  );
}
