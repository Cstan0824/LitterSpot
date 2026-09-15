import { apiRequest } from "./http";

export type BinPlacementFactor = {
  raw: number;
  normalized: number;
  contribution: number;
};

export type BinPlacementCoverage = {
  requestedDays: number;
  availableDays: number;
  partial: boolean;
};

export type BinPlacementZoneRanking = {
  zoneId: string;
  zoneNameSnapshot: string;
  rank: number | null;
  totalScore: number | null;
  people: number;
  cleaning: number;
  bin: number;
  availableDays: number;
  peopleActivity: BinPlacementFactor;
  cleaningFrequency: BinPlacementFactor;
  binServiceFrequency: BinPlacementFactor;
  coverage: BinPlacementCoverage;
  status: "ready" | "partial_data" | "insufficient_data";
  reasonSummary: string;
};

export type BinPlacementSnapshot = {
  schemaVersion: 2;
  siteId: string;
  mapRevisionId: string | null;
  timeZoneSnapshot: string;
  requestedLookbackDays: number;
  requestedStart: string;
  requestedEnd: string;
  availableDays: number;
  availableStart: string | null;
  availableEnd: string | null;
  calculatedAt: string;
  policyVersion: string;
  status: "ready" | "partial_data" | "insufficient_data";
  zoneRankings: BinPlacementZoneRanking[];
  nextScheduledRefreshAt: string;
};

export type BinPlacementIntervention = {
  id: string;
  interventionId: string;
  siteId: string;
  zoneId: string;
  zoneNameSnapshot: string;
  mapRevisionId: string | null;
  timeZoneSnapshot: string;
  implementedAt: string;
  implementedByUid: string;
  sourceSnapshotCalculatedAt: string;
  rankingSnapshot: BinPlacementZoneRanking;
  requestedLookbackDaysSnapshot: number;
  availableCoverageSnapshot: BinPlacementCoverage;
  exclusionEndsAt: string;
  note: string | null;
};

export type BinPlacementComparisonRow = {
  localDate: string;
  periodStart: string;
  periodEnd: string;
  cleaningFrequency: number;
  binOverflowFrequency: number;
  coverageDays: number;
  monitoringPartial: boolean;
  partialDay: boolean;
};

export type BinPlacementComparisonSide = {
  requestedStart: string;
  requestedEnd: string;
  availableDays: number;
  partialDays: number;
  partial: boolean;
  missingDates: string[];
  summaries: BinPlacementComparisonRow[];
  series: BinPlacementComparisonRow[];
};

export type BinPlacementComparison = {
  interventionId: string;
  zoneId: string;
  requestedDays: number;
  timeZone: string;
  implementedAt: string;
  before: BinPlacementComparisonSide;
  after: BinPlacementComparisonSide;
  boundaryPolicy: string;
};

export const getBinPlacementRecommendations = (days?: number, signal?: AbortSignal) =>
  apiRequest<{ snapshot: BinPlacementSnapshot }>(`/api/bin-placement/recommendations${days === undefined ? "" : `?days=${encodeURIComponent(days)}`}`, { signal });

export const refreshBinPlacementRecommendations = (days: number) =>
  apiRequest<{ snapshot: BinPlacementSnapshot }>("/api/bin-placement/recommendations/refresh", { method: "POST", json: { days } });

export const implementBinPlacement = (zoneId: string, snapshotCalculatedAt: string, note?: string) =>
  apiRequest<{ intervention: BinPlacementIntervention }>(`/api/bin-placement/zones/${encodeURIComponent(zoneId)}/implement`, {
    method: "POST",
    json: { snapshotCalculatedAt, ...(note?.trim() ? { note: note.trim() } : {}) },
  });

export const getBinPlacementInterventions = (signal?: AbortSignal) =>
  apiRequest<{ interventions: BinPlacementIntervention[] }>("/api/bin-placement/interventions", { signal });

export const getBinPlacementComparison = (interventionId: string, days: number, signal?: AbortSignal) =>
  apiRequest<{ comparison: BinPlacementComparison }>(`/api/bin-placement/interventions/${encodeURIComponent(interventionId)}/comparison?days=${encodeURIComponent(days)}`, { signal });
