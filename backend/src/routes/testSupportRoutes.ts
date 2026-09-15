import { Router } from "express";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { createSimulatedAlert } from "../services/testSupportService.js";

export const testSupportRoutes = Router();
testSupportRoutes.use(requireRootSupervisor);

testSupportRoutes.post("/alerts", async (req, res) => {
  const input = z.object({
    cameraId: z.string().trim().min(1),
    issueType: z.enum(["floor_litter", "floor_spill", "bin_service"]),
    condition: z.enum(["litter", "spill", "full", "overflow"]),
    severity: z.enum(["warning", "critical"]),
    confidence: z.number().min(0).max(1).default(0.99),
    clientRequestId: z.string().trim().min(8).max(160),
  }).strict().parse(req.body);
  const actor = { uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName };
  return res.status(201).json(await createSimulatedAlert({ ...input, siteId: String(req.authUser.siteId) }, actor, req.requestId));
});
