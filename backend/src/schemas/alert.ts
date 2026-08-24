import { z } from "zod";
import { boundedListQueryFields } from "./pagination.js";

export const alertStatusSchema = z.enum(["new", "acknowledged", "in_progress", "awaiting_verification", "resolved"]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const alertStatusUpdateSchema = z.object({
  status: alertStatusSchema,
  note: z.string().trim().min(1).max(500).optional(),
}).strict();

export const alertListQuerySchema = z.object({
  status: z.enum(["new", "acknowledged", "in_progress", "awaiting_verification", "resolved", "all"]).default("all"),
  issueType: z.enum(["floor_litter", "floor_spill", "bin_overflow"]).optional(),
  severity: z.enum(["warning", "critical"]).optional(),
  siteId: z.string().trim().min(1).max(128).optional(),
  zoneId: z.string().trim().min(1).max(128).optional(),
  cameraId: z.string().trim().min(1).max(128).optional(),
  workflow: z.enum(["current", "legacy", "all"]).default("current"),
  ...boundedListQueryFields,
});

export const flagListQuerySchema = z.object({
  detectionId: z.string().trim().min(1).max(128).optional(),
  analysisRunId: z.string().trim().min(1).max(128).optional(),
  alertId: z.string().trim().min(1).max(128).optional(),
  workflow: z.enum(["current", "legacy", "all"]).default("current"),
  ...boundedListQueryFields,
});

export const issueObservationListQuerySchema = z.object({
  analysisRunId: z.string().trim().min(1).max(128).optional(),
  cameraId: z.string().trim().min(1).max(128).optional(),
  issueType: z.enum(["floor_litter", "floor_spill", "bin_overflow"]).optional(),
  positive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  ...boundedListQueryFields,
});

export const alertChildListQuerySchema = z.object({
  ...boundedListQueryFields,
});
