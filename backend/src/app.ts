import axios from "axios";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { authenticateUser } from "./middleware/authenticateUser.js";
import { requireSupervisor } from "./middleware/requireRole.js";
import { requireCleaner } from "./middleware/requireRole.js";
import { alertRoutes } from "./routes/alertRoutes.js";
import { cameraRoutes } from "./routes/cameraRoutes.js";
import { cleanerRoutes } from "./routes/cleanerRoutes.js";
import { detectionRoutes } from "./routes/detectionRoutes.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { processingJobRoutes } from "./routes/processingJobRoutes.js";
import { siteRoutes } from "./routes/siteRoutes.js";
import { supervisorRoutes } from "./routes/supervisorRoutes.js";
import { zoneRoutes } from "./routes/zoneRoutes.js";
import { analysisRunRoutes } from "./routes/analysisRunRoutes.js";
import { flagRoutes } from "./routes/flagRoutes.js";
import { issueObservationRoutes } from "./routes/issueObservationRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { analyticsRoutes } from "./routes/analyticsRoutes.js";
import { systemEventRoutes } from "./routes/systemEventRoutes.js";
import { cleanerSelfRoutes } from "./routes/cleanerSelfRoutes.js";
import { workOrderRoutes } from "./routes/workOrderRoutes.js";
import { checkAiHealth } from "./services/aiServiceClient.js";
import { HttpError } from "./shared/httpError.js";
import { env } from "./config/env.js";
import { requestContext } from "./middleware/requestContext.js";
import { rateLimit } from "./middleware/rateLimit.js";

export const app = express();

app.disable("x-powered-by");
app.use(requestContext);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new HttpError(403, "This web origin is not allowed."));
  },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));

async function readiness(_req: Request, res: Response) {
  try {
    const aiService = await checkAiHealth();
    const ready = aiService.modelReady !== false
      && aiService.binLocalizerReady !== false
      && aiService.floorAnalyzerReady !== false;
    return res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      dependencies: { aiInference: ready ? "ready" : "degraded" },
    });
  } catch (error) {
    return res.status(503).json({ status: "degraded", dependencies: { aiInference: "unavailable" } });
  }
}

app.get("/api/health", readiness);
app.get("/api/health/ready", readiness);

app.use("/api", authenticateUser);
app.use("/api", rateLimit({ namespace: "api", maximum: env.generalRateLimitPerMinute }));

app.use("/api/me", supervisorRoutes);
app.use("/api/cleaner", requireCleaner, cleanerSelfRoutes);
app.use("/api", requireSupervisor);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/analysis-runs", analysisRunRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/cameras", cameraRoutes);
app.use("/api/cleaners", cleanerRoutes);
app.use("/api/detections", detectionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/flags", flagRoutes);
app.use("/api/issue-observations", issueObservationRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/processing-jobs", processingJobRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/system-events", systemEventRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/zones", zoneRoutes);

app.use((req, res) => res.status(404).json({ error: "Route not found.", requestId: req.requestId }));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request.", details: error.flatten(), requestId: req.requestId });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, details: error.details, requestId: req.requestId });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.message, requestId: req.requestId });
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 502;
    const upstream = error.response?.data;
    const message = upstream && typeof upstream === "object" && "detail" in upstream
      ? String(upstream.detail)
      : "AI service request failed.";
    return res.status(status).json({ error: message, requestId: req.requestId });
  }
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "unhandled_request_error",
    requestId: req.requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  }));
  return res.status(500).json({ error: "Internal server error.", requestId: req.requestId });
});
