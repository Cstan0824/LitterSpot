import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { runAssignmentCycle, runReviewCycle, recoverOrchestratorRuns } from "./orchestratorService.js";
import { enqueueScheduledAssignmentTrigger } from "./orchestratorTriggers.js";
import type { AssignmentSelector } from "./orchestratorProvider.js";

const workerId = `local-worker:${process.pid}`;
let timer: NodeJS.Timeout | null = null;
let processing = false;
let lastScheduledScanBucket: number | null = null;

async function claimEvent(eventId: string) {
  const reference = firestore.collection("orchestratorOutbox").doc(eventId);
  const token = randomUUID();
  return firestore.runTransaction(async (transaction) => {
    const event = await transaction.get(reference);
    if (!event.exists || event.data()?.schemaVersion !== 2) return null;
    const data = event.data()!;
    const expiry = data.claimExpiresAt instanceof Timestamp ? data.claimExpiresAt : null;
    if (data.status !== "pending" && !(data.status === "claimed" && expiry && expiry.toMillis() <= Date.now())) return null;
    transaction.update(reference, { status: "claimed", claimTokenHash: token, claimedBy: workerId, claimExpiresAt: Timestamp.fromMillis(Date.now() + 300_000), deliveryAttempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    return { reference, token, data };
  });
}

async function completeTrigger(claim: NonNullable<Awaited<ReturnType<typeof claimEvent>>>, status: "completed" | "failed" | "pending" | "cancelled", runId: string | null, errorCode: string | null) {
  await firestore.runTransaction(async (transaction) => {
    const latest = await transaction.get(claim.reference);
    if (!latest.exists || latest.data()?.claimTokenHash !== claim.token || latest.data()?.claimedBy !== workerId) return;
    transaction.update(claim.reference, { status, runId, lastErrorCode: errorCode, claimTokenHash: null, claimedBy: null, claimExpiresAt: null, availableAt: status === "pending" ? Timestamp.fromMillis(Date.now() + 30_000) : latest.data()?.availableAt, updatedAt: FieldValue.serverTimestamp() });
  });
}

async function scheduleWaitingSites() {
  const bucket = Math.floor(Date.now() / 300_000);
  if (bucket === lastScheduledScanBucket) return;
  lastScheduledScanBucket = bucket;
  const alerts = await firestore.collection("alerts").where("status", "==", "waiting_for_cleaner").limit(500).get();
  const siteIds = [...new Set(alerts.docs.filter((document) => document.data().schemaVersion === 2 && document.data().managementMode === "orchestrated").map((document) => String(document.data().siteId)))];
  await Promise.all(siteIds.map((siteId) => enqueueScheduledAssignmentTrigger(siteId)));
}

export async function processOrchestratorTriggers(limit = 10, options: { selector?: AssignmentSelector; sleep?: (milliseconds: number) => Promise<void>; now?: Date; scheduleScan?: boolean; siteId?: string } = {}) {
  if (processing) return 0;
  processing = true;
  let processed = 0;
  try {
    await recoverOrchestratorRuns();
    if (options.scheduleScan !== false) await scheduleWaitingSites();
    let query = firestore.collection("orchestratorOutbox").where("status", "in", ["pending", "claimed"]).limit(100);
    if (options.siteId) query = query.where("siteId", "==", options.siteId);
    const events = await query.get();
    const candidates = events.docs.filter((document) => {
      const data = document.data();
      const availableAt = data.availableAt instanceof Timestamp ? data.availableAt.toMillis() : 0;
      const claimExpiry = data.claimExpiresAt instanceof Timestamp ? data.claimExpiresAt.toMillis() : 0;
      return data.schemaVersion === 2
        && !data.isRunRecord
        && ["assign_alert", "retry_waiting_alerts", "review_work"].includes(String(data.type))
        && availableAt <= Date.now()
        && (data.status === "pending" || claimExpiry <= Date.now());
    }).slice(0, limit);
    for (const event of candidates) {
      const claim = await claimEvent(event.id);
      if (!claim) continue;
      try {
        if (claim.data.runId) {
          const previous = await firestore.collection("orchestratorRuns").doc(String(claim.data.runId)).get();
          if (previous.data()?.status === "succeeded" || previous.data()?.resultCode === "needs_supervisor") {
            await completeTrigger(claim, "completed", previous.id, null); processed++; continue;
          }
          if (previous.data()?.status === "running") {
            await completeTrigger(claim, "pending", previous.id, "run_in_progress"); processed++; continue;
          }
        }
        const runOptions = { workerId, triggerType: String(claim.data.triggerType), requestId: event.id, sourceEventId: event.id, selector: options.selector, sleep: options.sleep, now: options.now };
        const result = claim.data.type === "review_work"
          ? await runReviewCycle(String(claim.data.siteId), String(claim.data.aggregateId), runOptions)
          : await runAssignmentCycle(String(claim.data.siteId), runOptions);
        const cancelled = result.run.status === "cancelled";
        const retryable = cancelled && ["automation_paused", "configuration_changed", "lease_expired", "context_changed", "alert_changed", "map_changed"].includes(result.run.resultCode);
        await completeTrigger(claim, retryable ? "pending" : cancelled ? "cancelled" : result.run.status === "failed" ? "failed" : "completed", String(result.run.id), result.run.errorCode ?? null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable = message.includes("paused") || message.includes("disabled") || message.includes("site_run_busy");
        await completeTrigger(claim, retryable ? "pending" : "cancelled", null, retryable ? "execution_blocked" : "execution_failed");
      }
      processed += 1;
    }
    return processed;
  } finally {
    processing = false;
  }
}

export function startOrchestratorWorker() {
  if (timer) return;
  const tick = () => { void processOrchestratorTriggers().catch(() => console.error(JSON.stringify({ event: "orchestrator_worker_failed" }))); };
  tick();
  timer = setInterval(tick, 5_000);
  timer.unref();
}

export function stopOrchestratorWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
