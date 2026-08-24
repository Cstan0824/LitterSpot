import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { OrchestratorClaimInput, OrchestratorCompletionInput, OrchestratorDecisionInput, OrchestratorRunStatus, OrchestratorWorkOrderInput } from "../schemas/orchestrator.js";
import { HttpError } from "../shared/httpError.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { createWorkOrder, listWorkOrders } from "./workOrderService.js";

const RUN_STATUSES: OrchestratorRunStatus[] = ["queued", "running", "waiting", "completed", "failed", "paused"];

function hash(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function instant(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}

function presentDocument(snapshot: DocumentSnapshot, label: string) {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return { id: snapshot.id, ...jsonValue(snapshot.data()) as Record<string, unknown> };
}

function presentRun(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) throw new HttpError(404, "Orchestrator run not found.");
  const data = snapshot.data()!;
  return {
    id: snapshot.id,
    alertId: String(data.alertId),
    threadKey: String(data.threadKey),
    status: String(data.status),
    triggerEventId: String(data.triggerEventId),
    attemptCount: Number(data.attemptCount ?? 0),
    currentWorkOrderId: data.currentWorkOrderId == null ? null : String(data.currentWorkOrderId),
    workerId: data.workerId == null ? null : String(data.workerId),
    leaseExpiresAt: instant(data.leaseExpiresAt),
    lastError: data.lastError ?? null,
    result: data.result ?? null,
    createdAt: instant(data.createdAt),
    updatedAt: instant(data.updatedAt),
    completedAt: instant(data.completedAt),
  };
}

export function orchestratorRunId(alertId: string) {
  return hash("orchestrator-run-v1", alertId);
}

export function orchestratorOutboxId(alertId: string) {
  return hash("orchestrator-outbox-v1", alertId);
}

/** Called only from the transaction that creates a newly confirmed alert. */
export function enqueueAlertOrchestratorInTransaction(transaction: Transaction, input: {
  alertId: string;
  siteId: string;
  zoneId: string;
  issueType: string;
}) {
  const runId = orchestratorRunId(input.alertId);
  const outboxId = orchestratorOutboxId(input.alertId);
  const runReference = firestore.collection("orchestratorRuns").doc(runId);
  const outboxReference = firestore.collection("orchestratorOutbox").doc(outboxId);
  transaction.create(runReference, {
    alertId: input.alertId,
    threadKey: `alert:${input.alertId}`,
    status: "queued",
    triggerEventId: outboxId,
    siteId: input.siteId,
    zoneId: input.zoneId,
    issueType: input.issueType,
    attemptCount: 0,
    workerId: null,
    claimToken: null,
    leaseExpiresAt: null,
    currentWorkOrderId: null,
    lastError: null,
    result: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: null,
  });
  transaction.create(outboxReference, {
    type: "alert_confirmed",
    alertId: input.alertId,
    runId,
    status: "pending",
    attemptCount: 0,
    workerId: null,
    claimToken: null,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: null,
  });
  return { runId, outboxId };
}

export async function getOrchestratorRun(runId: string) {
  return presentRun(await firestore.collection("orchestratorRuns").doc(runId).get());
}

export async function assertActiveOrchestratorClaim(runId: string, claimToken: string, workerId: string) {
  const snapshot = await firestore.collection("orchestratorRuns").doc(runId).get();
  if (!snapshot.exists) throw new HttpError(404, "Orchestrator run not found.");
  const data = snapshot.data()!;
  const lease = data.leaseExpiresAt instanceof Timestamp ? data.leaseExpiresAt : null;
  if (data.status !== "running" || data.workerId !== workerId || data.claimToken !== claimToken
    || !lease || lease.toMillis() <= Date.now()) {
    throw new HttpError(409, "Orchestrator run claim is no longer valid.");
  }
  return presentRun(snapshot);
}

export async function ensureOrchestratorRun(alertId: string) {
  const alertReference = firestore.collection("alerts").doc(alertId);
  const alert = await alertReference.get();
  if (!alert.exists) throw new HttpError(404, "Alert not found.");
  const data = alert.data()!;
  if (!["new", "acknowledged", "in_progress"].includes(String(data.status))) {
    throw new HttpError(409, "Only active alerts can start orchestration.");
  }
  const runId = orchestratorRunId(alertId);
  const outboxId = orchestratorOutboxId(alertId);
  const runReference = firestore.collection("orchestratorRuns").doc(runId);
  const outboxReference = firestore.collection("orchestratorOutbox").doc(outboxId);
  const result = await firestore.runTransaction(async (transaction) => {
    const [run, outbox] = await Promise.all([transaction.get(runReference), transaction.get(outboxReference)]);
    if (run.exists && outbox.exists) return true;
    if (run.exists !== outbox.exists) throw new HttpError(409, "Orchestrator run and trigger are inconsistent.");
    enqueueAlertOrchestratorInTransaction(transaction, {
      alertId,
      siteId: String(data.siteId),
      zoneId: String(data.zoneId),
      issueType: String(data.issueType),
    });
    return false;
  });
  return { run: await getOrchestratorRun(runId), outboxId, idempotent: result };
}

export async function listOrchestratorRuns(input: { status: OrchestratorRunStatus | "all"; alertId?: string; limit: number; cursor?: string }) {
  let query = firestore.collection("orchestratorRuns");
  if (input.alertId) query = query.where("alertId", "==", input.alertId) as typeof query;
  else if (input.status !== "all") query = query.where("status", "==", input.status) as typeof query;
  return queryCursorPage({
    query,
    resource: "orchestrator-runs",
    orderField: "createdAt",
    filters: { status: input.status, alertId: input.alertId },
    limit: input.limit,
    cursor: input.cursor,
    present: presentRun,
  });
}

export async function claimOrchestratorRun(runId: string, input: OrchestratorClaimInput) {
  const runReference = firestore.collection("orchestratorRuns").doc(runId);
  const claimToken = randomUUID();
  const outcome = await firestore.runTransaction(async (transaction) => {
    const run = await transaction.get(runReference);
    if (!run.exists) throw new HttpError(404, "Orchestrator run not found.");
    const data = run.data()!;
    const status = String(data.status);
    const lease = data.leaseExpiresAt instanceof Timestamp ? data.leaseExpiresAt : null;
    const leaseActive = status === "running" && lease && lease.toMillis() > Date.now();
    if (leaseActive) throw new HttpError(409, "Orchestrator run is already claimed.");
    if (!["queued", "failed", "waiting", "running"].includes(status)) {
      throw new HttpError(409, `Orchestrator run cannot be claimed from ${status}.`);
    }
    const outboxReference = firestore.collection("orchestratorOutbox").doc(String(data.triggerEventId));
    const outbox = await transaction.get(outboxReference);
    if (!outbox.exists) throw new HttpError(409, "Orchestrator trigger event is missing.");
    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + input.leaseSeconds * 1_000);
    transaction.update(runReference, {
      status: "running",
      workerId: input.workerId,
      claimToken,
      leaseExpiresAt,
      attemptCount: FieldValue.increment(1),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });
    transaction.update(outboxReference, {
      status: "claimed",
      workerId: input.workerId,
      claimToken,
      leaseExpiresAt,
      attemptCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });
    return { claimToken };
  });
  return { run: await getOrchestratorRun(runId), claimToken: outcome.claimToken };
}

export async function completeOrchestratorRun(runId: string, input: OrchestratorCompletionInput) {
  if (!["queued", "waiting", "completed", "failed"].includes(input.status)) {
    throw new HttpError(400, "A worker may only queue, wait, complete, or fail a run.");
  }
  const runReference = firestore.collection("orchestratorRuns").doc(runId);
  await firestore.runTransaction(async (transaction) => {
    const run = await transaction.get(runReference);
    if (!run.exists) throw new HttpError(404, "Orchestrator run not found.");
    const data = run.data()!;
    if (data.status !== "running" || data.claimToken !== input.claimToken || data.workerId !== input.workerId) {
      throw new HttpError(409, "Orchestrator run claim is no longer valid.");
    }
    const outboxReference = firestore.collection("orchestratorOutbox").doc(String(data.triggerEventId));
    const outbox = await transaction.get(outboxReference);
    if (!outbox.exists || outbox.data()?.claimToken !== input.claimToken) throw new HttpError(409, "Orchestrator trigger claim is no longer valid.");
    const terminal = input.status === "completed";
    const failed = input.status === "failed";
    const error = failed ? { code: input.errorCode, message: input.errorMessage ?? null, occurredAt: FieldValue.serverTimestamp() } : null;
    transaction.update(runReference, {
      status: input.status,
      claimToken: null,
      leaseExpiresAt: null,
      lastError: error,
      result: input.result ?? null,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: terminal ? FieldValue.serverTimestamp() : null,
    });
    transaction.update(outboxReference, {
      status: terminal ? "completed" : failed ? "failed" : "pending",
      claimToken: null,
      leaseExpiresAt: null,
      lastError: error,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: terminal ? FieldValue.serverTimestamp() : null,
    });
  });
  return getOrchestratorRun(runId);
}

export async function recoverOrchestratorRuns(limit = 100) {
  const snapshot = await firestore.collection("orchestratorRuns").where("status", "==", "running").limit(limit).get();
  let recovered = 0;
  for (const run of snapshot.docs) {
    const lease = run.data().leaseExpiresAt;
    if (!(lease instanceof Timestamp) || lease.toMillis() > Date.now()) continue;
    await firestore.runTransaction(async (transaction) => {
      const latest = await transaction.get(run.ref);
      const latestLease = latest.data()?.leaseExpiresAt;
      if (!latest.exists || latest.data()?.status !== "running" || !(latestLease instanceof Timestamp) || latestLease.toMillis() > Date.now()) return;
      const outboxReference = firestore.collection("orchestratorOutbox").doc(String(latest.data()!.triggerEventId));
      transaction.update(run.ref, {
        status: "queued",
        workerId: null,
        claimToken: null,
        leaseExpiresAt: null,
        lastError: { code: "lease_expired", message: "Worker lease expired before completion.", occurredAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(outboxReference, {
        status: "pending",
        workerId: null,
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      recovered += 1;
    });
  }
  return recovered;
}

export async function recordOrchestratorDecision(runId: string, input: OrchestratorDecisionInput, workerId: string) {
  const runReference = firestore.collection("orchestratorRuns").doc(runId);
  const decisionId = hash("orchestrator-decision-v1", runId, input.actionId);
  const decisionReference = firestore.collection("orchestratorDecisions").doc(decisionId);
  const fingerprint = hash("orchestrator-decision-fingerprint-v1", JSON.stringify(input));
  const outcome = await firestore.runTransaction(async (transaction) => {
    const [run, existing] = await Promise.all([transaction.get(runReference), transaction.get(decisionReference)]);
    if (!run.exists) throw new HttpError(404, "Orchestrator run not found.");
    if (run.data()?.status !== "running" || run.data()?.workerId !== workerId || run.data()?.claimToken !== input.claimToken) {
      throw new HttpError(409, "Orchestrator run claim is required for a decision.");
    }
    if (existing.exists) {
      if (existing.data()?.fingerprint !== fingerprint) throw new HttpError(409, "Decision idempotency key conflicts with another action.");
      return true;
    }
    transaction.create(decisionReference, {
      runId,
      alertId: String(run.data()!.alertId),
      actionId: input.actionId,
      toolName: input.toolName,
      outcome: input.outcome,
      input: input.input,
      result: input.result ?? null,
      rationale: input.rationale ?? null,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      workerId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return false;
  });
  return { decisionId, idempotent: outcome };
}

export async function getOrchestratorAlertContext(alertId: string) {
  const alertReference = firestore.collection("alerts").doc(alertId);
  const [alert, history, occurrences, workOrders] = await Promise.all([
    alertReference.get(),
    alertReference.collection("statusHistory").orderBy("changedAt", "desc").limit(25).get(),
    alertReference.collection("occurrences").orderBy("capturedAt", "desc").limit(25).get(),
    listWorkOrders({ alertId, status: "all", limit: 25 }),
  ]);
  return {
    alert: presentDocument(alert, "Alert"),
    history: history.docs.map((item) => presentDocument(item, "Alert history")),
    occurrences: occurrences.docs.map((item) => presentDocument(item, "Alert occurrence")),
    workOrders: workOrders.items,
  };
}

export async function listEligibleCleanersForAlert(alertId: string) {
  const alert = await firestore.collection("alerts").doc(alertId).get();
  if (!alert.exists) throw new HttpError(404, "Alert not found.");
  const data = alert.data()!;
  const [cleaners, presences] = await Promise.all([
    firestore.collection("cleaners").where("status", "==", "active").limit(200).get(),
    firestore.collection("cleanerPresence").limit(200).get(),
  ]);
  const presenceByCleaner = new Map(presences.docs.map((item) => [item.id, item.data()]));
  const now = Date.now();
  return cleaners.docs.map((cleaner) => {
    const item = cleaner.data();
    const presence = presenceByCleaner.get(cleaner.id);
    const sites = Array.isArray(item.permittedSiteIds) ? item.permittedSiteIds.map(String) : [String(item.assignedSiteId)];
    const zones = Array.isArray(item.permittedZoneIds) ? item.permittedZoneIds.map(String) : [String(item.assignedZoneId)];
    const capabilities = Array.isArray(item.capabilities) ? item.capabilities.map(String) : ["general_cleaning"];
    const heartbeat = presence?.lastHeartbeatAt instanceof Timestamp ? presence.lastHeartbeatAt : null;
    const locationStatus = !heartbeat ? "unavailable" : now - heartbeat.toMillis() <= 5 * 60_000 ? "fresh" : "stale";
    const eligible = item.accountStatus === "active" && typeof item.authUid === "string"
      && sites.includes(String(data.siteId)) && zones.includes(String(data.zoneId))
      && (capabilities.includes("general_cleaning") || capabilities.includes(String(data.issueType)))
      && presence?.availability === "online" && locationStatus === "fresh" && !presence?.activeWorkOrderId;
    return {
      cleanerId: cleaner.id,
      fullName: String(item.fullName),
      staffCode: String(item.staffCode),
      availability: String(presence?.availability ?? "offline"),
      locationStatus,
      activeWorkOrderId: presence?.activeWorkOrderId == null ? null : String(presence.activeWorkOrderId),
      capabilities,
      permittedSiteIds: sites,
      permittedZoneIds: zones,
      eligible,
      ineligibilityReasons: eligible ? [] : [
        ...(item.accountStatus !== "active" || typeof item.authUid !== "string" ? ["account_not_active"] : []),
        ...(!sites.includes(String(data.siteId)) || !zones.includes(String(data.zoneId)) ? ["not_permitted"] : []),
        ...(!(capabilities.includes("general_cleaning") || capabilities.includes(String(data.issueType))) ? ["capability_missing"] : []),
        ...(presence?.availability !== "online" ? ["not_online"] : []),
        ...(locationStatus !== "fresh" ? [`location_${locationStatus}`] : []),
        ...(presence?.activeWorkOrderId ? ["active_work_order"] : []),
      ],
    };
  });
}

export async function createOrchestratorWorkOrder(input: OrchestratorWorkOrderInput, workerId: string) {
  const run = await getOrchestratorRun(input.runId);
  if (run.alertId !== input.alertId) throw new HttpError(409, "Work-order alert does not belong to this orchestrator run.");
  if (run.status !== "running" || run.workerId !== workerId || run.leaseExpiresAt === null) throw new HttpError(409, "Orchestrator run must be claimed before it can assign work.");
  const rawRun = await firestore.collection("orchestratorRuns").doc(input.runId).get();
  if (rawRun.data()?.claimToken !== input.claimToken) throw new HttpError(409, "Orchestrator run claim is no longer valid.");
  const result = await createWorkOrder({
    alertId: input.alertId,
    assignedCleanerId: input.assignedCleanerId,
    instructions: input.instructions,
    assignmentDecisionId: input.decisionId,
    idempotencyKey: input.idempotencyKey,
    overrideAvailability: input.overrideAvailability,
  }, { type: "orchestrator", id: workerId });
  const recorded = await recordOrchestratorDecision(input.runId, {
    claimToken: input.claimToken,
    actionId: input.decisionId,
    toolName: "create_work_order",
    outcome: "succeeded",
    input: {
      alertId: input.alertId,
      assignedCleanerId: input.assignedCleanerId,
      overrideAvailability: input.overrideAvailability,
    },
    result: { workOrderId: result.workOrder.id },
    rationale: input.rationale,
    idempotencyKey: input.idempotencyKey,
  }, workerId);
  await firestore.collection("orchestratorRuns").doc(input.runId).update({ currentWorkOrderId: result.workOrder.id, updatedAt: FieldValue.serverTimestamp() });
  return { ...result, decisionId: recorded.decisionId };
}

export function isKnownOrchestratorRunStatus(value: string): value is OrchestratorRunStatus {
  return RUN_STATUSES.includes(value as OrchestratorRunStatus);
}
