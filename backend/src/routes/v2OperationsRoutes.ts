import { Router } from "express";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { listV2Notifications } from "../services/v2NotificationService.js";
import { listV2AuditEvents } from "../services/v2AuditService.js";
import { getV2SystemView } from "../services/v2SystemService.js";

export const v2OperationsRoutes = Router();
v2OperationsRoutes.get("/notifications", async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
  return res.json({ notifications: await listV2Notifications(String(req.authUser.siteId), req.authUser.uid, limit) });
});
v2OperationsRoutes.get("/system", async (req, res) => res.json(await getV2SystemView(String(req.authUser.siteId))));
v2OperationsRoutes.get("/audit-events", requireRootSupervisor, async (req, res) => res.json({ events: await listV2AuditEvents({ siteId: String(req.authUser.siteId) }) }));
