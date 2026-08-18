import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  Filter,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { AuthenticatedSupervisor } from "../middleware/authenticateUser.js";
import type { AlertStatus } from "../schemas/alert.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import {
  ALERT_POLICY,
  evaluateIssueGroup,
  evaluateTemporalConfirmation,
  type AlertSeverity,
  type DetectionEvidence,
  type GroupEvaluation,
  type IssueType,
  type NormalizedBox,
  type NormalizedPoint,
} from "./alertPolicy.js";
import { assertForwardAlertTransition } from "./alertTransitions.js";
import { queryCursorPage, type CursorPage } from "./firestoreCursorPagination.js";
import { activeWorkOrderKeyId } from "../shared/workOrderKeys.js";
import { enqueueAlertOrchestratorInTransaction } from "./orchestratorService.js";

const issueTypes: IssueType[] = ["floor_litter", "floor_spill", "bin_overflow"];
const issueTypeSet = new Set<IssueType>(issueTypes);
export { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
const WORKFLOW_VERSION = ALERT_WORKFLOW_VERSION;

type ObservationOutcome = {
  issueType: IssueType;
  observationId: string;
  positive: boolean;
  flagId: string | null;
  alertId: string | null;
  temporalStatus: string;
  alreadyEvaluated: boolean;
};

type ConfirmationBufferEntry = {
  observationId: string;
  analysisRunId: string;
  flagId: string | null;
  positive: boolean;
  capturedAt: Timestamp;
  evidenceMediaId: string | null;
  cameraId: string;
  detectionIds: string[];
  severity: AlertSeverity | null;
  maximumConfidence: number;
  magnitudeScore: number | null;
  metrics: Record<string, unknown>;
};

function hashId(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

export function deterministicObservationId(analysisRunId: string, issueType: IssueType) {
  return hashId("issue-observation-v2", analysisRunId, issueType);
}

export function deterministicGroupedFlagId(observationId: string) {
  return hashId("grouped-flag-v2", observationId);
}

export function deterministicActiveAlertKey(zoneId: string, issueType: IssueType) {
  return hashId("active-alert-v2", zoneId, issueType);
}

export function deterministicConfirmationStateId(zoneId: string, cameraId: string, issueType: IssueType) {
  return hashId("confirmation-state-v2", zoneId, cameraId, issueType);
}

function timestampJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(timestampJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestampJson(item)]));
  }
  return value;
}

function serialize(snapshot: DocumentSnapshot, label: string): Record<string, unknown> & { id: string } {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return { id: snapshot.id, ...timestampJson(snapshot.data()) as Record<string, unknown> };
}

function evidenceUrl(mediaId: unknown) {
  return typeof mediaId === "string" && mediaId ? `/api/media/${mediaId}/content` : null;
}

function presentAlert(snapshot: DocumentSnapshot): Record<string, unknown> & {
  id: string;
  firstEvidenceContentUrl: string | null;
  latestEvidenceContentUrl: string | null;
} {
  const alert = serialize(snapshot, "Alert");
  return {
    ...alert,
    firstEvidenceContentUrl: evidenceUrl(alert["firstEvidenceMediaId"]),
    latestEvidenceContentUrl: evidenceUrl(alert["latestEvidenceMediaId"]),
  };
}

function requireString(data: DocumentData, key: string, label = "Analysis run") {
  const value = data[key];
  if (typeof value !== "string" || !value) throw new HttpError(422, `${label} is missing ${key}.`);
  return value;
}

function requireTimestamp(data: DocumentData, key: string) {
  const value = data[key];
  if (!(value instanceof Timestamp)) throw new HttpError(422, `Analysis run is missing ${key}.`);
  return value;
}

function parsePoint(value: unknown): NormalizedPoint | null {
  if (!value || typeof value !== "object") return null;
  const x = Number((value as { x?: unknown }).x);
  const y = Number((value as { y?: unknown }).y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parsePoints(value: unknown) {
  return Array.isArray(value) ? value.map(parsePoint).filter((point): point is NormalizedPoint => Boolean(point)) : [];
}

function parseBox(value: unknown): NormalizedBox {
  if (!value || typeof value !== "object") throw new HttpError(422, "Detection is missing normalized geometry.");
  const candidate = value as Record<string, unknown>;
  const box = {
    x1: Number(candidate.x1),
    y1: Number(candidate.y1),
    x2: Number(candidate.x2),
    y2: Number(candidate.y2),
  };
  if (Object.values(box).some((coordinate) => !Number.isFinite(coordinate))) {
    throw new HttpError(422, "Detection has invalid normalized geometry.");
  }
  return box;
}

function toDetectionEvidence(snapshot: QueryDocumentSnapshot): DetectionEvidence {
  const data = snapshot.data();
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) throw new HttpError(422, "Detection is missing confidence.");
  return {
    id: snapshot.id,
    confidence,
    bboxNormalized: parseBox(data.bboxNormalized),
    polygonNormalized: parsePoints(data.polygonNormalized),
  };
}

function strongerSeverity(values: Array<AlertSeverity | null | undefined>): AlertSeverity {
  return values.includes("critical") ? "critical" : "warning";
}

function bufferEntries(value: unknown): ConfirmationBufferEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ConfirmationBufferEntry => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<ConfirmationBufferEntry>;
    return typeof item.observationId === "string" && item.capturedAt instanceof Timestamp && typeof item.positive === "boolean";
  });
}

function observationEntry(observationId: string, observation: DocumentData): ConfirmationBufferEntry {
  return {
    observationId,
    analysisRunId: requireString(observation, "analysisRunId", "Issue observation"),
    flagId: typeof observation.flagId === "string" ? observation.flagId : null,
    positive: Boolean(observation.positive),
    capturedAt: observation.capturedAt instanceof Timestamp ? observation.capturedAt : Timestamp.now(),
    evidenceMediaId: typeof observation.evidenceMediaId === "string" ? observation.evidenceMediaId : null,
    cameraId: requireString(observation, "cameraId", "Issue observation"),
    detectionIds: Array.isArray(observation.detectionIds)
      ? observation.detectionIds.filter((id: unknown): id is string => typeof id === "string")
      : [],
    severity: observation.severity === "critical" ? "critical" : observation.severity === "warning" ? "warning" : null,
    maximumConfidence: Number(observation.metrics?.maximumConfidence ?? 0),
    magnitudeScore: typeof observation.metrics?.magnitudeScore === "number" ? observation.metrics.magnitudeScore : null,
    metrics: observation.metrics && typeof observation.metrics === "object" ? observation.metrics as Record<string, unknown> : {},
  };
}

async function persistGroupedObservation(
  analysisRunId: string,
  run: DocumentData,
  issueType: IssueType,
  detections: QueryDocumentSnapshot[],
): Promise<{ observationId: string; evaluation: GroupEvaluation; alreadyEvaluated: boolean }> {
  const observationId = deterministicObservationId(analysisRunId, issueType);
  const observationReference = firestore.collection("issueObservations").doc(observationId);
  const flagId = deterministicGroupedFlagId(observationId);
  const flagReference = firestore.collection("flags").doc(flagId);
  const evidence = detections.map(toDetectionEvidence);
  const evaluation = evaluateIssueGroup(issueType, evidence, Boolean(run.isTest), parsePoints(run.focusRegionNormalized));
  const alreadyEvaluated = await firestore.runTransaction(async (transaction) => {
    const [existingObservation, existingFlag] = await Promise.all([
      transaction.get(observationReference),
      transaction.get(flagReference),
    ]);
    if (existingObservation.exists) {
      return true;
    }

    const siteId = requireString(run, "siteId");
    const zoneId = requireString(run, "zoneId");
    const cameraId = requireString(run, "cameraId");
    const capturedAt = requireTimestamp(run, "capturedAt");
    const isTest = Boolean(run.isTest);
    const eligibleIds = new Set(evaluation.eligibleDetectionIds);
    const positiveFlagId = evaluation.createFlag ? flagId : null;

    transaction.create(observationReference, {
      workflowVersion: WORKFLOW_VERSION,
      policyVersion: ALERT_POLICY.version,
      analysisRunId,
      jobId: requireString(run, "jobId"),
      sourceType: String(run.sourceType ?? "unknown"),
      siteId,
      siteNameSnapshot: String(run.siteName ?? ""),
      zoneId,
      zoneNameSnapshot: String(run.zoneName ?? ""),
      cameraId,
      cameraCodeSnapshot: String(run.cameraCode ?? ""),
      cameraNameSnapshot: String(run.cameraName ?? ""),
      issueType,
      evidenceMediaId: typeof run.evidenceMediaId === "string" ? run.evidenceMediaId : null,
      capturedAt,
      frameIndex: Number.isInteger(run.frameIndex) ? run.frameIndex : null,
      videoOffsetSeconds: typeof run.videoOffsetSeconds === "number" ? run.videoOffsetSeconds : null,
      detectionIds: detections.map((detection) => detection.id),
      eligibleDetectionIds: evaluation.eligibleDetectionIds,
      rejectedDetectionIds: evaluation.rejectedDetectionIds,
      detectionCount: detections.length,
      positive: evaluation.createFlag,
      excluded: isTest,
      evaluationReason: evaluation.reason,
      severity: evaluation.createFlag ? evaluation.severity : null,
      metrics: evaluation.metrics,
      minimumDetectionConfidence: evaluation.minimumDetectionConfidence,
      alertThreshold: evaluation.alertThreshold,
      flagId: positiveFlagId,
      alertId: null,
      temporalStatus: isTest ? "excluded" : evaluation.createFlag ? "pending_confirmation" : "negative",
      confirmation: null,
      confirmationGeneration: null,
      temporalAppliedAt: null,
      temporalResult: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (evaluation.createFlag && !existingFlag.exists) {
      transaction.create(flagReference, {
        workflowVersion: WORKFLOW_VERSION,
        policyVersion: ALERT_POLICY.version,
        observationId,
        analysisRunId,
        detectionId: evaluation.eligibleDetectionIds[0] ?? null,
        detectionIds: evaluation.eligibleDetectionIds,
        siteId,
        zoneId,
        cameraId,
        issueType,
        severity: evaluation.severity,
        confidence: evaluation.metrics.maximumConfidence,
        metrics: evaluation.metrics,
        thresholdApplied: evaluation.alertThreshold,
        evidenceMediaId: typeof run.evidenceMediaId === "string" ? run.evidenceMediaId : null,
        capturedAt,
        status: "pending_confirmation",
        alertId: null,
        failureReason: null,
        confirmation: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (const detection of detections) {
      const included = eligibleIds.has(detection.id);
      const qualificationStatus = isTest ? "excluded" : included && evaluation.createFlag ? "qualified" : "rejected";
      const reason = isTest
        ? "test_data"
        : included && evaluation.createFlag
          ? "grouped_dirty_condition"
          : included
            ? evaluation.reason
            : "below_detection_confidence";
      transaction.update(detection.ref, {
        observationId,
        qualificationStatus,
        qualifiedForFlag: qualificationStatus === "qualified",
        qualificationReason: reason,
        qualificationEvaluatedAt: FieldValue.serverTimestamp(),
        qualificationPolicyVersion: ALERT_POLICY.version,
        qualificationThreshold: evaluation.minimumDetectionConfidence,
        flagId: qualificationStatus === "qualified" ? flagId : null,
      });
    }
    return false;
  });

  return { observationId, evaluation, alreadyEvaluated };
}

async function applyObservationToConfirmation(observationId: string): Promise<{
  alertId: string | null;
  temporalStatus: string;
}> {
  const observationReference = firestore.collection("issueObservations").doc(observationId);
  return firestore.runTransaction(async (transaction): Promise<{ alertId: string | null; temporalStatus: string }> => {
    const observationSnapshot = await transaction.get(observationReference);
    if (!observationSnapshot.exists) throw new HttpError(404, "Issue observation not found.");
    const observation = observationSnapshot.data()!;
    if (observation.workflowVersion !== WORKFLOW_VERSION) throw new HttpError(409, "Issue observation uses an unsupported workflow version.");
    if (observation.temporalAppliedAt && observation.temporalResult && typeof observation.temporalResult === "object") {
      const stored = observation.temporalResult as { alertId?: unknown; temporalStatus?: unknown };
      return {
        alertId: typeof stored.alertId === "string" ? stored.alertId : null,
        temporalStatus: typeof stored.temporalStatus === "string" ? stored.temporalStatus : String(observation.temporalStatus ?? "negative"),
      };
    }
    if (observation.excluded) {
      transaction.update(observationReference, {
        temporalAppliedAt: FieldValue.serverTimestamp(),
        temporalResult: { alertId: null, temporalStatus: "excluded" },
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { alertId: null, temporalStatus: "excluded" };
    }

    const issueType = observation.issueType;
    if (!issueTypeSet.has(issueType)) throw new HttpError(422, "Issue observation has an unsupported issue type.");
    const typedIssue = issueType as IssueType;
    const zoneId = requireString(observation, "zoneId", "Issue observation");
    const cameraId = requireString(observation, "cameraId", "Issue observation");
    const siteId = requireString(observation, "siteId", "Issue observation");
    const activeKey = `${zoneId}:${typedIssue}`;
    const activeKeyId = deterministicActiveAlertKey(zoneId, typedIssue);
    const stateId = deterministicConfirmationStateId(zoneId, cameraId, typedIssue);
    const stateReference = firestore.collection("alertConfirmationStates").doc(stateId);
    const keyReference = firestore.collection("activeAlertKeys").doc(activeKeyId);
    const resetReference = firestore.collection("alertConfirmationResets").doc(activeKeyId);
    const [stateSnapshot, keySnapshot, resetSnapshot] = await Promise.all([
      transaction.get(stateReference),
      transaction.get(keyReference),
      transaction.get(resetReference),
    ]);

    let activeAlertReference = keySnapshot.exists && typeof keySnapshot.data()?.alertId === "string"
      ? firestore.collection("alerts").doc(String(keySnapshot.data()!.alertId))
      : null;
    let activeAlertSnapshot = activeAlertReference ? await transaction.get(activeAlertReference) : null;
    const staleActiveKey = Boolean(keySnapshot.exists && (!activeAlertSnapshot?.exists || activeAlertSnapshot.data()?.status === "resolved"));
    if (!activeAlertSnapshot?.exists || activeAlertSnapshot.data()?.status === "resolved") {
      activeAlertReference = null;
      activeAlertSnapshot = null;
    }

    const resetAt = resetSnapshot.data()?.resetAt instanceof Timestamp ? resetSnapshot.data()!.resetAt as Timestamp : null;
    const resetGeneration = Number(resetSnapshot.data()?.generation ?? 0);
    const current = observationEntry(observationId, observation);
    const observationGeneration = typeof observation.confirmationGeneration === "number"
      ? observation.confirmationGeneration
      : null;
    if (observationGeneration !== null && observationGeneration < resetGeneration) {
      return {
        alertId: typeof observation.alertId === "string" ? observation.alertId : null,
        temporalStatus: "pre_reset_replay",
      };
    }
    const stateGeneration = Number(stateSnapshot.data()?.resetGeneration ?? 0);
    const samePolicy = stateSnapshot.data()?.policyVersion === ALERT_POLICY.version;
    let buffer = stateGeneration === resetGeneration && samePolicy ? bufferEntries(stateSnapshot.data()?.observations) : [];
    const isDuplicate = buffer.some((entry) => entry.observationId === observationId);
    const lastCapturedAt = buffer.length > 0 ? buffer[buffer.length - 1].capturedAt : null;

    if (!isDuplicate && lastCapturedAt && current.capturedAt.toMillis() < lastCapturedAt.toMillis()) {
      const confirmation = {
        confirmed: false,
        reason: "out_of_order_observation",
        evaluatedObservationCount: buffer.length,
        positiveCount: buffer.filter((entry) => entry.positive).length,
      };
      transaction.update(observationReference, {
        temporalStatus: "out_of_order",
        confirmation,
        confirmationGeneration: resetGeneration,
        temporalAppliedAt: FieldValue.serverTimestamp(),
        temporalResult: { alertId: null, temporalStatus: "out_of_order" },
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (current.flagId) {
        transaction.update(firestore.collection("flags").doc(current.flagId), {
          status: "ignored_out_of_order",
          confirmation,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (staleActiveKey) transaction.delete(keyReference);
      return { alertId: null, temporalStatus: "out_of_order" };
    }

    const confirmationRule = ALERT_POLICY.rules[typedIssue].confirmation;
    if (!isDuplicate && lastCapturedAt
      && current.capturedAt.toMillis() - lastCapturedAt.toMillis() > confirmationRule.maximumWindowSeconds * 1000) {
      buffer = [];
    }
    const confirmationCutoff = current.capturedAt.toMillis() - confirmationRule.maximumWindowSeconds * 1000;
    buffer = buffer.filter((entry) => entry.capturedAt.toMillis() >= confirmationCutoff);
    if (!isDuplicate) buffer.push(current);
    buffer = buffer.slice(-confirmationRule.windowSize);
    const confirmation = evaluateTemporalConfirmation(typedIssue, [...buffer].reverse().map((entry) => entry.positive));

    const currentPositive = current.positive && Boolean(current.flagId);
    let createAlert = false;
    if (!activeAlertReference && currentPositive && confirmation.confirmed) {
      const alertId = hashId("alert-v2", activeKeyId, current.flagId!);
      activeAlertReference = firestore.collection("alerts").doc(alertId);
      activeAlertSnapshot = await transaction.get(activeAlertReference);
      createAlert = !activeAlertSnapshot.exists;
    }

    const supportEntries = currentPositive && activeAlertReference
      ? createAlert
        ? buffer.filter((entry) => entry.positive && entry.flagId)
        : [current]
      : [];
    const flagSnapshots: DocumentSnapshot[] = [];
    const occurrenceSnapshots: DocumentSnapshot[] = [];
    for (const entry of supportEntries) {
      const flagReference = firestore.collection("flags").doc(entry.flagId!);
      flagSnapshots.push(await transaction.get(flagReference));
      occurrenceSnapshots.push(await transaction.get(activeAlertReference!.collection("occurrences").doc(entry.flagId!)));
    }
    const attachments = supportEntries.filter((entry, index) => {
      const flag = flagSnapshots[index];
      const occurrence = occurrenceSnapshots[index];
      const existingAlertId = flag.data()?.alertId;
      return flag.exists && !occurrence.exists && (!existingAlertId || existingAlertId === activeAlertReference!.id);
    });

    const temporalStatus = currentPositive
      ? activeAlertReference ? "attached" : "awaiting_confirmation"
      : "negative";
    if (staleActiveKey && !activeAlertReference) transaction.delete(keyReference);
    transaction.set(stateReference, {
      workflowVersion: WORKFLOW_VERSION,
      policyVersion: ALERT_POLICY.version,
      siteId,
      zoneId,
      cameraId,
      issueType: typedIssue,
      observations: buffer,
      lastCapturedAt: buffer.at(-1)?.capturedAt ?? current.capturedAt,
      lastObservationId: buffer.at(-1)?.observationId ?? observationId,
      lastAlertId: activeAlertReference?.id
        ?? (stateGeneration === resetGeneration && samePolicy ? stateSnapshot.data()?.lastAlertId ?? null : null),
      lastResetAt: resetAt,
      resetGeneration,
      updatedAt: FieldValue.serverTimestamp(),
      ...(stateSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.update(observationReference, {
      temporalStatus,
      confirmation,
      confirmationGeneration: resetGeneration,
      alertId: currentPositive ? activeAlertReference?.id ?? null : null,
      temporalAppliedAt: FieldValue.serverTimestamp(),
      temporalResult: {
        alertId: currentPositive ? activeAlertReference?.id ?? null : null,
        temporalStatus,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (current.flagId && !activeAlertReference) {
      transaction.update(firestore.collection("flags").doc(current.flagId), {
        status: "pending_confirmation",
        confirmation,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (!currentPositive) {
      return { alertId: null, temporalStatus: "negative" };
    }

    if (!activeAlertReference) {
      return { alertId: null, temporalStatus };
    }

    const alertId = activeAlertReference.id;
    for (const entry of attachments) {
      transaction.update(firestore.collection("flags").doc(entry.flagId!), {
        status: "attached",
        alertId,
        confirmation,
        attachedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(firestore.collection("issueObservations").doc(entry.observationId), {
        temporalStatus: "attached",
        alertId,
        temporalAppliedAt: FieldValue.serverTimestamp(),
        temporalResult: { alertId, temporalStatus: "attached" },
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(activeAlertReference.collection("occurrences").doc(entry.flagId!), {
        flagId: entry.flagId,
        observationId: entry.observationId,
        detectionId: entry.detectionIds[0] ?? null,
        detectionIds: entry.detectionIds,
        analysisRunId: entry.analysisRunId,
        cameraId: entry.cameraId,
        evidenceMediaId: entry.evidenceMediaId,
        confidence: entry.maximumConfidence,
        magnitudeScore: entry.magnitudeScore,
        metrics: entry.metrics,
        severity: entry.severity,
        capturedAt: entry.capturedAt,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const orderedAttachments = [...attachments].sort((left, right) => left.capturedAt.toMillis() - right.capturedAt.toMillis());
    const first = orderedAttachments[0] ?? current;
    const latest = orderedAttachments[orderedAttachments.length - 1] ?? current;
    const attachmentSeverity = strongerSeverity(attachments.map((entry) => entry.severity));
    const attachmentMaximumConfidence = Math.max(0, ...attachments.map((entry) => entry.maximumConfidence));
    const attachmentMaximumScore = Math.max(0, ...attachments.map((entry) => entry.magnitudeScore ?? 0));

    if (createAlert) {
      transaction.create(activeAlertReference, {
        workflowVersion: WORKFLOW_VERSION,
        policyVersion: ALERT_POLICY.version,
        activeKey,
        activeKeyId,
        siteId,
        zoneId,
        triggerCameraId: current.cameraId,
        cameraId: current.cameraId,
        latestCameraId: latest.cameraId,
        cameraIds: [...new Set(attachments.map((entry) => entry.cameraId))],
        siteNameSnapshot: String(observation.siteNameSnapshot ?? ""),
        zoneNameSnapshot: String(observation.zoneNameSnapshot ?? ""),
        cameraCodeSnapshot: String(observation.cameraCodeSnapshot ?? ""),
        cameraNameSnapshot: String(observation.cameraNameSnapshot ?? ""),
        issueType: typedIssue,
        severity: attachmentSeverity,
        status: "new",
        firstObservationId: first.observationId,
        latestObservationId: latest.observationId,
        firstDetectionId: first.detectionIds[0] ?? null,
        latestDetectionId: latest.detectionIds[0] ?? null,
        latestFlagId: latest.flagId,
        firstEvidenceMediaId: first.evidenceMediaId,
        latestEvidenceMediaId: latest.evidenceMediaId,
        occurrenceCount: attachments.length,
        firstDetectedAt: first.capturedAt,
        lastDetectedAt: latest.capturedAt,
        latestConfidence: latest.maximumConfidence,
        maximumConfidence: attachmentMaximumConfidence,
        latestMagnitudeScore: latest.magnitudeScore,
        maximumMagnitudeScore: attachmentMaximumScore,
        statusUpdatedAt: FieldValue.serverTimestamp(),
        statusUpdatedByUid: "system",
        resolvedAt: null,
        resolvedByUid: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(activeAlertReference.collection("statusHistory").doc(`created-${current.flagId}`), {
        previousStatus: null,
        newStatus: "new",
        actorType: "system",
        actorUid: null,
        actorNameSnapshot: "LitterSpot system",
        actorEmailSnapshot: null,
        note: null,
        changedAt: FieldValue.serverTimestamp(),
      });
      enqueueAlertOrchestratorInTransaction(transaction, {
        alertId,
        siteId,
        zoneId,
        issueType: typedIssue,
      });
    } else if (attachments.length > 0) {
      const existing = activeAlertSnapshot!.data()!;
      const existingLast = existing.lastDetectedAt instanceof Timestamp ? existing.lastDetectedAt : Timestamp.fromMillis(0);
      const replaceLatest = latest.capturedAt.toMillis() >= existingLast.toMillis();
      transaction.update(activeAlertReference, {
        severity: strongerSeverity([existing.severity as AlertSeverity, attachmentSeverity]),
        latestObservationId: replaceLatest ? latest.observationId : existing.latestObservationId,
        latestDetectionId: replaceLatest ? latest.detectionIds[0] ?? null : existing.latestDetectionId,
        latestFlagId: replaceLatest ? latest.flagId : existing.latestFlagId,
        latestEvidenceMediaId: replaceLatest ? latest.evidenceMediaId : existing.latestEvidenceMediaId,
        latestCameraId: replaceLatest ? latest.cameraId : existing.latestCameraId,
        cameraIds: FieldValue.arrayUnion(...attachments.map((entry) => entry.cameraId)),
        occurrenceCount: FieldValue.increment(attachments.length),
        lastDetectedAt: replaceLatest ? latest.capturedAt : existingLast,
        latestConfidence: replaceLatest ? latest.maximumConfidence : existing.latestConfidence,
        maximumConfidence: Math.max(Number(existing.maximumConfidence ?? 0), attachmentMaximumConfidence),
        latestMagnitudeScore: replaceLatest ? latest.magnitudeScore : existing.latestMagnitudeScore ?? null,
        maximumMagnitudeScore: Math.max(Number(existing.maximumMagnitudeScore ?? 0), attachmentMaximumScore),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(keyReference, {
      workflowVersion: WORKFLOW_VERSION,
      alertId,
      siteId,
      zoneId,
      issueType: typedIssue,
      updatedAt: FieldValue.serverTimestamp(),
      ...(keySnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    return { alertId, temporalStatus: "attached" };
  });
}

export async function evaluateAnalysisRunDetections(analysisRunId: string) {
  const runReference = firestore.collection("analysisRuns").doc(analysisRunId);
  const [runSnapshot, detectionSnapshot] = await Promise.all([
    runReference.get(),
    firestore.collection("detections").where("analysisRunId", "==", analysisRunId).get(),
  ]);
  if (!runSnapshot.exists) throw new HttpError(404, "Analysis run not found.");
  const run = runSnapshot.data()!;
  if (run.alertWorkflowVersion !== WORKFLOW_VERSION) {
    throw new HttpError(409, "This analysis run predates grouped temporal alerting and will not be replayed automatically.");
  }

  const detectionsByIssue = new Map<IssueType, QueryDocumentSnapshot[]>();
  for (const issueType of issueTypes) detectionsByIssue.set(issueType, []);
  for (const detection of detectionSnapshot.docs) {
    const issueType = detection.data().issueType;
    if (issueTypeSet.has(issueType)) detectionsByIssue.get(issueType as IssueType)!.push(detection);
  }

  const outcomes: ObservationOutcome[] = [];
  for (const issueType of issueTypes) {
    const persisted = await persistGroupedObservation(analysisRunId, run, issueType, detectionsByIssue.get(issueType)!);
    const temporal = await applyObservationToConfirmation(persisted.observationId);
    outcomes.push({
      issueType,
      observationId: persisted.observationId,
      positive: persisted.evaluation.createFlag,
      flagId: persisted.evaluation.createFlag ? deterministicGroupedFlagId(persisted.observationId) : null,
      alertId: temporal.alertId,
      temporalStatus: temporal.temporalStatus,
      alreadyEvaluated: persisted.alreadyEvaluated,
    });
  }

  const observationIds = outcomes.map((outcome) => outcome.observationId);
  const flagIds = outcomes.flatMap((outcome) => outcome.flagId ? [outcome.flagId] : []);
  const alertIds = [...new Set(outcomes.flatMap((outcome) => outcome.alertId ? [outcome.alertId] : []))];
  const jobId = requireString(run, "jobId");
  const jobReference = firestore.collection("processingJobs").doc(jobId);
  const jobSnapshot = await jobReference.get();
  const updates = {
    alertEvaluationStatus: "completed",
    alertEvaluationPolicyVersion: ALERT_POLICY.version,
    alertEvaluationWorkflowVersion: WORKFLOW_VERSION,
    alertEvaluationAt: FieldValue.serverTimestamp(),
    observationIds,
    flagIds,
    alertIds,
  };
  await runReference.update(updates);
  if (jobSnapshot.exists && jobSnapshot.data()?.type === "image") {
    await jobReference.update({
      "summary.flagCount": flagIds.length,
      "summary.alertIds": alertIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    analysisRunId,
    workflowVersion: WORKFLOW_VERSION,
    policyVersion: ALERT_POLICY.version,
    detectionCount: detectionSnapshot.size,
    observationCount: observationIds.length,
    positiveObservationCount: outcomes.filter((outcome) => outcome.positive).length,
    excludedObservationCount: Boolean(run.isTest) ? outcomes.length : 0,
    flagIds,
    alertIds,
    outcomes,
  };
}

export async function listIssueObservations(filters: {
  analysisRunId?: string;
  cameraId?: string;
  issueType?: IssueType;
  positive?: boolean;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("issueObservations");
  const ownershipFilter = filters.analysisRunId
    ? { field: "analysisRunId", value: filters.analysisRunId }
    : filters.cameraId
      ? { field: "cameraId", value: filters.cameraId }
      : null;
  if (ownershipFilter) query = query.where(ownershipFilter.field, "==", ownershipFilter.value);
  if (filters.issueType) query = query.where("issueType", "==", filters.issueType);
  if (filters.positive !== undefined) query = query.where("positive", "==", filters.positive);
  return queryCursorPage({
    query,
    resource: "issue-observations",
    orderField: "capturedAt",
    filters: { ownershipFilter, issueType: filters.issueType, positive: filters.positive },
    limit: filters.limit,
    cursor: filters.cursor,
    present: (item) => serialize(item, "Issue observation"),
  });
}

export async function getIssueObservation(observationId: string) {
  return serialize(await firestore.collection("issueObservations").doc(observationId).get(), "Issue observation");
}

type WorkflowFilter = "current" | "legacy" | "all";

function matchesWorkflow(item: Record<string, unknown>, workflow: WorkflowFilter) {
  if (workflow === "all") return true;
  const current = item["workflowVersion"] === WORKFLOW_VERSION;
  return workflow === "current" ? current : !current;
}

type LegacyListPage<T> = CursorPage<T> & {
  paginationMode?: "cursor" | "bounded_legacy_scan";
  resultCompleteness?: "complete" | "bounded";
  scannedCount?: number;
};

const LEGACY_SCAN_LIMIT = 500;

async function listLegacyWorkflowFallback<T>(options: {
  query: Query<DocumentData>;
  orderField: string;
  limit: number;
  cursor?: string;
  present: (snapshot: QueryDocumentSnapshot) => T & Record<string, unknown>;
}): Promise<LegacyListPage<T>> {
  if (options.cursor) {
    throw new HttpError(400, "Legacy workflow scans do not support pagination cursors.");
  }
  const snapshot = await options.query
    .orderBy(options.orderField, "desc")
    .limit(LEGACY_SCAN_LIMIT)
    .get();
  const items = snapshot.docs.map(options.present)
    .filter((item) => matchesWorkflow(item, "legacy"))
    .sort((left, right) => {
      const timestampOrder = String(right[options.orderField]).localeCompare(String(left[options.orderField]));
      return timestampOrder || String(right["id"]).localeCompare(String(left["id"]));
    })
    .slice(0, options.limit);
  return {
    items,
    nextCursor: null,
    paginationMode: "bounded_legacy_scan",
    resultCompleteness: snapshot.size < LEGACY_SCAN_LIMIT ? "complete" : "bounded",
    scannedCount: snapshot.size,
  };
}

export async function listFlags(filters: {
  detectionId?: string;
  analysisRunId?: string;
  alertId?: string;
  workflow: WorkflowFilter;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("flags");
  const ownershipFilter = filters.detectionId
    ? { field: "detectionIds", operator: "array-contains" as const, value: filters.detectionId }
    : filters.analysisRunId
      ? { field: "analysisRunId", operator: "==" as const, value: filters.analysisRunId }
      : filters.alertId
        ? { field: "alertId", operator: "==" as const, value: filters.alertId }
        : null;
  if (ownershipFilter) query = query.where(ownershipFilter.field, ownershipFilter.operator, ownershipFilter.value);
  if (filters.workflow === "legacy") {
    return listLegacyWorkflowFallback({
      query,
      orderField: "createdAt",
      limit: filters.limit,
      cursor: filters.cursor,
      present: (item) => serialize(item, "Flag"),
    });
  }
  if (filters.workflow === "current") query = query.where("workflowVersion", "==", WORKFLOW_VERSION);
  return queryCursorPage({
    query,
    resource: "flags",
    orderField: "createdAt",
    filters: { ownershipFilter, workflow: filters.workflow },
    limit: filters.limit,
    cursor: filters.cursor,
    present: (item) => serialize(item, "Flag"),
  });
}

export async function getFlag(flagId: string) {
  return serialize(await firestore.collection("flags").doc(flagId).get(), "Flag");
}

export async function listAlerts(filters: {
  status: AlertStatus | "all";
  issueType?: IssueType;
  severity?: AlertSeverity;
  siteId?: string;
  zoneId?: string;
  cameraId?: string;
  workflow: WorkflowFilter;
  limit: number;
  cursor?: string;
}) {
  let query: Query<DocumentData> = firestore.collection("alerts");
  if (filters.status !== "all") query = query.where("status", "==", filters.status);
  if (filters.issueType) query = query.where("issueType", "==", filters.issueType);
  if (filters.severity) query = query.where("severity", "==", filters.severity);
  if (filters.siteId) query = query.where("siteId", "==", filters.siteId);
  if (filters.zoneId) query = query.where("zoneId", "==", filters.zoneId);
  if (filters.cameraId) {
    query = query.where(Filter.or(
      Filter.where("cameraId", "==", filters.cameraId),
      Filter.where("cameraIds", "array-contains", filters.cameraId),
    ));
  }
  if (filters.workflow === "legacy") {
    return listLegacyWorkflowFallback({
      query,
      orderField: "lastDetectedAt",
      limit: filters.limit,
      cursor: filters.cursor,
      present: presentAlert,
    });
  }
  if (filters.workflow === "current") query = query.where("workflowVersion", "==", WORKFLOW_VERSION);
  return queryCursorPage({
    query,
    resource: "alerts",
    orderField: "lastDetectedAt",
    filters: {
      status: filters.status,
      issueType: filters.issueType,
      severity: filters.severity,
      siteId: filters.siteId,
      zoneId: filters.zoneId,
      cameraId: filters.cameraId,
      workflow: filters.workflow,
    },
    limit: filters.limit,
    cursor: filters.cursor,
    present: presentAlert,
  });
}

export async function getAlert(alertId: string) {
  return presentAlert(await firestore.collection("alerts").doc(alertId).get());
}

export async function listAlertHistory(alertId: string, options: { limit?: number; cursor?: string } = {}) {
  const alert = await firestore.collection("alerts").doc(alertId).get();
  if (!alert.exists) throw new HttpError(404, "Alert not found.");
  return queryCursorPage({
    query: alert.ref.collection("statusHistory"),
    resource: "alert-status-history",
    orderField: "changedAt",
    filters: { alertId },
    limit: options.limit ?? 25,
    cursor: options.cursor,
    present: (item) => serialize(item, "Status history"),
  });
}

export async function listAlertOccurrences(alertId: string, options: { limit?: number; cursor?: string } = {}) {
  const alert = await firestore.collection("alerts").doc(alertId).get();
  if (!alert.exists) throw new HttpError(404, "Alert not found.");
  return queryCursorPage({
    query: alert.ref.collection("occurrences"),
    resource: "alert-occurrences",
    orderField: "capturedAt",
    filters: { alertId },
    limit: options.limit ?? 25,
    cursor: options.cursor,
    present: (item) => {
      const occurrence = serialize(item, "Alert occurrence");
      return { ...occurrence, evidenceContentUrl: evidenceUrl(occurrence["evidenceMediaId"]) } as Record<string, unknown> & {
        id: string;
        evidenceContentUrl: string | null;
      };
    },
  });
}

export async function getAlertDetails(alertId: string) {
  const [alert, historyPage, occurrencePage] = await Promise.all([
    getAlert(alertId), listAlertHistory(alertId), listAlertOccurrences(alertId),
  ]);
  return {
    alert,
    history: historyPage.items,
    occurrences: occurrencePage.items,
    historyNextCursor: historyPage.nextCursor,
    occurrencesNextCursor: occurrencePage.nextCursor,
  };
}

export async function updateAlertStatus(alertId: string, nextStatus: AlertStatus, actor: AuthenticatedSupervisor, note?: string) {
  const alertReference = firestore.collection("alerts").doc(alertId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(alertReference);
    if (!snapshot.exists) throw new HttpError(404, "Alert not found.");
    const alert = snapshot.data()!;
    const currentStatus = alert.status as AlertStatus;
    assertForwardAlertTransition(currentStatus, nextStatus);
    const keyReference = nextStatus === "resolved" && typeof alert.activeKeyId === "string"
      ? firestore.collection("activeAlertKeys").doc(alert.activeKeyId)
      : null;
    const keySnapshot = keyReference ? await transaction.get(keyReference) : null;
    const resetReference = keyReference ? firestore.collection("alertConfirmationResets").doc(alert.activeKeyId) : null;
    const resetSnapshot = resetReference ? await transaction.get(resetReference) : null;
    const workKeyReference = nextStatus === "resolved"
      ? firestore.collection("activeWorkOrderKeys").doc(activeWorkOrderKeyId(alertId))
      : null;
    const workKeySnapshot = workKeyReference ? await transaction.get(workKeyReference) : null;
    if (workKeySnapshot?.exists) {
      throw new HttpError(409, "Complete or cancel the active work order before resolving this alert.");
    }
    transaction.update(alertReference, {
      status: nextStatus,
      statusUpdatedAt: FieldValue.serverTimestamp(),
      statusUpdatedByUid: actor.uid,
      resolvedAt: nextStatus === "resolved" ? FieldValue.serverTimestamp() : null,
      resolvedByUid: nextStatus === "resolved" ? actor.uid : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(alertReference.collection("statusHistory").doc(randomUUID()), {
      previousStatus: currentStatus,
      newStatus: nextStatus,
      actorType: "supervisor",
      actorUid: actor.uid,
      actorNameSnapshot: actor.displayName,
      actorEmailSnapshot: actor.email || null,
      note: note ?? null,
      changedAt: FieldValue.serverTimestamp(),
    });
    if (keyReference && keySnapshot?.exists && keySnapshot.data()?.alertId === alertId) {
      transaction.delete(keyReference);
    }
    if (resetReference) {
      transaction.set(resetReference!, {
        workflowVersion: alert.workflowVersion ?? WORKFLOW_VERSION,
        siteId: alert.siteId,
        zoneId: alert.zoneId,
        issueType: alert.issueType,
        resolvedAlertId: alertId,
        generation: Number(resetSnapshot?.data()?.generation ?? 0) + 1,
        resetAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
  return getAlertDetails(alertId);
}
