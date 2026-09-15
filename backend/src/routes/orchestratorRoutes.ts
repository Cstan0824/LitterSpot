import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { authenticateOrchestrator } from "../middleware/authenticateOrchestrator.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  assignCleanerByIdsTool,
  createAssignmentRun,
  createReviewRun,
  getAssignmentContextTool,
  getOrchestratorConfig,
  getOrchestratorRun,
  getReviewContext,
  listOrchestratorRuns,
  listOrchestratorRunsPage,
  requestRework,
  resolveVerifiedWork,
  runAssignmentCycle,
  setOrchestratorStatus,
} from "../services/orchestratorService.js";
import { boundedListQueryFields } from "../schemas/pagination.js";

const siteBody = z.object({ siteId: z.string().trim().min(1) }).strict();
const runBody = siteBody.extend({ triggerType: z.string().trim().min(1).max(100).default("manual_cycle") }).strict();
const reviewRunBody = siteBody.extend({ workOrderId: z.string().trim().min(1), triggerType: z.string().trim().min(1).max(100).default("verification_ready") }).strict();
const pairBody = siteBody.extend({ alertId: z.string().trim().min(1), cleanerId: z.string().trim().min(1), rationaleSummary: z.string().trim().min(1).max(300) }).strict();
const workBody = siteBody.extend({ workOrderId: z.string().trim().min(1) }).strict();

export const orchestratorSupervisorRoutes = Router();

orchestratorSupervisorRoutes.get("/config", async (req, res) => res.json({ config: await getOrchestratorConfig(String(req.authUser.siteId)) }));
orchestratorSupervisorRoutes.post("/status", async (req, res) => {
  const input = z.object({ status: z.enum(["running", "paused"]), reason: z.string().trim().max(500).nullable().optional() }).strict().parse(req.body);
  return res.json({ config: await setOrchestratorStatus(String(req.authUser.siteId), input.status, { uid: req.authUser.uid, role: "supervisor", authority: req.authUser.authority, displayName: req.authUser.displayName }, input.reason ?? null, req.requestId) });
});
orchestratorSupervisorRoutes.get("/runs", async (req, res) => {
  const query = z.object({ ...boundedListQueryFields, status: z.string().trim().min(1).optional() }).strict().parse(req.query);
  const page = await listOrchestratorRunsPage(String(req.authUser.siteId), query);
  return res.json({ runs: page.items, ...page });
});
orchestratorSupervisorRoutes.get("/runs/:runId", async (req, res) => res.json(await getOrchestratorRun(String(req.authUser.siteId), req.params.runId)));
orchestratorSupervisorRoutes.post("/assignment-cycle", async (req, res) => {
  const input = z.object({ triggerType: z.string().trim().min(1).max(100).default("supervisor_test") }).strict().parse(req.body);
  return res.status(201).json(await runAssignmentCycle(String(req.authUser.siteId), { workerId: `supervisor-trigger:${req.authUser.uid}`, requestId: req.requestId, triggerType: input.triggerType }));
});

export const orchestratorInternalRoutes = Router();
orchestratorInternalRoutes.use(authenticateOrchestrator);
orchestratorInternalRoutes.use(rateLimit({ namespace: "v2-orchestrator", maximum: env.generalRateLimitPerMinute }));

orchestratorInternalRoutes.post("/assignment-runs", async (req, res) => {
  const input = runBody.parse(req.body);
  return res.status(201).json(await createAssignmentRun(input.siteId, req.orchestrator!.workerId, input.triggerType));
});
orchestratorInternalRoutes.get("/runs/:runId/assignment-context", async (req, res) => {
  const siteId = z.string().trim().min(1).parse(req.query.siteId);
  return res.json({ context: await getAssignmentContextTool(siteId, req.params.runId, req.orchestrator!.workerId) });
});
orchestratorInternalRoutes.post("/runs/:runId/assign-cleaner", async (req, res) => {
  const input = pairBody.parse(req.body);
  return res.status(201).json({ workOrder: await assignCleanerByIdsTool({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }) });
});
orchestratorInternalRoutes.post("/review-runs", async (req, res) => {
  const input = reviewRunBody.parse(req.body);
  return res.status(201).json(await createReviewRun(input.siteId, input.workOrderId, req.orchestrator!.workerId, input.triggerType));
});
orchestratorInternalRoutes.get("/runs/:runId/review-context", async (req, res) => {
  const input = workBody.parse(req.query);
  return res.json({ context: await getReviewContext(input.siteId, req.params.runId, input.workOrderId, req.orchestrator!.workerId) });
});
orchestratorInternalRoutes.post("/runs/:runId/resolve-verified-work", async (req, res) => {
  const input = workBody.parse(req.body);
  return res.json(await resolveVerifiedWork({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }));
});
orchestratorInternalRoutes.post("/runs/:runId/request-rework", async (req, res) => {
  const input = workBody.parse(req.body);
  return res.json(await requestRework({ ...input, runId: req.params.runId, workerId: req.orchestrator!.workerId, requestId: req.requestId }));
});
