import { Router } from "express";
import { dashboardQuerySchema, dashboardSiteSchema } from "../schemas/dashboard.js";
import { getDashboard } from "../services/dashboardService.js";
import { getDashboardSummary, reconcileDashboardSummary } from "../services/dashboardSummary.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/summary", async (req, res) => {
  const query = dashboardSiteSchema.parse(req.query);
  return res.json({ summary: await getDashboardSummary(query.siteId) });
});

dashboardRoutes.post("/reconcile", async (req, res) => {
  const input = dashboardSiteSchema.parse(req.body);
  return res.json({ summary: await reconcileDashboardSummary(input.siteId, req.supervisor.uid) });
});

dashboardRoutes.get("/", async (req, res) => {
  const query = dashboardQuerySchema.parse(req.query);
  return res.json({ dashboard: await getDashboard(query) });
});
