import axios from "axios";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { alertRoutes } from "./routes/alertRoutes.js";
import { detectionRoutes } from "./routes/detectionRoutes.js";
import { operationsRoutes } from "./routes/operationsRoutes.js";
import { checkAiHealth } from "./services/aiServiceClient.js";

export const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    const aiService = await checkAiHealth();
    return res.json({ status: aiService.modelReady === false ? "degraded" : "ok", aiService });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI service could not be reached.";
    return res.status(503).json({ status: "degraded", aiService: { status: "unavailable", reason } });
  }
});

app.use("/api/alerts", alertRoutes);
app.use("/api/detections", detectionRoutes);
app.use("/api/operations", operationsRoutes);

app.use((_req, res) => res.status(404).json({ error: "Route not found." }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request.", details: error.flatten() });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.message });
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 502;
    const upstream = error.response?.data;
    const message = upstream && typeof upstream === "object" && "detail" in upstream
      ? String(upstream.detail)
      : "AI service request failed.";
    return res.status(status).json({ error: message });
  }
  console.error(error);
  return res.status(500).json({ error: "Internal server error." });
});
