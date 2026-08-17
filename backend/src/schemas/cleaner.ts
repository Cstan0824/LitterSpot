import { z } from "zod";

const cleanerFields = {
  fullName: z.string().trim().min(2).max(60),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/),
  assignedZoneId: z.string().trim().min(1).max(128),
  notes: z.string().trim().max(500).nullable().optional(),
};

export const cleanerCapabilitySchema = z.enum([
  "general_cleaning",
  "floor_litter",
  "bin_overflow",
  "floor_spill",
]);

export const createCleanerSchema = z.object({
  staffCode: z.string().trim().regex(/^CLN-\d{3,}$/i),
  ...cleanerFields,
  capabilities: z.array(cleanerCapabilitySchema).min(1).max(10).default(["general_cleaning"]),
});

export const updateCleanerSchema = z.object({
  ...cleanerFields,
  permittedSiteIds: z.array(z.string().trim().min(1).max(128)).min(1).max(50).optional(),
  permittedZoneIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100).optional(),
  capabilities: z.array(cleanerCapabilitySchema).min(1).max(10).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be supplied.",
});

export const provisionCleanerAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();

export const cleanerAccountParamsSchema = z.object({
  cleanerId: z.string().trim().min(1).max(128),
}).strict();
