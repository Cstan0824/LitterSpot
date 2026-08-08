import { Router } from "express";
import multer from "multer";
import { analyzeImageBins, classifyBinState, detectImage } from "../services/aiServiceClient.js";
import { batchAnalysisOptionsSchema, detectionOptionsSchema, stateClassificationOptionsSchema } from "../schemas/detection.js";
import { pipelineRoutes } from "./pipelineRoutes.js";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const detectionRoutes = Router();
const requestWindows = new Map<string, { startedAt: number; count: number }>();
detectionRoutes.use((req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = requestWindows.get(key);
  const window = !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 0 } : current;
  window.count += 1;
  requestWindows.set(key, window);
  if (window.count > 120) return res.status(429).json({ error: "Inference rate limit exceeded. Try again shortly." });
  next();
});
detectionRoutes.use("/pipeline", pipelineRoutes);

detectionRoutes.post("/image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "An image file is required." });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP." });
    const options = detectionOptionsSchema.parse(req.body);
    return res.json(await detectImage(req.file, options));
  } catch (error) { next(error); }
});

detectionRoutes.post("/bin-state", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "A bin crop image is required." });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP." });
    const options = stateClassificationOptionsSchema.parse(req.body);
    return res.json(await classifyBinState(req.file, options));
  } catch (error) { next(error); }
});

detectionRoutes.post("/bin-state/batch", upload.array("images", 10), async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "Select at least one image." });
    if (files.length > 10) return res.status(400).json({ error: "A maximum of 10 images is allowed." });
    const invalid = files.find((file) => !allowedImageTypes.has(file.mimetype));
    if (invalid) return res.status(415).json({ error: `${invalid.originalname}: use JPEG, PNG, or WebP.` });
    const options = batchAnalysisOptionsSchema.parse(req.body);
    const items = [];
    // Keep GPU inference sequential. Concurrent requests increase memory use and
    // make per-image latency unpredictable on the deployment GPU.
    for (const [index, file] of files.entries()) {
      items.push({
        index,
        fileName: file.originalname,
        result: await analyzeImageBins(file, options, `upload-${index + 1}`),
      });
    }
    return res.json({ items });
  } catch (error) { next(error); }
});
