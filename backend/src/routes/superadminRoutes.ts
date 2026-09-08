import { Router } from "express";
import { z } from "zod";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { getMediaContent } from "../services/mediaService.js";
import { listV2AuditEvents, writeV2AuditEvent } from "../services/v2AuditService.js";
import { createV2Site, recoverV2Root, updateV2SiteStatus } from "../services/v2SuperadminService.js";
import { getV2SuperadminAlert, getV2SuperadminAnalytics, getV2SuperadminCamera, getV2SuperadminOperationsView, getV2SuperadminSiteDetail, getV2SuperadminWork, listV2SuperadminSites, rewriteSuperadminSiteMediaUrls } from "../services/v2SuperadminReadService.js";
import { getV2SiteOperation, reconcileV2SiteOperation } from "../services/v2SiteOperationService.js";
import { getV2OrchestratorRun } from "../services/v2OrchestratorService.js";

export const superadminRoutes = Router();

superadminRoutes.get("/sites/:siteId/operations/:operationId", async (req, res) => res.json({ operation: await getV2SiteOperation(req.params.siteId, req.params.operationId) }));
superadminRoutes.post("/sites/:siteId/operations/:operationId/reconcile", async (req, res) => {
  const actor = { uid: req.authUser.uid, role: "superadmin" as const, displayName: req.authUser.displayName };
  const site = await firestore.collection("sites").doc(req.params.siteId).get();
  const before = await getV2SiteOperation(req.params.siteId, req.params.operationId);
  try {
    const operation = await reconcileV2SiteOperation(req.params.siteId, req.params.operationId);
    await writeV2AuditEvent({ actor, siteId: req.params.siteId, siteNameSnapshot: String(site.data()?.name ?? req.params.siteId), action: "site_operation_reconciled", resourceType: "SiteOperation", resourceId: req.params.operationId, outcome: "succeeded", before: { status: before.status, cursorState: before.cursorState }, after: { status: operation.status, cursorState: operation.cursorState, counts: operation.counts }, requestId: req.requestId });
    return res.json({ operation });
  } catch (error) {
    await writeV2AuditEvent({ actor, siteId: req.params.siteId, siteNameSnapshot: String(site.data()?.name ?? req.params.siteId), action: "site_operation_reconciled", resourceType: "SiteOperation", resourceId: req.params.operationId, outcome: "failed", before: { status: before.status, cursorState: before.cursorState }, errorCode: error instanceof HttpError ? `http_${error.status}` : "reconciliation_failed", requestId: req.requestId }).catch(() => undefined);
    throw error;
  }
});

superadminRoutes.get("/sites", async (req, res) => {
  const status = z.enum(["active", "inactive", "all"]).default("all").parse(req.query.status);
  return res.json({ sites: await listV2SuperadminSites(status) });
});

superadminRoutes.get("/sites/:siteId", async (req, res) => res.json(await getV2SuperadminSiteDetail(req.params.siteId)));
superadminRoutes.get("/sites/:siteId/view/operations", async (req, res) => res.json(await getV2SuperadminOperationsView(req.params.siteId)));
superadminRoutes.get("/sites/:siteId/view/alerts/:alertId", async (req, res) => res.json(rewriteSuperadminSiteMediaUrls(req.params.siteId, await getV2SuperadminAlert(req.params.siteId, req.params.alertId))));
superadminRoutes.get("/sites/:siteId/view/cameras/:cameraId", async (req, res) => res.json(rewriteSuperadminSiteMediaUrls(req.params.siteId, await getV2SuperadminCamera(req.params.siteId, req.params.cameraId))));
superadminRoutes.get("/sites/:siteId/view/work-orders/:workOrderId", async (req, res) => res.json(rewriteSuperadminSiteMediaUrls(req.params.siteId, await getV2SuperadminWork(req.params.siteId, req.params.workOrderId))));
superadminRoutes.get("/sites/:siteId/view/system/runs/:runId", async (req, res) => res.json(await getV2OrchestratorRun(req.params.siteId, req.params.runId)));
superadminRoutes.get("/sites/:siteId/view/analytics", async (req, res) => {
  const query = z.object({ from: z.string().optional(), to: z.string().optional() }).strict().parse(req.query);
  return res.json(await getV2SuperadminAnalytics(req.params.siteId, query.from, query.to));
});
superadminRoutes.get("/sites/:siteId/view/audit-events", async (req, res) => res.json({ events: await listV2AuditEvents({ siteId: req.params.siteId, actorRole: "superadmin", limit: 100 }) }));
superadminRoutes.get("/sites/:siteId/view/media/:mediaId/content", async (req, res) => {
  const record = await firestore.collection("mediaAssets").doc(req.params.mediaId).get();
  if (!record.exists || record.data()?.siteId !== req.params.siteId) throw new HttpError(404, "Media not found.");
  const media = await getMediaContent(req.params.mediaId);
  res.type(media.mimeType);
  res.setHeader("Content-Length", String(media.byteSize));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(media.originalFileName)}`);
  return res.sendFile(media.filePath, { dotfiles: "allow" });
});
superadminRoutes.get("/sites/:siteId/view/media/:mediaId/overlay", async (req, res) => {
  const record = await firestore.collection("mediaAssets").doc(req.params.mediaId).get();
  if (!record.exists || record.data()?.siteId !== req.params.siteId) throw new HttpError(404, "Media not found.");
  return res.json({ observation: record.data()?.evidenceObservation ?? null });
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
  return res.json({ events: await listV2AuditEvents({ siteId: typeof req.query.siteId === "string" ? req.query.siteId : undefined, actorUid: typeof req.query.actorUid === "string" ? req.query.actorUid : undefined, actorRole: "superadmin" }) });
});
