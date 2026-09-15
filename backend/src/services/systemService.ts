import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { canonicalHash } from "./persistence.js";
import { serializeFirestore } from "./presentation.js";
import { getOrchestratorConfig, listOrchestratorRunsPage } from "./orchestratorService.js";

/** Text comes from this catalogue, never a provider exception or raw model response. */
const catalogue = {
  assignment_failed: { component: "orchestrator", message: "Automatic assignment needs attention." },
  orchestrator_no_available_cleaner: { component: "orchestrator", message: "Alerts are waiting because no Cleaner is currently available." },
  orchestrator_provider_unavailable: { component: "orchestrator", message: "The assignment provider did not respond successfully after its retries." },
  orchestrator_invalid_selection: { component: "orchestrator", message: "The assignment provider repeatedly selected an invalid Alert and Cleaner pair." },
  orchestrator_assignment_failed: { component: "orchestrator", message: "Automatic assignment stopped before it could create Work." },
  orchestrator_review_inconclusive: { component: "orchestrator", message: "A cleaning review needs a Supervisor decision." },
  orchestrator_review_failed: { component: "orchestrator", message: "Automatic cleaning review stopped before it could decide the Work outcome." },
  site_operation_failed: { component: "site_operations", message: "Site cleanup needs to be retried." },
} as const;

export type SystemEventCode = keyof typeof catalogue;
const assignmentFailureCodes: SystemEventCode[] = [
  "assignment_failed",
  "orchestrator_no_available_cleaner",
  "orchestrator_provider_unavailable",
  "orchestrator_invalid_selection",
  "orchestrator_assignment_failed",
];
const reviewFailureCodes: SystemEventCode[] = [
  "orchestrator_review_inconclusive",
  "orchestrator_review_failed",
];

export async function recordSystemEvent(siteId: string, code: SystemEventCode, recovered = false) {
  const ref = firestore.collection("systemEvents").doc(canonicalHash("v2-system-event", siteId, code));
  await firestore.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (recovered && !current.exists) return;
    tx.set(ref, {
      schemaVersion: 2, siteId, eventKey: ref.id, code, ...catalogue[code], severity: "warning", status: recovered ? "recovered" : "open",
      occurrenceCount: Number(current.data()?.occurrenceCount ?? 0) + (recovered ? 0 : 1),
      firstOccurredAt: current.data()?.firstOccurredAt ?? FieldValue.serverTimestamp(), lastOccurredAt: recovered ? current.data()?.lastOccurredAt : FieldValue.serverTimestamp(),
      recoveredAt: recovered ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function recoverOrchestratorSystemEvents(siteId: string, runType: "assignment" | "review") {
  const codes = runType === "assignment" ? assignmentFailureCodes : reviewFailureCodes;
  await Promise.all(codes.map((code) => recordSystemEvent(siteId, code, true)));
}

export async function getSystemView(siteId: string) {
  const [config, runPage, events, waitingAlerts, awaitingReviewWork] = await Promise.all([
    getOrchestratorConfig(siteId), listOrchestratorRunsPage(siteId, { limit: 25 }),
    firestore.collection("systemEvents").where("siteId", "==", siteId).where("schemaVersion", "==", 2).get(),
    firestore.collection("alerts").where("siteId", "==", siteId).where("schemaVersion", "==", 2).where("status", "==", "waiting_for_cleaner").count().get(),
    firestore.collection("workOrders").where("siteId", "==", siteId).where("schemaVersion", "==", 2).where("status", "==", "awaiting_review").count().get(),
  ]);
  const observedAt = new Date().toISOString();
  // A no-waiting-alerts Run is a durable worker check, not an assignment or
  // review decision. Keep it in the Run ledger for diagnostics, but do not
  // present it as Supervisor decision activity.
  const decisionRuns = runPage.items.filter((run) => run.resultCode !== "no_waiting_alerts").slice(0, 20);
  const persistedEvents = events.docs.map(doc => serializeFirestore({ id: doc.id, ...doc.data() }));
  const runtimeEvents = config.status === "running" && !env.orchestratorWorkerEnabled ? [{
    id: `runtime-worker-disabled:${siteId}`,
    schemaVersion: 2,
    siteId,
    code: "orchestrator_worker_disabled",
    component: "orchestrator",
    severity: "warning",
    status: "open",
    occurrenceCount: 1,
    message: "The Site Orchestrator is running, but this Node process has its background worker disabled.",
    firstOccurredAt: observedAt,
    lastOccurredAt: observedAt,
    recoveredAt: null,
    updatedAt: observedAt,
    derivedFromRuntime: true,
  }] : [];
  return {
    configuration: config,
    runtime: {
      backgroundWorkerEnabled: env.orchestratorWorkerEnabled,
      observedAt,
      providerConnectivity: "not_probed",
      backlog: {
        waitingAlertCount: waitingAlerts.data().count,
        awaitingReviewWorkOrderCount: awaitingReviewWork.data().count,
      },
    },
    controlHistory: Array.isArray(config.controlHistory) ? [...config.controlHistory].reverse() : [],
    recentRuns: decisionRuns.map(run => ({
      id: run.id, type: run.type, status: run.status, resultCode: run.resultCode, selectedAlertId: run.selectedAlertId,
      selectedCleanerId: run.selectedCleanerId, workOrderId: run.workOrderId, provider: run.provider, model: run.model,
      decisionSummary: run.decisionSummary, decisionFactors: run.decisionFactors, isSimulation: run.isSimulation,
      references: run.references,
      providerRequestCount: Number(run.providerRequestCount ?? 0),
      retryCount: Math.max(0, Number(run.providerRequestCount ?? 0) - 1),
      candidateAttemptCount: Number(run.candidateAttemptCount ?? 0),
      toolCallCount: Number(run.toolCallCount ?? 0),
      errorCode: run.errorCode, startedAt: run.startedAt, completedAt: run.completedAt, createdAt: run.createdAt,
    })),
    recentRunsPage: { nextCursor: runPage.nextCursor, hasMore: runPage.hasMore, totalCount: runPage.totalCount ?? runPage.items.length },
    events: [...runtimeEvents, ...persistedEvents].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""))),
  };
}
