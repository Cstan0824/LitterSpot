import { z } from "zod";

const idSchema = z.string().trim().min(1).max(128);
const instantSchema = z.string().datetime({ offset: true });

export const generateAnalyticsReportSchema = z.object({
  siteId: idSchema,
  periodStart: instantSchema,
  periodEnd: instantSchema,
  zoneIds: z.array(idSchema).max(1_000).optional(),
}).strict().superRefine((input, context) => {
  const start = Date.parse(input.periodStart);
  const end = Date.parse(input.periodEnd);
  if (end <= start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodEnd"], message: "periodEnd must be after periodStart." });
  }
  if (end - start > 366 * 24 * 60 * 60 * 1_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodEnd"], message: "A report period cannot exceed 366 days." });
  }
  if (input.zoneIds && new Set(input.zoneIds).size !== input.zoneIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["zoneIds"], message: "zoneIds must be unique." });
  }
});

export const listAnalyticsReportsSchema = z.object({
  siteId: idSchema,
  status: z.enum(["completed", "insufficient_data", "failed", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: idSchema.optional(),
}).strict();

export const analyticsReportParamsSchema = z.object({ reportId: idSchema }).strict();
export const reconcileAnalyticsSchema = z.object({ siteId: idSchema }).strict();

export type GenerateAnalyticsReportInput = z.infer<typeof generateAnalyticsReportSchema>;
export type ListAnalyticsReportsInput = z.infer<typeof listAnalyticsReportsSchema>;

