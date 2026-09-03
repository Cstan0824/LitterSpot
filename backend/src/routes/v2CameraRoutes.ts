import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { createV2CameraDraft, publishV2CameraDraft, saveV2DraftRegistration, startV2CameraDraft, uploadV2DraftReference, uploadV2DraftSourceVideo, validateV2CameraDraft } from "../services/v2CameraDraftService.js";
import { firestore } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError } from "../shared/httpError.js";
import { env } from "../config/env.js";
import { getV2CameraDetail } from "../services/v2CameraDetailService.js";

export const v2CameraRoutes = Router();
const point = z.object({ xMeters: z.number().finite(), yMeters: z.number().finite() });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.videoMaxBytes, files: 1 } });
v2CameraRoutes.get("/cameras", async (req, res) => { const snapshot = await firestore.collection("cameras").where("siteId", "==", req.authUser.siteId).limit(100).get(); const site = await firestore.collection("sites").doc(String(req.authUser.siteId)).get(); const revisionId = String(site.data()?.activeMapRevisionId ?? ""); const cameras = await Promise.all(snapshot.docs.filter((document) => document.data().schemaVersion === 2).map(async (document) => { const [placement, runtime, source, registration] = await Promise.all([firestore.collection("siteMapRevisions").doc(revisionId).collection("cameraPlacements").doc(document.id).get(), firestore.collection("cameraRuntimeStates").doc(document.id).get(), firestore.collection("cameraSourceRevisions").doc(String(document.data().activeSourceRevisionId)).get(), firestore.collection("cameraRegistrationRevisions").doc(String(document.data().activeRegistrationRevisionId)).get()]); return { id: document.id, ...document.data(), placement: placement.exists ? placement.data() : null, runtime: runtime.exists ? runtime.data() : null, source: source.exists ? { ...source.data(), contentUrl: source.data()?.sourceMediaId ? `/api/media/${source.data()?.sourceMediaId}/content` : null } : null, registration: registration.exists ? registration.data() : null }; })); return res.json({ cameras, activeMapRevisionId: revisionId }); });
v2CameraRoutes.get("/cameras/:cameraId/detail", async (req, res) => res.json(await getV2CameraDetail(String(req.authUser.siteId), req.params.cameraId)));
v2CameraRoutes.post("/drafts/start", async (req, res) => { const input = z.object({ kind: z.enum(["create", "reconfigure"]), cameraId: z.string().trim().min(1).optional(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(), sourceType: z.enum(["laptop_camera", "looped_video"]), placement: z.object({ point }).nullable().optional() }).strict().parse(req.body); if (input.kind === "create" && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId }); return res.status(201).json({ draft: await startV2CameraDraft({ ...input, siteId: String(req.authUser.siteId), actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/reference", imageUpload.single("image"), async (req, res) => { if (!req.file) throw new HttpError(400, "A reference image is required."); return res.status(201).json({ reference: await uploadV2DraftReference({ siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), file: req.file, actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/source-video", videoUpload.single("video"), async (req, res) => { if (!req.file) throw new HttpError(400, "A looped source video is required."); return res.status(201).json({ source: await uploadV2DraftSourceVideo({ siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), file: req.file, actorUid: req.authUser.uid }) }); });
v2CameraRoutes.put("/drafts/:draftId/registration", async (req, res) => { const input = z.object({ sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), walkableFloorPolygon: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3).max(64), bins: z.array(z.unknown()).max(32).default([]) }).strict().parse(req.body); return res.json({ registration: await saveV2DraftRegistration({ ...input, siteId: String(req.authUser.siteId), draftId: String(req.params.draftId), actorUid: req.authUser.uid }) }); });
v2CameraRoutes.post("/drafts/:draftId/validate", async (req, res) => res.json(await validateV2CameraDraft(String(req.authUser.siteId), String(req.params.draftId))));
v2CameraRoutes.post("/drafts", async (req, res) => {
  const input = z.object({ kind: z.enum(["create", "reconfigure"]), cameraId: z.string().optional(), name: z.string().min(1), description: z.string().nullable().optional(), source: z.object({ type: z.enum(["laptop_camera", "looped_video"]), sourceMediaId: z.string().nullable().optional(), sampleIntervalSeconds: z.number().positive().optional() }), placement: z.object({ point }).nullable().optional(), registration: z.object({ referenceMediaId: z.string().min(1), sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), walkableFloorPolygon: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3), bins: z.array(z.unknown()).optional() }) }).strict().parse(req.body);
  if (input.kind === "create" && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  return res.status(201).json({ draft: await createV2CameraDraft({ ...input, siteId: String(req.authUser.siteId), actorUid: req.authUser.uid }) });
});
v2CameraRoutes.get("/drafts/:draftId", async (req, res) => {
  const draft = await firestore.collection("cameraDrafts").doc(req.params.draftId).get();
  if (!draft.exists || draft.data()?.siteId !== req.authUser.siteId) throw new HttpError(404, "Camera Draft not found.");
  return res.json({ draft: { id: draft.id, ...draft.data() } });
});
v2CameraRoutes.delete("/drafts/:draftId", async (req, res) => {
  const draft = await firestore.collection("cameraDrafts").doc(req.params.draftId).get();
  if (!draft.exists || draft.data()?.siteId !== req.authUser.siteId) throw new HttpError(404, "Camera Draft not found.");
  await draft.ref.delete();
  return res.status(204).send();
});
v2CameraRoutes.post("/drafts/:draftId/publish", async (req, res) => {
  const draft = await firestore.collection("cameraDrafts").doc(req.params.draftId).get();
  if (!draft.exists || draft.data()?.siteId !== req.authUser.siteId) throw new HttpError(404, "Camera Draft not found.");
  if (draft.data()?.kind === "create" && req.authUser.authority !== "root") return res.status(403).json({ error: "Root Supervisor access is required.", requestId: req.requestId });
  return res.json({ result: await publishV2CameraDraft(req.params.draftId, req.authUser.uid) });
});

v2CameraRoutes.patch("/cameras/:cameraId/monitoring", async (req, res) => {
  const input = z.object({ monitoringEnabled: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict().parse(req.body);
  const reference = firestore.collection("cameras").doc(req.params.cameraId);
  await firestore.runTransaction(async (transaction) => {
    const camera = await transaction.get(reference);
    if (!camera.exists || camera.data()?.siteId !== req.authUser.siteId) throw new HttpError(404, "Camera not found.");
    if (camera.data()?.status !== "active") throw new HttpError(409, "Inactive Camera monitoring cannot be changed.");
    if (camera.data()?.revision !== input.expectedRevision) throw new HttpError(409, "The Camera changed. Refresh and retry.");
    transaction.update(reference, { monitoringEnabled: input.monitoringEnabled, updatedAt: FieldValue.serverTimestamp(), updatedByUid: req.authUser.uid, revision: FieldValue.increment(1) });
  });
  return res.json({ cameraId: req.params.cameraId, monitoringEnabled: input.monitoringEnabled });
});
