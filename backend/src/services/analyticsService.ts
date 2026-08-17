import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { GenerateAnalyticsReportInput, ListAnalyticsReportsInput } from "../schemas/analyticsApi.js";
import type { HourlyZoneAnalyticsBucket } from "../schemas/priorityZoneAnalytics.js";
import { HttpError } from "../shared/httpError.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import {
  ANALYTICS_AGGREGATION_VERSION,
  ANALYTICS_PERSISTENCE_METHOD,
  deriveRunAnalyticsContribution,
  hourlyBucketBounds,
  type AnalyticsObservationInput,
  type AnalyticsPersistenceState,
  type AnalyticsRunContribution,
} from "./analyticsAggregation.js";
import { type IssueType } from "./alertPolicy.js";
import { buildPriorityZoneReport, DEFAULT_PRIORITY_ZONE_POLICY } from "./priorityZoneAnalytics.js";
import { recordOperationalFailure, recoverOperationalEvent } from "./dependencyEventMonitor.js";

const ISSUE_TYPES: IssueType[] = ["floor_litter", "floor_spill", "bin_overflow"];
const ISSUE_TYPE_SET = new Set<IssueType>(ISSUE_TYPES);
const REBUILD_RUN_LIMIT = 5_000;
const REBUILD_OBSERVATION_LIMIT = REBUILD_RUN_LIMIT * ISSUE_TYPES.length + 1;
const REBUILD_ALERT_LIMIT = 5_000;
const REPORT_BUCKET_LIMIT = 100_000;
const FALLBACK_SCAN_LIMIT = 10_000;
const REBUILD_LEASE_MS = 30 * 60 * 1_000;

type ApplicationStatus = "applied" | "already_applied" | "excluded";

type MutableBucket = {
  id: string;
  siteId: string;
  zoneId: string;
  generationId: string;
  bucketStartMs: number;
  bucketEndMs: number;
  successfulSampleCount: number;
  failedSampleCount: number;
  cameraIds: Set<string>;
  peopleCountSum: number;
  peopleCountMax: number;
  peoplePresentSamples: number;
  litterPositiveSamples: number;
  litterDetectionCount: number;
  litterIncidentCount: number;
  overflowPositiveSamples: number;
  overflowDetectionCount: number;
  overflowIncidentCount: number;
  spillPositiveSamples: number;
  spillDetectionCount: number;
  spillIncidentCount: number;
  issuePersistenceSeconds: number;
  issuePersistenceSecondsByType: Record<IssueType, number>;
  modelVersionSampleCounts: Map<string, number>;
};

function hashId(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function analyticsSiteStateId(siteId: string) {
  return hashId("analytics-site-v1", siteId);
}

function initialGenerationId(siteId: string) {
  return `initial-${hashId("analytics-generation-v1", siteId).slice(0, 24)}`;
}

function bucketId(generationId: string, siteId: string, zoneId: string, bucketStartMs: number) {
  return hashId("analytics-bucket-v1", generationId, siteId, zoneId, new Date(bucketStartMs).toISOString());
}

function stateId(generationId: string, siteId: string, zoneId: string, cameraId: string, issueType: IssueType) {
  return hashId("analytics-persistence-state-v1", generationId, siteId, zoneId, cameraId, issueType);
}

function sampleMarkerId(generationId: string, analysisRunId: string) {
  return hashId("analytics-sample-application-v1", generationId, analysisRunId);
}

function incidentMarkerId(generationId: string, alertId: string, firstObservationId: string) {
  return hashId("analytics-incident-application-v1", generationId, alertId, firstObservationId);
}

function isMissingIndexError(error: unknown) {
  return Boolean(error && typeof error === "object" && Number((error as { code?: unknown }).code) === 9);
}

function timestampMs(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : Number.NaN;
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function serialize(snapshot: DocumentSnapshot, label: string): Record<string, unknown> & { id: string } {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return { id: snapshot.id, ...jsonValue(snapshot.data()) as Record<string, unknown> };
}

function requiredString(data: DocumentData, key: string, label: string) {
  const value = data[key];
  if (typeof value !== "string" || !value) throw new HttpError(422, `${label} is missing ${key}.`);
  return value;
}

function modelVersions(data: DocumentData) {
  if (!data.modelVersions || typeof data.modelVersions !== "object") return [];
  return [...new Set(Object.values(data.modelVersions)
    .filter((value): value is string => typeof value === "string" && value.length > 0))].sort();
}

function observationInput(snapshot: QueryDocumentSnapshot | DocumentSnapshot): AnalyticsObservationInput | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  if (!ISSUE_TYPE_SET.has(data.issueType)) return null;
  return {
    issueType: data.issueType as IssueType,
    positive: Boolean(data.positive) && !Boolean(data.excluded),
    eligibleDetectionCount: Array.isArray(data.eligibleDetectionIds) ? data.eligibleDetectionIds.length : 0,
  };
}

function persistenceState(snapshot: DocumentSnapshot): AnalyticsPersistenceState | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  const capturedAtMs = timestampMs(data.lastCapturedAt);
  if (!Number.isFinite(capturedAtMs) || typeof data.lastAnalysisRunId !== "string") return null;
  return {
    lastAnalysisRunId: data.lastAnalysisRunId,
    lastCapturedAtMs: capturedAtMs,
    lastPositive: Boolean(data.lastPositive),
  };
}

function modelCountMap(value: unknown) {
  const result = new Map<string, number>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const version = (item as { version?: unknown }).version;
    const count = Number((item as { sampleCount?: unknown }).sampleCount);
    if (typeof version === "string" && version && Number.isFinite(count) && count >= 0) result.set(version, count);
  }
  return result;
}

function emptyMutableBucket(siteId: string, zoneId: string, generationId: string, bucketStartMs: number): MutableBucket {
  return {
    id: bucketId(generationId, siteId, zoneId, bucketStartMs),
    siteId,
    zoneId,
    generationId,
    bucketStartMs,
    bucketEndMs: bucketStartMs + 3_600_000,
    successfulSampleCount: 0,
    failedSampleCount: 0,
    cameraIds: new Set(),
    peopleCountSum: 0,
    peopleCountMax: 0,
    peoplePresentSamples: 0,
    litterPositiveSamples: 0,
    litterDetectionCount: 0,
    litterIncidentCount: 0,
    overflowPositiveSamples: 0,
    overflowDetectionCount: 0,
    overflowIncidentCount: 0,
    spillPositiveSamples: 0,
    spillDetectionCount: 0,
    spillIncidentCount: 0,
    issuePersistenceSeconds: 0,
    issuePersistenceSecondsByType: { floor_litter: 0, floor_spill: 0, bin_overflow: 0 },
    modelVersionSampleCounts: new Map(),
  };
}

function mutableBucketFromSnapshot(
  snapshot: DocumentSnapshot,
  siteId: string,
  zoneId: string,
  generationId: string,
  bucketStartMs: number,
) {
  const result = emptyMutableBucket(siteId, zoneId, generationId, bucketStartMs);
  if (!snapshot.exists) return result;
  const data = snapshot.data()!;
  result.successfulSampleCount = Number(data.successfulSampleCount ?? 0);
  result.failedSampleCount = Number(data.failedSampleCount ?? 0);
  result.cameraIds = new Set(Array.isArray(data.cameraIds) ? data.cameraIds.filter((id): id is string => typeof id === "string") : []);
  result.peopleCountSum = Number(data.peopleCountSum ?? 0);
  result.peopleCountMax = Number(data.peopleCountMax ?? 0);
  result.peoplePresentSamples = Number(data.peoplePresentSamples ?? 0);
  result.litterPositiveSamples = Number(data.litterPositiveSamples ?? 0);
  result.litterDetectionCount = Number(data.litterDetectionCount ?? 0);
  result.litterIncidentCount = Number(data.litterIncidentCount ?? 0);
  result.overflowPositiveSamples = Number(data.overflowPositiveSamples ?? 0);
  result.overflowDetectionCount = Number(data.overflowDetectionCount ?? 0);
  result.overflowIncidentCount = Number(data.overflowIncidentCount ?? 0);
  result.spillPositiveSamples = Number(data.spillPositiveSamples ?? 0);
  result.spillDetectionCount = Number(data.spillDetectionCount ?? 0);
  result.spillIncidentCount = Number(data.spillIncidentCount ?? 0);
  result.issuePersistenceSeconds = Number(data.issuePersistenceSeconds ?? 0);
  result.issuePersistenceSecondsByType = {
    floor_litter: Number(data.issuePersistenceSecondsByType?.floor_litter ?? 0),
    floor_spill: Number(data.issuePersistenceSecondsByType?.floor_spill ?? 0),
    bin_overflow: Number(data.issuePersistenceSecondsByType?.bin_overflow ?? 0),
  };
  result.modelVersionSampleCounts = modelCountMap(data.modelVersionSampleCounts);
  return result;
}

function mergeRunContribution(bucket: MutableBucket, cameraId: string, contribution: AnalyticsRunContribution) {
  bucket.successfulSampleCount += contribution.successfulSampleCount;
  bucket.cameraIds.add(cameraId);
  bucket.peopleCountSum += contribution.peopleCountSum;
  bucket.peopleCountMax = Math.max(bucket.peopleCountMax, contribution.peopleCountMax);
  bucket.peoplePresentSamples += contribution.peoplePresentSamples;
  bucket.litterPositiveSamples += contribution.litterPositiveSamples;
  bucket.litterDetectionCount += contribution.litterDetectionCount;
  bucket.overflowPositiveSamples += contribution.overflowPositiveSamples;
  bucket.overflowDetectionCount += contribution.overflowDetectionCount;
  bucket.spillPositiveSamples += contribution.spillPositiveSamples;
  bucket.spillDetectionCount += contribution.spillDetectionCount;
  bucket.issuePersistenceSeconds += contribution.issuePersistenceSeconds;
  for (const issueType of ISSUE_TYPES) {
    bucket.issuePersistenceSecondsByType[issueType] += contribution.issuePersistenceSecondsByType[issueType];
  }
  for (const version of contribution.modelVersions) {
    bucket.modelVersionSampleCounts.set(version, (bucket.modelVersionSampleCounts.get(version) ?? 0) + 1);
  }
}

function storedBucket(bucket: MutableBucket) {
  return {
    aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
    granularity: "hour",
    generationId: bucket.generationId,
    bucketStart: Timestamp.fromMillis(bucket.bucketStartMs),
    bucketEnd: Timestamp.fromMillis(bucket.bucketEndMs),
    siteId: bucket.siteId,
    zoneId: bucket.zoneId,
    analyticsEligible: true,
    isTest: false,
    sampleCount: bucket.successfulSampleCount + bucket.failedSampleCount,
    successfulSampleCount: bucket.successfulSampleCount,
    failedSampleCount: bucket.failedSampleCount,
    cameraIds: [...bucket.cameraIds].sort(),
    peopleCountSum: bucket.peopleCountSum,
    peopleCountMax: bucket.peopleCountMax,
    peoplePresentSamples: bucket.peoplePresentSamples,
    litterPositiveSamples: bucket.litterPositiveSamples,
    litterDetectionCount: bucket.litterDetectionCount,
    litterIncidentCount: bucket.litterIncidentCount,
    overflowPositiveSamples: bucket.overflowPositiveSamples,
    overflowDetectionCount: bucket.overflowDetectionCount,
    overflowIncidentCount: bucket.overflowIncidentCount,
    spillPositiveSamples: bucket.spillPositiveSamples,
    spillDetectionCount: bucket.spillDetectionCount,
    optionalSpillIncidentCount: bucket.spillIncidentCount,
    issuePersistenceSeconds: bucket.issuePersistenceSeconds,
    issuePersistenceSecondsByType: bucket.issuePersistenceSecondsByType,
    persistenceMethod: ANALYTICS_PERSISTENCE_METHOD,
    modelVersions: [...bucket.modelVersionSampleCounts.keys()].sort(),
    modelVersionSampleCounts: [...bucket.modelVersionSampleCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([version, sampleCount]) => ({ version, sampleCount })),
    updatedAt: Timestamp.now(),
  };
}

function analyticsReferences(siteId: string) {
  const id = analyticsSiteStateId(siteId);
  return {
    siteState: firestore.collection("analyticsSites").doc(id),
    lock: firestore.collection("analyticsReconciliationLocks").doc(id),
  };
}

async function generationCandidate(siteId: string) {
  const state = await analyticsReferences(siteId).siteState.get();
  return typeof state.data()?.currentGenerationId === "string"
    ? String(state.data()!.currentGenerationId)
    : initialGenerationId(siteId);
}

function assertUnlocked(lockSnapshot: DocumentSnapshot) {
  if (!lockSnapshot.exists) return;
  const expiresAt = timestampMs(lockSnapshot.data()?.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
    throw new HttpError(409, "Analytics reconciliation is running for this site; retry after it completes.");
  }
}

export async function applyAnalysisRunAnalytics(analysisRunId: string): Promise<{
  status: ApplicationStatus;
  generationId: string;
  bucketId: string | null;
  persistenceOutOfOrderIssueTypes: IssueType[];
}> {
  const runReference = firestore.collection("analysisRuns").doc(analysisRunId);
  const outsideRun = await runReference.get();
  if (!outsideRun.exists) throw new HttpError(404, "Analysis run not found.");
  const outsideSiteId = requiredString(outsideRun.data()!, "siteId", "Analysis run");
  const candidate = await generationCandidate(outsideSiteId);
  const references = analyticsReferences(outsideSiteId);
  const initialResponse = {
    status: "applied" as ApplicationStatus,
    generationId: candidate,
    bucketId: null as string | null,
    persistenceOutOfOrderIssueTypes: [] as IssueType[],
  };

  return firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, lockSnapshot, runSnapshot, observationsSnapshot] = await Promise.all([
      transaction.get(references.siteState),
      transaction.get(references.lock),
      transaction.get(runReference),
      transaction.get(firestore.collection("issueObservations").where("analysisRunId", "==", analysisRunId)),
    ]);
    if (!runSnapshot.exists) throw new HttpError(404, "Analysis run not found.");
    assertUnlocked(lockSnapshot);
    const run = runSnapshot.data()!;
    const siteId = requiredString(run, "siteId", "Analysis run");
    if (siteId !== outsideSiteId) throw new HttpError(409, "Analysis run site changed while analytics were being applied.");
    const activeGeneration = typeof stateSnapshot.data()?.currentGenerationId === "string"
      ? String(stateSnapshot.data()!.currentGenerationId)
      : initialGenerationId(siteId);
    if (activeGeneration !== candidate) throw new HttpError(409, "Analytics generation changed; retry this application.");

    const markerReference = firestore.collection("analyticsSampleApplications")
      .doc(sampleMarkerId(activeGeneration, analysisRunId));
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists) {
      return {
        status: markerSnapshot.data()?.status === "excluded" ? "excluded" : "already_applied",
        generationId: activeGeneration,
        bucketId: typeof markerSnapshot.data()?.bucketId === "string" ? markerSnapshot.data()!.bucketId : null,
        persistenceOutOfOrderIssueTypes: [],
      };
    }

    const eligible = Boolean(run.analyticsEligible) && !Boolean(run.isTest);
    if (!eligible) {
      transaction.create(markerReference, {
        aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        generationId: activeGeneration,
        analysisRunId,
        siteId,
        zoneId: run.zoneId ?? null,
        cameraId: run.cameraId ?? null,
        status: "excluded",
        exclusionReason: run.isTest ? "test_data" : "not_analytics_eligible",
        appliedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(runReference, {
        analyticsAppliedAt: FieldValue.serverTimestamp(),
        analyticsApplicationStatus: "excluded",
        analyticsGenerationId: activeGeneration,
      });
      if (!stateSnapshot.exists) {
        transaction.create(references.siteState, {
          siteId, currentGenerationId: activeGeneration, aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { ...initialResponse, status: "excluded" as const, generationId: activeGeneration };
    }
    if (run.alertWorkflowVersion !== ALERT_WORKFLOW_VERSION || run.alertEvaluationStatus !== "completed") {
      throw new HttpError(409, "Alert evaluation must complete before an operational run enters analytics.");
    }

    const observations = observationsSnapshot.docs.map(observationInput)
      .filter((value): value is AnalyticsObservationInput => Boolean(value));
    if (ISSUE_TYPES.some((issueType) => !observations.some((observation) => observation.issueType === issueType))) {
      throw new HttpError(409, "The analysis run is missing one or more grouped issue observations.");
    }
    const zoneId = requiredString(run, "zoneId", "Analysis run");
    const cameraId = requiredString(run, "cameraId", "Analysis run");
    const capturedAtMs = timestampMs(run.capturedAt);
    if (!Number.isFinite(capturedAtMs)) throw new HttpError(422, "Analysis run is missing capturedAt.");
    const bounds = hourlyBucketBounds(capturedAtMs);
    const targetBucketId = bucketId(activeGeneration, siteId, zoneId, bounds.bucketStartMs);
    const bucketReference = firestore.collection("analyticsBuckets").doc(targetBucketId);
    const persistenceReferences = ISSUE_TYPES.map((issueType) => firestore.collection("analyticsPersistenceStates")
      .doc(stateId(activeGeneration, siteId, zoneId, cameraId, issueType)));
    const [bucketSnapshot, ...persistenceSnapshots] = await Promise.all([
      transaction.get(bucketReference),
      ...persistenceReferences.map((reference) => transaction.get(reference)),
    ]);
    const previousStates = Object.fromEntries(ISSUE_TYPES.map((issueType, index) => [
      issueType, persistenceState(persistenceSnapshots[index]),
    ])) as Partial<Record<IssueType, AnalyticsPersistenceState | null>>;
    const derived = deriveRunAnalyticsContribution({
      id: analysisRunId,
      siteId,
      zoneId,
      cameraId,
      capturedAtMs,
      peopleCount: Number(run.peopleCount ?? 0),
      modelVersions: modelVersions(run),
      observations,
    }, previousStates);
    const bucket = mutableBucketFromSnapshot(bucketSnapshot, siteId, zoneId, activeGeneration, bounds.bucketStartMs);
    mergeRunContribution(bucket, cameraId, derived.contribution);

    if (!stateSnapshot.exists) {
      transaction.create(references.siteState, {
        siteId, currentGenerationId: activeGeneration, aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.set(bucketReference, {
      ...storedBucket(bucket),
      ...(bucketSnapshot.exists ? { createdAt: bucketSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() } : { createdAt: FieldValue.serverTimestamp() }),
    });
    for (const [index, issueType] of ISSUE_TYPES.entries()) {
      if (derived.contribution.persistenceOutOfOrderIssueTypes.includes(issueType)) continue;
      const next = derived.nextStates[issueType];
      transaction.set(persistenceReferences[index], {
        aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        persistenceMethod: ANALYTICS_PERSISTENCE_METHOD,
        generationId: activeGeneration,
        siteId,
        zoneId,
        cameraId,
        issueType,
        lastAnalysisRunId: next.lastAnalysisRunId,
        lastCapturedAt: Timestamp.fromMillis(next.lastCapturedAtMs),
        lastPositive: next.lastPositive,
        updatedAt: FieldValue.serverTimestamp(),
        ...(persistenceSnapshots[index].exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
    }
    transaction.create(markerReference, {
      aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
      generationId: activeGeneration,
      analysisRunId,
      siteId,
      zoneId,
      cameraId,
      bucketId: targetBucketId,
      status: "applied",
      persistenceOutOfOrderIssueTypes: derived.contribution.persistenceOutOfOrderIssueTypes,
      appliedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(runReference, {
      analyticsAppliedAt: FieldValue.serverTimestamp(),
      analyticsApplicationStatus: "applied",
      analyticsGenerationId: activeGeneration,
      analyticsBucketId: targetBucketId,
      analyticsPersistenceOutOfOrderIssueTypes: derived.contribution.persistenceOutOfOrderIssueTypes,
    });
    return {
      status: "applied",
      generationId: activeGeneration,
      bucketId: targetBucketId,
      persistenceOutOfOrderIssueTypes: derived.contribution.persistenceOutOfOrderIssueTypes,
    };
  });
}

export async function applyAlertIncidentAnalytics(alertId: string): Promise<{
  status: ApplicationStatus;
  generationId: string;
  bucketId: string | null;
}> {
  const alertReference = firestore.collection("alerts").doc(alertId);
  const preAlert = await alertReference.get();
  if (!preAlert.exists) throw new HttpError(404, "Alert not found.");
  const firstObservationId = requiredString(preAlert.data()!, "firstObservationId", "Alert");
  const preObservation = await firestore.collection("issueObservations").doc(firstObservationId).get();
  if (!preObservation.exists) throw new HttpError(422, "Alert first observation was not found.");
  const analysisRunId = requiredString(preObservation.data()!, "analysisRunId", "Issue observation");
  await applyAnalysisRunAnalytics(analysisRunId);

  const siteId = requiredString(preAlert.data()!, "siteId", "Alert");
  const candidate = await generationCandidate(siteId);
  const references = analyticsReferences(siteId);
  const initialResponse = { status: "applied" as ApplicationStatus, generationId: candidate, bucketId: null as string | null };
  return firestore.runTransaction(async (transaction) => {
    const [stateSnapshot, lockSnapshot, alertSnapshot, observationSnapshot, runSnapshot] = await Promise.all([
      transaction.get(references.siteState),
      transaction.get(references.lock),
      transaction.get(alertReference),
      transaction.get(firestore.collection("issueObservations").doc(firstObservationId)),
      transaction.get(firestore.collection("analysisRuns").doc(analysisRunId)),
    ]);
    if (!alertSnapshot.exists) throw new HttpError(404, "Alert not found.");
    if (!observationSnapshot.exists || !runSnapshot.exists) throw new HttpError(422, "Alert analytics evidence is incomplete.");
    assertUnlocked(lockSnapshot);
    const activeGeneration = typeof stateSnapshot.data()?.currentGenerationId === "string"
      ? String(stateSnapshot.data()!.currentGenerationId)
      : initialGenerationId(siteId);
    if (activeGeneration !== candidate) throw new HttpError(409, "Analytics generation changed; retry this application.");
    const markerReference = firestore.collection("analyticsIncidentApplications")
      .doc(incidentMarkerId(activeGeneration, alertId, firstObservationId));
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists) {
      return {
        status: markerSnapshot.data()?.status === "excluded" ? "excluded" : "already_applied",
        generationId: activeGeneration,
        bucketId: typeof markerSnapshot.data()?.bucketId === "string" ? markerSnapshot.data()!.bucketId : null,
      };
    }
    const observation = observationSnapshot.data()!;
    const run = runSnapshot.data()!;
    const eligible = Boolean(run.analyticsEligible)
      && !Boolean(run.isTest)
      && !Boolean(observation.excluded)
      && Boolean(observation.positive)
      && alertSnapshot.data()?.issueType === observation.issueType;
    const issueType = observation.issueType;
    if (!eligible || !ISSUE_TYPE_SET.has(issueType)) {
      transaction.create(markerReference, {
        aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        generationId: activeGeneration,
        alertId,
        firstObservationId,
        analysisRunId,
        siteId,
        zoneId: observation.zoneId ?? null,
        issueType: issueType ?? null,
        status: "excluded",
        exclusionReason: !eligible ? "test_or_ineligible" : "unsupported_issue_type",
        appliedAt: FieldValue.serverTimestamp(),
      });
      return { ...initialResponse, status: "excluded" as const, generationId: activeGeneration };
    }
    const zoneId = requiredString(observation, "zoneId", "Issue observation");
    const capturedAtMs = timestampMs(observation.capturedAt);
    if (!Number.isFinite(capturedAtMs)) throw new HttpError(422, "Issue observation is missing capturedAt.");
    const { bucketStartMs } = hourlyBucketBounds(capturedAtMs);
    const targetBucketId = bucketId(activeGeneration, siteId, zoneId, bucketStartMs);
    const bucketReference = firestore.collection("analyticsBuckets").doc(targetBucketId);
    const bucketSnapshot = await transaction.get(bucketReference);
    if (!bucketSnapshot.exists) {
      throw new HttpError(409, "The alert's first sample has not been applied to the active analytics generation.");
    }
    const bucket = mutableBucketFromSnapshot(bucketSnapshot, siteId, zoneId, activeGeneration, bucketStartMs);
    if (issueType === "floor_litter") bucket.litterIncidentCount += 1;
    else if (issueType === "bin_overflow") bucket.overflowIncidentCount += 1;
    else bucket.spillIncidentCount += 1;
    transaction.set(bucketReference, { ...storedBucket(bucket), createdAt: bucketSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() });
    transaction.create(markerReference, {
      aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
      generationId: activeGeneration,
      alertId,
      firstObservationId,
      analysisRunId,
      siteId,
      zoneId,
      issueType,
      bucketId: targetBucketId,
      status: "applied",
      appliedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(alertReference, {
      analyticsIncidentAppliedAt: FieldValue.serverTimestamp(),
      analyticsIncidentGenerationId: activeGeneration,
      analyticsIncidentBucketId: targetBucketId,
    });
    return { status: "applied" as const, generationId: activeGeneration, bucketId: targetBucketId };
  });
}

export async function applyCompletedAnalysisAnalytics(analysisRunId: string, alertIds: string[] = []) {
  const sample = await applyAnalysisRunAnalytics(analysisRunId);
  const incidents = [];
  for (const alertId of [...new Set(alertIds)]) incidents.push(await applyAlertIncidentAnalytics(alertId));
  return { sample, incidents };
}

async function writeInBatches(items: Array<{ reference: DocumentReference; data: DocumentData }>) {
  for (let offset = 0; offset < items.length; offset += 400) {
    const batch = firestore.batch();
    for (const item of items.slice(offset, offset + 400)) batch.set(item.reference, item.data);
    await batch.commit();
  }
}

async function boundedSiteDocuments(collection: string, siteId: string, limit: number) {
  const snapshot = await firestore.collection(collection).where("siteId", "==", siteId).limit(limit + 1).get();
  if (snapshot.size > limit) {
    throw new HttpError(409, `Analytics reconciliation exceeded the prototype limit of ${limit} ${collection} records.`);
  }
  return snapshot.docs;
}

export async function reconcileSiteAnalytics(siteId: string, actorUid: string) {
  const siteReference = firestore.collection("sites").doc(siteId);
  const siteSnapshot = await siteReference.get();
  if (!siteSnapshot.exists) throw new HttpError(404, "Site not found.");
  const references = analyticsReferences(siteId);
  const token = randomUUID();
  const generationId = `rebuild-${Date.now()}-${token.slice(0, 8)}`;
  await firestore.runTransaction(async (transaction) => {
    const lock = await transaction.get(references.lock);
    assertUnlocked(lock);
    transaction.set(references.lock, {
      siteId,
      token,
      status: "building",
      requestedByUid: actorUid,
      generationId,
      acquiredAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + REBUILD_LEASE_MS),
    });
  });

  try {
    const [zones, runs, observations, alerts] = await Promise.all([
      boundedSiteDocuments("zones", siteId, 1_000),
      boundedSiteDocuments("analysisRuns", siteId, REBUILD_RUN_LIMIT),
      boundedSiteDocuments("issueObservations", siteId, REBUILD_OBSERVATION_LIMIT),
      boundedSiteDocuments("alerts", siteId, REBUILD_ALERT_LIMIT),
    ]);
    const zoneIds = new Set(zones.map((zone) => zone.id));
    const observationById = new Map(observations.map((observation) => [observation.id, observation]));
    const observationsByRun = new Map<string, QueryDocumentSnapshot[]>();
    for (const observation of observations) {
      const runId = observation.data().analysisRunId;
      if (typeof runId !== "string") continue;
      const existing = observationsByRun.get(runId) ?? [];
      existing.push(observation);
      observationsByRun.set(runId, existing);
    }
    const runById = new Map(runs.map((run) => [run.id, run]));
    const buckets = new Map<string, MutableBucket>();
    const states = new Map<string, {
      state: AnalyticsPersistenceState;
      zoneId: string;
      cameraId: string;
      issueType: IssueType;
    }>();
    const stagedWrites: Array<{ reference: DocumentReference; data: DocumentData }> = [];
    let includedRunCount = 0;
    let excludedRunCount = 0;
    let invalidRunCount = 0;
    const orderedRuns = [...runs].sort((left, right) => {
      const timestampOrder = timestampMs(left.data().capturedAt) - timestampMs(right.data().capturedAt);
      return timestampOrder || left.id.localeCompare(right.id);
    });
    for (const runSnapshot of orderedRuns) {
      const run = runSnapshot.data();
      if (!run.analyticsEligible || run.isTest) {
        excludedRunCount += 1;
        continue;
      }
      const zoneId = typeof run.zoneId === "string" ? run.zoneId : "";
      const cameraId = typeof run.cameraId === "string" ? run.cameraId : "";
      const capturedAtMs = timestampMs(run.capturedAt);
      const projectedObservations = (observationsByRun.get(runSnapshot.id) ?? [])
        .map(observationInput).filter((item): item is AnalyticsObservationInput => Boolean(item));
      if (!zoneIds.has(zoneId) || !cameraId || !Number.isFinite(capturedAtMs)
        || ISSUE_TYPES.some((issueType) => !projectedObservations.some((item) => item.issueType === issueType))) {
        invalidRunCount += 1;
        continue;
      }
      const previousStates = Object.fromEntries(ISSUE_TYPES.map((issueType) => [
        issueType,
        states.get(hashId("analytics-rebuild-series-v1", zoneId, cameraId, issueType))?.state ?? null,
      ])) as Partial<Record<IssueType, AnalyticsPersistenceState | null>>;
      const derived = deriveRunAnalyticsContribution({
        id: runSnapshot.id,
        siteId,
        zoneId,
        cameraId,
        capturedAtMs,
        peopleCount: Number(run.peopleCount ?? 0),
        modelVersions: modelVersions(run),
        observations: projectedObservations,
      }, previousStates);
      const { bucketStartMs } = hourlyBucketBounds(capturedAtMs);
      const id = bucketId(generationId, siteId, zoneId, bucketStartMs);
      const bucket = buckets.get(id) ?? emptyMutableBucket(siteId, zoneId, generationId, bucketStartMs);
      mergeRunContribution(bucket, cameraId, derived.contribution);
      buckets.set(id, bucket);
      for (const issueType of ISSUE_TYPES) {
        states.set(hashId("analytics-rebuild-series-v1", zoneId, cameraId, issueType), {
          state: derived.nextStates[issueType], zoneId, cameraId, issueType,
        });
      }
      stagedWrites.push({
        reference: firestore.collection("analyticsSampleApplications").doc(sampleMarkerId(generationId, runSnapshot.id)),
        data: {
          aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
          generationId,
          analysisRunId: runSnapshot.id,
          siteId,
          zoneId,
          cameraId,
          bucketId: id,
          status: "applied",
          source: "reconciliation",
          appliedAt: Timestamp.now(),
        },
      });
      includedRunCount += 1;
    }

    let includedIncidentCount = 0;
    let excludedIncidentCount = 0;
    for (const alertSnapshot of alerts) {
      const alert = alertSnapshot.data();
      const firstObservationId = typeof alert.firstObservationId === "string" ? alert.firstObservationId : "";
      const observationSnapshot = observationById.get(firstObservationId);
      const observation = observationSnapshot?.data();
      const runSnapshot = observation && typeof observation.analysisRunId === "string" ? runById.get(observation.analysisRunId) : undefined;
      const run = runSnapshot?.data();
      const issueType = observation?.issueType;
      const zoneId = typeof observation?.zoneId === "string" ? observation.zoneId : "";
      const capturedAtMs = timestampMs(observation?.capturedAt);
      if (!observation || !run || !run.analyticsEligible || run.isTest || observation.excluded || !observation.positive
        || alert.issueType !== issueType || !ISSUE_TYPE_SET.has(issueType) || !zoneIds.has(zoneId) || !Number.isFinite(capturedAtMs)) {
        excludedIncidentCount += 1;
        continue;
      }
      const { bucketStartMs } = hourlyBucketBounds(capturedAtMs);
      const id = bucketId(generationId, siteId, zoneId, bucketStartMs);
      const bucket = buckets.get(id);
      if (!bucket) {
        excludedIncidentCount += 1;
        continue;
      }
      if (issueType === "floor_litter") bucket.litterIncidentCount += 1;
      else if (issueType === "bin_overflow") bucket.overflowIncidentCount += 1;
      else bucket.spillIncidentCount += 1;
      stagedWrites.push({
        reference: firestore.collection("analyticsIncidentApplications")
          .doc(incidentMarkerId(generationId, alertSnapshot.id, firstObservationId)),
        data: {
          aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
          generationId,
          alertId: alertSnapshot.id,
          firstObservationId,
          analysisRunId: runSnapshot!.id,
          siteId,
          zoneId,
          issueType,
          bucketId: id,
          status: "applied",
          source: "reconciliation",
          appliedAt: Timestamp.now(),
        },
      });
      includedIncidentCount += 1;
    }

    for (const bucket of buckets.values()) {
      stagedWrites.push({
        reference: firestore.collection("analyticsBuckets").doc(bucket.id),
        data: { ...storedBucket(bucket), createdAt: Timestamp.now() },
      });
    }
    for (const storedState of states.values()) {
      const { state, zoneId, cameraId, issueType } = storedState;
      stagedWrites.push({
        reference: firestore.collection("analyticsPersistenceStates")
          .doc(stateId(generationId, siteId, zoneId, cameraId, issueType)),
        data: {
          aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
          persistenceMethod: ANALYTICS_PERSISTENCE_METHOD,
          generationId,
          siteId,
          zoneId,
          cameraId,
          issueType,
          lastAnalysisRunId: state.lastAnalysisRunId,
          lastCapturedAt: Timestamp.fromMillis(state.lastCapturedAtMs),
          lastPositive: state.lastPositive,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      });
    }
    const generationReference = references.siteState.collection("generations").doc(generationId);
    stagedWrites.push({
      reference: generationReference,
      data: {
        siteId,
        generationId,
        aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        status: "ready",
        source: "reconciliation",
        requestedByUid: actorUid,
        includedRunCount,
        excludedRunCount,
        invalidRunCount,
        includedIncidentCount,
        excludedIncidentCount,
        bucketCount: buckets.size,
        builtAt: Timestamp.now(),
      },
    });
    await writeInBatches(stagedWrites);

    await firestore.runTransaction(async (transaction) => {
      const [lock, state, generation] = await Promise.all([
        transaction.get(references.lock),
        transaction.get(references.siteState),
        transaction.get(generationReference),
      ]);
      if (!lock.exists || lock.data()?.token !== token) throw new HttpError(409, "Analytics reconciliation lock was lost before publication.");
      if (!generation.exists || generation.data()?.status !== "ready") throw new HttpError(409, "Analytics staging generation is incomplete.");
      const previousGenerationId = typeof state.data()?.currentGenerationId === "string" ? String(state.data()!.currentGenerationId) : null;
      const previousReference = previousGenerationId ? references.siteState.collection("generations").doc(previousGenerationId) : null;
      const previousSnapshot = previousReference ? await transaction.get(previousReference) : null;
      transaction.set(references.siteState, {
        siteId,
        currentGenerationId: generationId,
        previousGenerationId,
        aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
        lastReconciledAt: FieldValue.serverTimestamp(),
        lastReconciledByUid: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(state.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      transaction.update(generationReference, { status: "active", publishedAt: FieldValue.serverTimestamp() });
      if (previousReference && previousSnapshot?.exists) {
        transaction.update(previousReference, { status: "superseded", supersededAt: FieldValue.serverTimestamp() });
      }
      transaction.delete(references.lock);
    });

    const result = {
      siteId,
      generationId,
      aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
      includedRunCount,
      excludedRunCount,
      invalidRunCount,
      includedIncidentCount,
      excludedIncidentCount,
      bucketCount: buckets.size,
      sourceLimits: { runs: REBUILD_RUN_LIMIT, observations: REBUILD_OBSERVATION_LIMIT, alerts: REBUILD_ALERT_LIMIT },
    };
    await recoverOperationalEvent({
      identity: {
        dependency: "analytics_rebuild",
        eventCode: "reconciliation_failed",
        scope: { type: "site", id: siteId },
      },
      recoveryId: `analytics-recovery-${token}`,
      safeDetails: {
        operation: "analytics_reconciliation",
        siteId,
        succeededItemCount: includedRunCount,
      },
    });
    return result;
  } catch (error) {
    await firestore.runTransaction(async (transaction) => {
      const lock = await transaction.get(references.lock);
      if (lock.exists && lock.data()?.token === token) transaction.delete(references.lock);
    });
    await recordOperationalFailure({
      identity: {
        dependency: "analytics_rebuild",
        eventCode: "reconciliation_failed",
        scope: { type: "site", id: siteId },
      },
      occurrenceId: `analytics-rebuild-${token}`,
      severity: "warning",
      safeDetails: {
        operation: "analytics_reconciliation",
        reasonCode: error instanceof HttpError && error.status === 409
          ? "source_limit_or_lock_conflict" : "rebuild_failed",
        retryable: true,
        siteId,
      },
    });
    throw error;
  }
}

function reportBucket(snapshot: QueryDocumentSnapshot): HourlyZoneAnalyticsBucket {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    siteId: String(data.siteId),
    zoneId: String(data.zoneId),
    bucketStart: data.bucketStart instanceof Timestamp ? data.bucketStart.toDate().toISOString() : String(data.bucketStart),
    bucketEnd: data.bucketEnd instanceof Timestamp ? data.bucketEnd.toDate().toISOString() : String(data.bucketEnd),
    analyticsEligible: Boolean(data.analyticsEligible),
    isTest: Boolean(data.isTest),
    successfulSampleCount: Number(data.successfulSampleCount ?? 0),
    failedSampleCount: Number(data.failedSampleCount ?? 0),
    peopleCountSum: Number(data.peopleCountSum ?? 0),
    peopleCountMax: Number(data.peopleCountMax ?? 0),
    litterIncidentCount: Number(data.litterIncidentCount ?? 0),
    overflowIncidentCount: Number(data.overflowIncidentCount ?? 0),
    issuePersistenceSeconds: Number(data.issuePersistenceSeconds ?? 0),
  };
}

async function reportBuckets(siteId: string, generationId: string, start: Timestamp, end: Timestamp) {
  try {
    const result: QueryDocumentSnapshot[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    while (result.length <= REPORT_BUCKET_LIMIT) {
      let query = firestore.collection("analyticsBuckets")
        .where("siteId", "==", siteId)
        .where("generationId", "==", generationId)
        .where("bucketStart", ">=", start)
        .where("bucketStart", "<", end)
        .orderBy("bucketStart", "asc")
        .limit(500);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      result.push(...page.docs);
      if (page.size < 500) break;
      cursor = page.docs.at(-1)!;
    }
    if (result.length > REPORT_BUCKET_LIMIT) throw new HttpError(409, `A report cannot read more than ${REPORT_BUCKET_LIMIT} hourly buckets.`);
    return { documents: result, queryMode: "indexed" as const };
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("analyticsBuckets").where("siteId", "==", siteId).limit(FALLBACK_SCAN_LIMIT + 1).get();
    if (snapshot.size > FALLBACK_SCAN_LIMIT) {
      throw new HttpError(409, "The bounded analytics fallback is full; deploy Firestore indexes before generating this report.");
    }
    return {
      documents: snapshot.docs.filter((document) => {
        const data = document.data();
        const bucketStartMs = timestampMs(data.bucketStart);
        return data.generationId === generationId && bucketStartMs >= start.toMillis() && bucketStartMs < end.toMillis();
      }).sort((left, right) => timestampMs(left.data().bucketStart) - timestampMs(right.data().bucketStart)),
      queryMode: "fallback_bounded_scan" as const,
    };
  }
}

export async function generateAnalyticsReport(input: GenerateAnalyticsReportInput, actorUid: string) {
  const [siteSnapshot, zonesSnapshot] = await Promise.all([
    firestore.collection("sites").doc(input.siteId).get(),
    firestore.collection("zones").where("siteId", "==", input.siteId).limit(1_001).get(),
  ]);
  if (!siteSnapshot.exists) throw new HttpError(404, "Site not found.");
  if (zonesSnapshot.size > 1_000) throw new HttpError(409, "The site exceeds the prototype limit of 1,000 zones.");
  const requestedZoneIds = input.zoneIds ? new Set(input.zoneIds) : null;
  const allZoneIds = new Set(zonesSnapshot.docs.map((zone) => zone.id));
  if (requestedZoneIds && [...requestedZoneIds].some((zoneId) => !allZoneIds.has(zoneId))) {
    throw new HttpError(400, "One or more requested zones do not belong to the selected site.");
  }
  const zones = zonesSnapshot.docs
    .filter((zone) => !requestedZoneIds || requestedZoneIds.has(zone.id))
    .map((zone) => ({ id: zone.id, name: String(zone.data().name ?? zone.id) }));
  if (zones.length === 0) throw new HttpError(400, "At least one configured zone is required for a report.");

  const reportReference = firestore.collection("analyticsReports").doc(randomUUID());
  const generatedAt = Timestamp.now();
  const generationId = await generationCandidate(input.siteId);
  await reportReference.create({
    siteId: input.siteId,
    zoneIds: zones.map((zone) => zone.id),
    periodStart: Timestamp.fromDate(new Date(input.periodStart)),
    periodEnd: Timestamp.fromDate(new Date(input.periodEnd)),
    status: "pending",
    policyVersion: DEFAULT_PRIORITY_ZONE_POLICY.version,
    aggregationVersion: ANALYTICS_AGGREGATION_VERSION,
    generationId,
    generatedByUid: actorUid,
    generatedAt,
    completedAt: null,
    error: null,
  });
  try {
    const start = Timestamp.fromDate(new Date(input.periodStart));
    const end = Timestamp.fromDate(new Date(input.periodEnd));
    const bucketResult = await reportBuckets(input.siteId, generationId, start, end);
    const report = buildPriorityZoneReport({
      site: {
        id: siteSnapshot.id,
        name: String(siteSnapshot.data()?.name ?? siteSnapshot.id),
        timeZone: String(siteSnapshot.data()?.timezone ?? "Asia/Kuala_Lumpur"),
      },
      period: { start: start.toDate().toISOString(), end: end.toDate().toISOString() },
      zones,
      buckets: bucketResult.documents.map(reportBucket),
    });
    await writeInBatches(report.zoneResults.map((zone) => ({
      reference: reportReference.collection("zoneResults").doc(zone.zoneId),
      data: {
        ...zone,
        siteId: input.siteId,
        reportId: reportReference.id,
        zoneNameSnapshot: zone.zoneName,
        createdAt: Timestamp.now(),
      },
    })));
    await reportReference.update({
      status: report.status,
      siteNameSnapshot: report.site.name,
      siteTimeZoneSnapshot: report.site.timeZone,
      policy: report.policy,
      selection: report.selection,
      sufficientZoneCount: report.sufficientZoneCount,
      insufficientZoneCount: report.insufficientZoneCount,
      highPriorityZoneCount: report.zoneResults.filter((zone) => zone.priorityBand === "high").length,
      mediumPriorityZoneCount: report.zoneResults.filter((zone) => zone.priorityBand === "medium").length,
      lowPriorityZoneCount: report.zoneResults.filter((zone) => zone.priorityBand === "low").length,
      bucketQueryMode: bucketResult.queryMode,
      completedAt: FieldValue.serverTimestamp(),
    });
    return getAnalyticsReport(reportReference.id);
  } catch (error) {
    await reportReference.update({
      status: "failed",
      error: { message: error instanceof Error ? error.message : "Analytics report generation failed." },
      completedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
}

export async function getAnalyticsReport(reportId: string) {
  const reportReference = firestore.collection("analyticsReports").doc(reportId);
  const [reportSnapshot, resultsSnapshot] = await Promise.all([
    reportReference.get(),
    reportReference.collection("zoneResults").limit(1_001).get(),
  ]);
  if (!reportSnapshot.exists) throw new HttpError(404, "Analytics report not found.");
  if (resultsSnapshot.size > 1_000) throw new HttpError(409, "Analytics report exceeds the prototype zone-result limit.");
  const zoneResults = resultsSnapshot.docs.map((document) => serialize(document, "Analytics zone result"))
    .sort((left, right) => {
      const leftRank = typeof left.rank === "number" ? left.rank : Number.MAX_SAFE_INTEGER;
      const rightRank = typeof right.rank === "number" ? right.rank : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || String(left.zoneId).localeCompare(String(right.zoneId));
    });
  return { report: serialize(reportSnapshot, "Analytics report"), zoneResults };
}

function reportSummary(snapshot: QueryDocumentSnapshot | DocumentSnapshot) {
  const item = serialize(snapshot, "Analytics report");
  delete item.policy;
  delete item.selection;
  return item;
}

export async function listAnalyticsReports(input: ListAnalyticsReportsInput) {
  const cursorSnapshot = input.cursor ? await firestore.collection("analyticsReports").doc(input.cursor).get() : null;
  if (cursorSnapshot && (!cursorSnapshot.exists || cursorSnapshot.data()?.siteId !== input.siteId)) {
    throw new HttpError(400, "The report cursor is invalid for this site.");
  }
  try {
    let baseQuery = firestore.collection("analyticsReports").where("siteId", "==", input.siteId);
    if (input.status !== "all") baseQuery = baseQuery.where("status", "==", input.status);
    let query = baseQuery
      .orderBy("generatedAt", "desc")
      .limit(input.limit + 1);
    if (cursorSnapshot) query = query.startAfter(cursorSnapshot);
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, input.limit);
    return {
      reports: page.map(reportSummary),
      nextCursor: snapshot.size > input.limit ? page.at(-1)?.id ?? null : null,
      queryMode: "indexed" as const,
    };
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await firestore.collection("analyticsReports").where("siteId", "==", input.siteId).limit(1_001).get();
    if (snapshot.size > 1_000) throw new HttpError(409, "Deploy Firestore indexes before listing more than 1,000 analytics reports.");
    const ordered = snapshot.docs
      .filter((document) => input.status === "all" || document.data().status === input.status)
      .sort((left, right) => timestampMs(right.data().generatedAt) - timestampMs(left.data().generatedAt));
    const cursorIndex = input.cursor ? ordered.findIndex((document) => document.id === input.cursor) : -1;
    const candidates = ordered.slice(cursorIndex >= 0 ? cursorIndex + 1 : 0);
    const page = candidates.slice(0, input.limit);
    return {
      reports: page.map(reportSummary),
      nextCursor: candidates.length > input.limit ? page.at(-1)?.id ?? null : null,
      queryMode: "fallback_bounded_scan" as const,
    };
  }
}

function csvCell(value: unknown) {
  const text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function analyticsReportCsv(reportId: string) {
  const detail = await getAnalyticsReport(reportId);
  const report = detail.report;
  if (report.status !== "completed" && report.status !== "insufficient_data") {
    throw new HttpError(409, "CSV is available only for completed analytics reports.");
  }
  const columns = [
    "reportId", "siteId", "periodStart", "periodEnd", "zoneId", "zoneName", "rank", "priorityBand", "totalScore",
    "litterIncidents", "overflowIncidents", "averagePeoplePerSuccessfulSample", "peakPeople", "issuePersistenceSeconds",
    "successfulHourlyBuckets", "localCalendarDays", "successfulSamples", "failedSamples", "sampleSuccessRatio",
    "litterRaw", "litterNormalized", "visitorRaw", "visitorNormalized", "overflowRaw", "overflowNormalized",
    "persistenceRaw", "persistenceNormalized", "reasons",
  ];
  const rows = detail.zoneResults.map((zone) => {
    const evidence = zone.evidence as Record<string, unknown>;
    const coverage = zone.coverage as Record<string, unknown>;
    const factors = zone.factors as Record<string, Record<string, unknown>>;
    return [
      report.id, report.siteId, report.periodStart, report.periodEnd, zone.zoneId, zone.zoneName, zone.rank,
      zone.priorityBand, zone.totalScore, evidence.litterIncidents, evidence.overflowIncidents,
      evidence.averagePeoplePerSuccessfulSample, evidence.peakPeople, evidence.issuePersistenceSeconds,
      coverage.successfulHourlyBucketCount, coverage.localCalendarDayCount, coverage.successfulSampleCount,
      coverage.failedSampleCount, coverage.sampleSuccessRatio,
      factors.litterBurden?.raw, factors.litterBurden?.normalized,
      factors.visitorPressure?.raw, factors.visitorPressure?.normalized,
      factors.overflowBurden?.raw, factors.overflowBurden?.normalized,
      factors.issuePersistence?.raw, factors.issuePersistence?.normalized, zone.reasons,
    ];
  });
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
