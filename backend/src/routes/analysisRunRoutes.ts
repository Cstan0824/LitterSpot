import { Router } from "express";
import { analysisListQuerySchema } from "../schemas/media.js";
import { getAnalysisRun, listAnalysisRuns } from "../services/jobProcessingService.js";
import { evaluateAnalysisRunDetections } from "../services/alertWorkflowService.js";

export const analysisRunRoutes = Router();

analysisRunRoutes.get("/", async (req, res) => {
  const query = analysisListQuerySchema.parse(req.query);
  const page = await listAnalysisRuns(query);
  return res.json({ analysisRuns: page.items, nextCursor: page.nextCursor });
});

analysisRunRoutes.post("/:analysisRunId/evaluate-alerts", async (req, res) => {
  return res.json(await evaluateAnalysisRunDetections(req.params.analysisRunId));
});

analysisRunRoutes.get("/:analysisRunId", async (req, res) => {
  return res.json({ analysisRun: await getAnalysisRun(req.params.analysisRunId) });
});
