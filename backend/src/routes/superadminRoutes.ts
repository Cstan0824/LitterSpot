import { Router } from "express";
import { z } from "zod";
import { listV2AuditEvents } from "../services/v2AuditService.js";
import { createV2Site, recoverV2Root, updateV2SiteStatus } from "../services/v2SuperadminService.js";

export const superadminRoutes = Router();

superadminRoutes.get("/sites", async (_req, res) => {
  const status = z.enum(["active", "inactive", "all"]).default("all").parse(_req.query.status);
  const snapshot = await import("../config/firebase.js").then(({ firestore }) => firestore.collection("sites").limit(200).get());
  const sites = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as { id: string; status?: string })).filter((site) => status === "all" || site.status === status);
  return res.json({ sites });
});

superadminRoutes.post("/sites", async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(120), timeZone: z.string().trim().min(1), description: z.string().trim().max(500).nullable().optional(),
    widthMeters: z.number().finite().positive(), heightMeters: z.number().finite().positive(), gridSizeMeters: z.number().finite().positive(),
    backgroundMediaId: z.string().trim().min(1).nullable().optional(), rootEmail: z.string().trim().email(), rootPassword: z.string().min(8).max(128),
    rootDisplayName: z.string().trim().min(2).max(80), idempotencyKey: z.string().trim().min(8).max(160),
  }).strict().parse(req.body);
  const result = await createV2Site(input, { uid: req.authUser.uid, role: "superadmin", displayName: req.authUser.displayName }, req.requestId);
  return res.status(result.replayed ? 200 : 201).json(result);
});

superadminRoutes.patch("/sites/:siteId/status", async (req, res) => {
  const input = z.object({ status: z.enum(["active", "inactive"]), reason: z.string().min(1).max(500) }).parse(req.body);
  const result = await updateV2SiteStatus(req.params.siteId, input.status, input.reason, { uid: req.authUser.uid, role: "superadmin", displayName: req.authUser.displayName }, req.requestId);
  return res.json({ site: result });
});

superadminRoutes.post("/sites/:siteId/root-recovery", async (req, res) => {
  const input = z.object({ mode: z.enum(["reset_existing", "replace"]), email: z.string().trim().email().optional(), password: z.string().min(8).max(128), displayName: z.string().trim().min(2).max(80), reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().trim().min(8).max(160) }).strict().parse(req.body);
  return res.json({ result: await recoverV2Root({ ...input, siteId: req.params.siteId }, { uid: req.authUser.uid, role: "superadmin", displayName: req.authUser.displayName }, req.requestId) });
});

superadminRoutes.get("/audit-events", async (req, res) => {
  return res.json({ events: await listV2AuditEvents({ siteId: typeof req.query.siteId === "string" ? req.query.siteId : undefined, actorUid: typeof req.query.actorUid === "string" ? req.query.actorUid : undefined }) });
});
