import { v2Request } from "./http";

export type V2SystemControlHistory = {
  status: "running" | "paused";
  actorUid: string;
  actorNameSnapshot: string;
  actorAuthority: "root" | "regular" | null;
  reason: string | null;
  occurredAt: string;
};

export type V2SystemReference = {
  alert: null | {
    id: string;
    issueType: string | null;
    observedCondition: string | null;
    severity: string | null;
    zoneId: string | null;
    zoneName: string | null;
    cameraId: string | null;
    cameraName: string | null;
  };
  cleaner: null | { id: string; name: string | null };
  workOrder: null | { id: string; title: string | null; status: string | null; targetType: string | null };
};

export type V2SystemRun = {
  id: string;
  type: "assignment" | "review";
  status: string;
  resultCode: string | null;
  selectedAlertId: string | null;
  selectedCleanerId: string | null;
  workOrderId: string | null;
  provider: string | null;
  model: string | null;
  decisionSummary: string | null;
  decisionFactors: Record<string, unknown>;
  isSimulation: boolean;
  references: V2SystemReference;
  providerRequestCount: number;
  retryCount: number;
  candidateAttemptCount: number;
  toolCallCount: number;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type V2SystemEvent = {
  id: string;
  code: string;
  component: string;
  severity: "warning" | "critical";
  status: "open" | "recovered";
  occurrenceCount: number;
  message: string;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  recoveredAt: string | null;
  updatedAt: string | null;
  derivedFromRuntime?: boolean;
};

export type V2SystemView = {
  configuration: {
    id: string;
    siteId: string;
    status: "running" | "paused";
    assignmentEnabled: boolean;
    reviewEnabled: boolean;
    provider: string;
    model: string;
    activeRunId: string | null;
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    lastFailureAt: string | null;
    lastFailureCode: string | null;
    pauseReason: string | null;
    pausedAt: string | null;
  };
  runtime: {
    backgroundWorkerEnabled: boolean;
    observedAt: string;
    providerConnectivity: "not_probed";
    backlog: { waitingAlertCount: number; awaitingReviewWorkOrderCount: number };
  };
  controlHistory: V2SystemControlHistory[];
  recentRuns: V2SystemRun[];
  events: V2SystemEvent[];
};

export type V2OrchestratorRunDetail = {
  run: V2SystemRun & {
    inputSnapshot?: {
      alerts?: Array<{ alertId: string; issueType?: string; zoneName?: string; cameraName?: string }>;
      cleaners?: Array<{ cleanerId: string; fullName: string }>;
      eligiblePairs?: Array<{
        alertId: string;
        cleanerId: string;
        stationDistanceMeters: number;
        recentWorkDistanceMeters: number | null;
        recentWorkStrength: "strong" | "weak" | null;
      }>;
      workOrder?: Record<string, unknown>;
    } | null;
  };
  attempts: Array<{
    id: string;
    sequence: number;
    kind: "provider_request" | "cleaner_reservation";
    selectedAlertId: string | null;
    selectedCleanerId: string | null;
    excludedCleanerIds: string[];
    outcome: string;
    reasonCode: string | null;
    retryDelayMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  actions: Array<{
    id: string;
    sequence: number;
    tool: string;
    outcome: "succeeded" | "rejected" | "failed";
    resultSummary: Record<string, unknown>;
    errorCode: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
};

export type V2ServiceHealth = {
  status: "ok" | "degraded";
  dependencies?: { aiInference?: "ready" | "degraded" | "unavailable" };
};

export const getV2SystemView = (signal?: AbortSignal) =>
  v2Request<V2SystemView>("/api/operations/v2/system", { signal });

export const setV2OrchestratorStatus = (status: "running" | "paused", reason?: string | null) =>
  v2Request<{ config: V2SystemView["configuration"] }>("/api/orchestrator/v2/status", {
    method: "POST",
    json: { status, reason: reason?.trim() || null },
  });

export const getV2OrchestratorRunDetail = (runId: string, signal?: AbortSignal) =>
  v2Request<V2OrchestratorRunDetail>(`/api/orchestrator/v2/runs/${encodeURIComponent(runId)}`, { signal });

export async function getV2ServiceHealth(signal?: AbortSignal): Promise<V2ServiceHealth> {
  const response = await fetch("/api/health", { signal, headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({ status: "degraded", dependencies: { aiInference: "unavailable" } })) as V2ServiceHealth;
  return body;
}
