import { z } from "zod";

export const statusQuerySchema = z.enum(["active", "inactive", "all"]).default("all");

const nameSchema = z.string().trim().min(2).max(80);
const descriptionSchema = z.string().trim().max(500).nullable().optional();
const codeSchema = z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/i).nullable().optional();

export const createSiteSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  timezone: z.string().trim().min(3).max(64).default("Asia/Kuala_Lumpur"),
}).strict();

export const updateSiteSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema,
  status: z.enum(["active", "inactive"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one field must be supplied." });

export const createZoneSchema = z.object({
  siteId: z.string().trim().min(1).max(128),
  name: nameSchema,
  code: codeSchema,
  description: descriptionSchema,
}).strict();

export const updateZoneSchema = z.object({
  name: nameSchema.optional(),
  code: codeSchema,
  description: descriptionSchema,
  status: z.enum(["active", "inactive"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one field must be supplied." });

export const createCameraSchema = z.object({
  zoneId: z.string().trim().min(1).max(128),
  code: z.string().trim().regex(/^CAMERA-[1-9]\d*$/i),
  name: nameSchema,
  sourceMode: z.enum(["upload", "stream"]).default("upload"),
}).strict();

export const updateCameraSchema = z.object({
  zoneId: z.string().trim().min(1).max(128).optional(),
  name: nameSchema.optional(),
  sourceMode: z.enum(["upload", "stream"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one field must be supplied." });
