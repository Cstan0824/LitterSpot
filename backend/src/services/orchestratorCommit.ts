import { FieldValue, Timestamp, type Transaction, type DocumentData } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { canonicalHash } from "./persistence.js";

export class OrchestrationConflict extends HttpError {
  constructor(public readonly code: string) { super(409, `Orchestrator operation rejected: ${code}.`, { code }); }
}
export type OrchestrationCommand = {
  siteId: string; runId: string; workerId: string; kind: "assignment" | "review";
  fingerprint: string; contextHash?: string; alertId?: string; cleanerId?: string;
  workOrderId?: string; verificationId?: string; outcome?: string;
  rationaleSummary?: string; provider?: string; model?: string;
};

function ordered(value: any): any {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const assignmentContextHash = (snapshot: unknown) => canonicalHash("v2-assignment-context", ordered(snapshot));

export async function readOrchestrationGuard(tx: Transaction, command: OrchestrationCommand) {
  const runRef = firestore.collection("orchestratorRuns").doc(command.runId);
  const configRef = firestore.collection("orchestratorConfigs").doc(command.siteId);
  const [run, site, config] = await Promise.all([tx.get(runRef), tx.get(firestore.collection("sites").doc(command.siteId)), tx.get(configRef)]);
  const data = run.data();
  if (!data || data.schemaVersion !== 2 || data.siteId !== command.siteId || data.requestedWorkerId !== command.workerId || data.type !== command.kind) throw new HttpError(404, "Orchestrator Run not found.");
  if (data.commandResult) {
    if (data.commandFingerprint !== command.fingerprint) throw new OrchestrationConflict("command_replay_conflict");
    return { runRef, configRef, data, replay: data.commandResult as DocumentData };
  }
  if (data.status !== "running" || data.leaseOwner !== command.workerId || !(data.leaseExpiresAt instanceof Timestamp) || data.leaseExpiresAt.toMillis() <= Date.now()) throw new OrchestrationConflict("lease_expired");
  if (site.data()?.status !== "active") throw new OrchestrationConflict("site_inactive");
  if (config.data()?.status !== "running" || config.data()?.[command.kind === "assignment" ? "assignmentEnabled" : "reviewEnabled"] !== true) throw new OrchestrationConflict("automation_paused");
  if (config.data()?.activeRunId !== command.runId || Number(config.data()?.revision ?? 0) !== Number(data.configRevision)) throw new OrchestrationConflict("configuration_changed");
  if (command.kind === "assignment") {
    const snapshot = data.inputSnapshot;
    if (!snapshot || data.contextHash !== command.contextHash || assignmentContextHash(snapshot) !== command.contextHash) throw new OrchestrationConflict("context_changed");
    if (site.data()?.activeMapRevisionId !== snapshot.activeMapRevisionId) throw new OrchestrationConflict("map_changed");
    if (!snapshot.eligiblePairs?.some((p: any) => p.alertId === command.alertId && p.cleanerId === command.cleanerId)) throw new OrchestrationConflict("invalid_pair");
  } else if (data.workOrderId !== command.workOrderId || data.verificationId !== command.verificationId) throw new OrchestrationConflict("review_changed");
  return { runRef, configRef, data, replay: null };
}

/** Called after all reads, inside the same transaction as the Work mutation. */
export function commitOrchestration(tx: Transaction, guard: Awaited<ReturnType<typeof readOrchestrationGuard>>, command: OrchestrationCommand, result: DocumentData) {
  const data = guard.data;
  const pair = data.inputSnapshot?.eligiblePairs?.find((p: any) => p.alertId === command.alertId && p.cleanerId === command.cleanerId) ?? {};
  const code = command.kind === "assignment" ? "assigned" : command.outcome === "passed" ? "resolved" : "rework";
  tx.update(guard.runRef, {
    status: "succeeded", commandFingerprint: command.fingerprint, commandResult: result,
    selectedAlertId: command.alertId ?? data.alertId ?? null, alertId: command.alertId ?? data.alertId ?? null,
    selectedCleanerId: command.cleanerId ?? null, workOrderId: result.workOrder.id,
    decisionSummary: command.rationaleSummary ?? null, decisionFactors: pair,
    provider: command.provider ?? data.provider, model: command.model ?? data.model,
    isSimulation: Boolean(result.workOrder.isSimulation), resultCode: code,
    toolCallCount: FieldValue.increment(1),
    leaseOwner: null, leaseExpiresAt: null, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  tx.update(firestore.collection("orchestratorOutbox").doc(data.triggerEventId), {
    status: "completed", claimedBy: null, claimTokenHash: null, claimExpiresAt: null, updatedAt: FieldValue.serverTimestamp(),
  });
  tx.update(guard.configRef, { activeRunId: null, lastSuccessfulRunAt: FieldValue.serverTimestamp(), lastFailureCode: null, updatedAt: FieldValue.serverTimestamp() });
  tx.create(guard.runRef.collection("actions").doc("committed-command"), {
    schemaVersion: 2, siteId: command.siteId, runId: command.runId, sequence: 10000,
    tool: command.kind === "assignment" ? "assign_cleaner" : command.outcome === "passed" ? "resolve_verified_work" : "request_rework",
    inputSummary: { alertId: command.alertId ?? data.alertId ?? null, cleanerId: command.cleanerId ?? null, verificationId: command.verificationId ?? null },
    outcome: "succeeded", resultSummary: { workOrderId: result.workOrder.id, status: result.workOrder.status },
    startedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(), errorCode: null,
  });
}
