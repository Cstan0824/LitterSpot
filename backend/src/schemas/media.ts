import { z } from "zod";
import { boundedListQueryFields } from "./pagination.js";

function booleanFormField(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  }, z.boolean());
}

const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
}).strict();

type NormalizedPoint = z.infer<typeof normalizedPointSchema>;

function polygonArea(points: NormalizedPoint[]) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function cross(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsProperlyIntersect(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint, d: NormalizedPoint) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB);
}

function selfIntersects(points: NormalizedPoint[]) {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsProperlyIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true;
    }
  }
  return false;
}

const normalizedPolygonSchema = z.array(normalizedPointSchema)
  .refine((points) => points.length === 0 || points.length >= 3, {
    message: "focusRegion must be empty or contain at least three points.",
  })
  .superRefine((points, context) => {
    if (points.length === 0) return;
    if (polygonArea(points) < 0.000001) context.addIssue({ code: z.ZodIssueCode.custom, message: "focusRegion must have a non-zero area." });
    if (selfIntersects(points)) context.addIssue({ code: z.ZodIssueCode.custom, message: "focusRegion must not cross itself." });
  });

const focusRegionSchema = z.preprocess((value, context) => {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "focusRegion must be valid JSON." });
    return z.NEVER;
  }
}, normalizedPolygonSchema);

export const imageUploadSchema = z.object({
  cameraId: z.string().trim().min(1).max(128),
  clientRequestId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  isTest: booleanFormField(true),
  floorConfidence: z.coerce.number().min(0.01).max(0.99).optional(),
  binLocalizerConfidence: z.coerce.number().min(0.01).max(0.99).optional(),
  focusRegion: focusRegionSchema,
}).strict();

export const videoUploadSchema = z.object({
  cameraId: z.string().trim().min(1).max(128),
  clientRequestId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  isTest: booleanFormField(true),
  frameIntervalSeconds: z.coerce.number().min(1).max(10).optional(),
  floorConfidence: z.coerce.number().min(0.01).max(0.99).optional(),
  binLocalizerConfidence: z.coerce.number().min(0.01).max(0.99).optional(),
  focusRegion: focusRegionSchema,
}).strict();

export const mediaListQuerySchema = z.object({
  cameraId: z.string().trim().min(1).max(128).optional(),
  isTest: z.enum(["true", "false"]).optional(),
  ...boundedListQueryFields,
});

export const jobListQuerySchema = z.object({
  status: z.enum(["uploading", "queued", "processing", "completed", "failed", "cancelled", "all"]).default("all"),
  ...boundedListQueryFields,
});

export const analysisListQuerySchema = z.object({
  jobId: z.string().trim().min(1).max(128).optional(),
  cameraId: z.string().trim().min(1).max(128).optional(),
  ...boundedListQueryFields,
});

export const detectionListQuerySchema = z.object({
  analysisRunId: z.string().trim().min(1).max(128).optional(),
  jobId: z.string().trim().min(1).max(128).optional(),
  cameraId: z.string().trim().min(1).max(128).optional(),
  issueType: z.enum(["floor_litter", "bin_overflow", "floor_spill"]).optional(),
  ...boundedListQueryFields,
});
