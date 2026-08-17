import { Router } from "express";
import multer from "multer";
import { analyzeImageBins, classifyBinState } from "../services/aiServiceClient.js";
import { batchAnalysisOptionsSchema, stateClassificationOptionsSchema } from "../schemas/detection.js";
import { detectionListQuerySchema } from "../schemas/media.js";
import { getDetection, listDetections } from "../services/jobProcessingService.js";
import { env } from "../config/env.js";
import { rateLimit } from "../middleware/rateLimit.js";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const detectionRoutes = Router();
detectionRoutes.use(rateLimit({ namespace: "inference", maximum: env.inferenceRateLimitPerMinute }));
detectionRoutes.post("/bin-state", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "A bin crop image is required.", requestId: req.requestId });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP.", requestId: req.requestId });
    const options = stateClassificationOptionsSchema.parse(req.body);
    return res.json(await classifyBinState(req.file, options));
  } catch (error) { next(error); }
});

detectionRoutes.post("/bin-state/batch", upload.array("images", 10), async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "Select at least one image.", requestId: req.requestId });
    if (files.length > 10) return res.status(400).json({ error: "A maximum of 10 images is allowed.", requestId: req.requestId });
    const invalid = files.find((file) => !allowedImageTypes.has(file.mimetype));
    if (invalid) return res.status(415).json({ error: `${invalid.originalname}: use JPEG, PNG, or WebP.`, requestId: req.requestId });
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

detectionRoutes.get("/", async (req, res) => {
  const query = detectionListQuerySchema.parse(req.query);
  const page = await listDetections(query);
  return res.json({ detections: page.items, nextCursor: page.nextCursor });
});

detectionRoutes.get("/:detectionId", async (req, res) => {
  return res.json({ detection: await getDetection(req.params.detectionId) });
});
