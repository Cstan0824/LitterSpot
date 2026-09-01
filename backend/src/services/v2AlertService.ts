import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { writeMedia } from "./localMediaStorage.js";
import { qualifiesIssue, priorityScore, type V2IssueType } from "./v2AlertPolicy.js";
import { getV2LiveIssueState } from "./v2LiveMonitoringService.js";
import { canonicalHash } from "./v2Persistence.js";
import { enqueueV2OrchestratorTriggerInTransaction } from "./v2OrchestratorTriggers.js";
import { notifyV2SiteSupervisors } from "./v2NotificationService.js";

const threshold = 0.5;
const activeStatuses = ["waiting_for_cleaner", "assigned", "in_progress", "awaiting_review"];
const timestamp = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;

async function persistEvidence(input: { siteId: string; cameraId: string; alertId: string; candidate: NonNullable<ReturnType<typeof getV2LiveIssueState>["candidate"]> }) {
  const mediaId = randomUUID(); const ext = input.candidate.mimeType === "image/png" ? "png" : input.candidate.mimeType === "image/webp" ? "webp" : "jpg"; const storageKey = `media/${mediaId}/alert-evidence.${ext}`;
  await writeMedia(storageKey, input.candidate.frame);
  await firestore.collection("mediaAssets").doc(mediaId).create({ schemaVersion: V2_SCHEMA_VERSION, mediaId, siteId: input.siteId, purpose: "alert_evidence", ownerType: "alert", ownerId: input.alertId, cameraId: input.cameraId, mimeType: input.candidate.mimeType, originalFileName: `alert-evidence.${ext}`, byteSize: input.candidate.frame.length, sha256: canonicalHash("evidence", input.candidate.frame.toString("base64")), storageKey, storageStatus: "available", width: null, height: null, durationSeconds: null, capturedAt: Timestamp.fromMillis(input.candidate.observation.capturedAtMs), retentionClass: "operational", expiresAt: null, createdAt: FieldValue.serverTimestamp(), createdByUid: null, deletedAt: null, revision: 1 });
  return mediaId;
}

export async function evaluateV2AlertsForCamera(siteId: string, cameraId: string, episodeId: string) {
  const [camera, episode] = await Promise.all([firestore.collection("cameras").doc(cameraId).get(), firestore.collection("monitoringEpisodes").doc(episodeId).get()]);
  if (!camera.exists || camera.data()?.siteId !== siteId || !episode.exists || episode.data()?.siteId !== siteId) throw new HttpError(404, "Camera monitoring context not found.");
  const outcomes: Array<{ issueType: V2IssueType; flagId: string; alertId: string | null; created: boolean }> = [];
  for (const issueType of ["floor_litter", "floor_spill", "bin_service"] as const) {
    const state = getV2LiveIssueState(siteId, cameraId, issueType); const current = state.observations.at(-1); if (!current) continue;
    const matches = current.issues.filter((issue) => issue.issueType === issueType && issue.confidence >= threshold); if (matches.length === 0) continue;
    const best = matches.sort((a, b) => b.confidence - a.confidence)[0]; const flagId = canonicalHash("v2-flag", cameraId, current.sampleId, issueType); const flagRef = firestore.collection("flags").doc(flagId);
    const flagData = { schemaVersion: V2_SCHEMA_VERSION, flagId, siteId, mapRevisionId: String(episode.data()?.mapRevisionId), zoneId: String(episode.data()?.zoneId), zoneNameSnapshot: String(episode.data()?.zoneId), cameraId, cameraNameSnapshot: String(camera.data()?.name), registrationRevisionId: String(episode.data()?.registrationRevisionId), monitoringEpisodeId: episodeId, sampleId: current.sampleId, issueType, observedCondition: best.condition, severityCandidate: best.condition === "overflow" || issueType === "floor_spill" ? "critical" : "warning", confidence: best.confidence, magnitude: { issueCount: matches.length }, affectedBinIds: matches.filter((item) => issueType === "bin_service").map((item) => item.entityId), detections: matches.map((item) => ({ entityId: item.entityId, confidence: item.confidence, condition: item.condition, geometry: item.geometry })), modelVersions: current.modelVersions, qualificationPolicyVersion: "cleanliness-v2", qualificationSnapshot: { threshold, issueCount: matches.length }, capturedAt: Timestamp.fromMillis(current.capturedAtMs), isSimulation: current.isSimulation, alertId: null, createdAt: FieldValue.serverTimestamp() };
    await flagRef.set(flagData, { merge: false });
    const observations = state.observations.map((observation) => ({ capturedAtMs: observation.capturedAtMs, positive: observation.issues.some((issue) => issue.issueType === issueType && issue.confidence >= threshold) }));
    if (!qualifiesIssue(issueType, observations, current.capturedAtMs)) { outcomes.push({ issueType, flagId, alertId: null, created: false }); continue; }
    const activeKeyId = canonicalHash("v2-active-alert", siteId, cameraId, issueType); const keyRef = firestore.collection("activeAlertKeys").doc(activeKeyId); const existingKey = await keyRef.get(); const alertId = existingKey.exists ? String(existingKey.data()?.alertId) : firestore.collection("alerts").doc().id; const alertRef = firestore.collection("alerts").doc(alertId); const existingAlert = await alertRef.get();
    const candidate = state.candidate; let evidenceMediaId: string | null = null; const priorConfidence = Number(existingAlert.data()?.evidence?.confidence ?? -1); const strongerCondition = best.condition === "overflow" && existingAlert.data()?.observedCondition !== "overflow"; if (candidate && (candidate.confidence > priorConfidence || strongerCondition)) evidenceMediaId = await persistEvidence({ siteId, cameraId, alertId, candidate });
    const severity = best.condition === "overflow" || issueType === "floor_spill" ? "critical" : "warning"; const created = !existingAlert.exists;
    await firestore.runTransaction(async (transaction) => {
      const site = await transaction.get(firestore.collection("sites").doc(siteId));
      if (site.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
      const [key, alert] = await Promise.all([transaction.get(keyRef), transaction.get(alertRef)]);
      if (key.exists && key.data()?.alertId !== alertId) throw new HttpError(409, "Active Alert changed.");
      if (!key.exists) transaction.create(keyRef, { schemaVersion: V2_SCHEMA_VERSION, siteId, cameraId, issueType, alertId, createdAt: FieldValue.serverTimestamp() });
      const prior = alert.data(); const nextSeverity = prior?.severity === "critical" ? "critical" : severity; const occurrenceCount = Number(prior?.occurrenceCount ?? 0) + 1;
      const evidenceValue = evidenceMediaId && candidate ? { mediaId: evidenceMediaId, flagId, capturedAt: Timestamp.fromMillis(candidate.observation.capturedAtMs), confidence: candidate.confidence, width: null, height: null, detections: candidate.observation.issues.filter((issue) => issue.issueType === issueType), modelVersions: candidate.observation.modelVersions, selectionPolicyVersion: "highest-confidence-v1" } : prior?.evidence ?? null;
      transaction.set(alertRef, { schemaVersion: V2_SCHEMA_VERSION, alertId, siteId, mapRevisionId: String(episode.data()?.mapRevisionId), zoneId: String(episode.data()?.zoneId), zoneNameSnapshot: String(episode.data()?.zoneId), cameraId, cameraNameSnapshot: String(camera.data()?.name), registrationRevisionId: String(episode.data()?.registrationRevisionId), issueType, observedCondition: best.condition, status: prior?.status ?? "waiting_for_cleaner", severity: nextSeverity, highestSeverity: nextSeverity, priorityScore: priorityScore({ severity: nextSeverity, createdAtMs: prior?.createdAt?.toMillis?.() ?? current.capturedAtMs, nowMs: current.capturedAtMs }), priorityPolicyVersion: "priority-v2", nextEscalationAt: nextSeverity === "warning" ? Timestamp.fromMillis((prior?.createdAt?.toMillis?.() ?? current.capturedAtMs) + 15 * 60000) : null, firstDetectedAt: prior?.firstDetectedAt ?? Timestamp.fromMillis(current.capturedAtMs), lastDetectedAt: Timestamp.fromMillis(current.capturedAtMs), occurrenceCount, affectedBinIds: [...new Set([...(prior?.affectedBinIds ?? []), ...matches.filter((item) => issueType === "bin_service").map((item) => item.entityId)])], evidence: evidenceValue, activeWorkOrderId: prior?.activeWorkOrderId ?? null, managementMode: prior?.managementMode ?? "orchestrated", isSimulation: current.isSimulation, resolvedAt: null, resolvedBy: null, dismissedAt: null, dismissedBy: null, dismissReason: null, createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), revision: Number(prior?.revision ?? 0) + 1 }, { merge: false });
      transaction.set(alertRef.collection("occurrences").doc(flagId), { schemaVersion: V2_SCHEMA_VERSION, siteId, alertId, flagId, capturedAt: Timestamp.fromMillis(current.capturedAtMs), confidence: best.confidence, observedCondition: best.condition, severityCandidate: severity, becameEvidence: Boolean(evidenceMediaId), createdAt: FieldValue.serverTimestamp() });
      const eventRef = alertRef.collection("events").doc(); transaction.create(eventRef, { schemaVersion: V2_SCHEMA_VERSION, siteId, alertId, type: created ? "created" : prior?.severity !== nextSeverity ? "severity_changed" : "occurrence", fromStatus: null, toStatus: created ? "waiting_for_cleaner" : null, fromSeverity: prior?.severity ?? null, toSeverity: nextSeverity, workOrderId: null, actor: { type: "system", serviceId: "alert-policy", displayNameSnapshot: "Alert policy" }, fromCondition: prior?.observedCondition ?? null, toCondition: best.condition, reasonCode: best.condition, note: null, requestId: current.sampleId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
      transaction.update(flagRef, { alertId });
      if (created) enqueueV2OrchestratorTriggerInTransaction(transaction, { siteId, type: "assign_alert", aggregateType: "alert", aggregateId: alertId, triggerType: "alert_created", uniquenessKey: alertId });
    });
    outcomes.push({ issueType, flagId, alertId, created });
    if (created && (await firestore.collection("orchestratorConfigs").doc(siteId).get()).data()?.status === "paused") {
      await notifyV2SiteSupervisors({ siteId, type: "alert_waiting_orchestrator_paused", eventKey: alertId,
        title: "Alert waiting for assignment", body: "The Orchestrator is paused. Assign a Cleaner manually or resume automation.",
        entityType: "alert", entityId: alertId, cameraId, alertId, workOrderId: null, severity, isSimulation: current.isSimulation });
    }
  }
  return outcomes;
}

export async function ageV2Alerts(siteId: string, now = new Date()) {
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
    if (result.escalated && config.data()?.status === "paused") await notifyV2SiteSupervisors({
      siteId, type: "alert_escalated", eventKey: `${alert.id}:critical`, title: "Alert priority increased",
      body: "An unresolved Alert is now critical. Automation is paused.", entityType: "alert", entityId: alert.id,
      cameraId: result.data.cameraId, alertId: alert.id, workOrderId: result.data.activeWorkOrderId ?? null,
      severity: "critical", isSimulation: Boolean(result.data.isSimulation),
    });
  }
  return changed;
}

export async function listV2Alerts(siteId: string) { const snapshot = await firestore.collection("alerts").where("siteId", "==", siteId).limit(500).get(); return snapshot.docs.map((document) => ({ id: document.id, ...document.data(), createdAt: timestamp(document.data().createdAt), updatedAt: timestamp(document.data().updatedAt) })).sort((a, b) => Number((b as any).priorityScore) - Number((a as any).priorityScore)); }
export async function getV2Alert(siteId: string, alertId: string) { const alert = await firestore.collection("alerts").doc(alertId).get(); if (!alert.exists || alert.data()?.siteId !== siteId) throw new HttpError(404, "Alert not found."); const [events, occurrences, flags] = await Promise.all([alert.ref.collection("events").orderBy("occurredAt", "desc").limit(100).get(), alert.ref.collection("occurrences").orderBy("capturedAt", "desc").limit(100).get(), firestore.collection("flags").where("alertId", "==", alertId).limit(100).get()]); return { alert: { id: alert.id, ...alert.data() }, events: events.docs.map((d) => ({ id: d.id, ...d.data() })), occurrences: occurrences.docs.map((d) => ({ id: d.id, ...d.data() })), flags: flags.docs.map((d) => ({ id: d.id, ...d.data() })) }; }
