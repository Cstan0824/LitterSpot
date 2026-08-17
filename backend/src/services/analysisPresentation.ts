import { simplifyPolygon } from "./analysisNormalization.js";

type Data = Record<string, unknown>;

function mediaContentUrl(mediaId: unknown) {
  return typeof mediaId === "string" && mediaId ? `/api/media/${mediaId}/content` : null;
}

export function presentAnalysisRun(id: string, data: Data): Data & { id: string; evidenceContentUrl: string | null } {
  const { inferenceFlags: _inferenceFlags, ...visible } = data;
  return {
    id,
    ...visible,
    evidenceContentUrl: mediaContentUrl(data["evidenceMediaId"]),
  };
}

export function presentDetection(id: string, data: Data, includeGeometry: boolean): Data & {
  id: string;
  qualifiedForFlag: unknown;
  qualificationStatus: unknown;
  evidenceContentUrl: string | null;
  detailUrl: string;
  polygonNormalized?: Array<{ x: number; y: number }>;
} {
  const { polygonNormalized: rawPolygon, ...visible } = data;
  const pending = data["qualificationStatus"] === "pending_evaluation"
    || data["qualificationReason"] === "alert_policy_pending";
  const polygon = Array.isArray(rawPolygon)
    ? simplifyPolygon(rawPolygon.filter((point): point is { x: number; y: number } => (
      Boolean(point) && typeof point === "object"
      && typeof (point as { x?: unknown }).x === "number"
      && typeof (point as { y?: unknown }).y === "number"
    )))
    : [];
  return {
    id,
    ...visible,
    qualifiedForFlag: pending ? null : data["qualifiedForFlag"] ?? null,
    qualificationStatus: pending ? "pending_evaluation" : data["qualificationStatus"] ?? "evaluated",
    evidenceContentUrl: mediaContentUrl(data["evidenceMediaId"]),
    detailUrl: `/api/detections/${id}`,
    ...(includeGeometry ? { polygonNormalized: polygon } : {}),
  };
}

export function buildProcessResponse(job: Data, analysisRun: Data, detections: Data[], alreadyCompleted: boolean) {
  return {
    job: {
      id: job["id"],
      status: job["status"],
      attemptCount: job["attemptCount"],
      analysisRunId: job["analysisRunId"],
      progress: job["progress"],
      summary: job["summary"],
      error: job["error"],
      startedAt: job["startedAt"],
      completedAt: job["completedAt"],
    },
    result: {
      analysisRunId: analysisRun["id"],
      evidenceMediaId: analysisRun["evidenceMediaId"],
      evidenceContentUrl: analysisRun["evidenceContentUrl"],
      siteId: analysisRun["siteId"],
      zoneId: analysisRun["zoneId"],
      cameraId: analysisRun["cameraId"],
      peopleCount: analysisRun["peopleCount"],
      issueKinds: analysisRun["issueKinds"],
      issueCounts: analysisRun["issueCounts"],
      detectionCount: detections.length,
      detectionIds: detections.map((detection) => detection["id"]),
      processingTimeMs: analysisRun["processingTimeMs"],
    },
    alreadyCompleted,
  };
}
