import { Router } from "express";
import { alertChildListQuerySchema } from "../schemas/alert.js";
import {
  createWorkOrderSchema,
  reassignWorkOrderSchema,
  transitionWorkOrderSchema,
  workOrderListQuerySchema,
} from "../schemas/cleanerOperations.js";
import {
  createWorkOrder,
  getWorkOrder,
  listWorkOrderHistory,
  listWorkOrders,
  reassignWorkOrder,
  transitionWorkOrder,
} from "../services/workOrderService.js";
import { getReviewContext } from "../services/reviewService.js";

export const workOrderRoutes = Router();

workOrderRoutes.get("/", async (req, res) => {
  const query = workOrderListQuerySchema.parse(req.query);
  const page = await listWorkOrders(query);
  return res.json({ workOrders: page.items, nextCursor: page.nextCursor });
});

workOrderRoutes.post("/", async (req, res) => {
  const result = await createWorkOrder(createWorkOrderSchema.parse(req.body), { type: "supervisor", id: req.supervisor.uid });
  return res.status(result.idempotent ? 200 : 201).json(result);
});

workOrderRoutes.get("/:workOrderId/history", async (req, res) => {
  const page = await listWorkOrderHistory(req.params.workOrderId, alertChildListQuerySchema.parse(req.query));
  return res.json({ history: page.items, nextCursor: page.nextCursor });
});

workOrderRoutes.get("/:workOrderId/reviews", async (req, res) => {
  return res.json(await getReviewContext(req.params.workOrderId));
});

workOrderRoutes.post("/:workOrderId/reassign", async (req, res) => {
  return res.json(await reassignWorkOrder(req.params.workOrderId, reassignWorkOrderSchema.parse(req.body), req.supervisor.uid));
});

workOrderRoutes.patch("/:workOrderId/status", async (req, res) => {
  return res.json(await transitionWorkOrder(req.params.workOrderId, transitionWorkOrderSchema.parse(req.body), {
    type: "supervisor",
    id: req.supervisor.uid,
  }));
});

workOrderRoutes.get("/:workOrderId", async (req, res) => {
  return res.json({ workOrder: await getWorkOrder(req.params.workOrderId) });
});
