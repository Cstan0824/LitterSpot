import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { ageV2Alerts, getV2Alert, listV2AlertsPage } from "../services/v2AlertService.js";
import { canonicalHash } from "../services/v2Persistence.js";
import { createV2AlertWorkOrder } from "../services/v2WorkOrderService.js";
import { clearV2EvidenceCandidate } from "../services/v2LiveMonitoringService.js";
import { publishCameraWorkflow } from "../services/cameraLiveEvents.js";
import { updateCameraRuntimeSnapshot } from "../services/monitoringRuntimeRegistry.js";
import { boundedListQueryFields } from "../schemas/pagination.js";

export const v2AlertRoutes = Router();
v2AlertRoutes.get("/", async (req, res) => {
  const query = z.object({ ...boundedListQueryFields, status: z.enum(["all", "unresolved", "waiting_for_cleaner", "assigned", "in_progress", "awaiting_review", "resolved", "dismissed"]).default("all"), zoneId: z.string().trim().min(1).optional(), cameraId: z.string().trim().min(1).optional(), severity: z.enum(["warning", "critical"]).optional() }).strict().parse(req.query);
  const page = await listV2AlertsPage(String(req.authUser.siteId), query);
  return res.json({ alerts: page.items, ...page });
});
v2AlertRoutes.get("/:alertId", async (req, res) => res.json(await getV2Alert(String(req.authUser.siteId), String(req.params.alertId))));
v2AlertRoutes.post("/age", async (req, res) => res.json({ alertsChanged: await ageV2Alerts(String(req.authUser.siteId), new Date()) }));
v2AlertRoutes.post("/:alertId/dismiss", async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(1).max(500), expectedRevision: z.number().int().nonnegative() }).strict().parse(req.body); const alertRef = firestore.collection("alerts").doc(String(req.params.alertId));
  await firestore.runTransaction(async (transaction) => { const alert = await transaction.get(alertRef); if (!alert.exists || alert.data()?.siteId !== req.authUser.siteId) throw new HttpError(404, "Alert not found."); if (alert.data()?.revision !== input.expectedRevision) throw new HttpError(409, "The Alert changed. Refresh and retry."); if (["resolved", "dismissed"].includes(String(alert.data()?.status))) throw new HttpError(409, "Alert is already terminal."); if (alert.data()?.activeWorkOrderId) throw new HttpError(409, "Dismiss the linked Work Order through the Work workflow."); const event = alertRef.collection("events").doc(); transaction.update(alertRef, { status: "dismissed", dismissedAt: FieldValue.serverTimestamp(), dismissedBy: { type: "human", uid: req.authUser.uid, role: "supervisor", authority: req.authUser.authority, displayNameSnapshot: req.authUser.displayName }, dismissReason: input.reason, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); transaction.delete(firestore.collection("activeAlertKeys").doc(canonicalHash("v2-active-alert", req.authUser.siteId, alert.data()?.cameraId, alert.data()?.issueType))); transaction.create(event, { schemaVersion: 2, siteId: req.authUser.siteId, alertId: alert.id, type: "dismissed", fromStatus: alert.data()?.status, toStatus: "dismissed", fromSeverity: alert.data()?.severity, toSeverity: alert.data()?.severity, workOrderId: null, actor: { type: "human", uid: req.authUser.uid, role: "supervisor", authority: req.authUser.authority, displayNameSnapshot: req.authUser.displayName }, reasonCode: "supervisor_dismissed", note: input.reason, requestId: req.requestId, occurredAt: FieldValue.serverTimestamp(), analyticsAppliedVersion: null, analyticsAppliedAt: null }); });
  const dismissed = (await alertRef.get()).data()!;
  clearV2EvidenceCandidate(String(req.authUser.siteId), dismissed.cameraId, dismissed.issueType);
  if (dismissed.cameraId) {
    updateCameraRuntimeSnapshot(String(req.authUser.siteId), String(dismissed.cameraId), { cleanlinessState: "clean" });
    publishCameraWorkflow(String(req.authUser.siteId), String(dismissed.cameraId));
  }
  return res.json({ alertId: req.params.alertId, status: "dismissed" });
});

v2AlertRoutes.post("/:alertId/manual-assignment", async (req, res) => {
  const input = z.object({ assignedCleanerId: z.string().trim().min(1), idempotencyKey: z.string().trim().min(8).max(160) }).strict().parse(req.body);
  return res.status(201).json({ workOrder: await createV2AlertWorkOrder({ siteId: String(req.authUser.siteId), alertId: req.params.alertId, ...input }, { uid: req.authUser.uid, role: "supervisor", authority: req.authUser.authority, displayName: req.authUser.displayName, type: "supervisor" }, req.requestId) });
});
