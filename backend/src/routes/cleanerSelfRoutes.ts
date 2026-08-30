import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  cleanerWorkOrderActionSchema,
  notificationListQuerySchema,
  registerPushTokenSchema,
  updateCleanerPresenceSchema,
  workOrderListQuerySchema,
} from "../schemas/cleanerOperations.js";
import { cleanerReviewSubmissionSchema } from "../schemas/review.js";
import { getCleaner } from "../services/cleanerService.js";
import { getCleanerPresence, updateCleanerPresence } from "../services/cleanerPresenceService.js";
import {
  listCleanerNotifications,
  markNotificationRead,
  registerCleanerPushToken,
  removeCleanerPushToken,
} from "../services/notificationService.js";
import { getWorkOrder, listWorkOrders, transitionWorkOrder } from "../services/workOrderService.js";
import { submitCleanerForReview } from "../services/reviewService.js";
import { HttpError } from "../shared/httpError.js";
import { presentV2Cleaner } from "../services/v2CleanerService.js";
import { getV2WorkOrder, listV2WorkOrders, transitionV2WorkOrder, uploadV2CompletionEvidence } from "../services/v2WorkOrderService.js";

export const cleanerSelfRoutes = Router();
const v2EvidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const isV2Cleaner = (req: Request) => Boolean(req.authUser.siteId && req.cleaner?.assignedZoneId === "");
const ACTIVE = ["assigned", "in_progress", "awaiting_review"];

cleanerSelfRoutes.get("/me", async (req, res) => {
  return res.json({ cleaner: await presentV2Cleaner(req.cleaner!.cleanerId, String(req.authUser.siteId)) });
});

cleanerSelfRoutes.get("/work-orders", async (req, res) => {
  if (isV2Cleaner(req)) {
    const status = z.enum(["assigned", "in_progress", "awaiting_review", "resolved", "dismissed", "active", "all"]).default("active").parse(req.query.status);
    const limit = Math.min(Math.max(Number(String(req.query.limit ?? 25)) || 25, 1), 100);
    if (status !== "active" && status !== "all") return res.json({ workOrders: await listV2WorkOrders(String(req.authUser.siteId), { status, cleanerId: req.cleaner!.cleanerId, limit: status === "resolved" || status === "dismissed" ? Math.min(limit, 5) : limit }) });
    const all = await listV2WorkOrders(String(req.authUser.siteId), { status: "all", cleanerId: req.cleaner!.cleanerId, limit: 100 });
    const active = all.filter((work) => ACTIVE.includes(work.status));
    const recentTerminal = all.filter((work) => ["resolved", "dismissed"].includes(work.status)).slice(0, 5);
    return res.json({ workOrders: status === "active" ? active : [...active, ...recentTerminal] });
  }
  const query = workOrderListQuerySchema.parse(req.query);
  const page = await listWorkOrders({ ...query, cleanerId: req.cleaner!.cleanerId, alertId: undefined });
  return res.json({ workOrders: page.items, nextCursor: page.nextCursor });
});

cleanerSelfRoutes.get("/work-orders/:workOrderId", async (req, res) => {
  if (isV2Cleaner(req)) {
    const workOrder = await getV2WorkOrder(String(req.authUser.siteId), String(req.params.workOrderId));
    if (workOrder.assignedCleanerId !== req.cleaner!.cleanerId) throw new HttpError(404, "Work order not found.");
    return res.json({ workOrder });
  }
  const workOrder = await getWorkOrder(req.params.workOrderId);
  if (workOrder.assignedCleanerId !== req.cleaner!.cleanerId) throw new HttpError(404, "Work order not found.");
  return res.json({ workOrder });
});

async function cleanerTransition(req: Request, res: Response, status: "accepted" | "rejected" | "in_progress" | "ready_for_review") {
  if (isV2Cleaner(req)) {
    if (status === "accepted" || status === "rejected") throw new HttpError(404, "This Cleaner action is not available in V2.");
    const input = z.object({ idempotencyKey: z.string().trim().min(8).max(160), completionEvidenceMediaId: z.string().trim().min(1).nullable().optional() }).strict().parse(req.body);
    return res.json({ workOrder: await transitionV2WorkOrder(String(req.authUser.siteId), String(req.params.workOrderId), status === "in_progress" ? "in_progress" : "awaiting_review", { ...req.authUser, type: "cleaner", cleanerId: req.cleaner!.cleanerId } as any, input, req.requestId) });
  }
  const input = cleanerWorkOrderActionSchema.parse(req.body);
  const result = await transitionWorkOrder(String(req.params.workOrderId), { ...input, status }, {
    type: "cleaner",
    id: req.cleaner!.cleanerId,
    cleaner: req.cleaner!,
  });
  return res.json(result);
}

cleanerSelfRoutes.post("/work-orders/:workOrderId/accept", async (req, res) => cleanerTransition(req, res, "accepted"));
cleanerSelfRoutes.post("/work-orders/:workOrderId/reject", async (req, res) => cleanerTransition(req, res, "rejected"));
cleanerSelfRoutes.post("/work-orders/:workOrderId/start", async (req, res) => cleanerTransition(req, res, "in_progress"));
cleanerSelfRoutes.post("/work-orders/:workOrderId/ready-for-review", async (req, res) => {
  if (isV2Cleaner(req)) {
    const input = z.object({ idempotencyKey: z.string().trim().min(8).max(160), completionEvidenceMediaId: z.string().trim().min(1).nullable().optional() }).strict().parse(req.body);
    return res.json({ workOrder: await transitionV2WorkOrder(String(req.authUser.siteId), String(req.params.workOrderId), "awaiting_review", { ...req.authUser, type: "cleaner", cleanerId: req.cleaner!.cleanerId } as any, input, req.requestId) });
  }
  const input = cleanerReviewSubmissionSchema.parse(req.body);
  const result = await submitCleanerForReview(String(req.params.workOrderId), input, {
    type: "cleaner",
    id: req.cleaner!.cleanerId,
    cleaner: req.cleaner!,
  });
  return res.json(result);
});

cleanerSelfRoutes.post("/work-orders/:workOrderId/completion-evidence", v2EvidenceUpload.single("photo"), async (req, res) => {
  if (!isV2Cleaner(req)) throw new HttpError(404, "Route not found.");
  if (!req.file) throw new HttpError(400, "A completion photo is required.");
  return res.status(201).json({ evidence: await uploadV2CompletionEvidence({ siteId: String(req.authUser.siteId), workOrderId: String(req.params.workOrderId), cleanerId: req.cleaner!.cleanerId, file: req.file }) });
});

cleanerSelfRoutes.get("/notifications", async (req, res) => {
  const query = notificationListQuerySchema.parse(req.query);
  const page = await listCleanerNotifications(req.cleaner!.cleanerId, query);
  return res.json({ notifications: page.items, nextCursor: page.nextCursor });
});
