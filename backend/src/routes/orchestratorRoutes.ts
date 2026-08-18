import { Router } from "express";
import { env } from "../config/env.js";
import { requireSupervisor } from "../middleware/requireRole.js";
import { authenticateOrchestrator } from "../middleware/authenticateOrchestrator.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  claimOrchestratorRun,
  completeOrchestratorRun,
  createOrchestratorWorkOrder,
  ensureOrchestratorRun,
  getOrchestratorAlertContext,
  getOrchestratorRun,
  listEligibleCleanersForAlert,
  listOrchestratorRuns,
  recordOrchestratorDecision,
  recoverOrchestratorRuns,
} from "../services/orchestratorService.js";
import {
  orchestratorClaimSchema,
  orchestratorCompletionSchema,
  orchestratorDecisionSchema,
  orchestratorRunListQuerySchema,
  orchestratorWorkOrderSchema,
  orchestratorReviewRequestSchema,
  orchestratorReviewDecisionSchema,
} from "../schemas/orchestrator.js";
import { assertActiveOrchestratorClaim } from "../services/orchestratorService.js";
import { getReviewContext, requestFreshEvidence, recordReviewDecision } from "../services/reviewService.js";

export const orchestratorSupervisorRoutes = Router();
orchestratorSupervisorRoutes.use(requireSupervisor);

orchestratorSupervisorRoutes.get("/runs", async (req, res) => {
  const page = await listOrchestratorRuns(orchestratorRunListQuerySchema.parse(req.query));
  return res.json({ runs: page.items, nextCursor: page.nextCursor });
});

orchestratorSupervisorRoutes.get("/runs/:runId", async (req, res) => {
  return res.json({ run: await getOrchestratorRun(req.params.runId) });
});

orchestratorSupervisorRoutes.post("/recover", async (_req, res) => {
  return res.json({ recovered: await recoverOrchestratorRuns() });
});

orchestratorSupervisorRoutes.post("/runs/ensure", async (req, res) => {
  const alertId = String(req.body?.alertId ?? "").trim();
  if (!alertId) return res.status(400).json({ error: "alertId is required.", requestId: req.requestId });
  const result = await ensureOrchestratorRun(alertId);
  return res.status(result.idempotent ? 200 : 201).json(result);
});

export const orchestratorInternalRoutes = Router();
orchestratorInternalRoutes.use(authenticateOrchestrator);
orchestratorInternalRoutes.use(rateLimit({ namespace: "orchestrator", maximum: env.generalRateLimitPerMinute }));

orchestratorInternalRoutes.get("/runs/:runId/context", async (req, res) => {
  return res.json({ context: await getOrchestratorAlertContext((await getOrchestratorRun(req.params.runId)).alertId) });
});

orchestratorInternalRoutes.get("/work-orders/:workOrderId/review-context", async (req, res) => {
  return res.json(await getReviewContext(req.params.workOrderId));
});

orchestratorInternalRoutes.get("/runs", async (req, res) => {
  const page = await listOrchestratorRuns(orchestratorRunListQuerySchema.parse(req.query));
  return res.json({ runs: page.items, nextCursor: page.nextCursor });
});

orchestratorInternalRoutes.get("/alerts/:alertId/eligible-cleaners", async (req, res) => {
  return res.json({ cleaners: await listEligibleCleanersForAlert(req.params.alertId) });
});

orchestratorInternalRoutes.post("/runs/:runId/claim", async (req, res) => {
  const input = orchestratorClaimSchema.parse({ ...req.body, leaseSeconds: req.body?.leaseSeconds ?? env.orchestratorLeaseSeconds });
  if (input.workerId !== req.orchestrator!.workerId) return res.status(403).json({ error: "Worker ID does not match the authenticated orchestrator.", requestId: req.requestId });
  return res.json(await claimOrchestratorRun(req.params.runId, input));
});

orchestratorInternalRoutes.post("/runs/:runId/complete", async (req, res) => {
  const input = orchestratorCompletionSchema.parse(req.body);
  if (input.workerId !== req.orchestrator!.workerId) return res.status(403).json({ error: "Worker ID does not match the authenticated orchestrator.", requestId: req.requestId });
  return res.json({ run: await completeOrchestratorRun(req.params.runId, input) });
});

orchestratorInternalRoutes.post("/runs/:runId/decisions", async (req, res) => {
  const input = orchestratorDecisionSchema.parse(req.body);
  const result = await recordOrchestratorDecision(req.params.runId, input, req.orchestrator!.workerId);
  return res.status(result.idempotent ? 200 : 201).json(result);
});

orchestratorInternalRoutes.post("/runs/:runId/review-requests", async (req, res) => {
  const input = orchestratorReviewRequestSchema.parse({ ...req.body, workOrderId: req.body?.workOrderId, claimToken: req.body?.claimToken });
  const run = await assertActiveOrchestratorClaim(req.params.runId, input.claimToken, req.orchestrator!.workerId);
  if (input.alertId !== run.alertId) return res.status(409).json({ error: "Review alert does not belong to the claimed orchestrator run.", requestId: req.requestId });
  const { claimToken: _claimToken, ...reviewInput } = input;
  const result = await requestFreshEvidence(reviewInput, { type: "orchestrator", id: req.orchestrator!.workerId });
  const decision = await recordOrchestratorDecision(req.params.runId, {
    claimToken: input.claimToken,
    actionId: input.idempotencyKey,
    toolName: "request_fresh_evidence",
    outcome: "succeeded",
    input: { workOrderId: input.workOrderId, alertId: input.alertId, rationale: input.rationale ?? null },
    result: { reviewRequestId: result.reviewRequest.id },
    rationale: input.rationale,
    idempotencyKey: input.idempotencyKey,
  }, req.orchestrator!.workerId);
  return res.status(result.idempotent ? 200 : 201).json({ ...result, decisionId: decision.decisionId });
});

orchestratorInternalRoutes.post("/runs/:runId/reviews", async (req, res) => {
  const input = orchestratorReviewDecisionSchema.parse(req.body);
  const run = await assertActiveOrchestratorClaim(req.params.runId, input.claimToken, req.orchestrator!.workerId);
  if (input.alertId !== run.alertId) return res.status(409).json({ error: "Review alert does not belong to the claimed orchestrator run.", requestId: req.requestId });
  const { claimToken: _claimToken, ...reviewInput } = input;
  const result = await recordReviewDecision(reviewInput, { type: "orchestrator", id: req.orchestrator!.workerId });
  const toolName = input.decision === "clean" ? "resolve_alert"
    : input.decision === "rework" ? "mark_rework_required"
      : input.decision === "more_evidence" ? "request_fresh_evidence" : "raise_supervisor_exception";
  const decision = await recordOrchestratorDecision(req.params.runId, {
    claimToken: input.claimToken,
    actionId: input.idempotencyKey,
    toolName,
    outcome: "succeeded",
    input: { workOrderId: input.workOrderId, alertId: input.alertId, reviewRequestId: input.reviewRequestId, decision: input.decision },
    result: { reviewId: result.review.id },
    rationale: input.rationaleSummary,
    idempotencyKey: input.idempotencyKey,
  }, req.orchestrator!.workerId);
  return res.status(result.idempotent ? 200 : 201).json({ ...result, decisionId: decision.decisionId });
});

orchestratorInternalRoutes.post("/work-orders", async (req, res) => {
  const input = orchestratorWorkOrderSchema.parse(req.body);
  const result = await createOrchestratorWorkOrder(input, req.orchestrator!.workerId);
  return res.status(result.idempotent ? 200 : 201).json(result);
});
