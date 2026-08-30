import { Router } from "express";
import { z } from "zod";
import { createV2RegularSupervisor, listV2Supervisors, updateV2Supervisor } from "../services/v2IdentityService.js";

export const v2SupervisorAccountRoutes = Router();

v2SupervisorAccountRoutes.get("/", async (req, res) => {
  return res.json({ supervisors: await listV2Supervisors(String(req.authUser.siteId)) });
});

v2SupervisorAccountRoutes.post("/", async (req, res) => {
  if (req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  const input = z.object({
    email: z.string().trim().email(), password: z.string().min(8).max(128), fullName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(30).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(160),
  }).strict().parse(req.body);
  const result = await createV2RegularSupervisor({ ...input, siteId: String(req.authUser.siteId) }, { uid: req.authUser.uid, role: "supervisor", authority: "root", displayName: req.authUser.displayName }, req.requestId);
  return res.status(result.replayed ? 200 : 201).json({ supervisor: result });
});

v2SupervisorAccountRoutes.patch("/:supervisorUid", async (req, res) => {
  if (req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  const input = z.object({
    fullName: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(), expectedRevision: z.number().int().nonnegative(),
  }).strict().refine((value) => value.fullName !== undefined || value.phone !== undefined || value.status !== undefined, "At least one change is required.").parse(req.body);
  return res.json({ supervisor: await updateV2Supervisor({ ...input, siteId: String(req.authUser.siteId), supervisorUid: req.params.supervisorUid }, { uid: req.authUser.uid, role: "supervisor", authority: "root", displayName: req.authUser.displayName }, req.requestId) });
});
