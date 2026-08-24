import { Router } from "express";
import {
  analyticsReportParamsSchema,
  generateAnalyticsReportSchema,
  listAnalyticsReportsSchema,
  reconcileAnalyticsSchema,
} from "../schemas/analyticsApi.js";
import {
  analyticsReportCsv,
  generateAnalyticsReport,
  getAnalyticsReport,
  listAnalyticsReports,
  reconcileSiteAnalytics,
} from "../services/analyticsService.js";

export const analyticsRoutes = Router();

analyticsRoutes.get("/reports", async (req, res) => {
  const query = listAnalyticsReportsSchema.parse(req.query);
  return res.json(await listAnalyticsReports(query));
});

analyticsRoutes.post("/reports", async (req, res) => {
  const input = generateAnalyticsReportSchema.parse(req.body);
  return res.status(201).json(await generateAnalyticsReport(input, req.supervisor.uid));
});

analyticsRoutes.get("/reports/:reportId/csv", async (req, res) => {
  const { reportId } = analyticsReportParamsSchema.parse(req.params);
  const csv = await analyticsReportCsv(reportId);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="litterspot-priority-zones-${reportId}.csv"`);
  return res.send(csv);
});

analyticsRoutes.get("/reports/:reportId", async (req, res) => {
  const { reportId } = analyticsReportParamsSchema.parse(req.params);
  return res.json(await getAnalyticsReport(reportId));
});

analyticsRoutes.post("/reconcile", async (req, res) => {
  const { siteId } = reconcileAnalyticsSchema.parse(req.body);
  return res.json({ reconciliation: await reconcileSiteAnalytics(siteId, req.supervisor.uid) });
});

