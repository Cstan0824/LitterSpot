import { Router } from "express";
import multer from "multer";
import { detectImage } from "../services/aiServiceClient.js";
import { detectionOptionsSchema } from "../schemas/detection.js";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export const detectionRoutes = Router();

detectionRoutes.post("/image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "An image file is required." });
    if (!allowedImageTypes.has(req.file.mimetype)) return res.status(415).json({ error: "Use JPEG, PNG, or WebP." });
    const options = detectionOptionsSchema.parse(req.body);
    return res.json(await detectImage(req.file, options));
  } catch (error) { next(error); }
});
