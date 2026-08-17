import { z } from "zod";
import { boundedListQueryFields } from "./pagination.js";

const idSchema = z.string().trim().min(1).max(128);
const idempotencyKeySchema = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const instantSchema = z.string().datetime({ offset: true });

export const presenceAvailabilitySchema = z.enum(["online", "busy", "break", "offline"]);
export const cleanerAvailabilityInputSchema = z.enum(["online", "break", "offline"]);

export const updateCleanerPresenceSchema = z.object({
  availability: cleanerAvailabilityInputSchema.optional(),
  locationConsent: z.boolean().optional(),
  clientHeartbeatId: idempotencyKeySchema.optional(),
  location: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(10_000),
    capturedAt: instantSchema,
    source: z.enum(["browser_geolocation", "manual_check_in"]).default("browser_geolocation"),
  }).strict().optional(),
}).strict().superRefine((input, context) => {
  if (Object.keys(input).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one presence field is required." });
  if (input.location && !input.clientHeartbeatId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["clientHeartbeatId"], message: "clientHeartbeatId is required with location." });
  }
});

export const locationHistoryQuerySchema = z.object({ ...boundedListQueryFields }).strict();

export const workOrderStatusSchema = z.enum([
  "unassigned",
  "assigned",
  "accepted",
  "in_progress",
  "ready_for_review",
  "rework_required",
  "completed",
  "rejected",
  "cancelled",
]);

export const createWorkOrderSchema = z.object({
  alertId: idSchema,
  assignedCleanerId: idSchema,
  instructions: z.string().trim().min(1).max(1_000),
  assignmentDecisionId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  overrideAvailability: z.boolean().default(false),
}).strict();

export const reassignWorkOrderSchema = z.object({
  assignedCleanerId: idSchema,
  instructions: z.string().trim().min(1).max(1_000),
  assignmentDecisionId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(500).nullable().optional(),
  overrideAvailability: z.boolean().default(false),
}).strict();

export const transitionWorkOrderSchema = z.object({
  status: workOrderStatusSchema,
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export const cleanerWorkOrderActionSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export const workOrderListQuerySchema = z.object({
  status: z.union([workOrderStatusSchema, z.literal("active"), z.literal("all")]).default("active"),
  alertId: idSchema.optional(),
  cleanerId: idSchema.optional(),
  ...boundedListQueryFields,
}).strict().superRefine((input, context) => {
  if (input.alertId && input.cleanerId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use at most one of alertId or cleanerId." });
});

export const notificationListQuerySchema = z.object({
  status: z.enum(["unread", "read", "all"]).default("unread"),
  ...boundedListQueryFields,
}).strict();

export const registerPushTokenSchema = z.object({
  deviceId: idSchema,
  token: z.string().trim().min(20).max(4_096),
  userAgent: z.string().trim().max(500).optional(),
}).strict();

export const workOrderParamsSchema = z.object({ workOrderId: idSchema }).strict();
export const notificationParamsSchema = z.object({ notificationId: idSchema }).strict();
export const cleanerParamsSchema = z.object({ cleanerId: idSchema }).strict();

export type UpdateCleanerPresenceInput = z.infer<typeof updateCleanerPresenceSchema>;
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type ReassignWorkOrderInput = z.infer<typeof reassignWorkOrderSchema>;
export type TransitionWorkOrderInput = z.infer<typeof transitionWorkOrderSchema>;
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;
