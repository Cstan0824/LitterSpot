import { Router } from "express";
import { z } from "zod";
import {
  createAlertWorkOrder,
  createManualWorkOrder,
  dismissWorkOrder,
  getWorkOrder,
  listWorkEventsPage,
  listVerificationsPage,
  listWorkOrdersPage,
  reassignWorkOrder,
  takeOverWorkOrder,
  transitionWorkOrder,
  applyVerification,
} from "../services/workOrderService.js";
import { alertAssignmentSchema, manualWorkSchema, workDismissSchema, workListQuerySchema, workReassignSchema, workTakeoverSchema, workTransitionSchema, verificationOverrideSchema, verificationSchema } from "../schemas/workOrder.js";
import { HttpError } from "../shared/httpError.js";
import { boundedListQueryFields } from "../schemas/pagination.js";

const actor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName, type: "supervisor" as const });

export const workOrderRoutes = Router();

workOrderRoutes.get("/", async (req, res) => {
  const query = workListQuerySchema.parse(req.query);
  const page = await listWorkOrdersPage(String(req.authUser.siteId), query);
  return res.json({ workOrders: page.items, ...page });
});

workOrderRoutes.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (body.target) {
    const input = manualWorkSchema.parse(body);
    return res.status(201).json({ workOrder: await createManualWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
  }
  const input = alertAssignmentSchema.extend({ alertId: z.string().trim().min(1) }).parse(body);
  return res.status(201).json({ workOrder: await createAlertWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
});

workOrderRoutes.post("/manual", async (req, res) => {
  const input = manualWorkSchema.parse(req.body);
  return res.status(201).json({ workOrder: await createManualWorkOrder({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
});

workOrderRoutes.get("/:workOrderId", async (req, res) => res.json({ workOrder: await getWorkOrder(String(req.authUser.siteId), req.params.workOrderId) }));
workOrderRoutes.get("/:workOrderId/history", async (req, res) => { const query = z.object(boundedListQueryFields).strict().parse(req.query); const page = await listWorkEventsPage(String(req.authUser.siteId), req.params.workOrderId, query); return res.json({ events: page.items, ...page }); });
workOrderRoutes.get("/:workOrderId/verifications", async (req, res) => { const query = z.object({ ...boundedListQueryFields, limit: boundedListQueryFields.limit.default(20) }).strict().parse(req.query); const page = await listVerificationsPage(String(req.authUser.siteId), req.params.workOrderId, query); return res.json({ verifications: page.items, ...page }); });
workOrderRoutes.post("/:workOrderId/reassign", async (req, res) => { const input = workReassignSchema.parse(req.body); return res.json({ workOrder: await reassignWorkOrder({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId) }); });
workOrderRoutes.post("/:workOrderId/takeover", async (req, res) => { const input = workTakeoverSchema.parse(req.body); return res.json({ workOrder: await takeOverWorkOrder(String(req.authUser.siteId), req.params.workOrderId, actor(req), input.reason, input.idempotencyKey, req.requestId) }); });
workOrderRoutes.post("/:workOrderId/dismiss", async (req, res) => { const input = workDismissSchema.parse(req.body); return res.json({ workOrder: await dismissWorkOrder({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId) }); });
workOrderRoutes.post("/:workOrderId/verification", async (req, res) => { const input = verificationSchema.parse(req.body); return res.json(await applyVerification({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId }, actor(req), req.requestId)); });
workOrderRoutes.post("/:workOrderId/verification/override", async (req, res) => { const input = verificationOverrideSchema.parse(req.body); return res.json(await applyVerification({ ...input, siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId, override: true }, actor(req), req.requestId)); });
workOrderRoutes.patch("/:workOrderId/status", async (req, res) => {
  const input = workTransitionSchema.extend({ status: z.enum(["in_progress", "awaiting_review", "dismissed"]), completionEvidenceMediaId: z.string().nullable().optional(), reason: z.string().trim().max(500).nullable().optional(), expectedRevision: z.number().int().nonnegative().optional() }).parse(req.body);
  if (input.status === "dismissed") {
    if (input.expectedRevision === undefined || !input.reason) throw new HttpError(400, "Dismissal requires reason and expectedRevision.");
    return res.json({ workOrder: await dismissWorkOrder({ siteId: String(req.authUser.siteId), workOrderId: req.params.workOrderId, reason: input.reason, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey }, actor(req), req.requestId) });
  }
  return res.json({ workOrder: await transitionWorkOrder(String(req.authUser.siteId), req.params.workOrderId, input.status, actor(req), input, req.requestId) });
});
