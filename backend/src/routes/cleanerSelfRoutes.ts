import { Router } from "express";
import { getMediaContent } from "../services/mediaService.js";
import { serializeFirestore } from "../services/presentation.js";
import { firestore } from "../config/firebase.js";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { HttpError } from "../shared/httpError.js";
import { presentCleaner } from "../services/cleanerService.js";
import { getCleanerMap } from "../services/mapService.js";
import { listNotificationsPage } from "../services/notificationService.js";
import { getWorkOrder, listWorkOrders, transitionWorkOrder, uploadCompletionEvidence } from "../services/workOrderService.js";
import { opaqueCursorSchema } from "../schemas/pagination.js";

export const cleanerSelfRoutes = Router();
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const ACTIVE = ["assigned", "in_progress", "awaiting_review"];

cleanerSelfRoutes.get("/me", async (req, res) => {
  return res.json({ cleaner: await presentCleaner(req.cleaner!.cleanerId, String(req.authUser.siteId)) });
});

cleanerSelfRoutes.get("/work-orders/:workOrderId/camera-evidence", async (req, res) => {
  const work = await getWorkOrder(String(req.authUser.siteId), String(req.params.workOrderId));
  if (work.assignedCleanerId !== req.cleaner!.cleanerId || !work.alertId) throw new HttpError(404, "Camera evidence not found.");
  const alert = await firestore.collection("alerts").doc(work.alertId).get();
  if (alert.data()?.siteId !== req.authUser.siteId || !alert.data()?.evidence?.mediaId) throw new HttpError(404, "Camera evidence not found.");
  if (req.query.content === "true") {
    const media = await getMediaContent(alert.data()!.evidence.mediaId);
    return res.type(media.mimeType).sendFile(media.filePath, { dotfiles: "allow" });
  }
  return res.json(serializeFirestore({ evidence: alert.data()!.evidence }));
});

cleanerSelfRoutes.get("/map", async (req, res) => {
  return res.json({ map: await getCleanerMap(String(req.authUser.siteId), req.cleaner!.cleanerId) });
});

cleanerSelfRoutes.get("/map/background", async (req, res) => {
  const map = await getCleanerMap(String(req.authUser.siteId), req.cleaner!.cleanerId);
  const mediaId = map.revision.backgroundMediaId;
  if (!mediaId) throw new HttpError(404, "The active Site Map has no background image.");
  const media = await getMediaContent(mediaId);
  res.type(media.mimeType);
  res.setHeader("Content-Length", String(media.byteSize));
  return res.sendFile(media.filePath, { dotfiles: "allow" });
});

cleanerSelfRoutes.get("/work-orders", async (req, res) => {
  const status = z.enum(["assigned", "in_progress", "awaiting_review", "resolved", "dismissed", "active", "all"]).default("active").parse(req.query.status);
  const limit = Math.min(Math.max(Number(String(req.query.limit ?? 25)) || 25, 1), 100);
  if (status !== "active" && status !== "all") return res.json({ workOrders: await listWorkOrders(String(req.authUser.siteId), { status, cleanerId: req.cleaner!.cleanerId, limit: status === "resolved" || status === "dismissed" ? Math.min(limit, 5) : limit }) });
  const all = await listWorkOrders(String(req.authUser.siteId), { status: "all", cleanerId: req.cleaner!.cleanerId, limit: 100 });
  const active = all.filter((work) => ACTIVE.includes(work.status));
  const recentTerminal = all.filter((work) => ["resolved", "dismissed"].includes(work.status));
  return res.json({ workOrders: status === "active" ? active : [...active, ...recentTerminal] });
});

cleanerSelfRoutes.get("/work-orders/:workOrderId", async (req, res) => {
  const workOrder = await getWorkOrder(String(req.authUser.siteId), String(req.params.workOrderId));
  if (workOrder.assignedCleanerId !== req.cleaner!.cleanerId) throw new HttpError(404, "Work order not found.");
  return res.json({ workOrder });
});

async function cleanerTransition(req: Request, res: Response, status: "in_progress" | "awaiting_review") {
  const input = z.object({ idempotencyKey: z.string().trim().min(8).max(160), completionEvidenceMediaId: z.string().trim().min(1).nullable().optional() }).strict().parse(req.body);
  return res.json({ workOrder: await transitionWorkOrder(String(req.authUser.siteId), String(req.params.workOrderId), status, { ...req.authUser, type: "cleaner", cleanerId: req.cleaner!.cleanerId } as any, input, req.requestId) });
}

cleanerSelfRoutes.post("/work-orders/:workOrderId/start", async (req, res) => cleanerTransition(req, res, "in_progress"));
cleanerSelfRoutes.post("/work-orders/:workOrderId/ready-for-review", async (req, res) => cleanerTransition(req, res, "awaiting_review"));

cleanerSelfRoutes.post("/work-orders/:workOrderId/completion-evidence", evidenceUpload.single("photo"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A completion photo is required.");
  return res.status(201).json({ evidence: await uploadCompletionEvidence({ siteId: String(req.authUser.siteId), workOrderId: String(req.params.workOrderId), cleanerId: req.cleaner!.cleanerId, file: req.file }) });
});

cleanerSelfRoutes.get("/work-orders/:workOrderId/completion-evidence", async (req, res) => {
  const work = await getWorkOrder(String(req.authUser.siteId), String(req.params.workOrderId));
  if (work.assignedCleanerId !== req.cleaner!.cleanerId || !work.completionEvidenceMediaId) throw new HttpError(404, "Completion evidence not found.");
  const media = await getMediaContent(work.completionEvidenceMediaId);
  res.type(media.mimeType);
  res.setHeader("Content-Length", String(media.byteSize));
  return res.sendFile(media.filePath, { dotfiles: "allow" });
});

cleanerSelfRoutes.get("/notifications", async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: opaqueCursorSchema.optional() }).strict().parse(req.query);
  const page = await listNotificationsPage(String(req.authUser.siteId), req.authUser.uid, query);
  return res.json({ notifications: page.items, ...page });
});
