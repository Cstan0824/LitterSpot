import { apiRequest } from "./http";
import { cachedPageRequest, type ListPage } from "./pagination";

export type SystemControlHistory = {
  status: "running" | "paused";
  actorUid: string;
  actorNameSnapshot: string;
  actorAuthority: "root" | "regular" | null;
  reason: string | null;
  occurredAt: string;
};

export type SystemReference = {
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

export type SystemRun = {
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
  references: SystemReference;
  providerRequestCount: number;
  retryCount: number;
  candidateAttemptCount: number;
  toolCallCount: number;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type SystemEvent = {
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

export type SystemView = {
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
  controlHistory: SystemControlHistory[];
  recentRuns: SystemRun[];
  recentRunsPage?: { nextCursor: string | null; hasMore: boolean; totalCount: number };
  events: SystemEvent[];
};

export type OrchestratorRunDetail = {
  run: SystemRun & {
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

export type ServiceHealth = {
  status: "ok" | "degraded";
  dependencies?: { aiInference?: "ready" | "degraded" | "unavailable" };
};

export const getSystemView = (signal?: AbortSignal) =>
  apiRequest<SystemView>("/api/operations/system", { signal });

export const setOrchestratorStatus = (status: "running" | "paused", reason?: string | null) =>
  apiRequest<{ config: SystemView["configuration"] }>("/api/orchestrator/status", {
    method: "POST",
    json: { status, reason: reason?.trim() || null },
  });

export const getOrchestratorRunDetail = (runId: string, signal?: AbortSignal) =>
  apiRequest<OrchestratorRunDetail>(`/api/orchestrator/runs/${encodeURIComponent(runId)}`, { signal });

export const getOrchestratorRunsPage = (cursor?: string, signal?: AbortSignal): Promise<ListPage<SystemRun>> => {
  const url = `/api/orchestrator/runs?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  return cachedPageRequest(url, async () => { const result = await apiRequest<{ runs: SystemRun[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.runs, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal);
};

export async function getServiceHealth(signal?: AbortSignal): Promise<ServiceHealth> {
  const response = await fetch("/api/health", { signal, headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({ status: "degraded", dependencies: { aiInference: "unavailable" } })) as ServiceHealth;
  return body;
}
