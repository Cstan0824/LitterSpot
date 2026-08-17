import { z } from "zod";

const idSchema = z.string().trim().min(1).max(128);

export const dashboardSiteSchema = z.object({ siteId: idSchema }).strict();

export const dashboardQuerySchema = z.object({
  siteId: idSchema,
  alertLimit: z.coerce.number().int().min(1).max(50).default(10),
  detectionLimit: z.coerce.number().int().min(1).max(50).default(10),
  failedJobLimit: z.coerce.number().int().min(1).max(50).default(10),
}).strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardSiteInput = z.infer<typeof dashboardSiteSchema>;
