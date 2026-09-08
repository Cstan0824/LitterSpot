import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { authenticateOrchestrator } from "../middleware/authenticateOrchestrator.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  assignV2CleanerByIdsTool,
  createV2AssignmentRun,
  createV2ReviewRun,
  getV2AssignmentContextTool,
  getV2OrchestratorConfig,
  getV2OrchestratorRun,
  getV2ReviewContext,
  listV2OrchestratorRuns,
  requestV2Rework,
  resolveV2VerifiedWork,
  runV2AssignmentCycle,
  setV2OrchestratorStatus,
} from "../services/v2OrchestratorService.js";

const siteBody = z.object({ siteId: z.string().trim().min(1) }).strict();
const runBody = siteBody.extend({ triggerType: z.string().trim().min(1).max(100).default("manual_cycle") }).strict();
const reviewRunBody = siteBody.extend({ workOrderId: z.string().trim().min(1), triggerType: z.string().trim().min(1).max(100).default("verification_ready") }).strict();
const pairBody = siteBody.extend({ alertId: z.string().trim().min(1), cleanerId: z.string().trim().min(1), rationaleSummary: z.string().trim().min(1).max(300) }).strict();
const workBody = siteBody.extend({ workOrderId: z.string().trim().min(1) }).strict();

export const v2OrchestratorSupervisorRoutes = Router();

v2OrchestratorSupervisorRoutes.get("/config", async (req, res) => res.json({ config: await getV2OrchestratorConfig(String(req.authUser.siteId)) }));
v2OrchestratorSupervisorRoutes.post("/status", async (req, res) => {
  const input = z.object({ status: z.enum(["running", "paused"]), reason: z.string().trim().max(500).nullable().optional() }).strict().parse(req.body);
  return res.json({ config: await setV2OrchestratorStatus(String(req.authUser.siteId), input.status, { uid: req.authUser.uid, role: "supervisor", authority: req.authUser.authority, displayName: req.authUser.displayName }, input.reason ?? null, req.requestId) });
});
v2OrchestratorSupervisorRoutes.get("/runs", async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
  return res.json({ runs: await listV2OrchestratorRuns(String(req.authUser.siteId), limit) });
});
v2OrchestratorSupervisorRoutes.get("/runs/:runId", async (req, res) => res.json(await getV2OrchestratorRun(String(req.authUser.siteId), req.params.runId)));
v2OrchestratorSupervisorRoutes.post("/assignment-cycle", async (req, res) => {
  const input = z.object({ triggerType: z.string().trim().min(1).max(100).default("supervisor_test") }).strict().parse(req.body);
  return res.status(201).json(await runV2AssignmentCycle(String(req.authUser.siteId), { workerId: `supervisor-trigger:${req.authUser.uid}`, requestId: req.requestId, triggerType: input.triggerType }));
});

export const v2OrchestratorInternalRoutes = Router();
v2OrchestratorInternalRoutes.use(authenticateOrchestrator);
v2OrchestratorInternalRoutes.use(rateLimit({ namespace: "v2-orchestrator", maximum: env.generalRateLimitPerMinute }));

v2OrchestratorInternalRoutes.post("/assignment-runs", async (req, res) => {
  const input = runBody.parse(req.body);
  return res.status(201).json(await createV2AssignmentRun(input.siteId, req.orchestrator!.workerId, input.triggerType));
});
v2OrchestratorInternalRoutes.get("/runs/:runId/assignment-context", async (req, res) => {
  const siteId = z.string().trim().min(1).parse(req.query.siteId);
  return res.json({ context: await getV2AssignmentContextTool(siteId, req.params.runId, req.orchestrator!.workerId) });
});
v2OrchestratorInternalRoutes.post("/runs/:runId/assign-cleaner", async (req, res) => {
  const input = pairBody.parse(req.body);
  return res.status(201).json({ workOrder: await assignV2CleanerByIdsTool({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }) });
});
v2OrchestratorInternalRoutes.post("/review-runs", async (req, res) => {
  const input = reviewRunBody.parse(req.body);
  return res.status(201).json(await createV2ReviewRun(input.siteId, input.workOrderId, req.orchestrator!.workerId, input.triggerType));
});
v2OrchestratorInternalRoutes.get("/runs/:runId/review-context", async (req, res) => {
  const input = workBody.parse(req.query);
  return res.json({ context: await getV2ReviewContext(input.siteId, req.params.runId, input.workOrderId, req.orchestrator!.workerId) });
});
v2OrchestratorInternalRoutes.post("/runs/:runId/resolve-verified-work", async (req, res) => {
  const input = workBody.parse(req.body);
  return res.json(await resolveV2VerifiedWork({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }));
});
v2OrchestratorInternalRoutes.post("/runs/:runId/request-rework", async (req, res) => {
  const input = workBody.parse(req.body);
  return res.json(await requestV2Rework({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }));
});
