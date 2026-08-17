import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";

export const DASHBOARD_CONTRACT_VERSION = "site-dashboard-v1";

type UnknownRecord = Record<string, unknown>;

export type DashboardSource<T extends UnknownRecord = UnknownRecord> = T & { id: string };

export type DashboardLimits = {
  alertLimit: number;
  detectionLimit: number;
  failedJobLimit: number;
};

export type DashboardActiveAlertCounts = {
  new: number;
  acknowledged: number;
  inProgress: number;
  total: number;
};

export type DashboardBuildInput = {
  site: DashboardSource;
  cameras: DashboardSource[];
  latestRuns: DashboardSource[];
  activeAlerts: DashboardSource[];
  activeAlertCounts: DashboardActiveAlertCounts;
  activeAlertsHasMore: boolean;
  recentDetections: DashboardSource[];
  recentFailedJobs: DashboardSource[];
  limits: DashboardLimits;
  generatedAt: string;
  sourceTruncation?: {
    cameras?: boolean;
    detections?: boolean;
    failedJobs?: boolean;
  };
  sourceQueryMode?: {
    activeAlerts?: "indexed";
    detections?: "indexed" | "fallback_bounded_scan";
    failedJobs?: "indexed" | "fallback_bounded_scan";
  };
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function objectOrEmpty(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function descending(left: UnknownRecord, right: UnknownRecord, field: string) {
  return String(right[field] ?? "").localeCompare(String(left[field] ?? ""));
}

function evidenceContentUrl(mediaId: unknown) {
  const id = stringOrNull(mediaId);
  return id ? `/api/media/${id}/content` : null;
}

function presentLatestRun(run: DashboardSource | undefined) {
  if (!run) return null;
  return {
    id: run.id,
    sourceType: stringOrNull(run.sourceType),
    capturedAt: stringOrNull(run.capturedAt),
    peopleCount: numberOrZero(run.peopleCount),
    issueKinds: stringArray(run.issueKinds),
    issueCounts: objectOrEmpty(run.issueCounts),
    image: objectOrEmpty(run.image),
    processingTimeMs: numberOrZero(run.processingTimeMs),
    evidenceMediaId: stringOrNull(run.evidenceMediaId),
    evidenceContentUrl: evidenceContentUrl(run.evidenceMediaId),
    isTest: Boolean(run.isTest),
    alertWorkflowVersion: stringOrNull(run.alertWorkflowVersion),
    alertEvaluationStatus: stringOrNull(run.alertEvaluationStatus),
  };
}

function presentCamera(camera: DashboardSource, latestRun: DashboardSource | undefined) {
  return {
    id: camera.id,
    zoneId: stringOrNull(camera.zoneId),
    zoneName: stringOrNull(camera.zoneNameSnapshot),
    code: stringOrNull(camera.code),
    name: stringOrNull(camera.name),
    status: stringOrNull(camera.status),
    availability: stringOrNull(camera.availability) ?? "unknown",
    sourceMode: stringOrNull(camera.sourceMode),
    latestAnalysisRunId: stringOrNull(camera.latestAnalysisRunId),
    latestAnalysisAt: stringOrNull(camera.latestAnalysisAt),
    latestRun: presentLatestRun(latestRun),
  };
}

function latestRunForCamera(camera: DashboardSource, latestRuns: Map<string, DashboardSource>) {
  const latestRunId = stringOrNull(camera.latestAnalysisRunId);
  if (!latestRunId) return undefined;
  const run = latestRuns.get(latestRunId);
  if (!run) return undefined;
  return run.cameraId === camera.id
    && run.siteId === camera.siteId
    && run.zoneId === camera.zoneId
    ? run
    : undefined;
}

function presentAlert(alert: DashboardSource) {
  return {
    id: alert.id,
    workflowVersion: stringOrNull(alert.workflowVersion),
    siteId: stringOrNull(alert.siteId),
    zoneId: stringOrNull(alert.zoneId),
    zoneName: stringOrNull(alert.zoneNameSnapshot),
    issueType: stringOrNull(alert.issueType),
    severity: stringOrNull(alert.severity),
    status: stringOrNull(alert.status),
    cameraIds: stringArray(alert.cameraIds),
    triggerCameraId: stringOrNull(alert.triggerCameraId),
    latestCameraId: stringOrNull(alert.latestCameraId),
    occurrenceCount: numberOrZero(alert.occurrenceCount),
    firstDetectedAt: stringOrNull(alert.firstDetectedAt),
    lastDetectedAt: stringOrNull(alert.lastDetectedAt),
    latestConfidence: numberOrZero(alert.latestConfidence),
    latestMagnitudeScore: typeof alert.latestMagnitudeScore === "number" ? alert.latestMagnitudeScore : null,
    latestEvidenceMediaId: stringOrNull(alert.latestEvidenceMediaId),
    latestEvidenceContentUrl: evidenceContentUrl(alert.latestEvidenceMediaId),
  };
}

function presentDetection(detection: DashboardSource) {
  return {
    id: detection.id,
    analysisRunId: stringOrNull(detection.analysisRunId),
    zoneId: stringOrNull(detection.zoneId),
    zoneName: stringOrNull(detection.zoneName),
    cameraId: stringOrNull(detection.cameraId),
    cameraCode: stringOrNull(detection.cameraCode),
    cameraName: stringOrNull(detection.cameraName),
    issueType: stringOrNull(detection.issueType),
    confidence: numberOrZero(detection.confidence),
    capturedAt: stringOrNull(detection.capturedAt),
    qualificationStatus: stringOrNull(detection.qualificationStatus),
    qualifiedForFlag: typeof detection.qualifiedForFlag === "boolean" ? detection.qualifiedForFlag : null,
    observationId: stringOrNull(detection.observationId),
    flagId: stringOrNull(detection.flagId),
    isTest: Boolean(detection.isTest),
    evidenceMediaId: stringOrNull(detection.evidenceMediaId),
    evidenceContentUrl: evidenceContentUrl(detection.evidenceMediaId),
    detailUrl: `/api/detections/${detection.id}`,
  };
}

function presentFailedJob(job: DashboardSource) {
  const error = objectOrEmpty(job.error);
  return {
    id: job.id,
    type: stringOrNull(job.type),
    status: stringOrNull(job.status),
    sourceType: stringOrNull(job.sourceType),
    zoneId: stringOrNull(job.zoneId),
    cameraId: stringOrNull(job.cameraId),
    sourceMediaId: stringOrNull(job.sourceMediaId),
    requestedAt: stringOrNull(job.requestedAt),
    completedAt: stringOrNull(job.completedAt),
    attemptCount: numberOrZero(job.attemptCount),
    isTest: Boolean(job.isTest),
    analyticsEligible: Boolean(job.analyticsEligible),
    error: {
      code: stringOrNull(error.code),
      message: stringOrNull(error.message),
      occurredAt: stringOrNull(error.occurredAt),
    },
  };
}

export function buildDashboardDto(input: DashboardBuildInput) {
  const latestRuns = new Map(input.latestRuns.map((run) => [run.id, run]));
  const cameras = input.cameras
    .map((camera) => presentCamera(camera, latestRunForCamera(camera, latestRuns)))
    .sort((left, right) => String(left.code ?? "").localeCompare(String(right.code ?? ""), undefined, { numeric: true }));
  const activeAlertStatuses = new Set(["new", "acknowledged", "in_progress"]);
  const eligibleActiveAlerts = input.activeAlerts
    .filter((alert) => alert.workflowVersion === ALERT_WORKFLOW_VERSION
      && activeAlertStatuses.has(String(alert.status)))
    .sort((left, right) => descending(left, right, "lastDetectedAt"));
  const activeAlerts = eligibleActiveAlerts.slice(0, input.limits.alertLimit).map(presentAlert);
  const recentDetections = [...input.recentDetections]
    .sort((left, right) => descending(left, right, "capturedAt"))
    .slice(0, input.limits.detectionLimit)
    .map(presentDetection);
  const recentFailedJobs = [...input.recentFailedJobs]
    .sort((left, right) => descending(left, right, "completedAt"))
    .slice(0, input.limits.failedJobLimit)
    .map(presentFailedJob);
  const availableCameraCount = cameras.filter((camera) => camera.status === "active" && camera.availability === "available").length;
  const unavailableCameraCount = cameras.filter((camera) => camera.status === "active" && camera.availability === "unavailable").length;
  const unknownCameraCount = cameras.filter((camera) => camera.status === "active" && !["available", "unavailable"].includes(camera.availability)).length;

  return {
    contractVersion: DASHBOARD_CONTRACT_VERSION,
    workflowVersion: ALERT_WORKFLOW_VERSION,
    generatedAt: input.generatedAt,
    site: {
      id: input.site.id,
      name: stringOrNull(input.site.name),
      timezone: stringOrNull(input.site.timezone) ?? "Asia/Kuala_Lumpur",
      status: stringOrNull(input.site.status),
    },
    summary: {
      configuredCameraCount: cameras.length,
      activeCameraCount: cameras.filter((camera) => camera.status === "active").length,
      availableCameraCount,
      unavailableCameraCount,
      unknownCameraCount,
      activeAlertCounts: input.activeAlertCounts,
      latestDetectionAt: recentDetections[0]?.capturedAt ?? null,
      latestJobFailureAt: recentFailedJobs[0]?.error.occurredAt ?? recentFailedJobs[0]?.completedAt ?? null,
    },
    cameras,
    activeAlerts,
    recentDetections,
    recentFailedJobs,
    completeness: {
      activeAlerts: input.activeAlertsHasMore ? "more_available" : "complete",
      configuredCameras: input.sourceTruncation?.cameras ? "bounded_source_scan" : "complete",
      latestRuns: "complete_for_configured_cameras",
      recentDetections: input.sourceTruncation?.detections ? "bounded_source_scan" : "complete_within_site_query",
      recentFailedJobs: input.sourceTruncation?.failedJobs ? "bounded_source_scan" : "complete_within_site_query",
    },
    sourceQueryMode: {
      activeAlerts: input.sourceQueryMode?.activeAlerts ?? "indexed",
      detections: input.sourceQueryMode?.detections ?? "indexed",
      failedJobs: input.sourceQueryMode?.failedJobs ?? "indexed",
    },
  };
}
