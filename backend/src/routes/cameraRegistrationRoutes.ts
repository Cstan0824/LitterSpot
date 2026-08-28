import { Router } from "express";
import multer from "multer";
import { cameraRegistrationDraftSchema, cameraRegistrationPreviewSourceSchema, publishCameraRegistrationSchema } from "../schemas/cameraRegistration.js";
import { getCameraRegistration, getCameraRegistrationDraft, getCameraRegistrationWorkspace, listCameraRegistrationRevisions, publishCameraRegistration, saveCameraRegistrationDraft, validateCameraRegistration } from "../services/cameraRegistrationService.js";
import { createCameraRegistrationAttachment, createCameraRegistrationReference, createCameraRegistrationVideoSource, listCameraRegistrationAttachments } from "../services/cameraRegistrationReference.js";
import { previewCameraRegistration } from "../services/cameraRegistrationPreview.js";
import { HttpError } from "../shared/httpError.js";

export const cameraRegistrationRoutes = Router();
const referenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

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

cameraRegistrationRoutes.get("/:cameraId/registration/attachments", async (req, res) => {
  return res.json({ attachments: await listCameraRegistrationAttachments(String(req.params.cameraId)) });
});

cameraRegistrationRoutes.post("/:cameraId/registration/attachments", attachmentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Select an image or video attachment.", requestId: req.requestId });
  return res.status(201).json({
    attachment: await createCameraRegistrationAttachment(String(req.params.cameraId), req.file, req.supervisor.uid),
  });
});

cameraRegistrationRoutes.post("/:cameraId/registration/reference", referenceUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A clean reference image is required.", requestId: req.requestId });
  return res.status(201).json({
    media: await createCameraRegistrationReference(String(req.params.cameraId), req.file, req.supervisor.uid),
  });
});

cameraRegistrationRoutes.post("/:cameraId/registration/source-video", attachmentUpload.single("video"), async (req, res) => {
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
  return res.json({ preview: await previewCameraRegistration(String(req.params.cameraId), req.file, draft, sourceType) });
});

cameraRegistrationRoutes.put("/:cameraId/registration", async (req, res) => {
  const input = publishCameraRegistrationSchema.parse(req.body);
  const registration = await publishCameraRegistration(req.params.cameraId, input.draft, input.expectedRevision, req.supervisor.uid);
  return res.json({ registration });
});
