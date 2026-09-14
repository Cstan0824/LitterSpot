import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { cancelV2CameraDraft, createV2CameraDraft, getV2CameraDraftForCamera, publishV2CameraDraft, saveV2DraftRegistration, startV2CameraDraft, uploadV2DraftReference, uploadV2DraftSourceVideo, validateV2CameraDraft } from "../services/v2CameraDraftService.js";
import { firestore } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError } from "../shared/httpError.js";
import { env } from "../config/env.js";
import { getV2CameraDetail } from "../services/v2CameraDetailService.js";
import { controlCamera } from "../services/v2CameraControl.js";
import { getCameraListConfiguration } from "../services/cameraConfigurationCache.js";
import { v2Json } from "../services/v2Presentation.js";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { removeV2CameraFromSite } from "../services/v2CameraRemovalService.js";

export const v2CameraRoutes = Router();
const auditActor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName });
const point = z.object({ xMeters: z.number().finite(), yMeters: z.number().finite() });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.videoMaxBytes, files: 1 } });
async function assertDraftAccess(req: Request) {
  const draft = await firestore.collection("cameraDrafts").doc(String(req.params.draftId)).get();
  if (!draft.exists || draft.data()?.siteId !== req.authUser.siteId || draft.data()?.status === "published") throw new HttpError(404, "Camera Draft not found.");
  if (draft.data()?.kind === "physical_move" && req.authUser.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  return draft;
}
const requireDraftAccess: RequestHandler = async (req, _res, next) => { try { await assertDraftAccess(req); next(); } catch (error) { next(error); } };
v2CameraRoutes.get("/cameras", async (req, res) => res.json(v2Json(await getCameraListConfiguration(String(req.authUser.siteId)))));
v2CameraRoutes.get("/cameras/:cameraId/draft", async (req, res) => {
  const draft = await getV2CameraDraftForCamera(String(req.authUser.siteId), req.params.cameraId);
  if (draft?.kind === "physical_move" && req.authUser.authority !== "root") throw new HttpError(403, "Root Supervisor access is required.");
  return res.json({ draft });
});
v2CameraRoutes.get("/cameras/:cameraId/detail", async (req, res) => res.json(await getV2CameraDetail(String(req.authUser.siteId), req.params.cameraId)));
v2CameraRoutes.post("/drafts/start", async (req, res) => { const input = z.object({ kind: z.enum(["create", "reconfigure"]), cameraId: z.string().trim().min(1).optional(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(), sourceType: z.enum(["laptop_camera", "looped_video"]), placement: z.object({ point }).nullable().optional(), provisionalZone: z.object({ zoneId: z.string().trim().min(1).max(160), zoneNameSnapshot: z.string().trim().min(1).max(120), polygon: z.array(point).min(3).max(64) }).nullable().optional() }).strict().parse(req.body); if (input.kind === "create" && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId }); return res.status(201).json({ draft: await startV2CameraDraft({ ...input, siteId: String(req.authUser.siteId), actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/reference", requireDraftAccess, imageUpload.single("image"), async (req, res) => { if (!req.file) throw new HttpError(400, "A reference image is required."); return res.status(201).json({ reference: await uploadV2DraftReference({ siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), file: req.file, actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/source-video", requireDraftAccess, videoUpload.single("video"), async (req, res) => { if (!req.file) throw new HttpError(400, "A looped source video is required."); return res.status(201).json({ source: await uploadV2DraftSourceVideo({ siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), file: req.file, actorUid: req.authUser.uid }) }); });
v2CameraRoutes.put("/drafts/:draftId/registration", requireDraftAccess, async (req, res) => { const input = z.object({ sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), walkableFloorPolygon: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3).max(64), bins: z.array(z.unknown()).max(32).default([]) }).strict().parse(req.body); return res.json({ registration: await saveV2DraftRegistration({ ...input, siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/validate", requireDraftAccess, async (req, res) => res.json(await validateV2CameraDraft(String(req.authUser.siteId), String(req.params.draftId))));
v2CameraRoutes.post("/drafts", async (req, res) => {
  const input = z.object({ kind: z.enum(["create", "reconfigure"]), cameraId: z.string().optional(), name: z.string().min(1), description: z.string().nullable().optional(), source: z.object({ type: z.enum(["laptop_camera", "looped_video"]), sourceMediaId: z.string().nullable().optional(), sampleIntervalSeconds: z.number().positive().optional() }), placement: z.object({ point }).nullable().optional(), registration: z.object({ referenceMediaId: z.string().min(1), sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), walkableFloorPolygon: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3), bins: z.array(z.unknown()).optional() }) }).strict().parse(req.body);
  if (input.kind === "create" && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  return res.status(201).json({ draft: await createV2CameraDraft({ ...input, siteId: String(req.authUser.siteId), actorUid: req.authUser.uid }) });
});
v2CameraRoutes.get("/drafts/:draftId", async (req, res) => {
  const draft = await assertDraftAccess(req);
  return res.json({ draft: { id: draft.id, ...draft.data() } });
});
v2CameraRoutes.delete("/drafts/:draftId", async (req, res) => {
  await assertDraftAccess(req);
  await cancelV2CameraDraft(String(req.authUser.siteId), String(req.params.draftId), auditActor(req), req.requestId);
  return res.status(204).send();
});
v2CameraRoutes.post("/drafts/:draftId/publish", async (req, res) => {
  const draft = await assertDraftAccess(req);
  if ((draft.data()?.kind === "create" || draft.data()?.kind === "physical_move") && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  return res.json({ result: await publishV2CameraDraft(req.params.draftId, auditActor(req), req.requestId) });
});

v2CameraRoutes.patch("/cameras/:cameraId/monitoring", async (req, res) => {
  const input = z.object({ monitoringEnabled: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict().parse(req.body);
  return res.json(await controlCamera({ ...input, cameraId: req.params.cameraId, siteId: String(req.authUser.siteId), actor: auditActor(req), requestId: req.requestId }));
});

v2CameraRoutes.post("/cameras/:cameraId/deactivate", async (req, res) => {
  const input = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(req.body);
  res.json(await controlCamera({ ...input, monitoringEnabled: false, deactivate: true, cameraId: req.params.cameraId, siteId: String(req.authUser.siteId), actor: auditActor(req), requestId: req.requestId }));
});

v2CameraRoutes.post("/cameras/:cameraId/remove", requireRootSupervisor, async (req, res) => {
  const input = z.object({
    reason: z.string().trim().min(3).max(500), confirmation: z.literal(true),
    expectedCameraRevision: z.number().int().nonnegative(), expectedMapRevisionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8).max(160),
  }).strict().parse(req.body);
  return res.json({ removal: await removeV2CameraFromSite({ ...input, siteId: String(req.authUser.siteId), cameraId: String(req.params.cameraId), actor: auditActor(req), requestId: req.requestId }) });
});
