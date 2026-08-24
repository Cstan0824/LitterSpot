import { z } from "zod";
import { boundedListQueryFields } from "./pagination.js";
import { reviewDecisionInputSchema, reviewRequestSchema } from "./review.js";

const idSchema = z.string().trim().min(1).max(160);
const idempotencyKeySchema = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/);

export const orchestratorRunStatusSchema = z.enum(["queued", "running", "waiting", "completed", "failed", "paused"]);
export type OrchestratorRunStatus = z.infer<typeof orchestratorRunStatusSchema>;

export const orchestratorOutboxStatusSchema = z.enum(["pending", "claimed", "completed", "failed", "paused"]);
export type OrchestratorOutboxStatus = z.infer<typeof orchestratorOutboxStatusSchema>;

export const orchestratorRunListQuerySchema = z.object({
  status: orchestratorRunStatusSchema.or(z.literal("all")).default("all"),
  alertId: idSchema.optional(),
  ...boundedListQueryFields,
}).strict();

export const orchestratorClaimSchema = z.object({
  workerId: idSchema,
  leaseSeconds: z.number().int().min(30).max(900).default(300),
}).strict();

export const orchestratorCompletionSchema = z.object({
  workerId: idSchema,
  claimToken: idSchema,
  status: orchestratorRunStatusSchema,
  result: z.record(z.unknown()).optional(),
  errorCode: idSchema.optional(),
  errorMessage: z.string().trim().max(500).optional(),
}).strict().superRefine((input, context) => {
  if (input.status === "failed" && !input.errorCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "errorCode is required for a failed run." });
  }
});

export const orchestratorDecisionSchema = z.object({
  claimToken: idSchema,
  actionId: idempotencyKeySchema,
  toolName: z.enum([
    "get_alert_context",
    "list_eligible_cleaners",
    "create_work_order",
    "reassign_work_order",
    "send_notification",
    "request_fresh_evidence",
    "mark_rework_required",
    "resolve_alert",
    "raise_supervisor_exception",
  ]),
  outcome: z.enum(["succeeded", "rejected", "failed"]),
  input: z.record(z.unknown()).default({}),
  result: z.record(z.unknown()).optional(),
  rationale: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const orchestratorWorkOrderSchema = z.object({
  runId: idSchema,
  claimToken: idSchema,
  decisionId: idempotencyKeySchema,
  rationale: z.string().trim().max(2_000).optional(),
  alertId: idSchema,
  assignedCleanerId: idSchema,
  instructions: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
  overrideAvailability: z.boolean().default(false),
}).strict();

export const orchestratorReviewRequestSchema = reviewRequestSchema.extend({
  claimToken: idSchema,
}).strict();

export const orchestratorReviewDecisionSchema = reviewDecisionInputSchema.extend({
  claimToken: idSchema,
}).strict();

export type OrchestratorClaimInput = z.infer<typeof orchestratorClaimSchema>;
export type OrchestratorCompletionInput = z.infer<typeof orchestratorCompletionSchema>;
export type OrchestratorDecisionInput = z.infer<typeof orchestratorDecisionSchema>;
export type OrchestratorWorkOrderInput = z.infer<typeof orchestratorWorkOrderSchema>;
export type OrchestratorReviewRequestInput = z.infer<typeof orchestratorReviewRequestSchema>;
export type OrchestratorReviewDecisionInput = z.infer<typeof orchestratorReviewDecisionSchema>;
