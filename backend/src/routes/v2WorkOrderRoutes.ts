import { Router } from "express";
import { z } from "zod";
import {
  createV2AlertWorkOrder,
  createV2ManualWorkOrder,
  dismissV2WorkOrder,
  getV2WorkOrder,
  listV2WorkEvents,
  listV2Verifications,
  listV2WorkOrders,
  reassignV2WorkOrder,
  takeOverV2WorkOrder,
  transitionV2WorkOrder,
  applyV2Verification,
} from "../services/v2WorkOrderService.js";
import { v2AlertAssignmentSchema, v2ManualWorkSchema, v2WorkDismissSchema, v2WorkListQuerySchema, v2WorkReassignSchema, v2WorkTakeoverSchema, v2WorkTransitionSchema, v2VerificationOverrideSchema, v2VerificationSchema } from "../schemas/v2WorkOrder.js";
import { HttpError } from "../shared/httpError.js";

const actor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName, type: "supervisor" as const });

export const v2WorkOrderRoutes = Router();

v2WorkOrderRoutes.get("/", async (req, res) => {
  const query = v2WorkListQuerySchema.parse(req.query);
  return res.json({ workOrders: await listV2WorkOrders(String(req.authUser.siteId), query) });
});

v2WorkOrderRoutes.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (body.target) {
    const input = v2ManualWorkSchema.parse(body);
    return res.status(201).json({ workOrder: await createV2ManualWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
  }
  const input = v2AlertAssignmentSchema.extend({ alertId: z.string().trim().min(1) }).parse(body);
  return res.status(201).json({ workOrder: await createV2AlertWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
});

v2WorkOrderRoutes.post("/manual", async (req, res) => {
  const input = v2ManualWorkSchema.parse(req.body);
  return res.status(201).json({ workOrder: await createV2ManualWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
});

v2WorkOrderRoutes.get("/:workOrderId", async (req, res) => res.json({ workOrder: await getV2WorkOrder(String(req.authUser.siteId), req.params.workOrderId) }));
v2WorkOrderRoutes.get("/:workOrderId/history", async (req, res) => res.json({ events: await listV2WorkEvents(String(req.authUser.siteId), req.params.workOrderId) }));
v2WorkOrderRoutes.get("/:workOrderId/verifications", async (req, res) => res.json({ verifications: await listV2Verifications(String(req.authUser.siteId), req.params.workOrderId) }));
v2WorkOrderRoutes.post("/:workOrderId/reassign", async (req, res) => { const input = v2WorkReassignSchema.parse(req.body); return res.json({ workOrder: await reassignV2WorkOrder({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId) }); });
v2WorkOrderRoutes.post("/:workOrderId/takeover", async (req, res) => { const input = v2WorkTakeoverSchema.parse(req.body); return res.json({ workOrder: await takeOverV2WorkOrder(String(req.authUser.siteId), req.params.workOrderId, actor(req), input.reason, input.idempotencyKey, req.requestId) }); });
v2WorkOrderRoutes.post("/:workOrderId/dismiss", async (req, res) => { const input = v2WorkDismissSchema.parse(req.body); return res.json({ workOrder: await dismissV2WorkOrder({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId) }); });
v2WorkOrderRoutes.post("/:workOrderId/verification", async (req, res) => { const input = v2VerificationSchema.parse(req.body); return res.json(await applyV2Verification({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId)); });
v2WorkOrderRoutes.post("/:workOrderId/verification/override", async (req, res) => { const input = v2VerificationOverrideSchema.parse(req.body); return res.json(await applyV2Verification({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId, override: true }, actor(req), req.requestId)); });
v2WorkOrderRoutes.patch("/:workOrderId/status", async (req, res) => {
  const input = v2WorkTransitionSchema.extend({ status: z.enum(["in_progress", "awaiting_review", "dismissed"]), completionEvidenceMediaId: z.string().nullable().optional(), reason: z.string().trim().max(500).nullable().optional(), expectedRevision: z.number().int().nonnegative().optional() }).parse(req.body);
  if (input.status === "dismissed") {
    if (input.expectedRevision === undefined || !input.reason) throw new HttpError(400, "Dismissal requires reason and expectedRevision.");
    return res.json({ workOrder: await dismissV2WorkOrder({ siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId, reason: input.reason, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey }, actor(req), req.requestId) });
  }
  return res.json({ workOrder: await transitionV2WorkOrder(String(req.authUser.siteId), req.params.workOrderId, input.status, actor(req), input, req.requestId) });
});
