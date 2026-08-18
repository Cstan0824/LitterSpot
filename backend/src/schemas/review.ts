import { z } from "zod";
import { boundedListQueryFields } from "./pagination.js";

const idSchema = z.string().trim().min(1).max(160);
const idempotencyKeySchema = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const evidenceIdsSchema = z.array(idSchema).max(20).default([]);

export const reviewDecisionSchema = z.enum(["clean", "rework", "more_evidence", "supervisor_exception"]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewRequestStatusSchema = z.enum(["requested", "fulfilled", "expired", "cancelled"]);
export type ReviewRequestStatus = z.infer<typeof reviewRequestStatusSchema>;

export const cleanerReviewSubmissionSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(500).nullable().optional(),
  evidenceMediaIds: evidenceIdsSchema,
}).strict();

export const reviewRequestSchema = z.object({
  workOrderId: idSchema,
  alertId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  rationale: z.string().trim().max(2_000).optional(),
}).strict();

export const reviewDecisionInputSchema = z.object({
  workOrderId: idSchema,
  alertId: idSchema,
  reviewRequestId: idSchema,
  decision: reviewDecisionSchema,
  rationaleSummary: z.string().trim().min(1).max(2_000),
  afterEvidenceMediaIds: evidenceIdsSchema,
  visionResults: z.record(z.unknown()).default({}),
  modelVersions: z.record(z.unknown()).default({}),
  promptPolicyVersion: z.string().trim().max(160).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reviewListQuerySchema = z.object({
  status: reviewRequestStatusSchema.or(z.literal("all")).default("all"),
  ...boundedListQueryFields,
}).strict();

export type CleanerReviewSubmissionInput = z.infer<typeof cleanerReviewSubmissionSchema>;
export type ReviewRequestInput = z.infer<typeof reviewRequestSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;
