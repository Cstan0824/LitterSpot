import { Router } from "express";
import { alertChildListQuerySchema, alertListQuerySchema, alertStatusUpdateSchema } from "../schemas/alert.js";
import { getAlertDetails, listAlertHistory, listAlertOccurrences, listAlerts, updateAlertStatus } from "../services/alertWorkflowService.js";
import { ALERT_POLICY } from "../services/alertPolicy.js";

export const alertRoutes = Router();

alertRoutes.get("/", async (req, res) => {
  const query = alertListQuerySchema.parse(req.query);
  const page = await listAlerts(query);
  return res.json({ alerts: page.items, nextCursor: page.nextCursor, ...(
    page.paginationMode ? {
      paginationMode: page.paginationMode,
      resultCompleteness: page.resultCompleteness,
      scannedCount: page.scannedCount,
    } : {}
  ) });
});

alertRoutes.get("/policy", (_req, res) => {
  return res.json({ alertPolicy: ALERT_POLICY });
});

alertRoutes.get("/:alertId/history", async (req, res) => {
  const query = alertChildListQuerySchema.parse(req.query);
  const page = await listAlertHistory(req.params.alertId, query);
  return res.json({ history: page.items, nextCursor: page.nextCursor });
});

alertRoutes.get("/:alertId/occurrences", async (req, res) => {
  const query = alertChildListQuerySchema.parse(req.query);
  const page = await listAlertOccurrences(req.params.alertId, query);
  return res.json({ occurrences: page.items, nextCursor: page.nextCursor });
});

alertRoutes.get("/:alertId", async (req, res) => {
  return res.json(await getAlertDetails(req.params.alertId));
});

alertRoutes.patch("/:alertId/status", async (req, res) => {
  const update = alertStatusUpdateSchema.parse(req.body);
  return res.json(await updateAlertStatus(req.params.alertId, update.status, req.supervisor, update.note));
});
