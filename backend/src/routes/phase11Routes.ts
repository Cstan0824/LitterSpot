import { Router } from "express";
import { z } from "zod";
import { validLocalDate } from "../services/phase11Calendar.js";
import {
  buildDashboard,
  cleanupMinuteBuckets,
  compareIntervention,
  getBinPlacementSnapshot,
  getDashboard,
  getDailySummaries,
  implementBinPlacement,
  listInterventions,
  rebuildDailySummaries,
  refreshBinPlacement,
} from "../services/phase11Service.js";

const date = z.string().refine(validLocalDate, "Invalid calendar date");
const daysSchema = z.coerce.number().int().min(2).max(3660);
const actor = (req: any) => ({
  uid: req.authUser.uid,
  role: "supervisor",
  authority: req.authUser.authority,
  displayName: req.authUser.displayName,
});
export const phase11DashboardRoutes = Router();
phase11DashboardRoutes.get("/", async (req, res) =>
  res.json({ dashboard: await getDashboard(String(req.authUser.siteId)) }),
);
phase11DashboardRoutes.post("/refresh", async (req, res) =>
  res
    .status(201)
    .json({ dashboard: await buildDashboard(String(req.authUser.siteId)) }),
);

export const phase11AnalyticsRoutes = Router();
phase11AnalyticsRoutes.get("/daily", async (req, res) => {
  const q = z
    .object({ from: date.optional(), to: date.optional() })
    .strict()
    .parse(req.query);
  return res.json({
    summaries: await getDailySummaries(
      String(req.authUser.siteId),
      q.from,
      q.to,
    ),
  });
});
phase11AnalyticsRoutes.post("/daily/rebuild", async (req, res) => {
  const input = z
    .object({
      localDate: date.optional(),
      dates: z
        .array(date).min(1)
        .max(31)
        .optional(),
    })
    .strict().refine(body => Boolean(body.localDate) !== Boolean(body.dates), "Supply localDate or dates, not both")
    .parse(req.body);
  const dates = [...new Set(input.dates ?? [input.localDate!])];
  return res.json({
    summaries: await rebuildDailySummaries(String(req.authUser.siteId), dates),
  });
});
phase11AnalyticsRoutes.post("/minute/cleanup", async (req, res) =>
  res.json({
    deleted: await cleanupMinuteBuckets(String(req.authUser.siteId)),
  }),
);

export const phase11BinPlacementRoutes = Router();
phase11BinPlacementRoutes.get("/recommendations", async (req, res) => {
  const days = daysSchema.optional().parse(req.query.days);
  return res.json({ snapshot: await getBinPlacementSnapshot(String(req.authUser.siteId), days) });
});
phase11BinPlacementRoutes.post("/recommendations/refresh", async (req, res) => {
  const input = z
    .object({ days: z.number().int().min(2).max(3660).default(30) })
    .strict()
    .parse(req.body);
  return res
    .status(201)
    .json({
      snapshot: await refreshBinPlacement(
        String(req.authUser.siteId),
        input.days,
        actor(req),
      ),
    });
});
phase11BinPlacementRoutes.post("/zones/:zoneId/implement", async (req, res) => {
  const input = z
    .object({ note: z.string().trim().max(500).nullable().optional(), snapshotCalculatedAt: z.string().datetime({ offset: true }) })
    .strict()
    .parse(req.body);
  return res
    .status(201)
    .json({
      intervention: await implementBinPlacement(
        String(req.authUser.siteId),
        req.params.zoneId,
        actor(req),
        input.note ?? undefined,
        new Date(), input.snapshotCalculatedAt,
      ),
    });
});
phase11BinPlacementRoutes.get("/interventions", async (req, res) =>
  res.json({
    interventions: await listInterventions(String(req.authUser.siteId)),
  }),
);
phase11BinPlacementRoutes.get(
  "/interventions/:id/comparison",
  async (req, res) => {
    const days = z.coerce
      .number()
      .int()
      .min(2)
      .max(3660)
      .default(2)
      .parse(req.query.days);
    return res.json({
      comparison: await compareIntervention(
        String(req.authUser.siteId),
        req.params.id,
        days,
      ),
    });
  },
);
