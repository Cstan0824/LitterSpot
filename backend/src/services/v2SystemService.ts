import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { canonicalHash } from "./v2Persistence.js";
import { v2Json } from "./v2Presentation.js";
import { getV2OrchestratorConfig, listV2OrchestratorRuns } from "./v2OrchestratorService.js";

/** Text comes from this catalogue, never a provider exception or raw model response. */
const catalogue = {
  assignment_failed: { component: "orchestrator", message: "Automatic assignment needs attention." },
  site_operation_failed: { component: "site_operations", message: "Site cleanup needs to be retried." },
} as const;

export async function recordV2SystemEvent(siteId: string, code: keyof typeof catalogue, recovered = false) {
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

export async function getV2SystemView(siteId: string) {
  const [config, runs, events] = await Promise.all([
    getV2OrchestratorConfig(siteId), listV2OrchestratorRuns(siteId, 20),
    firestore.collection("systemEvents").where("siteId", "==", siteId).where("schemaVersion", "==", 2).get(),
  ]);
  return {
    configuration: config,
    runtime: { backgroundWorkerEnabled: env.orchestratorWorkerEnabled, observedAt: new Date().toISOString(), providerConnectivity: "not_probed" },
    recentRuns: runs.slice(0, 20).map(run => ({
      id: run.id, type: run.type, status: run.status, resultCode: run.resultCode, selectedAlertId: run.selectedAlertId,
      selectedCleanerId: run.selectedCleanerId, workOrderId: run.workOrderId, provider: run.provider, model: run.model,
      decisionSummary: run.decisionSummary, decisionFactors: run.decisionFactors, isSimulation: run.isSimulation,
      errorCode: run.errorCode, startedAt: run.startedAt, completedAt: run.completedAt,
    })),
    events: events.docs.map(doc => v2Json({ id: doc.id, ...doc.data() })),
  };
}
