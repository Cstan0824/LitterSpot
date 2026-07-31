import cors from "cors";
import express from "express";
import multer from "multer";
import { ZodError } from "zod";
import { checkAiHealth } from "./services/aiServiceClient.js";
import { detectionRoutes } from "./routes/detectionRoutes.js";

export const app = express();
app.use(cors());
app.use(express.json());
app.get("/api/health", async (_req, res) => {
  try { res.json({ status: "ok", aiService: await checkAiHealth() }); }
  catch { res.status(503).json({ status: "degraded", aiService: { status: "unavailable" } }); }
});
app.use("/api/detections", detectionRoutes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Each image must be 10 MB or smaller."
      : error.code === "LIMIT_UNEXPECTED_FILE"
        ? "A maximum of 10 images is allowed."
        : error.message;
    return res.status(400).json({ error: message });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({ error: error.issues[0]?.message ?? "Invalid analysis settings." });
  }
  console.error(error);
  return res.status(502).json({ error: "The detection service could not process this image." });
});
