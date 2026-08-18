import { Router } from "express";
import type { Request, Response } from "express";
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

export const cleanerSelfRoutes = Router();

cleanerSelfRoutes.get("/me", async (req, res) => {
  return res.json({ cleaner: await getCleaner(req.cleaner!.cleanerId) });
});

cleanerSelfRoutes.get("/presence", async (req, res) => {
  return res.json({ presence: await getCleanerPresence(req.cleaner!.cleanerId) });
});

cleanerSelfRoutes.put("/presence", async (req, res) => {
  return res.json(await updateCleanerPresence(req.cleaner!, updateCleanerPresenceSchema.parse(req.body)));
});

cleanerSelfRoutes.get("/work-orders", async (req, res) => {
  const query = workOrderListQuerySchema.parse(req.query);
  const page = await listWorkOrders({ ...query, cleanerId: req.cleaner!.cleanerId, alertId: undefined });
  return res.json({ workOrders: page.items, nextCursor: page.nextCursor });
});

cleanerSelfRoutes.get("/work-orders/:workOrderId", async (req, res) => {
  const workOrder = await getWorkOrder(req.params.workOrderId);
  if (workOrder.assignedCleanerId !== req.cleaner!.cleanerId) throw new HttpError(404, "Work order not found.");
  return res.json({ workOrder });
});

async function cleanerTransition(req: Request, res: Response, status: "accepted" | "rejected" | "in_progress" | "ready_for_review") {
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
  const input = cleanerReviewSubmissionSchema.parse(req.body);
  const result = await submitCleanerForReview(String(req.params.workOrderId), input, {
    type: "cleaner",
    id: req.cleaner!.cleanerId,
    cleaner: req.cleaner!,
  });
  return res.json(result);
});

cleanerSelfRoutes.get("/notifications", async (req, res) => {
  const query = notificationListQuerySchema.parse(req.query);
  const page = await listCleanerNotifications(req.cleaner!.cleanerId, query);
  return res.json({ notifications: page.items, nextCursor: page.nextCursor });
});

cleanerSelfRoutes.post("/notifications/:notificationId/read", async (req, res) => {
  return res.json({ notification: await markNotificationRead(req.cleaner!.cleanerId, req.params.notificationId) });
});

cleanerSelfRoutes.put("/push-token", async (req, res) => {
  const input = registerPushTokenSchema.parse(req.body);
  return res.json({ pushDevice: await registerCleanerPushToken(req.cleaner!.cleanerId, req.cleaner!.uid, input) });
});

cleanerSelfRoutes.delete("/push-token/:deviceId", async (req, res) => {
  return res.json({ pushDevice: await removeCleanerPushToken(req.cleaner!.cleanerId, req.params.deviceId) });
});
