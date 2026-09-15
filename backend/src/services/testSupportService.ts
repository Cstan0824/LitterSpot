import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { env } from "../config/env.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { SCHEMA_VERSION } from "../shared/firestoreSchema.js";
import { priorityScore, type IssueType } from "./alertPolicy.js";
import { auditEventData, type AuditActor } from "./auditService.js";
import { enqueueOrchestratorTriggerInTransaction } from "./orchestratorTriggers.js";
import { recordKeyHash } from "./persistence.js";
import { notifySiteSupervisors } from "./notificationService.js";

type SimulatedCondition = "litter" | "spill" | "full" | "overflow";

function expectedConditions(issueType: IssueType): SimulatedCondition[] {
  if (issueType === "floor_litter") return ["litter"];
  if (issueType === "floor_spill") return ["spill"];
  return ["full", "overflow"];
}

export async function createSimulatedAlert(input: {
  siteId: string;
  cameraId: string;
  issueType: IssueType;
  condition: SimulatedCondition;
  severity: "warning" | "critical";
  confidence: number;
  clientRequestId: string;
}, actor: AuditActor, requestId: string) {
  if (env.appEnvironment === "production-cloud") throw new HttpError(404, "Route not found.");
  if (actor.role !== "supervisor" || actor.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  if (!expectedConditions(input.issueType).includes(input.condition)) throw new HttpError(400, `${input.condition} is not valid for ${input.issueType}.`);

  const [site, camera] = await Promise.all([
    firestore.collection("sites").doc(input.siteId).get(),
    firestore.collection("cameras").doc(input.cameraId).get(),
  ]);
  if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  if (!camera.exists || camera.data()?.schemaVersion !== 2 || camera.data()?.siteId !== input.siteId || camera.data()?.status !== "active") throw new HttpError(404, "Active Camera not found.");
  const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
  if (!mapRevisionId) throw new HttpError(409, "Site has no Active Map Revision.");
  const placement = await firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cameraPlacements").doc(input.cameraId).get();
  if (!placement.exists || placement.data()?.siteId !== input.siteId || !placement.data()?.zoneId || !placement.data()?.point) throw new HttpError(409, "Camera Placement is missing from the Active Map Revision.");

  const alertId = recordKeyHash("simulated-alert", input.siteId, input.cameraId, input.issueType, input.clientRequestId);
  const flagId = recordKeyHash("simulated-flag", alertId);
  const activeKeyId = recordKeyHash("active-alert", input.siteId, input.cameraId, input.issueType);
  const alertRef = firestore.collection("alerts").doc(alertId);
  const flagRef = firestore.collection("flags").doc(flagId);
  const activeKeyRef = firestore.collection("activeAlertKeys").doc(activeKeyId);
  const auditRef = firestore.collection("auditEvents").doc(recordKeyHash("simulated-alert-audit", alertId));
  const requestFingerprint = recordKeyHash("simulated-alert-request", input);
  let idempotent = false;

  await firestore.runTransaction(async (transaction) => {
    idempotent = false;
    const [existingAlert, activeKey, currentSite, currentCamera, currentPlacement] = await Promise.all([
      transaction.get(alertRef), transaction.get(activeKeyRef), transaction.get(site.ref), transaction.get(camera.ref), transaction.get(placement.ref),
    ]);
    if (currentSite.data()?.status !== "active" || currentCamera.data()?.status !== "active" || currentCamera.data()?.siteId !== input.siteId
      || currentSite.data()?.activeMapRevisionId !== mapRevisionId || !currentPlacement.exists
      || currentPlacement.data()?.siteId !== input.siteId || !currentPlacement.data()?.zoneId || !currentPlacement.data()?.point) {
      throw new HttpError(409, "Site or Camera placement changed. Refresh and retry.");
    }
    if (existingAlert.exists) {
      if (existingAlert.data()?.requestFingerprint !== requestFingerprint) throw new HttpError(409, "clientRequestId was already used with different Alert fields.");
      idempotent = true;
      return;
    }
    if (activeKey.exists) throw new HttpError(409, "An active Alert already exists for this Camera and issue type. Resolve or dismiss it before creating another simulated Alert.", { alertId: activeKey.data()?.alertId });

    const now = Date.now();
    const affectedBinIds = input.issueType === "bin_service" ? ["simulated-bin-1"] : [];
    const detection = { entityId: input.issueType === "bin_service" ? "simulated-bin-1" : "simulated-issue-1", confidence: input.confidence, condition: input.condition, geometry: null };
    transaction.create(activeKeyRef, { schemaVersion: SCHEMA_VERSION, siteId: input.siteId, cameraId: input.cameraId, issueType: input.issueType, alertId, createdAt: FieldValue.serverTimestamp() });
    transaction.create(flagRef, {
      schemaVersion: SCHEMA_VERSION,
      flagId,
      siteId: input.siteId,
      mapRevisionId,
      zoneId: String(placement.data()?.zoneId),
      zoneNameSnapshot: String(placement.data()?.zoneNameSnapshot ?? placement.data()?.zoneId),
      cameraId: input.cameraId,
      cameraNameSnapshot: String(camera.data()?.name ?? input.cameraId),
      registrationRevisionId: String(camera.data()?.activeRegistrationRevisionId ?? "simulated"),
      monitoringEpisodeId: null,
      sampleId: `simulated:${input.clientRequestId}`,
      issueType: input.issueType,
      observedCondition: input.condition,
      severityCandidate: input.severity,
      confidence: input.confidence,
      magnitude: { issueCount: 1 },
      affectedBinIds,
      detections: [detection],
      modelVersions: { testSupport: "simulated-alert-v1" },
      qualificationPolicyVersion: "simulated-alert-v1",
      qualificationSnapshot: { bypassedTemporalQualification: true, requestedByUid: actor.uid },
      capturedAt: FieldValue.serverTimestamp(),
      isSimulation: true,
      alertId,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(alertRef, {
      schemaVersion: SCHEMA_VERSION,
      alertId,
      siteId: input.siteId,
      mapRevisionId,
      zoneId: String(placement.data()?.zoneId),
      zoneNameSnapshot: String(placement.data()?.zoneNameSnapshot ?? placement.data()?.zoneId),
      cameraId: input.cameraId,
      cameraNameSnapshot: String(camera.data()?.name ?? input.cameraId),
      registrationRevisionId: String(camera.data()?.activeRegistrationRevisionId ?? "simulated"),
      issueType: input.issueType,
      observedCondition: input.condition,
      status: "waiting_for_cleaner",
      severity: input.severity,
      highestSeverity: input.severity,
      priorityScore: priorityScore({ severity: input.severity, createdAtMs: now, nowMs: now }),
      priorityPolicyVersion: "severity-age",
      nextEscalationAt: input.severity === "warning" ? Timestamp.fromMillis(now + 15 * 60_000) : null,
      firstDetectedAt: FieldValue.serverTimestamp(),
      lastDetectedAt: FieldValue.serverTimestamp(),
      occurrenceCount: 1,
      affectedBinIds,
      evidence: null,
      activeWorkOrderId: null,
      managementMode: "orchestrated",
      isSimulation: true,
      resolvedAt: null,
      resolvedBy: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissReason: null,
      testClientRequestId: input.clientRequestId,
      requestFingerprint,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      revision: 1,
    });
    transaction.create(alertRef.collection("occurrences").doc(flagId), { schemaVersion: SCHEMA_VERSION, siteId: input.siteId, alertId, flagId, capturedAt: FieldValue.serverTimestamp(), confidence: input.confidence, observedCondition: input.condition, severityCandidate: input.severity, becameEvidence: false, createdAt: FieldValue.serverTimestamp() });
    transaction.create(alertRef.collection("events").doc(recordKeyHash("simulated-alert-event", alertId)), { schemaVersion: SCHEMA_VERSION, siteId: input.siteId, alertId, type: "created", fromStatus: null, toStatus: "waiting_for_cleaner", fromSeverity: null, toSeverity: input.severity, workOrderId: null, actor: { type: "human", uid: actor.uid, role: actor.role, authority: actor.authority ?? null, displayNameSnapshot: actor.displayName }, reasonCode: "simulated_test_alert", note: null, requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null });
    transaction.create(auditRef, auditEventData({ auditEventId: auditRef.id, actor, siteId: input.siteId, siteNameSnapshot: String(site.data()?.name), action: "simulated_alert_created", resourceType: "Alert", resourceId: alertId, outcome: "succeeded", after: { cameraId: input.cameraId, issueType: input.issueType, condition: input.condition, severity: input.severity }, requestId }));
    enqueueOrchestratorTriggerInTransaction(transaction, { siteId: input.siteId, type: "assign_alert", aggregateType: "alert", aggregateId: alertId, triggerType: "simulated_alert_created", uniquenessKey: alertId });
    transaction.set(firestore.collection("cameraRuntimeStates").doc(input.cameraId), { schemaVersion: SCHEMA_VERSION, siteId: input.siteId, cameraId: input.cameraId, cleanlinessState: "alerted", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  if (!idempotent && (await firestore.collection("orchestratorConfigs").doc(input.siteId).get()).data()?.status === "paused") {
    await notifySiteSupervisors({
      siteId: input.siteId,
      type: "alert_waiting_orchestrator_paused",
      eventKey: alertId,
      title: "Alert waiting for assignment",
      body: "The Orchestrator is paused. Assign a Cleaner manually or resume automation.",
      entityType: "alert",
      entityId: alertId,
      cameraId: input.cameraId,
      alertId,
      workOrderId: null,
      severity: input.severity,
      isSimulation: true,
    });
  }

  const [alert, flag] = await Promise.all([alertRef.get(), flagRef.get()]);
  return { alert: { id: alert.id, ...alert.data() }, flag: flag.exists ? { id: flag.id, ...flag.data() } : null, idempotent };
}
