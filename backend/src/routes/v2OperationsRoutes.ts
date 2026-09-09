import { Router } from "express";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { listV2NotificationsPage } from "../services/v2NotificationService.js";
import { listV2AuditEventsPage } from "../services/v2AuditService.js";
import { boundedListQueryFields } from "../schemas/pagination.js";
import { getV2SystemView } from "../services/v2SystemService.js";

export const v2OperationsRoutes = Router();
v2OperationsRoutes.get("/notifications", async (req, res) => {
  const query = z.object(boundedListQueryFields).strict().parse(req.query);
  const page = await listV2NotificationsPage(String(req.authUser.siteId), req.authUser.uid, query);
  return res.json({ notifications: page.items, ...page });
});
v2OperationsRoutes.get("/system", async (req, res) => res.json(await getV2SystemView(String(req.authUser.siteId))));
v2OperationsRoutes.get("/audit-events", requireRootSupervisor, async (req, res) => { const query = z.object({ ...boundedListQueryFields, siteId: z.string().optional() }).strict().parse(req.query); const page = await listV2AuditEventsPage({ siteId: String(req.authUser.siteId), limit: query.limit, cursor: query.cursor }); return res.json({ events: page.items, ...page }); });
