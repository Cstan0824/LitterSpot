import { ALERT_POLICY, type IssueType } from "./alertPolicy.js";

export const ANALYTICS_AGGREGATION_VERSION = "hourly-zone-v1";
export const ANALYTICS_PERSISTENCE_METHOD =
  "positive_to_positive_gap_same_camera_capped_by_confirmation_horizon_v1";

export type AnalyticsPersistenceState = {
  lastAnalysisRunId: string;
  lastCapturedAtMs: number;
  lastPositive: boolean;
};

export type AnalyticsObservationInput = {
  issueType: IssueType;
  positive: boolean;
  eligibleDetectionCount: number;
};

export type AnalyticsRunInput = {
  id: string;
  siteId: string;
  zoneId: string;
  cameraId: string;
  capturedAtMs: number;
  peopleCount: number;
  modelVersions: string[];
  observations: AnalyticsObservationInput[];
};

export type AnalyticsRunContribution = {
  successfulSampleCount: 1;
  peopleCountSum: number;
  peopleCountMax: number;
  peoplePresentSamples: number;
  litterPositiveSamples: number;
  litterDetectionCount: number;
  overflowPositiveSamples: number;
  overflowDetectionCount: number;
  spillPositiveSamples: number;
  spillDetectionCount: number;
  issuePersistenceSeconds: number;
  issuePersistenceSecondsByType: Record<IssueType, number>;
  modelVersions: string[];
  persistenceOutOfOrderIssueTypes: IssueType[];
};

export function hourlyBucketBounds(capturedAtMs: number) {
  if (!Number.isFinite(capturedAtMs)) throw new Error("A finite capture timestamp is required.");
  const bucketStartMs = Math.floor(capturedAtMs / 3_600_000) * 3_600_000;
  return { bucketStartMs, bucketEndMs: bucketStartMs + 3_600_000 };
}

export function applyPersistenceObservation(
  previous: AnalyticsPersistenceState | null,
  input: { analysisRunId: string; capturedAtMs: number; positive: boolean; issueType: IssueType },
): { next: AnalyticsPersistenceState; persistenceSeconds: number; outOfOrder: boolean } {
  const next = {
    lastAnalysisRunId: input.analysisRunId,
    lastCapturedAtMs: input.capturedAtMs,
    lastPositive: input.positive,
  };
  if (!previous) return { next, persistenceSeconds: 0, outOfOrder: false };
  if (input.capturedAtMs < previous.lastCapturedAtMs) {
    return { next: previous, persistenceSeconds: 0, outOfOrder: true };
  }

  const elapsedSeconds = (input.capturedAtMs - previous.lastCapturedAtMs) / 1_000;
  const maximumSeconds = ALERT_POLICY.rules[input.issueType].confirmation.maximumWindowSeconds;
  const persistenceSeconds = input.positive
    && previous.lastPositive
    && elapsedSeconds <= maximumSeconds
    ? elapsedSeconds
    : 0;
  return { next, persistenceSeconds, outOfOrder: false };
}

export function deriveRunAnalyticsContribution(
  input: AnalyticsRunInput,
  previousStates: Partial<Record<IssueType, AnalyticsPersistenceState | null>>,
): {
  contribution: AnalyticsRunContribution;
  nextStates: Record<IssueType, AnalyticsPersistenceState>;
} {
  const observations = new Map(input.observations.map((observation) => [observation.issueType, observation]));
  const issueTypes: IssueType[] = ["floor_litter", "floor_spill", "bin_overflow"];
  const nextStates = {} as Record<IssueType, AnalyticsPersistenceState>;
  const persistenceByType: Record<IssueType, number> = {
    floor_litter: 0,
    floor_spill: 0,
    bin_overflow: 0,
  };
  const outOfOrder: IssueType[] = [];

  for (const issueType of issueTypes) {
    const observation = observations.get(issueType);
    const persistence = applyPersistenceObservation(previousStates[issueType] ?? null, {
      analysisRunId: input.id,
      capturedAtMs: input.capturedAtMs,
      positive: Boolean(observation?.positive),
      issueType,
    });
    nextStates[issueType] = persistence.next;
    persistenceByType[issueType] = persistence.persistenceSeconds;
    if (persistence.outOfOrder) outOfOrder.push(issueType);
  }

  const litter = observations.get("floor_litter");
  const overflow = observations.get("bin_overflow");
  const spill = observations.get("floor_spill");
  const uniqueModelVersions = [...new Set(input.modelVersions.filter(Boolean))].sort();
  return {
    contribution: {
      successfulSampleCount: 1,
      peopleCountSum: Math.max(0, Math.trunc(input.peopleCount)),
      peopleCountMax: Math.max(0, Math.trunc(input.peopleCount)),
      peoplePresentSamples: input.peopleCount > 0 ? 1 : 0,
      litterPositiveSamples: litter?.positive ? 1 : 0,
      litterDetectionCount: litter?.positive ? Math.max(0, Math.trunc(litter.eligibleDetectionCount)) : 0,
      overflowPositiveSamples: overflow?.positive ? 1 : 0,
      overflowDetectionCount: overflow?.positive ? Math.max(0, Math.trunc(overflow.eligibleDetectionCount)) : 0,
      spillPositiveSamples: spill?.positive ? 1 : 0,
      spillDetectionCount: spill?.positive ? Math.max(0, Math.trunc(spill.eligibleDetectionCount)) : 0,
      issuePersistenceSeconds: Object.values(persistenceByType).reduce((sum, seconds) => sum + seconds, 0),
      issuePersistenceSecondsByType: persistenceByType,
      modelVersions: uniqueModelVersions,
      persistenceOutOfOrderIssueTypes: outOfOrder,
    },
    nextStates,
  };
}

