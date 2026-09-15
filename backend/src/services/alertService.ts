import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";
import { HttpError } from "../shared/httpError.js";
import { SCHEMA_VERSION } from "../shared/firestoreSchema.js";
import { writeMedia } from "./localMediaStorage.js";
import { qualifiesIssue, priorityScore, type IssueType } from "./alertPolicy.js";
import { getLiveIssueState } from "./liveMonitoringService.js";
import { canonicalHash, recordKeyHash } from "./persistence.js";
import { enqueueOrchestratorTriggerInTransaction } from "./orchestratorTriggers.js";
import { notifySiteSupervisors } from "./notificationService.js";
import { runtimeEpisode, updateCameraRuntimeSnapshot } from "./monitoringRuntimeRegistry.js";
import { publishCameraWorkflow } from "./cameraLiveEvents.js";

const threshold = 0.5;
const activeStatuses = ["waiting_for_cleaner", "assigned", "in_progress", "awaiting_review"];
const timestamp = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
type ConfirmedIssue = { alertId: string | null; condition: string; severity: "warning" | "critical" };
const confirmedIssues = new Map<string, ConfirmedIssue>();

export function resetAlertQualification(cameraId?: string) {
  for (const key of confirmedIssues.keys()) if (!cameraId || key.includes(`:${cameraId}:`)) confirmedIssues.delete(key);
}

async function persistEvidence(input: { siteId: string; cameraId: string; alertId: string; candidate: NonNullable<ReturnType<typeof getLiveIssueState>["candidate"]> }) {
  const mediaId = randomUUID(); const ext = input.candidate.mimeType === "image/png" ? "png" : input.candidate.mimeType === "image/webp" ? "webp" : "jpg"; const storageKey = `media/${mediaId}/alert-evidence.${ext}`;
  await writeMedia(storageKey, input.candidate.frame);
  await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: SCHEMA_VERSION, mediaId, siteId: input.siteId, purpose: "alert_evidence", ownerType: "alert", ownerId: input.alertId, cameraId: input.cameraId, mimeType: input.candidate.mimeType, originalFileName: `alert-evidence.${ext}`, byteSize: input.candidate.frame.length, sha256: canonicalHash("evidence", input.candidate.frame.toString("base64")), storageKey, storageStatus: "available", width: input.candidate.observation.image?.width ?? null, height: input.candidate.observation.image?.height ?? null, evidenceObservation: input.candidate.observation, durationSeconds: null, capturedAt: Timestamp.fromMillis(input.candidate.observation.capturedAtMs), retentionClass: "operational", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: null, deletedAt: null, revision: 1 });
  return mediaId;
}

export async function evaluateAlertsForCamera(siteId: string, cameraId: string, episodeId: string) {
  const episode = runtimeEpisode(episodeId);
  if (!episode || episode.ended || episode.siteId !== siteId || episode.cameraId !== cameraId) throw new HttpError(404, "Camera monitoring context not found.");
  const outcomes: Array<{ issueType: IssueType; flagId: string; alertId: string | null; created: boolean }> = [];
  for (const issueType of ["floor_litter", "floor_spill", "bin_service"] as const) {
    const state = getLiveIssueState(siteId, cameraId, issueType); const current = state.observations.at(-1); if (!current) continue;
    const observations = state.observations.map((observation) => ({ capturedAtMs: observation.capturedAtMs, positive: observation.issues.some((issue) => issue.issueType === issueType && issue.confidence >= threshold) }));
    const confirmationKey = `${siteId}:${cameraId}:${episodeId}:${issueType}`;
    const matches = current.issues.filter((issue) => issue.issueType === issueType && issue.confidence >= threshold);
    if (!qualifiesIssue(issueType, observations, current.capturedAtMs) || matches.length === 0) { confirmedIssues.delete(confirmationKey); continue; }
    const best = matches.sort((a, b) => b.confidence - a.confidence)[0];
    const severity = best.condition === "overflow" || issueType === "floor_spill" ? "critical" as const : "warning" as const;
    const confirmed = confirmedIssues.get(confirmationKey);
    const materiallyChanged = !confirmed || confirmed.severity !== severity || confirmed.condition !== best.condition;
    if (!materiallyChanged) continue;
    const flagId = recordKeyHash("flag", cameraId, current.sampleId, issueType); const flagRef = firestore.collection("flags").doc(flagId);
    const flagData = { schemaVersion: SCHEMA_VERSION, flagId, siteId, mapRevisionId: episode.mapRevisionId, zoneId: episode.zoneId, zoneNameSnapshot: episode.zoneName, cameraId, cameraNameSnapshot: episode.cameraName, registrationRevisionId: episode.registrationRevisionId, monitoringEpisodeId: episodeId, sampleId: current.sampleId, issueType, observedCondition: best.condition, severityCandidate: severity, confidence: best.confidence, magnitude: { issueCount: matches.length }, affectedBinIds: matches.filter((item) => issueType === "bin_service").map((item) => item.entityId), detections: matches.map((item) => ({ entityId: item.entityId, confidence: item.confidence, condition: item.condition, geometry: item.geometry })), modelVersions: current.modelVersions, qualificationPolicyVersion: "grouped-temporal", qualificationSnapshot: { threshold, issueCount: matches.length, observationCount: observations.length }, capturedAt: Timestamp.fromMillis(current.capturedAtMs), isSimulation: current.isSimulation, alertId: null, createdAt: FieldValue.serverTimestamp() };
    const activeKeyId = recordKeyHash("active-alert", siteId, cameraId, issueType); const keyRef = firestore.collection("activeAlertKeys").doc(activeKeyId); const existingKey = await keyRef.get(); const alertId = existingKey.exists ? String(existingKey.data()?.alertId) : firestore.collection("alerts").doc().id; const alertRef = firestore.collection("alerts").doc(alertId); const existingAlert = await alertRef.get();
    const candidate = state.candidate; let evidenceMediaId: string | null = null; const priorConfidence = Number(existingAlert.data()?.evidence?.confidence ?? -1); const strongerCondition = best.condition === "overflow" && existingAlert.data()?.observedCondition !== "overflow"; if (candidate && (candidate.confidence > priorConfidence || strongerCondition)) evidenceMediaId = await persistEvidence({ siteId, cameraId, alertId, candidate });
    const created = !existingAlert.exists;
    await firestore.runTransaction(async (transaction) => {
      const site = await transaction.get(firestore.collection("sites").doc(siteId));
      if (site.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
      const [key, alert] = await Promise.all([transaction.get(keyRef), transaction.get(alertRef)]);
      if (key.exists && key.data()?.alertId !== alertId) throw new HttpError(409, "Active Alert changed.");
      if (!key.exists) transaction.create(keyRef, { schemaVersion: SCHEMA_VERSION, siteId, cameraId, issueType, alertId, createdAt: FieldValue.serverTimestamp() });
      transaction.create(flagRef, { ...flagData, alertId });
      const prior = alert.data(); const nextSeverity = prior?.severity === "critical" ? "critical" : severity; const occurrenceCount = Number(prior?.occurrenceCount ?? 0) + 1;
      const evidenceValue = evidenceMediaId && candidate ? { mediaId: evidenceMediaId, flagId: recordKeyHash("flag", cameraId, candidate.observation.sampleId, issueType), capturedAt: Timestamp.fromMillis(candidate.observation.capturedAtMs), confidence: candidate.confidence, width: candidate.observation.image?.width ?? null, height: candidate.observation.image?.height ?? null, detections: candidate.observation.issues, people: candidate.observation.people, bins: candidate.observation.bins, observation: candidate.observation, coordinateSpace: "image_pixels", modelVersions: candidate.observation.modelVersions, selectionPolicyVersion: "highest-confidence" } : prior?.evidence ?? null;
      transaction.set(alertRef, { schemaVersion: SCHEMA_VERSION, alertId, siteId, mapRevisionId: episode.mapRevisionId, zoneId: episode.zoneId, zoneNameSnapshot: episode.zoneName, cameraId, cameraNameSnapshot: episode.cameraName, registrationRevisionId: episode.registrationRevisionId, issueType, observedCondition: best.condition, status: prior?.status ?? "waiting_for_cleaner", severity: nextSeverity, highestSeverity: nextSeverity, priorityScore: priorityScore({ severity: nextSeverity, createdAtMs: prior?.createdAt?.toMillis?.() ?? current.capturedAtMs, nowMs: current.capturedAtMs }), priorityPolicyVersion: "severity-age", nextEscalationAt: nextSeverity === "warning" ? Timestamp.fromMillis((prior?.createdAt?.toMillis?.() ?? current.capturedAtMs) + 15 * 60000) : null, firstDetectedAt: prior?.firstDetectedAt ?? Timestamp.fromMillis(current.capturedAtMs), lastDetectedAt: Timestamp.fromMillis(current.capturedAtMs), occurrenceCount, affectedBinIds: [...new Set([...(prior?.affectedBinIds ?? []), ...matches.filter((item) => issueType === "bin_service").map((item) => item.entityId)])], evidence: evidenceValue, activeWorkOrderId: prior?.activeWorkOrderId ?? null, managementMode: prior?.managementMode ?? "orchestrated", isSimulation: current.isSimulation, resolvedAt: null, resolvedBy: null, dismissedAt: null, dismissedBy: null, dismissReason: null, createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), revision: Number(prior?.revision ?? 0) + 1 }, { merge: false });
      transaction.set(alertRef.collection("occurrences").doc(flagId), { schemaVersion: SCHEMA_VERSION, siteId, alertId, flagId, capturedAt: Timestamp.fromMillis(current.capturedAtMs), confidence: best.confidence, observedCondition: best.condition, severityCandidate: severity, becameEvidence: Boolean(evidenceMediaId), createdAt: FieldValue.serverTimestamp() });
      const eventRef = alertRef.collection("events").doc(); transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, siteId, alertId, type: created ? "created" : prior?.severity !== nextSeverity ? "severity_changed" : "occurrence", fromStatus: null, toStatus: created ? "waiting_for_cleaner" : null, fromSeverity: prior?.severity ?? null, toSeverity: nextSeverity, workOrderId: null, actor: { type: "system", serviceId: "alert-policy", displayNameSnapshot: "Alert policy" }, fromCondition: prior?.observedCondition ?? null, toCondition: best.condition, reasonCode: best.condition, note: null, requestId: current.sampleId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
      if (created) enqueueOrchestratorTriggerInTransaction(transaction, { siteId, type: "assign_alert", aggregateType: "alert", aggregateId: alertId, triggerType: "alert_created", uniquenessKey: alertId });
    });
    confirmedIssues.set(confirmationKey, { alertId, condition: best.condition, severity });
    if (created || existingAlert.data()?.status === "waiting_for_cleaner") updateCameraRuntimeSnapshot(siteId, cameraId, { cleanlinessState: "alerted" });
    outcomes.push({ issueType, flagId, alertId, created });
    if (created && (await firestore.collection("orchestratorConfigs").doc(siteId).get()).data()?.status === "paused") {
      await notifySiteSupervisors({ siteId, type: "alert_waiting_orchestrator_paused", eventKey: alertId,
        title: "Alert waiting for assignment", body: "The Orchestrator is paused. Assign a Cleaner manually or resume automation.",
        entityType: "alert", entityId: alertId, cameraId, alertId, workOrderId: null, severity, isSimulation: current.isSimulation });
    }
  }
  return outcomes;
}

export async function ageAlerts(siteId: string, now = new Date()) {
  const snapshot = await firestore.collection("alerts").where("siteId", "==", siteId).limit(500).get();
  let changed = 0;
  const config = await firestore.collection("orchestratorConfigs").doc(siteId).get();
  for (const alert of snapshot.docs) {
    const result = await firestore.runTransaction(async tx => {
      const [current, site] = await Promise.all([tx.get(alert.ref), tx.get(firestore.collection("sites").doc(siteId))]);
      const data = current.data();
      if (!data || data.schemaVersion !== 2 || site.data()?.status !== "active" || !activeStatuses.includes(String(data.status))) return null;
      const createdAtMs = data.createdAt?.toMillis?.() ?? now.getTime();
      const severity = data.severity === "warning" && now.getTime() - createdAtMs >= 15 * 60000 ? "critical" : data.severity;
      const score = priorityScore({ severity, createdAtMs, nowMs: now.getTime() });
      if (severity === data.severity && score === data.priorityScore) return null;
      tx.update(alert.ref, { severity, highestSeverity: severity === "critical" ? "critical" : data.highestSeverity, priorityScore: score,
        nextEscalationAt: severity === "critical" ? null : data.nextEscalationAt, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
      if (severity !== data.severity) tx.create(alert.ref.collection("events").doc(), {
        schemaVersion: 2, siteId, alertId: alert.id, type: "severity_changed", fromStatus: data.status, toStatus: data.status,
        fromSeverity: data.severity, toSeverity: severity, actor: { type: "system", serviceId: "alert-aging" },
        reasonCode: "alert_age", requestId: `aging:${now.toISOString()}`, occurredAt: FieldValue.serverTimestamp(),
      });
      return { escalated: severity !== data.severity, data };
    });
    if (!result) continue;
    changed++;
    if (result.data.cameraId) publishCameraWorkflow(siteId, String(result.data.cameraId));
    if (result.escalated && config.data()?.status === "paused") await notifySiteSupervisors({
      siteId, type: "alert_escalated", eventKey: `${alert.id}:critical`, title: "Alert priority increased",
      body: "An unresolved Alert is now critical. Automation is paused.", entityType: "alert", entityId: alert.id,
      cameraId: result.data.cameraId, alertId: alert.id, workOrderId: result.data.activeWorkOrderId ?? null,
      severity: "critical", isSimulation: Boolean(result.data.isSimulation),
    });
  }
  return changed;
}

export async function listAlertsPage(siteId: string, input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; severity?: string } = {}) {
  const filters = { siteId, status: input.status ?? "all", zoneId: input.zoneId ?? null, cameraId: input.cameraId ?? null, severity: input.severity ?? null };
  let query: FirebaseFirestore.Query = firestore.collection("alerts").where("siteId", "==", siteId).where("schemaVersion", "==", 2);
  if (input.status && input.status !== "all") query = input.status === "unresolved" ? query.where("status", "in", ["waiting_for_cleaner", "assigned", "in_progress", "awaiting_review"]) : query.where("status", "==", input.status);
  if (input.zoneId) query = query.where("zoneId", "==", input.zoneId);
  if (input.cameraId) query = query.where("cameraId", "==", input.cameraId);
  if (input.severity) query = query.where("severity", "==", input.severity);
  const page = await queryCursorPage({ query, totalQuery: query, resource: "alerts", orderField: "updatedAt", filters, limit: input.limit ?? 25, cursor: input.cursor, present: (document) => ({ id: document.id, ...document.data(), createdAt: timestamp(document.data().createdAt), updatedAt: timestamp(document.data().updatedAt) }) });
  return page;
}
export async function listAlerts(siteId: string) { return (await listAlertsPage(siteId, { limit: 100 })).items; }
export async function getAlert(siteId: string, alertId: string) { const alert = await firestore.collection("alerts").doc(alertId).get(); if (!alert.exists || alert.data()?.siteId !== siteId) throw new HttpError(404, "Alert not found."); const [events, occurrences, flags] = await Promise.all([alert.ref.collection("events").orderBy("occurredAt", "desc").limit(100).get(), alert.ref.collection("occurrences").orderBy("capturedAt", "desc").limit(100).get(), firestore.collection("flags").where("alertId", "==", alertId).limit(100).get()]); return { alert: { id: alert.id, ...alert.data() }, events: events.docs.map((d) => ({ id: d.id, ...d.data() })), occurrences: occurrences.docs.map((d) => ({ id: d.id, ...d.data() })), flags: flags.docs.map((d) => ({ id: d.id, ...d.data() })) }; }
