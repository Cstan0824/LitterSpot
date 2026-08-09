import { Router } from "express";
import multer from "multer";
import { pipelineOptionsSchema, videoFrameOptionsSchema } from "../schemas/detection.js";
import { pipelineClient } from "../services/pipelineClient.js";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const pipelineRoutes = Router();

pipelineRoutes.post("/frame", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "An image file is required." });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP." });
    return res.json(await pipelineClient.analyzeFrame(req.file, pipelineOptionsSchema.parse(req.body)));
  } catch (error) { next(error); }
});

pipelineRoutes.post("/video-frame", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "A sampled video frame is required." });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP." });
    return res.json(await pipelineClient.analyzeVideoFrame(req.file, videoFrameOptionsSchema.parse(req.body)));
  } catch (error) { next(error); }
});

pipelineRoutes.get("/recent", async (_req, res, next) => {
  try { return res.json(await pipelineClient.recent()); }
  catch (error) { next(error); }
});

pipelineRoutes.get("/placement/:cameraId", async (req, res, next) => {
  try { return res.json(await pipelineClient.placement(req.params.cameraId)); }
  catch (error) { next(error); }
});

pipelineRoutes.patch("/placement/:cameraId", async (req, res, next) => {
  try {
    const windowDays = Number(req.body.windowDays);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) {
      return res.status(400).json({ error: "windowDays must be between 1 and 30." });
    }
    return res.json(await pipelineClient.updatePlacementWindow(req.params.cameraId, windowDays));
  } catch (error) { next(error); }
});
