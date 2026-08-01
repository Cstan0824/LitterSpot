import { Router } from "express";
import { z } from "zod";
import { operationsClient } from "../services/operationsClient.js";

export const operationsRoutes = Router();
const alertStatusSchema = z.object({
  status: z.enum(["active", "resolved", "dismissed"]),
  operatorName: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().max(500).optional(),
});

operationsRoutes.get("/dashboard", async (_req, res, next) => {
  try { return res.json(await operationsClient.dashboard()); }
  catch (error) { next(error); }
});

operationsRoutes.get("/alerts", async (req, res, next) => {
  try {
    const params = z.object({ status: z.string().optional(), severity: z.string().optional(), kind: z.string().optional() }).parse(req.query);
    return res.json(await operationsClient.alerts(params));
  } catch (error) { next(error); }
});

operationsRoutes.patch("/alerts/:alertId/status", async (req, res, next) => {
  try {
    const update = alertStatusSchema.parse(req.body);
    return res.json(await operationsClient.updateAlertStatus(req.params.alertId, update.status, update.operatorName, update.note));
  } catch (error) { next(error); }
});

operationsRoutes.get("/history", async (req, res, next) => {
  try {
    const params = z.object({ query: z.string().optional(), kind: z.string().optional() }).parse(req.query);
    return res.json(await operationsClient.history(params));
  } catch (error) { next(error); }
});

operationsRoutes.get("/placement", async (_req, res, next) => {
  try { return res.json(await operationsClient.placement()); }
  catch (error) { next(error); }
});

operationsRoutes.get("/evidence/:analysisId", async (req, res, next) => {
  try {
    const response = await operationsClient.evidence(req.params.analysisId);
    const contentType = response.headers["content-type"];
    if (typeof contentType === "string") res.type(contentType);
    response.data.pipe(res);
  } catch (error) { next(error); }
});
