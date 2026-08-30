import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const key = id.regex(/^[A-Za-z0-9._:-]+$/);
const point = z.object({ xMeters: z.number().finite().nonnegative(), yMeters: z.number().finite().nonnegative() }).strict();

export const v2WorkStatusSchema = z.enum(["assigned", "in_progress", "awaiting_review", "resolved", "dismissed"]);
export const v2WorkListQuerySchema = z.object({
  status: z.union([v2WorkStatusSchema, z.literal("active"), z.literal("all")]).default("active"),
  cleanerId: id.optional(),
  alertId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().superRefine((value, context) => {
  if (value.cleanerId && value.alertId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use at most one of cleanerId or alertId." });
});

export const v2AlertAssignmentSchema = z.object({ assignedCleanerId: id, idempotencyKey: key }).strict();
export const v2ManualWorkSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1000),
  severity: z.enum(["warning", "critical"]),
  assignedCleanerId: id,
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("camera"), cameraId: id }).strict(),
    z.object({ type: z.literal("coordinate"), point }).strict(),
  ]),
  creationEvidenceMediaId: id.nullable().optional(),
  idempotencyKey: key,
}).strict();

export const v2WorkTransitionSchema = z.object({ idempotencyKey: key }).strict();
export const v2WorkDismissSchema = z.object({ reason: z.string().trim().min(1).max(500), expectedRevision: z.number().int().nonnegative(), idempotencyKey: key }).strict();
export const v2WorkReassignSchema = z.object({ assignedCleanerId: id, reason: z.string().trim().min(1).max(500), expectedRevision: z.number().int().nonnegative(), idempotencyKey: key }).strict();
export const v2WorkTakeoverSchema = z.object({ reason: z.string().trim().min(1).max(500), idempotencyKey: key }).strict();
export const v2VerificationSchema = z.object({ outcome: z.enum(["passed", "failed", "inconclusive"]), reason: z.string().trim().max(500).nullable().optional(), expectedRevision: z.number().int().nonnegative(), idempotencyKey: key }).strict();
export const v2VerificationOverrideSchema = z.object({ outcome: z.enum(["passed", "failed", "inconclusive"]), reason: z.string().trim().min(1).max(500), expectedRevision: z.number().int().nonnegative(), idempotencyKey: key }).strict();

export type V2WorkStatus = z.infer<typeof v2WorkStatusSchema>;
