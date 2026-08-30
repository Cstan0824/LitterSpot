import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { canonicalHash } from "./v2Persistence.js";

export function enqueueV2OrchestratorTriggerInTransaction(transaction: Transaction, input: {
  siteId: string;
  type: "assign_alert" | "retry_waiting_alerts" | "review_work";
  aggregateType: "site" | "alert" | "work_order";
  aggregateId: string;
  triggerType: string;
  uniquenessKey: string;
  verificationId?: string;
}) {
  const eventId = canonicalHash("v2-orchestrator-trigger", input.siteId, input.type, input.uniquenessKey);
  transaction.create(firestore.collection("orchestratorOutbox").doc(eventId), {
    schemaVersion: V2_SCHEMA_VERSION,
    eventId,
    siteId: input.siteId,
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    triggerType: input.triggerType,
    verificationId: input.verificationId ?? null,
    status: "pending",
    availableAt: FieldValue.serverTimestamp(),
    claimTokenHash: null,
    claimedBy: null,
    claimExpiresAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    runId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return eventId;
}

export async function enqueueV2ScheduledAssignmentTrigger(siteId: string, at = new Date()) {
  const fiveMinuteBucket = Math.floor(at.getTime() / 300_000);
  const eventId = canonicalHash("v2-orchestrator-trigger", siteId, "retry_waiting_alerts", `scheduled:${fiveMinuteBucket}`);
  await firestore.collection("orchestratorOutbox").doc(eventId).create({
    schemaVersion: V2_SCHEMA_VERSION,
    eventId,
    siteId,
    type: "retry_waiting_alerts",
    aggregateType: "site",
    aggregateId: siteId,
    triggerType: "scheduled_retry",
    status: "pending",
    availableAt: Timestamp.fromDate(at),
    claimTokenHash: null,
    claimedBy: null,
    claimExpiresAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    runId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 6) throw error;
  });
  return eventId;
}

export async function enqueueV2ImmediateAssignmentTrigger(siteId: string, triggerType: string, uniquenessKey: string) {
  const eventId = canonicalHash("v2-orchestrator-trigger", siteId, "retry_waiting_alerts", uniquenessKey);
  await firestore.collection("orchestratorOutbox").doc(eventId).create({
    schemaVersion: V2_SCHEMA_VERSION,
    eventId,
    siteId,
    type: "retry_waiting_alerts",
    aggregateType: "site",
    aggregateId: siteId,
    triggerType,
    status: "pending",
    availableAt: FieldValue.serverTimestamp(),
    claimTokenHash: null,
    claimedBy: null,
    claimExpiresAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    runId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 6) throw error;
  });
  return eventId;
}
