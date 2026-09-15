import { Router } from "express";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { listNotificationsPage } from "../services/notificationService.js";
import { listAuditEventsPage } from "../services/auditService.js";
import { boundedListQueryFields } from "../schemas/pagination.js";
import { getSystemView } from "../services/systemService.js";

export const operationsRoutes = Router();
operationsRoutes.get("/notifications", async (req, res) => {
  const query = z.object(boundedListQueryFields).strict().parse(req.query);
  const page = await listNotificationsPage(String(req.authUser.siteId), req.authUser.uid, query);
  return res.json({ notifications: page.items, ...page });
});
operationsRoutes.get("/system", async (req, res) => res.json(await getSystemView(String(req.authUser.siteId))));
operationsRoutes.get("/audit-events", requireRootSupervisor, async (req, res) => { const query = z.object({ ...boundedListQueryFields, siteId: z.string().optional() }).strict().parse(req.query); const page = await listAuditEventsPage({ siteId: String(req.authUser.siteId), limit: query.limit, cursor: query.cursor }); return res.json({ events: page.items, ...page }); });
