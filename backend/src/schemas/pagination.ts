import { z } from "zod";

export const opaqueCursorSchema = z.string()
  .trim()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/, "cursor must be an opaque base64url value");

export const boundedListQueryFields = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: opaqueCursorSchema.optional(),
};
