import axios from "axios";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { authenticateUser } from "./middleware/authenticateUser.js";
import { requireSupervisor, requireSuperadmin } from "./middleware/requireRole.js";
import { requireCleaner } from "./middleware/requireRole.js";
import { alertRoutes } from "./routes/alertRoutes.js";
import { cameraRoutes } from "./routes/cameraRoutes.js";
import { cleanerRoutes } from "./routes/cleanerRoutes.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { siteRoutes } from "./routes/siteRoutes.js";
import { supervisorRoutes } from "./routes/supervisorRoutes.js";
import { zoneRoutes } from "./routes/zoneRoutes.js";
import { cleanerSelfRoutes } from "./routes/cleanerSelfRoutes.js";
import { checkAiHealth } from "./services/aiServiceClient.js";
import { HttpError } from "./shared/httpError.js";
import { env } from "./config/env.js";
import { requestContext } from "./middleware/requestContext.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { isFirestoreQuotaError } from "./shared/firestoreErrors.js";
import { binReplacementRoutes } from "./routes/binReplacementRoutes.js";
import { superadminRoutes } from "./routes/superadminRoutes.js";
import { siteMapRoutes } from "./routes/siteMapRoutes.js";
import { cameraCreationRoutes } from "./routes/cameraCreationRoutes.js";
import { monitoringRoutes } from "./routes/monitoringRoutes.js";
import { supervisorAccountRoutes } from "./routes/supervisorAccountRoutes.js";
import { workOrderRoutes } from "./routes/workOrderRoutes.js";
import { orchestratorInternalRoutes, orchestratorSupervisorRoutes } from "./routes/orchestratorRoutes.js";
import { testSupportRoutes } from "./routes/testSupportRoutes.js";
import { operationsRoutes } from "./routes/operationsRoutes.js";
import { auditMutation } from "./middleware/auditMutation.js";
import { phase11AnalyticsRoutes, phase11BinPlacementRoutes, phase11DashboardRoutes } from "./routes/phase11Routes.js";
import { cameraSceneRoutes } from "./routes/cameraSceneRoutes.js";
import { cameraLiveRoutes } from "./routes/cameraLiveRoutes.js";

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
const generalLimit = rateLimit({ namespace: "api", maximum: env.generalRateLimitPerMinute });
const cameraLimit = rateLimit({ namespace: "camera-samples", maximum: 3600 });
app.use("/api", (req, res, next) => /\/monitoring\/sessions\/[^/]+\/cameras\/[^/]+\/samples$/.test(req.path) ? cameraLimit(req, res, next) : generalLimit(req, res, next));

app.use("/api/me", supervisorRoutes);
app.use("/api/superadmin", requireSuperadmin, superadminRoutes);
app.use("/api/cleaner", requireCleaner, cleanerSelfRoutes);
app.use("/api", requireSupervisor);
app.use("/api/operations/v2", operationsRoutes);
app.use(["/api/dashboard/v2", "/api/analytics/v2", "/api/bin-placement/v2"], auditMutation);
app.use("/api/dashboard/v2", phase11DashboardRoutes);
app.use("/api/analytics/v2", phase11AnalyticsRoutes);
app.use("/api/bin-placement/v2", phase11BinPlacementRoutes);
app.use(["/api/site-map", "/api/camera-creation", "/api/monitoring", "/api/alerts", "/api/supervisors"], auditMutation);
app.use("/api/site-map", siteMapRoutes);
app.use("/api/camera-creation", cameraCreationRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/monitoring/live", cameraLiveRoutes);
app.use("/api/supervisors", supervisorAccountRoutes);
app.use("/api/bin-replacement", binReplacementRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/cameras", cameraRoutes);
app.use("/api/cleaners", cleanerRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/work-orders", (req, _res, next) => {
  if (req.authUser.siteId && req.authUser.role === "supervisor") return workOrderRoutes(req, _res, next);
  return next();
});
app.use("/api/test-support/v2", testSupportRoutes);
app.use("/api/development/cameras", cameraSceneRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/orchestrator/v2", orchestratorSupervisorRoutes);
app.use("/internal/orchestrator/v2", orchestratorInternalRoutes);

app.use((req, res) => res.status(404).json({ error: "Route not found.", requestId: req.requestId }));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (isFirestoreQuotaError(error)) {
    return res.status(503).json({ error: "Cloud database quota is temporarily unavailable. Try again after the daily quota resets.", code: "firestore_quota_exceeded", requestId: req.requestId });
  }
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
