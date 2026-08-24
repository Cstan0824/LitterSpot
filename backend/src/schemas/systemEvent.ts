import { z } from "zod";
import { opaqueCursorSchema } from "./pagination.js";

const safeIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Must be a stable identifier without whitespace or path separators.");
const isoInstantSchema = z.string().datetime({ offset: true });

export const systemEventKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
export const systemEventDependencySchema = z.enum([
  "ai_service",
  "video_processing",
  "analytics_rebuild",
]);
export const systemEventSeveritySchema = z.enum(["warning", "critical"]);
export const systemEventStatusSchema = z.enum(["open", "resolved"]);

export const systemEventCodeSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Must be a lower-snake-case event code.");

export const systemEventScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("site"), id: safeIdentifierSchema }).strict(),
  z.object({ type: z.literal("job"), id: safeIdentifierSchema }).strict(),
]);

export const systemEventIdentitySchema = z.object({
  dependency: systemEventDependencySchema,
  eventCode: systemEventCodeSchema,
  scope: systemEventScopeSchema,
}).strict();

/**
 * This is deliberately an allowlist, not arbitrary metadata. In particular it
 * has no raw error message, stack, URL, request header, credential, or token
 * field. Callers should map failures to stable reason/operation codes.
 */
export const systemEventSafeDetailsSchema = z.object({
  operation: systemEventCodeSchema.optional(),
  reasonCode: systemEventCodeSchema.optional(),
  retryable: z.boolean().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  siteId: safeIdentifierSchema.optional(),
  zoneId: safeIdentifierSchema.optional(),
  cameraId: safeIdentifierSchema.optional(),
  jobId: safeIdentifierSchema.optional(),
  mediaId: safeIdentifierSchema.optional(),
  analysisRunId: safeIdentifierSchema.optional(),
  analyticsBucketId: safeIdentifierSchema.optional(),
  frameIndex: z.number().int().nonnegative().optional(),
  videoOffsetSeconds: z.number().finite().nonnegative().max(86_400).optional(),
  attemptCount: z.number().int().nonnegative().max(1_000_000).optional(),
  succeededItemCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
  failedItemCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
  durationMs: z.number().finite().nonnegative().max(7 * 24 * 60 * 60 * 1_000).optional(),
  periodStart: isoInstantSchema.optional(),
  periodEnd: isoInstantSchema.optional(),
}).strict().superRefine((details, context) => {
  if (details.periodStart && details.periodEnd && Date.parse(details.periodEnd) <= Date.parse(details.periodStart)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "periodEnd must be after periodStart.",
    });
  }
});

export const systemEventOccurrenceInputSchema = z.object({
  occurrenceId: safeIdentifierSchema,
  identity: systemEventIdentitySchema,
  severity: systemEventSeveritySchema,
  occurredAt: isoInstantSchema,
  safeDetails: systemEventSafeDetailsSchema.default({}),
}).strict();

export const systemEventRecoveryInputSchema = z.object({
  recoveryId: safeIdentifierSchema,
  expectedGeneration: z.number().int().positive(),
  recoveredAt: isoInstantSchema,
  safeDetails: systemEventSafeDetailsSchema.default({}),
}).strict();

export const systemEventListQuerySchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  dependency: systemEventDependencySchema.optional(),
  severity: systemEventSeveritySchema.optional(),
  scopeType: z.enum(["global", "site", "job"]).optional(),
  scopeId: safeIdentifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: opaqueCursorSchema.optional(),
}).strict().superRefine((query, context) => {
  if (query.scopeType === "global" && query.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopeId"],
      message: "A global scope cannot have scopeId.",
    });
  }
  if (query.scopeId && !query.scopeType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopeType"],
      message: "scopeType is required when scopeId is provided.",
    });
  }
  if (query.scopeType && query.scopeType !== "global" && !query.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopeId"],
      message: "scopeId is required for a non-global scope.",
    });
  }
  const optionalFilterCount = Number(Boolean(query.dependency))
    + Number(Boolean(query.severity))
    + Number(Boolean(query.scopeType));
  if (optionalFilterCount > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use at most one of dependency, severity, or scope filters per request.",
    });
  }
  if (query.status === "all" && optionalFilterCount > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "status=all cannot be combined with another system-event filter.",
    });
  }
});

export type SystemEventDependency = z.infer<typeof systemEventDependencySchema>;
export type SystemEventSeverity = z.infer<typeof systemEventSeveritySchema>;
export type SystemEventStatus = z.infer<typeof systemEventStatusSchema>;
export type SystemEventIdentity = z.infer<typeof systemEventIdentitySchema>;
export type SystemEventSafeDetails = z.infer<typeof systemEventSafeDetailsSchema>;
export type SystemEventOccurrenceInput = z.infer<typeof systemEventOccurrenceInputSchema>;
export type SystemEventRecoveryInput = z.infer<typeof systemEventRecoveryInputSchema>;
export type SystemEventListQuery = z.infer<typeof systemEventListQuerySchema>;
