import { Router } from "express";
import { z } from "zod";
import { createRegularSupervisor, listSupervisorsPage, updateSupervisor } from "../services/identityService.js";
import { boundedListQueryFields } from "../schemas/pagination.js";

export const supervisorAccountRoutes = Router();

supervisorAccountRoutes.get("/", async (req, res) => {
  const query = z.object({ ...boundedListQueryFields, status: z.enum(["active", "inactive", "all"]).default("all") }).strict().parse(req.query);
  const page = await listSupervisorsPage(String(req.authUser.siteId), req.authUser.authority === "root" ? "root" : "regular", query);
  return res.json({ supervisors: page.items, ...page });
});

supervisorAccountRoutes.post("/", async (req, res) => {
  if (req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  const input = z.object({
    email: z.string().trim().email(), password: z.string().min(8).max(128), fullName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(30).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(160),
  }).strict().parse(req.body);
  const result = await createRegularSupervisor({ ...input, siteId: String(req.authUser.siteId) }, { uid: req.authUser.uid, role: "supervisor", authority: "root", displayName: req.authUser.displayName }, req.requestId);
  return res.status(result.replayed ? 200 : 201).json({ supervisor: result });
});

supervisorAccountRoutes.patch("/:supervisorUid", async (req, res) => {
  if (req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  const input = z.object({
    fullName: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(), expectedRevision: z.number().int().nonnegative(),
  }).strict().refine((value) => value.fullName !== undefined || value.phone !== undefined || value.status !== undefined, "At least one change is required.").parse(req.body);
  return res.json({ supervisor: await updateSupervisor({ ...input, siteId: String(req.authUser.siteId), supervisorUid: req.params.supervisorUid }, { uid: req.authUser.uid, role: "supervisor", authority: "root", displayName: req.authUser.displayName }, req.requestId) });
});
