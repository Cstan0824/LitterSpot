import { z } from "zod";

const pointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
}).strict();

const polygonSchema = z.array(pointSchema).min(3).max(64);

function polygonArea(points: Array<{ x: number; y: number }>) {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function validPolygon(points: Array<{ x: number; y: number }>) {
  return new Set(points.map((point) => `${point.x.toFixed(6)}:${point.y.toFixed(6)}`)).size >= 3
    && polygonArea(points) >= 0.00001;
}

const checkedPolygonSchema = polygonSchema.superRefine((points, context) => {
  if (!validPolygon(points)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Polygon must have three distinct points and non-zero area." });
});

const qualitySchema = z.object({
  minAlignmentScore: z.number().finite().min(0.5).max(1).default(0.82),
  minRimVisibility: z.number().finite().min(0.5).max(1).default(0.75),
  maxFrameAgeSeconds: z.number().int().min(1).max(86_400).default(300),
}).strict().default({});

const binIdSchema = z.string().trim().regex(/^bin-[A-Za-z0-9_-]{1,32}$/i);

const referenceSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image") }).strict(),
  z.object({
    type: z.literal("video"),
    mediaId: z.string().trim().min(1).max(128),
    capturedFrameTimeSeconds: z.number().finite().nonnegative(),
    durationSeconds: z.number().finite().positive().optional(),
  }).strict(),
]).default({ type: "image" });

const registrationBaseSchema = z.object({
  referenceMediaId: z.string().trim().min(1).max(128),
  referenceSource: referenceSourceSchema,
  sourceWidth: z.number().int().positive().max(16_000),
  sourceHeight: z.number().int().positive().max(16_000),
  walkableFloorPolygon: checkedPolygonSchema,
  quality: qualitySchema,
});

export const registeredBinSchema = z.object({
  binId: binIdSchema,
  displayName: z.string().trim().min(2).max(80),
  binType: z.enum(["open_top", "lidded", "unknown"]),
  binPolygon: checkedPolygonSchema,
}).strict();

export const cameraRegistrationDraftSchema = registrationBaseSchema.extend({
  schemaVersion: z.literal(2),
  bins: z.array(registeredBinSchema).max(32),
}).strict().superRefine((value, context) => {
  const ids = value.bins.map((bin) => bin.binId.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bins"], message: "Each registered binId must be unique within a camera." });
  }
});

export type CameraRegistrationDraft = z.infer<typeof cameraRegistrationDraftSchema>;
export type RegisteredBin = z.infer<typeof registeredBinSchema>;
export type CameraRegistrationReferenceSource = z.infer<typeof referenceSourceSchema>;

export function normalizeCameraRegistrationDraft(draft: CameraRegistrationDraft): CameraRegistrationDraft {
  return draft;
}
