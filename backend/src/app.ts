import cors from "cors";
import express from "express";
import { checkAiHealth } from "./services/aiServiceClient.js";
import { detectionRoutes } from "./routes/detectionRoutes.js";
import { alertRoutes } from "./routes/alertRoutes.js";

export const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/alerts", alertRoutes);
app.get("/api/health", async (_req, res) => {
  try { res.json({ status: "ok", aiService: await checkAiHealth() }); }
  catch { res.status(503).json({ status: "degraded", aiService: { status: "unavailable" } }); }
});
app.use("/api/detections", detectionRoutes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(502).json({ error: "The detection service could not process this image." });
});
