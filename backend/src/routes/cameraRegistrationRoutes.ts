import { Router } from "express";
import multer from "multer";
import { cameraRegistrationDraftSchema, cameraRegistrationPreviewSourceSchema, cameraRegistrationPreviewTemporalStateSchema, publishCameraRegistrationSchema } from "../schemas/cameraRegistration.js";
import { getCameraRegistration, getCameraRegistrationDraft, getCameraRegistrationWorkspace, listCameraRegistrationRevisions, publishCameraRegistration, saveCameraRegistrationDraft, validateCameraRegistration } from "../services/cameraRegistrationService.js";
import { createCameraRegistrationReference, createCameraRegistrationVideoSource } from "../services/cameraRegistrationReference.js";
import { previewCameraRegistration } from "../services/cameraRegistrationPreview.js";
import { HttpError } from "../shared/httpError.js";
import { VIDEO_BIN_TRACKING_VERSION, type VideoBinTrackingState } from "../services/videoBinTracking.js";

export const cameraRegistrationRoutes = Router();
const referenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

cameraRegistrationRoutes.get("/:cameraId/registration", async (req, res) => {
  return res.json({ registration: await getCameraRegistration(req.params.cameraId) });
});

cameraRegistrationRoutes.get("/:cameraId/registration/workspace", async (req, res) => {
  return res.json({ workspace: await getCameraRegistrationWorkspace(req.params.cameraId) });
});

cameraRegistrationRoutes.get("/:cameraId/registration/draft", async (req, res) => {
  return res.json({ savedDraft: await getCameraRegistrationDraft(req.params.cameraId) });
});

cameraRegistrationRoutes.put("/:cameraId/registration/draft", async (req, res) => {
  const draft = cameraRegistrationDraftSchema.parse(req.body);
  return res.json({ savedDraft: await saveCameraRegistrationDraft(req.params.cameraId, draft, req.supervisor.uid) });
});

cameraRegistrationRoutes.get("/:cameraId/registration/revisions", async (req, res) => {
  return res.json({ revisions: await listCameraRegistrationRevisions(req.params.cameraId) });
});

cameraRegistrationRoutes.post("/:cameraId/registration/reference", referenceUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A clean reference image is required.", requestId: req.requestId });
  return res.status(201).json({
    media: await createCameraRegistrationReference(String(req.params.cameraId), req.file, req.supervisor.uid),
  });
});

cameraRegistrationRoutes.post("/:cameraId/registration/source-video", videoUpload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A reference video is required.", requestId: req.requestId });
  return res.status(201).json({
    media: await createCameraRegistrationVideoSource(String(req.params.cameraId), req.file, req.supervisor.uid),
  });
});

cameraRegistrationRoutes.post("/:cameraId/registration/validate", async (req, res) => {
  const draft = cameraRegistrationDraftSchema.parse(req.body);
  return res.json({ validation: await validateCameraRegistration(req.params.cameraId, draft) });
});

cameraRegistrationRoutes.post("/:cameraId/registration/preview", referenceUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A camera image is required for live validation.", requestId: req.requestId });
  let draft: unknown;
  try {
    draft = typeof req.body.draft === "string" ? JSON.parse(req.body.draft) : req.body.draft;
  } catch {
    throw new HttpError(400, "The registration draft is not valid JSON.");
  }
  const sourceType = cameraRegistrationPreviewSourceSchema.parse(req.body.sourceType ?? "image");
  let temporalState: VideoBinTrackingState = { version: VIDEO_BIN_TRACKING_VERSION, nextId: 1, tracks: {} };
  if (sourceType === "video" && typeof req.body.temporalState === "string" && req.body.temporalState.trim()) {
    try {
      const parsed = cameraRegistrationPreviewTemporalStateSchema.parse(JSON.parse(req.body.temporalState));
      temporalState = { version: VIDEO_BIN_TRACKING_VERSION, nextId: 1, tracks: {}, stateHistories: parsed.stateHistories };
    } catch {
      throw new HttpError(400, "The video temporal state is not valid JSON.");
    }
  }
  const capturedAtMs = Number(req.body.capturedAtMs ?? 0);
  const registrationRevision = Number(req.body.registrationRevision ?? 0);
  if (sourceType === "video" && (!Number.isFinite(capturedAtMs) || capturedAtMs < 0 || !Number.isInteger(registrationRevision) || registrationRevision < 0)) {
    throw new HttpError(400, "The video preview timing context is invalid.");
  }
  return res.json(await previewCameraRegistration(
    String(req.params.cameraId),
    req.file,
    draft,
    sourceType,
    sourceType === "video" ? { state: temporalState, capturedAtMs, registrationRevision } : undefined,
  ));
});

cameraRegistrationRoutes.put("/:cameraId/registration", async (req, res) => {
  const input = publishCameraRegistrationSchema.parse(req.body);
  const registration = await publishCameraRegistration(req.params.cameraId, input.draft, input.expectedRevision, req.supervisor.uid);
  return res.json({ registration });
});
