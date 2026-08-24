import { createHash } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import {
  binReplacementRecommendationSchema,
  type BinReplacementRecommendation,
} from "../schemas/binReplacement.js";
import {
  type BinReplacementObservation,
  type PreviousBinReplacementDecision,
} from "./binReplacementPolicy.js";

const OBSERVATION_LIMIT = 5_000;
const MISSING_INDEX_CODE = 9;

export type BinReplacementObservationQuery = {
  zoneId: string;
  start: Date;
  end: Date;
  includeTestData?: boolean;
};

export interface BinReplacementRepository {
  loadRecentZoneObservations(query: BinReplacementObservationQuery): Promise<BinReplacementObservation[]>;
  loadPreviousRecommendation(zoneId: string): Promise<PreviousBinReplacementDecision | null>;
  loadCurrentRecommendation(zoneId: string): Promise<BinReplacementRecommendation | null>;
  saveRecommendation(zoneId: string, recommendation: BinReplacementRecommendation): Promise<void>;
}

function isMissingIndexError(error: unknown) {
  return Boolean(error && typeof error === "object" && Number((error as { code?: unknown }).code) === MISSING_INDEX_CODE);
}

function timestampDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const result = new Date(value);
    return Number.isFinite(result.getTime()) ? result : null;
  }
  return null;
}

function numberValue(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function normalizedBox(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const values = [item.x1, item.y1, item.x2, item.y2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return { x1: values[0], y1: values[1], x2: values[2], y2: values[3] };
}

function state(value: unknown): "normal" | "full" | "overflow" | "unknown" {
  return value === "normal" || value === "full" || value === "overflow" || value === "unknown" ? value : "unknown";
}

function binObservation(value: unknown): BinReplacementObservation["bins"][number] | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    state: state(item.state),
    stableState: item.stableState === null || item.stableState === undefined ? null : state(item.stableState),
    confirmed: typeof item.confirmed === "boolean" ? item.confirmed : null,
    stale: Boolean(item.stale),
  };
}

function observationFromRun(
  snapshot: { id: string; data(): DocumentData | undefined },
  includeTestData: boolean,
): BinReplacementObservation | null {
  const data = snapshot.data() ?? {};
  if (!includeTestData && Boolean(data.isTest)) return null;
  if (data.analyticsEligible === false) return null;
  if (data.alertEvaluationStatus && data.alertEvaluationStatus !== "completed") return null;
  const capturedAt = timestampDate(data.capturedAt) ?? timestampDate(data.createdAt);
  if (!capturedAt) return null;
  const bins = Array.isArray(data.bins)
    ? data.bins.map(binObservation).filter((value): value is NonNullable<ReturnType<typeof binObservation>> => Boolean(value))
    : [];
  const issueCounts = data.issueCounts && typeof data.issueCounts === "object" ? data.issueCounts as Record<string, unknown> : {};
  const floorHazards: BinReplacementObservation["floorHazards"] = [];
  // The normalized analysis run stores counts, while the raw detection
  // geometry remains in Firestore detections. Counts are kept as geometry-free
  // hazard events; the policy deduplicates them at the short minute scale.
  for (let index = 0; index < Math.min(100, Math.floor(numberValue(issueCounts.floorLitter))); index += 1) {
    floorHazards.push({ className: "floor_litter", bboxNormalized: null });
  }
  for (let index = 0; index < Math.min(100, Math.floor(numberValue(issueCounts.floorSpill))); index += 1) {
    floorHazards.push({ className: "floor_spill", bboxNormalized: null });
  }
  return {
    createdAt: capturedAt.toISOString(),
    peopleCount: Math.floor(numberValue(data.peopleCount)),
    isTest: Boolean(data.isTest),
    bins,
    floorHazards,
  };
}

function recommendationState(value: DocumentData | undefined): PreviousBinReplacementDecision | null {
  if (!value) return null;
  return {
    recommended: Boolean(value.recommended),
    triggerReason: typeof value.triggerReason === "string" ? value.triggerReason : null,
    raiseStreak: Math.max(0, Math.floor(numberValue(value.raiseStreak))),
    clearStreak: Math.max(0, Math.floor(numberValue(value.clearStreak))),
  };
}

function recommendationFromDocument(value: DocumentData | undefined): BinReplacementRecommendation | null {
  if (!value) return null;
  const evaluatedAt = timestampDate(value.evaluatedAt);
  const windowStart = timestampDate(value.windowStart);
  const windowEnd = timestampDate(value.windowEnd);
  if (!evaluatedAt || !windowStart || !windowEnd) return null;
  const parsed = binReplacementRecommendationSchema.safeParse({
    zoneId: value.zoneId,
    evaluatedAt: evaluatedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    decision: value.decision,
    recommended: value.recommended,
    provisional: value.provisional,
    policyVersion: value.policyVersion,
    windowMinutes: value.windowMinutes,
    sampleIntervalSeconds: value.sampleIntervalSeconds,
    coverage: value.coverage,
    fullMinutes: value.fullMinutes,
    litterEpisodes: value.litterEpisodes,
    spillEpisodes: value.spillEpisodes,
    score: value.score,
    scoreThreshold: value.scoreThreshold,
    signals: value.signals,
    highSignals: value.highSignals,
    triggerReason: value.triggerReason ?? null,
    raiseStreak: value.raiseStreak,
    clearStreak: value.clearStreak,
  });
  return parsed.success ? parsed.data : null;
}

export class FirestoreBinReplacementRepository implements BinReplacementRepository {
  public constructor(private readonly db: Firestore = firestore) {}

  private analysisQuery(input: BinReplacementObservationQuery): Query<DocumentData> {
    return this.db.collection("analysisRuns")
      .where("zoneId", "==", input.zoneId)
      .where("capturedAt", ">=", Timestamp.fromDate(input.start))
      .where("capturedAt", "<", Timestamp.fromDate(input.end))
      .limit(OBSERVATION_LIMIT);
  }

  private async runAnalysisQuery(input: BinReplacementObservationQuery) {
    try {
      return await this.analysisQuery(input).get();
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      // A bounded zone scan keeps the prototype useful before the compound
      // index is deployed. It is deliberately capped and visible in logs.
      console.warn(JSON.stringify({ event: "bin_replacement_index_fallback", zoneId: input.zoneId, limit: OBSERVATION_LIMIT }));
      return this.db.collection("analysisRuns").where("zoneId", "==", input.zoneId).limit(OBSERVATION_LIMIT).get();
    }
  }

  public async loadRecentZoneObservations(input: BinReplacementObservationQuery) {
    const snapshots = await this.runAnalysisQuery(input);
    return snapshots.docs
      .map((snapshot) => observationFromRun(snapshot, Boolean(input.includeTestData)))
      .filter((observation): observation is BinReplacementObservation => {
        if (!observation) return false;
        const timestamp = new Date(observation.createdAt).getTime();
        return timestamp >= input.start.getTime() && timestamp < input.end.getTime();
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async loadPreviousRecommendation(zoneId: string) {
    const snapshot = await this.db.collection("binReplacementRecommendations").doc(zoneId).get();
    return snapshot.exists ? recommendationState(snapshot.data()) : null;
  }

  public async loadCurrentRecommendation(zoneId: string) {
    const snapshot = await this.db.collection("binReplacementRecommendations").doc(zoneId).get();
    return snapshot.exists ? recommendationFromDocument(snapshot.data()) : null;
  }

  public async saveRecommendation(zoneId: string, recommendation: BinReplacementRecommendation) {
    const reference = this.db.collection("binReplacementRecommendations").doc(zoneId);
    const evaluationId = createHash("sha256")
      .update(zoneId).update("\0")
      .update(recommendation.evaluatedAt).update("\0")
      .update(recommendation.policyVersion)
      .digest("hex");
    const evaluationReference = reference.collection("evaluations").doc(evaluationId);
    const data = {
      ...recommendation,
      evaluatedAt: Timestamp.fromDate(new Date(recommendation.evaluatedAt)),
      windowStart: Timestamp.fromDate(new Date(recommendation.windowStart)),
      windowEnd: Timestamp.fromDate(new Date(recommendation.windowEnd)),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await this.db.runTransaction(async (transaction) => {
      transaction.set(reference, data, { merge: true });
      transaction.set(evaluationReference, { ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
}

/**
 * A deterministic adapter for policy tests and local mock replay. It has the
 * same public seam as Firestore but intentionally has no production wiring.
 */
export class InMemoryBinReplacementRepository implements BinReplacementRepository {
  private readonly recommendations = new Map<string, PreviousBinReplacementDecision>();
  private readonly observations = new Map<string, BinReplacementObservation[]>();
  private readonly saved = new Map<string, BinReplacementRecommendation>();

  public constructor(seed: Record<string, BinReplacementObservation[]> = {}) {
    for (const [zoneId, rows] of Object.entries(seed)) this.observations.set(zoneId, rows);
  }

  public async loadRecentZoneObservations(input: BinReplacementObservationQuery) {
    return (this.observations.get(input.zoneId) ?? []).filter((row) => {
      if (!input.includeTestData && row.isTest) return false;
      const timestamp = new Date(row.createdAt).getTime();
      return timestamp >= input.start.getTime() && timestamp < input.end.getTime();
    });
  }

  public async loadPreviousRecommendation(zoneId: string) {
    return this.recommendations.get(zoneId) ?? null;
  }

  public async loadCurrentRecommendation(zoneId: string) {
    return this.saved.get(zoneId) ?? null;
  }

  public async saveRecommendation(zoneId: string, recommendation: BinReplacementRecommendation) {
    this.recommendations.set(zoneId, {
      recommended: recommendation.recommended,
      triggerReason: recommendation.triggerReason,
      raiseStreak: recommendation.raiseStreak,
      clearStreak: recommendation.clearStreak,
    });
    this.saved.set(zoneId, recommendation);
  }

  public setObservations(zoneId: string, rows: BinReplacementObservation[]) {
    this.observations.set(zoneId, rows);
  }

  public getSavedRecommendation(zoneId: string) {
    return this.saved.get(zoneId) ?? null;
  }
}
