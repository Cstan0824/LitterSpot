import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";
import { SCHEMA_VERSION } from "../shared/firestoreSchema.js";
import { createAlertWorkOrder, applyVerification, getWorkOrder } from "./workOrderService.js";
import { deriveCleanerAvailability } from "./cleanerAvailability.js";
import { canonicalHash } from "./persistence.js";
import {
  assignmentPairKey,
  isEligibleAssignmentPair,
  mapDistanceMeters,
  recentLocationStrength,
  technicalRetryDelays,
  type Point,
} from "./orchestratorPolicy.js";
import {
  pythonAssignmentSelector,
  type AssignmentDecision,
  type AssignmentSelector,
} from "./orchestratorProvider.js";
import { enqueueImmediateAssignmentTrigger } from "./orchestratorTriggers.js";
import { writeAuditEvent, type AuditActor } from "./auditService.js";
import { serializeFirestore } from "./presentation.js";
import { recordSystemEvent, recoverOrchestratorSystemEvents, type SystemEventCode } from "./systemService.js";
import { notifySiteSupervisors } from "./notificationService.js";
import { assignmentContextHash, OrchestrationConflict, type OrchestrationCommand } from "./orchestratorCommit.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

type AssignmentAlert = {
  alertId: string;
  issueType: string;
  observedCondition: string;
  severity: string;
  priorityScore: number;
  ageMinutes: number;
  createdAt: string | null;
  mapRevisionId: string;
  zoneId: string;
  zoneName: string;
  cameraId: string;
  cameraName: string;
  targetPoint: Point;
  revision: number;
  isSimulation: boolean;
};

type AssignmentCleaner = {
  cleanerId: string;
  fullName: string;
  stationPoint: Point;
  stationZoneId: string | null;
  availability: "available";
  recentWorkLocation: null | {
    workOrderId: string;
    point: Point;
    zoneId: string;
    resolvedAt: string;
    minutesSinceResolution: number;
    strength: "strong" | "weak";
    uncertainty: "returning_to_station";
  };
};

export type AssignmentContext = {
  siteId: string;
  siteName: string;
  activeMapRevisionId: string;
  policyVersion: string;
  calculatedAt: string;
  alerts: AssignmentAlert[];
  cleaners: AssignmentCleaner[];
  eligiblePairs: Array<{
    alertId: string;
    cleanerId: string;
    stationDistanceMeters: number;
    recentWorkDistanceMeters: number | null;
    recentWorkStrength: "strong" | "weak" | null;
    locationUncertainty: "returning_to_station" | null;
  }>;
};

type RunOptions = {
  workerId?: string;
  selector?: AssignmentSelector;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: Date;
  requestId?: string;
  triggerType?: string;
  sourceEventId?: string;
};

const timestamp = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
const point = (value: unknown): Point | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const xMeters = Number(item.xMeters);
  const yMeters = Number(item.yMeters);
  return Number.isFinite(xMeters) && Number.isFinite(yMeters) ? { xMeters, yMeters } : null;
};
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function presentRun(id: string, data: DocumentData): Record<string, any> {
  const snapshot = data.inputSnapshot && typeof data.inputSnapshot === "object" ? data.inputSnapshot as Record<string, any> : {};
  const snapshotAlerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
  const snapshotCleaners = Array.isArray(snapshot.cleaners) ? snapshot.cleaners : [];
  const resultWork = data.commandResult?.workOrder && typeof data.commandResult.workOrder === "object"
    ? data.commandResult.workOrder as Record<string, any>
    : snapshot.workOrder && typeof snapshot.workOrder === "object"
      ? snapshot.workOrder as Record<string, any>
      : null;
  const alertId = String(data.selectedAlertId ?? data.alertId ?? resultWork?.alertId ?? "") || null;
  const cleanerId = String(data.selectedCleanerId ?? resultWork?.assignedCleanerId ?? "") || null;
  const snapshotAlert = alertId ? snapshotAlerts.find((item: Record<string, unknown>) => item.alertId === alertId) : null;
  const snapshotCleaner = cleanerId ? snapshotCleaners.find((item: Record<string, unknown>) => item.cleanerId === cleanerId) : null;
  return serializeFirestore({
    id,
    ...data,
    references: {
      alert: alertId ? {
        id: alertId,
        issueType: snapshotAlert?.issueType ?? resultWork?.issueType ?? null,
        observedCondition: snapshotAlert?.observedCondition ?? null,
        severity: snapshotAlert?.severity ?? resultWork?.severity ?? null,
        zoneId: snapshotAlert?.zoneId ?? resultWork?.zoneId ?? resultWork?.target?.zoneId ?? null,
        zoneName: snapshotAlert?.zoneName ?? resultWork?.target?.zoneNameSnapshot ?? null,
        cameraId: snapshotAlert?.cameraId ?? resultWork?.cameraId ?? resultWork?.target?.cameraId ?? null,
        cameraName: snapshotAlert?.cameraName ?? resultWork?.target?.cameraNameSnapshot ?? null,
      } : null,
      cleaner: cleanerId ? {
        id: cleanerId,
        name: snapshotCleaner?.fullName ?? resultWork?.cleanerNameSnapshot ?? null,
      } : null,
      workOrder: resultWork || data.workOrderId ? {
        id: String(resultWork?.id ?? data.workOrderId),
        title: resultWork?.title ?? null,
        status: resultWork?.status ?? null,
        targetType: resultWork?.target?.type ?? null,
      } : null,
    },
    leaseExpiresAt: timestamp(data.leaseExpiresAt),
    startedAt: timestamp(data.startedAt),
    completedAt: timestamp(data.completedAt),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
  });
}

async function readExecutionConfig(siteId: string, requireAssignment = true) {
  const [site, config] = await Promise.all([
    firestore.collection("sites").doc(siteId).get(),
    firestore.collection("orchestratorConfigs").doc(siteId).get(),
  ]);
  if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active") {
    throw new HttpError(409, "Orchestrator cannot run for an inactive or missing Site.");
  }
  if (!config.exists || config.data()?.schemaVersion !== 2) throw new HttpError(409, "Orchestrator configuration is missing.");
  if (config.data()?.status !== "running") throw new HttpError(409, "Orchestrator is paused.");
  if (requireAssignment && config.data()?.assignmentEnabled !== true) throw new HttpError(409, "Orchestrator assignment is disabled.");
  return { site: site.data()!, config: config.data()! };
}

export async function getAssignmentContext(
  siteId: string,
  options: { now?: Date; excludedCleanerIds?: Set<string>; excludedPairKeys?: Set<string> } = {},
): Promise<AssignmentContext> {
  const now = options.now ?? new Date();
  const { site, config } = await readExecutionConfig(siteId);
  const activeMapRevisionId = String(site.activeMapRevisionId ?? "");
  if (!activeMapRevisionId) throw new HttpError(409, "Site has no Active Map Revision.");

  const [alertSnapshot, cleanerSnapshot] = await Promise.all([
    firestore.collection("alerts").where("siteId", "==", siteId).limit(500).get(),
    firestore.collection("cleaners").where("siteId", "==", siteId).limit(500).get(),
  ]);

  const waitingAlerts = alertSnapshot.docs
    .filter((document) => {
      const data = document.data();
      return data.schemaVersion === 2
        && data.status === "waiting_for_cleaner"
        && data.managementMode === "orchestrated"
        && !data.activeWorkOrderId;
    })
    .sort((left, right) => {
      const priority = Number(right.data().priorityScore ?? 0) - Number(left.data().priorityScore ?? 0);
      if (priority !== 0) return priority;
      return Number(left.data().createdAt?.toMillis?.() ?? 0) - Number(right.data().createdAt?.toMillis?.() ?? 0);
    })
    .slice(0, 10);

  const alerts = (await Promise.all(waitingAlerts.map(async (document): Promise<AssignmentAlert | null> => {
    const data = document.data();
    const mapRevisionId = String(data.mapRevisionId ?? "");
    if (mapRevisionId !== activeMapRevisionId) return null;
    const placement = await firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cameraPlacements").doc(String(data.cameraId)).get();
    const targetPoint = point(placement.data()?.point);
    if (!placement.exists || placement.data()?.siteId !== siteId || !targetPoint) return null;
    const createdAtMs = Number(data.createdAt?.toMillis?.() ?? now.getTime());
    return {
      alertId: document.id,
      issueType: String(data.issueType),
      observedCondition: String(data.observedCondition),
      severity: String(data.severity),
      priorityScore: Number(data.priorityScore ?? 0),
      ageMinutes: Math.max(0, (now.getTime() - createdAtMs) / 60_000),
      createdAt: timestamp(data.createdAt),
      mapRevisionId,
      zoneId: String(data.zoneId),
      zoneName: String(data.zoneNameSnapshot ?? data.zoneId),
      cameraId: String(data.cameraId),
      cameraName: String(data.cameraNameSnapshot ?? data.cameraId),
      targetPoint,
      revision: Number(data.revision ?? 0),
      isSimulation: Boolean(data.isSimulation),
    };
  }))).filter((item): item is AssignmentAlert => item !== null);

  const cleaners = (await Promise.all(cleanerSnapshot.docs.map(async (document): Promise<AssignmentCleaner | null> => {
    const data = document.data();
    if (data.schemaVersion !== 2 || options.excludedCleanerIds?.has(document.id)) return null;
    const [account, station] = await Promise.all([
      firestore.collection("userAccounts").doc(String(data.authUid ?? "")).get(),
      firestore.collection("siteMapRevisions").doc(activeMapRevisionId).collection("cleanerStations").doc(document.id).get(),
    ]);
    const stationPoint = point(station.data()?.point);
    const availability = deriveCleanerAvailability({
      siteActive: true,
      accountActive: account.exists && account.data()?.status === "active" && account.data()?.siteId === siteId,
      cleanerActive: data.status === "active",
      availabilityOverride: data.availabilityOverride === "unavailable" ? "unavailable" : "none",
      activeWorkOrderId: data.activeWorkOrderId == null ? null : String(data.activeWorkOrderId),
      stationPointValid: Boolean(stationPoint && station.data()?.siteId === siteId),
      schedule: data.weeklySchedule ?? {},
      scheduleTimeZone: String(data.scheduleTimeZone ?? site.timeZone ?? "Asia/Kuala_Lumpur"),
      at: now,
    });
    if (!availability.available || !stationPoint) return null;

    let recentWorkLocation: AssignmentCleaner["recentWorkLocation"] = null;
    const resolvedAt = data.lastResolvedWorkAt instanceof Timestamp ? data.lastResolvedWorkAt : null;
    const recentTarget = data.lastResolvedWorkTarget as Record<string, unknown> | null | undefined;
    const recentPoint = point(recentTarget?.point);
    if (resolvedAt && recentPoint && data.lastResolvedMapRevisionId === activeMapRevisionId) {
      const minutesSinceResolution = Math.max(0, (now.getTime() - resolvedAt.toMillis()) / 60_000);
      const strength = recentLocationStrength(minutesSinceResolution);
      if (strength !== "expired") {
        recentWorkLocation = {
          workOrderId: String(data.lastResolvedWorkOrderId),
          point: recentPoint,
          zoneId: String(recentTarget?.zoneId ?? ""),
          resolvedAt: resolvedAt.toDate().toISOString(),
          minutesSinceResolution,
          strength,
          uncertainty: "returning_to_station",
        };
      }
    }
    return {
      cleanerId: document.id,
      fullName: String(data.fullName),
      stationPoint,
      stationZoneId: typeof station.data()?.zoneId === "string" ? String(station.data()?.zoneId) : null,
      availability: "available",
      recentWorkLocation,
    };
  }))).filter((item): item is AssignmentCleaner => item !== null);

  const eligiblePairs = alerts.flatMap((alert) => cleaners.map((cleaner) => ({
    alertId: alert.alertId,
    cleanerId: cleaner.cleanerId,
    stationDistanceMeters: mapDistanceMeters(cleaner.stationPoint, alert.targetPoint),
    recentWorkDistanceMeters: cleaner.recentWorkLocation ? mapDistanceMeters(cleaner.recentWorkLocation.point, alert.targetPoint) : null,
    recentWorkStrength: cleaner.recentWorkLocation?.strength ?? null,
    locationUncertainty: cleaner.recentWorkLocation ? "returning_to_station" as const : null,
  }))).filter((pair) => !options.excludedPairKeys?.has(assignmentPairKey(pair.alertId, pair.cleanerId)));

  return {
    siteId,
    siteName: String(site.name),
    activeMapRevisionId,
    policyVersion: String(config.assignmentPolicyVersion ?? "assignment-v2"),
    calculatedAt: now.toISOString(),
    alerts,
    cleaners,
    eligiblePairs,
  };
}

async function createRun(siteId: string, type: "assignment" | "review", workerId: string, input: { workOrderId?: string; alertId?: string; triggerType: string; sourceEventId?: string }) {
  const { config } = await readExecutionConfig(siteId, type === "assignment");
  if (type === "review" && config.reviewEnabled !== true) throw new HttpError(409, "Orchestrator review is disabled.");
  const runId = randomUUID();
  const eventId = canonicalHash("v2-orchestrator-event", siteId, type, runId);
  const leaseExpiresAt = Timestamp.fromMillis(Date.now() + env.orchestratorLeaseSeconds * 1000);
  const runRef = firestore.collection("orchestratorRuns").doc(runId);
  const eventRef = firestore.collection("orchestratorOutbox").doc(eventId);
  await firestore.runTransaction(async (transaction) => {
    const configRef = firestore.collection("orchestratorConfigs").doc(siteId);
    const [currentConfig, currentSite] = await Promise.all([transaction.get(configRef), transaction.get(firestore.collection("sites").doc(siteId))]);
    if (currentSite.data()?.status !== "active" || currentConfig.data()?.status !== "running" || currentConfig.data()?.[type === "assignment" ? "assignmentEnabled" : "reviewEnabled"] !== true) throw new OrchestrationConflict("automation_paused");
    if (Number(currentConfig.data()?.revision ?? 0) !== Number(config.revision ?? 0)) throw new OrchestrationConflict("configuration_changed");
    if (currentConfig.data()?.activeRunId) {
      const prior = await transaction.get(firestore.collection("orchestratorRuns").doc(String(currentConfig.data()?.activeRunId)));
      if (prior.data()?.status === "running") throw new OrchestrationConflict("site_run_busy");
    }
    let verificationId: string | null = null;
    let reviewInputSnapshot: Record<string, unknown> | null = null;
    if (type === "review") {
      const work = await transaction.get(firestore.collection("workOrders").doc(input.workOrderId!));
      if (work.data()?.siteId !== siteId || work.data()?.status !== "awaiting_review" || work.data()?.managementMode !== "orchestrated") throw new OrchestrationConflict("review_changed");
      verificationId = String(work.data()?.latestVerificationId ?? "");
      if (!verificationId) throw new OrchestrationConflict("review_not_ready");
      reviewInputSnapshot = {
        workOrder: {
          id: work.id,
          alertId: work.data()?.alertId ?? null,
          assignedCleanerId: work.data()?.assignedCleanerId ?? null,
          cleanerNameSnapshot: work.data()?.cleanerNameSnapshot ?? null,
          title: work.data()?.title ?? null,
          status: work.data()?.status ?? null,
          severity: work.data()?.severity ?? null,
          issueType: work.data()?.issueType ?? null,
          zoneId: work.data()?.zoneId ?? work.data()?.target?.zoneId ?? null,
          cameraId: work.data()?.cameraId ?? work.data()?.target?.cameraId ?? null,
          target: work.data()?.target ?? null,
        },
      };
    }
    if (input.sourceEventId) {
      const sourceRef = firestore.collection("orchestratorOutbox").doc(input.sourceEventId);
      const source = await transaction.get(sourceRef);
      if (source.data()?.siteId !== siteId || source.data()?.claimedBy !== workerId || source.data()?.status !== "claimed") throw new OrchestrationConflict("trigger_changed");
      if (type === "review" && source.data()?.verificationId && source.data()?.verificationId !== verificationId) throw new OrchestrationConflict("review_changed");
      transaction.update(sourceRef, { runId, claimExpiresAt: leaseExpiresAt });
    }
    transaction.create(eventRef, {
      isRunRecord: true,
      schemaVersion: SCHEMA_VERSION,
      eventId,
      siteId,
      type: type === "assignment" ? "retry_waiting_alerts" : "review_work",
      aggregateType: type === "assignment" ? "site" : "work_order",
      aggregateId: input.workOrderId ?? input.alertId ?? siteId,
      triggerType: input.triggerType,
      status: "claimed",
      availableAt: FieldValue.serverTimestamp(),
      claimTokenHash: canonicalHash("v2-orchestrator-claim", runId, workerId),
      claimedBy: workerId,
      claimExpiresAt: leaseExpiresAt,
      deliveryAttempts: 1,
      lastErrorCode: null,
      runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(runRef, {
      schemaVersion: SCHEMA_VERSION,
      runId,
      siteId,
      type,
      status: "running",
      triggerEventId: eventId,
      alertId: input.alertId ?? null,
      workOrderId: input.workOrderId ?? null,
      managementModeSnapshot: "orchestrated",
      requestedWorkerId: workerId,
      configRevision: Number(config.revision ?? 0),
      verificationId,
      inputSnapshot: reviewInputSnapshot,
      candidateCount: 0,
      inputAlertCount: type === "assignment" ? 0 : 1,
      candidatePairCount: 0,
      selectedAlertId: null,
      selectedCleanerId: null,
      decisionSummary: null,
      decisionFactors: {},
      provider: String(config.provider),
      model: String(config.model),
      providerRequestCount: 0,
      candidateAttemptCount: 0,
      toolCallCount: 0,
      resultCode: null,
      errorCode: null,
      errorMessage: null,
      isSimulation: false,
      leaseOwner: workerId,
      leaseExpiresAt,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(firestore.collection("orchestratorConfigs").doc(siteId), {
      activeRunId: runId,
      lastRunAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { runId, eventId, config };
}

async function assertRun(runId: string, workerId: string, type?: "assignment" | "review", siteId?: string) {
  const run = await firestore.collection("orchestratorRuns").doc(runId).get();
  if (!run.exists || run.data()?.schemaVersion !== 2) throw new HttpError(404, "Orchestrator Run not found.");
  const data = run.data()!;
  if (siteId && data.siteId !== siteId) throw new HttpError(404, "Orchestrator Run not found.");
  if (type && data.type !== type) throw new HttpError(409, `Orchestrator Run is not a ${type} run.`);
  const lease = data.leaseExpiresAt instanceof Timestamp ? data.leaseExpiresAt : null;
  if (data.status !== "running" || data.leaseOwner !== workerId || !lease || lease.toMillis() <= Date.now()) {
    throw new HttpError(409, "Orchestrator Run lease is no longer valid.");
  }
  const { site, config } = await readExecutionConfig(String(data.siteId), data.type !== "review");
  if (config.activeRunId !== runId || Number(config.revision ?? 0) !== Number(data.configRevision)) throw new OrchestrationConflict("configuration_changed");
  if (data.type === "review" && !config.reviewEnabled) throw new OrchestrationConflict("automation_paused");
  if (data.managementModeSnapshot !== "orchestrated") throw new HttpError(409, "Orchestrator Run was cancelled by manual takeover.");
  return { snapshot: run, data, site, config };
}

async function writeAction(runId: string, input: { siteId: string; sequence: number; tool: string; inputSummary: Record<string, unknown>; outcome: "succeeded" | "rejected" | "failed"; resultSummary?: Record<string, unknown>; errorCode?: string | null }) {
  const actionId = canonicalHash("v2-orchestrator-action", runId, input.sequence, input.tool);
  await firestore.collection("orchestratorRuns").doc(runId).collection("actions").doc(actionId).set({
    schemaVersion: SCHEMA_VERSION,
    siteId: input.siteId,
    runId,
    sequence: input.sequence,
    tool: input.tool,
    inputSummary: input.inputSummary,
    outcome: input.outcome,
    resultSummary: input.resultSummary ?? {},
    errorCode: input.errorCode ?? null,
    startedAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
  });
  await firestore.collection("orchestratorRuns").doc(runId).update({ toolCallCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
}

async function writeAttempt(runId: string, input: Record<string, unknown> & { siteId: string; sequence: number; kind: "provider_request" | "cleaner_reservation"; outcome: string }) {
  const attemptId = canonicalHash("v2-orchestrator-attempt", runId, input.sequence, input.kind);
  await firestore.collection("orchestratorRuns").doc(runId).collection("attempts").doc(attemptId).set({
    schemaVersion: SCHEMA_VERSION,
    runId,
    selectedAlertId: null,
    selectedCleanerId: null,
    candidateIds: [],
    excludedCleanerIds: [],
    distanceMeters: null,
    reasonCode: null,
    retryDelayMs: null,
    startedAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    ...input,
  });
}

async function finishRun(runId: string, input: { status: "succeeded" | "failed" | "exhausted" | "cancelled"; resultCode: string; errorCode?: string | null; errorMessage?: string | null; selected?: AssignmentDecision; workOrderId?: string | null; decisionFactors?: Record<string, unknown>; onlyIfExpired?: boolean }) {
  const runRef = firestore.collection("orchestratorRuns").doc(runId);
  const run = await runRef.get();
  if (!run.exists) throw new HttpError(404, "Orchestrator Run not found.");
  const eventRef = firestore.collection("orchestratorOutbox").doc(String(run.data()?.triggerEventId));
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(runRef);
    if (current.data()?.status !== "running") return;
    if (input.onlyIfExpired && current.data()?.leaseExpiresAt?.toMillis?.() > Date.now()) return;
    const currentConfig = await transaction.get(firestore.collection("orchestratorConfigs").doc(String(run.data()?.siteId)));
    const selectedAlert = input.selected ? await transaction.get(firestore.collection("alerts").doc(input.selected.alertId)) : null;
    transaction.update(runRef, {
      status: input.status,
      isSimulation: selectedAlert ? Boolean(selectedAlert.data()?.isSimulation) : Boolean(run.data()?.isSimulation),
      resultCode: input.resultCode,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorCode ? "Orchestrator could not complete this operation. Check the error code and development logs." : null,
      selectedAlertId: input.selected?.alertId ?? null,
      alertId: input.selected?.alertId ?? run.data()?.alertId ?? null,
      selectedCleanerId: input.selected?.cleanerId ?? null,
      decisionSummary: input.selected?.rationaleSummary ?? null,
      decisionFactors: input.decisionFactors ?? {},
      provider: input.selected?.provider ?? run.data()?.provider,
      model: input.selected?.model ?? run.data()?.model,
      workOrderId: input.workOrderId ?? run.data()?.workOrderId ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(eventRef, {
      status: input.status === "succeeded" ? "completed" : input.status === "cancelled" ? "cancelled" : "failed",
      claimTokenHash: null,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorCode: input.errorCode ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(firestore.collection("orchestratorConfigs").doc(String(run.data()?.siteId)), {
      ...(currentConfig.data()?.activeRunId === runId ? { activeRunId: null } : {}),
      ...(input.status === "succeeded" ? { lastSuccessfulRunAt: FieldValue.serverTimestamp(), lastFailureCode: null } : { lastFailureAt: FieldValue.serverTimestamp(), lastFailureCode: input.errorCode ?? input.resultCode }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function notifySupervisors(siteId: string, runId: string, type: "assignment_failed", body: string, alertId: string | null = null, stableKey = runId, systemEventCode: SystemEventCode = "orchestrator_assignment_failed") {
  await recordSystemEvent(siteId, systemEventCode);
  const supervisors = await firestore.collection("supervisors").where("siteId", "==", siteId).where("status", "==", "active").get();
  const expiresAt = Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);
  await Promise.all(supervisors.docs.map((supervisor) => {
    const notificationId = canonicalHash("v2-notification", siteId, type, stableKey, supervisor.id);
    return firestore.collection("notifications").doc(notificationId).create({
      schemaVersion: SCHEMA_VERSION,
      notificationId,
      siteId,
      recipientUid: supervisor.id,
      recipientRole: "supervisor",
      type,
      title: "Automatic assignment needs attention",
      body,
      entityType: "orchestrator_run",
      entityId: runId,
      cameraId: null,
      alertId,
      workOrderId: null,
      severity: null,
      isSimulation: false,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    }).catch((error: unknown) => { if ((error as { code?: number }).code !== 6) throw error; });
  }));
}

export async function createAssignmentRun(siteId: string, workerId: string, triggerType = "manual_cycle", sourceEventId?: string) {
  return createRun(siteId, "assignment", workerId, { triggerType, sourceEventId });
}

export async function createReviewRun(siteId: string, workOrderId: string, workerId: string, triggerType = "verification_ready", sourceEventId?: string) {
  const work = await getWorkOrder(siteId, workOrderId);
  if (work.managementMode !== "orchestrated" || work.origin !== "alert") throw new HttpError(409, "Only orchestrated Alert Work can start an automatic review run.");
  return createRun(siteId, "review", workerId, { workOrderId, alertId: String(work.alertId), triggerType, sourceEventId });
}

async function saveAssignmentContext(siteId: string, runId: string, workerId: string, context: AssignmentContext) {
  await firestore.runTransaction(async tx => {
    const runRef = firestore.collection("orchestratorRuns").doc(runId);
    const [run, config, site] = await Promise.all([tx.get(runRef), tx.get(firestore.collection("orchestratorConfigs").doc(siteId)), tx.get(firestore.collection("sites").doc(siteId))]);
    if (run.data()?.siteId !== siteId || run.data()?.leaseOwner !== workerId || run.data()?.status !== "running") throw new OrchestrationConflict("lease_expired");
    if (site.data()?.status !== "active" || site.data()?.activeMapRevisionId !== context.activeMapRevisionId || config.data()?.status !== "running" || config.data()?.activeRunId !== runId) throw new OrchestrationConflict("context_changed");
    tx.update(runRef, { inputSnapshot: context, contextHash: assignmentContextHash(context),
      candidateCount: context.cleaners.length, inputAlertCount: context.alerts.length, candidatePairCount: context.eligiblePairs.length, updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function getAssignmentContextTool(siteId: string, runId: string, workerId: string) {
  const run = await assertRun(runId, workerId, "assignment", siteId);
  if (run.data.inputSnapshot) return run.data.inputSnapshot as AssignmentContext;
  const context = await getAssignmentContext(siteId);
  await saveAssignmentContext(siteId, runId, workerId, context);
  await writeAction(runId, { siteId, sequence: 1, tool: "get_assignment_context", inputSummary: {}, outcome: "succeeded", resultSummary: { alertCount: context.alerts.length, cleanerCount: context.cleaners.length, pairCount: context.eligiblePairs.length } });
  return context;
}

export async function getOrchestratorRun(siteId: string, runId: string) {
  const run = await firestore.collection("orchestratorRuns").doc(runId).get();
  if (!run.exists || run.data()?.schemaVersion !== 2 || run.data()?.siteId !== siteId) throw new HttpError(404, "Orchestrator Run not found.");
  const [attempts, actions] = await Promise.all([
    run.ref.collection("attempts").orderBy("sequence", "asc").limit(100).get(),
    run.ref.collection("actions").orderBy("sequence", "asc").limit(100).get(),
  ]);
  return {
    run: presentRun(run.id, run.data()!),
    attempts: attempts.docs.map((document) => serializeFirestore({ id: document.id, ...document.data() })),
    actions: actions.docs.map((document) => serializeFirestore({ id: document.id, ...document.data() })),
  };
}

export async function listOrchestratorRuns(siteId: string, limit = 50) {
  return (await listOrchestratorRunsPage(siteId, { limit })).items;
}
export async function listOrchestratorRunsPage(siteId: string, input: { limit: number; cursor?: string; status?: string }) {
  let query: FirebaseFirestore.Query = firestore.collection("orchestratorRuns").where("siteId", "==", siteId).where("schemaVersion", "==", 2);
  if (input.status) query = query.where("status", "==", input.status);
  return queryCursorPage({ query, totalQuery: query, resource: "orchestratorRuns", orderField: "createdAt", filters: { siteId, status: input.status ?? null }, limit: Math.min(input.limit, 100), cursor: input.cursor, present: (document) => presentRun(document.id, document.data()) });
}

export async function getOrchestratorConfig(siteId: string) {
  const config = await firestore.collection("orchestratorConfigs").doc(siteId).get();
  if (!config.exists || config.data()?.schemaVersion !== 2) throw new HttpError(404, "Orchestrator configuration not found.");
  return serializeFirestore({ id: config.id, ...config.data() });
}

export async function setOrchestratorStatus(siteId: string, status: "running" | "paused", actor: AuditActor, reason: string | null, requestId: string) {
  const configRef = firestore.collection("orchestratorConfigs").doc(siteId);
  const config = await configRef.get();
  if (!config.exists || config.data()?.schemaVersion !== 2) throw new HttpError(404, "Orchestrator configuration not found.");
  const controlHistory = Array.isArray(config.data()?.controlHistory) ? config.data()!.controlHistory.slice(-19) : [];
  controlHistory.push({
    status,
    actorUid: actor.uid,
    actorNameSnapshot: actor.displayName,
    actorAuthority: actor.authority ?? null,
    reason,
    occurredAt: Timestamp.now(),
  });
  await configRef.update({ status, pausedAt: status === "paused" ? FieldValue.serverTimestamp() : null, pausedByUid: status === "paused" ? actor.uid : null, pauseReason: status === "paused" ? reason : null, controlHistory, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, revision: FieldValue.increment(1) });
  if (status === "running") await enqueueImmediateAssignmentTrigger(siteId, "orchestrator_resumed", `resume:${Date.now()}`);
  await writeAuditEvent({ actor, siteId, action: status === "paused" ? "orchestrator_paused" : "orchestrator_resumed", resourceType: "OrchestratorConfig", resourceId: siteId, outcome: "succeeded", reason, before: { status: config.data()?.status }, after: { status }, requestId });
  return getOrchestratorConfig(siteId);
}

export async function assignCleanerTool(input: { siteId: string; runId: string; workerId: string; decision: AssignmentDecision; context: AssignmentContext; requestId: string; actionSequence?: number }) {
  const decision = input.decision;
  const command: OrchestrationCommand = {
    siteId: input.siteId, runId: input.runId, workerId: input.workerId, kind: "assignment",
    contextHash: assignmentContextHash(input.context), alertId: decision.alertId, cleanerId: decision.cleanerId,
    rationaleSummary: decision.rationaleSummary, provider: decision.provider, model: decision.model,
    fingerprint: canonicalHash("assignment-command", input.runId, decision.alertId, decision.cleanerId, decision.rationaleSummary),
  };
  const workOrder = await createAlertWorkOrder({ siteId: input.siteId, alertId: decision.alertId, assignedCleanerId: decision.cleanerId,
    idempotencyKey: `orchestrator:${input.runId}` },
    { uid: input.workerId, role: "supervisor", authority: null, displayName: "LitterSpot Orchestrator", type: "orchestrator" }, input.requestId, command);
  await recoverOrchestratorSystemEvents(input.siteId, "assignment").catch(() => undefined);
  return workOrder;
}

export async function assignCleanerByIdsTool(input: { siteId: string; runId: string; workerId: string; alertId: string; cleanerId: string; rationaleSummary: string; requestId: string }) {
  const run = await firestore.collection("orchestratorRuns").doc(input.runId).get();
  const data = run.data();
  if (!data || data.siteId !== input.siteId || data.requestedWorkerId !== input.workerId || data.type !== "assignment") throw new HttpError(404, "Orchestrator Run not found.");
  if (!data.inputSnapshot) throw new OrchestrationConflict("context_required");
  return assignCleanerTool({ ...input, context: data.inputSnapshot,
    decision: { alertId: input.alertId, cleanerId: input.cleanerId, rationaleSummary: input.rationaleSummary,
      provider: String(data.provider), model: String(data.model) } });
}

export async function runAssignmentCycle(siteId: string, options: RunOptions = {}) {
  const workerId = options.workerId ?? "v2-assignment-worker";
  const selector = options.selector ?? pythonAssignmentSelector;
  const sleeper = options.sleep ?? delay;
  const requestId = options.requestId ?? randomUUID();
  const { runId, config } = await createAssignmentRun(siteId, workerId, options.triggerType, options.sourceEventId);
  let actionSequence = 1, attemptSequence = 0;
  const excludedCleanerIds = new Set<string>();
  try {
    for (let cycle = 0; cycle < 500; cycle++) {
      await assertRun(runId, workerId, "assignment", siteId);
      const context = await getAssignmentContext(siteId, { now: options.now, excludedCleanerIds });
      await saveAssignmentContext(siteId, runId, workerId, context);
      await writeAction(runId, { siteId, sequence: actionSequence++, tool: "get_assignment_context", inputSummary: { excludedCleanerIds: [...excludedCleanerIds] }, outcome: "succeeded", resultSummary: { alertCount: context.alerts.length, cleanerCount: context.cleaners.length, pairCount: context.eligiblePairs.length } });
      if (!context.alerts.length || !context.eligiblePairs.length) {
        const code = !context.alerts.length ? "no_waiting_alerts" : excludedCleanerIds.size ? "all_candidates_conflicted" : "no_candidates";
        await finishRun(runId, { status: "exhausted", resultCode: code });
        if (context.alerts.length) await notifySupervisors(siteId, runId, "assignment_failed", "No Cleaner could be reserved. Alerts remain waiting.", context.alerts[0].alertId, `${code}:${context.alerts[0].alertId}`, "orchestrator_no_available_cleaner");
        return getOrchestratorRun(siteId, runId);
      }
      let selection: AssignmentDecision | null = null;
      let terminalProviderErrorCode: "invalid_selection" | "provider_error" = "provider_error";
      const retries = technicalRetryDelays(Math.min(3, Math.max(0, Number(config.technicalRetryLimit ?? 3))));
      for (let attempt = 0; attempt <= retries.length; attempt++) {
        await assertRun(runId, workerId, "assignment", siteId);
        const startedAt = Timestamp.now();
        let errorCode: string | null = null;
        try {
          selection = await selector.select(context, { provider: String(config.provider), model: String(config.model), requestTimeoutMs: Math.min(120000, Math.max(1000, Number(config.requestTimeoutMs ?? 60000))) }, runId);
          if (!isEligibleAssignmentPair(context.eligiblePairs, selection.alertId, selection.cleanerId)) throw new Error("invalid_selection");
        } catch (error) {
          selection = null;
          terminalProviderErrorCode = error instanceof Error && error.message === "invalid_selection" ? "invalid_selection" : "provider_error";
          errorCode = terminalProviderErrorCode;
        }
        await assertRun(runId, workerId, "assignment", siteId);
        await writeAttempt(runId, { siteId, sequence: ++attemptSequence, kind: "provider_request",
          selectedAlertId: selection?.alertId ?? null, selectedCleanerId: selection?.cleanerId ?? null,
          candidateIds: context.cleaners.map(c => c.cleanerId), excludedCleanerIds: [...excludedCleanerIds],
          outcome: errorCode ?? "selected", reasonCode: errorCode, retryDelayMs: selection ? null : retries[attempt] ?? null,
          startedAt, completedAt: Timestamp.now() });
        await firestore.collection("orchestratorRuns").doc(runId).update({ providerRequestCount: FieldValue.increment(1) });
        if (selection) break;
        if (retries[attempt]) await sleeper(retries[attempt]);
      }
      if (!selection) {
        await finishRun(runId, { status: "failed", resultCode: "provider_failed", errorCode: "provider_failed" });
        await notifySupervisors(
          siteId,
          runId,
          "assignment_failed",
          "The assignment model could not produce a valid decision. Alerts remain waiting.",
          context.alerts[0].alertId,
          runId,
          terminalProviderErrorCode === "invalid_selection" ? "orchestrator_invalid_selection" : "orchestrator_provider_unavailable",
        );
        return getOrchestratorRun(siteId, runId);
      }
      try {
        await assignCleanerTool({ siteId, runId, workerId, decision: selection, context, requestId });
        await writeAttempt(runId, { siteId, sequence: ++attemptSequence, kind: "cleaner_reservation",
          selectedAlertId: selection.alertId, selectedCleanerId: selection.cleanerId, outcome: "reserved" });
        await firestore.collection("orchestratorRuns").doc(runId).update({ candidateAttemptCount: FieldValue.increment(1) });
        return getOrchestratorRun(siteId, runId);
      } catch (error) {
        // Configuration, Alert, map and lease conflicts stop this episode; never blame a Cleaner for them.
        if (error instanceof OrchestrationConflict || !(error instanceof HttpError) || error.status !== 409) throw error;
        excludedCleanerIds.add(selection.cleanerId);
        await writeAttempt(runId, { siteId, sequence: ++attemptSequence, kind: "cleaner_reservation",
          selectedAlertId: selection.alertId, selectedCleanerId: selection.cleanerId, excludedCleanerIds: [...excludedCleanerIds],
          outcome: "reservation_conflict", reasonCode: "cleaner_unavailable" });
        await firestore.collection("orchestratorRuns").doc(runId).update({ candidateAttemptCount: FieldValue.increment(1) });
      }
    }
    throw new OrchestrationConflict("candidate_budget_exhausted");
  } catch (error) {
    const status = error instanceof HttpError ? "cancelled" : "failed";
    await finishRun(runId, { status,
      resultCode: error instanceof OrchestrationConflict ? error.code : error instanceof Error && /paused|disabled/.test(error.message) ? "automation_paused" : "execution_stopped", errorCode: "execution_stopped" });
    if (status === "failed") await recordSystemEvent(siteId, "orchestrator_assignment_failed");
    return getOrchestratorRun(siteId, runId);
  }
}

export async function getReviewContext(siteId: string, runId: string, workOrderId: string, workerId: string) {
  const run = await assertRun(runId, workerId, "review", siteId);
  const work = await getWorkOrder(siteId, workOrderId);
  if (run.data.workOrderId !== workOrderId || work.managementMode !== "orchestrated" || work.origin !== "alert") throw new HttpError(409, "Work Order is outside this automatic review run.");
  if (work.status !== "awaiting_review") throw new HttpError(409, "Work Order is not awaiting review.");
  const verification = await firestore.collection("workOrders").doc(workOrderId).collection("verifications").doc(String(work.latestVerificationId ?? "")).get();
  if (!verification.exists || verification.id !== run.data.verificationId || verification.data()?.status !== "ready" || !verification.data()?.outcome) throw new HttpError(409, "Verification outcome is not ready.");
  const context = { workOrderId, alertId: work.alertId, workRevision: work.revision, verificationId: verification.id, verificationOutcome: verification.data()?.outcome, outcomeReasonCodes: verification.data()?.outcomeReasonCodes ?? [], sampleSummaries: verification.data()?.sampleSummaries ?? [] };
  await writeAction(runId, { siteId, sequence: 1, tool: "get_review_context", inputSummary: { workOrderId }, outcome: "succeeded", resultSummary: { verificationOutcome: context.verificationOutcome } });
  return context;
}

async function applyReviewTool(input: { siteId: string; runId: string; workOrderId: string; workerId: string; outcome: "passed" | "failed"; requestId: string }) {
  const run = await firestore.collection("orchestratorRuns").doc(input.runId).get();
  const data = run.data();
  if (!data || data.siteId !== input.siteId || data.requestedWorkerId !== input.workerId || data.workOrderId !== input.workOrderId) throw new HttpError(404, "Orchestrator Run not found.");
  const fingerprint = canonicalHash("review-command", input.runId, input.workOrderId, data.verificationId, input.outcome);
  if (data.commandResult) {
    if (data.commandFingerprint !== fingerprint) throw new OrchestrationConflict("command_replay_conflict");
    return serializeFirestore(data.commandResult);
  }
  const context = await getReviewContext(input.siteId, input.runId, input.workOrderId, input.workerId);
  if (context.verificationOutcome !== input.outcome) throw new OrchestrationConflict("review_outcome_mismatch");
  return applyVerification({ siteId: input.siteId, workOrderId: input.workOrderId, outcome: input.outcome,
    reason: context.outcomeReasonCodes[0] ?? null, expectedRevision: Number(context.workRevision), idempotencyKey: `review:${input.runId}` },
    { uid: input.workerId, role: "supervisor", authority: null, displayName: "LitterSpot Orchestrator", type: "orchestrator" }, input.requestId,
    { siteId: input.siteId, runId: input.runId, workerId: input.workerId, kind: "review", fingerprint,
      workOrderId: input.workOrderId, verificationId: context.verificationId, outcome: input.outcome });
}

export const resolveVerifiedWork = (input: { siteId: string; runId: string; workOrderId: string; workerId: string; requestId: string }) => applyReviewTool({ ...input, outcome: "passed" });
export const requestRework = (input: { siteId: string; runId: string; workOrderId: string; workerId: string; requestId: string }) => applyReviewTool({ ...input, outcome: "failed" });

export async function runReviewCycle(siteId: string, workOrderId: string, options: RunOptions = {}) {
  const workerId = options.workerId ?? "v2-review-worker";
  const { runId } = await createReviewRun(siteId, workOrderId, workerId, options.triggerType, options.sourceEventId);
  try {
    const context = await getReviewContext(siteId, runId, workOrderId, workerId);
    if (context.verificationOutcome === "inconclusive") {
      await notifySiteSupervisors({ siteId, type: "verification_inconclusive", eventKey: context.verificationId,
        title: "Cleaning review needs attention", body: "Evidence is inconclusive. A Supervisor must review this task.", entityType: "work_order",
        entityId: workOrderId, cameraId: null, alertId: context.alertId, workOrderId, severity: null, isSimulation: false });
      await finishRun(runId, { status: "exhausted", resultCode: "needs_supervisor", workOrderId });
      await recordSystemEvent(siteId, "orchestrator_review_inconclusive");
    } else {
      await applyReviewTool({ siteId, runId, workOrderId, workerId, outcome: context.verificationOutcome, requestId: options.requestId ?? runId });
      await recoverOrchestratorSystemEvents(siteId, "review").catch(() => undefined);
    }
  } catch (error) {
    await finishRun(runId, { status: "cancelled", resultCode: error instanceof OrchestrationConflict ? error.code : "review_stopped" });
    if (!(error instanceof OrchestrationConflict)) await recordSystemEvent(siteId, "orchestrator_review_failed");
  }
  return getOrchestratorRun(siteId, runId);
}

export async function recoverOrchestratorRuns(limit = 100) {
  const snapshot = await firestore.collection("orchestratorRuns").where("status", "==", "running").limit(limit).get();
  let recovered = 0;
  for (const run of snapshot.docs) {
    if (run.data().schemaVersion !== 2) continue;
    const lease = run.data().leaseExpiresAt;
    if (!(lease instanceof Timestamp) || lease.toMillis() > Date.now()) continue;
    await finishRun(run.id, { status: "failed", resultCode: "lease_expired", errorCode: "lease_expired", errorMessage: "Worker lease expired before completion.", onlyIfExpired: true });
    recovered += 1;
  }
  return recovered;
}
