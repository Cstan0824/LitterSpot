import { z } from "zod";

export const stateClassificationResponseSchema = z.object({
  modelVersion: z.string(),
  state: z.enum(["normal", "full", "overflow", "unknown"]),
  stableState: z.enum(["normal", "full", "overflow", "unknown"]).nullable().optional(),
  confidence: z.number().min(0).max(1),
  signals: z.object({ binPresence: z.number().min(0).max(1), fullness: z.number().min(0).max(1), overflow: z.number().min(0).max(1) }),
  confirmed: z.boolean(),
  confirmationFrames: z.number().int().nonnegative(),
  distinctFrameAccepted: z.boolean(),
  transitionPending: z.boolean(),
  unknownReasons: z.array(z.string()),
  cameraId: z.string().nullable().optional(),
  binId: z.string().nullable().optional(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  region: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  profileUsed: z.boolean(),
  localizerUsed: z.boolean(),
  processingTimeMs: z.number().nonnegative(),
});

export const stateClassificationOptionsSchema = z.object({
  cameraId: z.string().trim().min(1).max(100).optional(),
  binId: z.string().trim().min(1).max(100).optional(),
  confirmationFrames: z.coerce.number().int().min(1).max(20).default(3),
  autoLocate: z.coerce.boolean().default(false),
  x1: z.coerce.number().nonnegative().optional(),
  y1: z.coerce.number().nonnegative().optional(),
  x2: z.coerce.number().positive().optional(),
  y2: z.coerce.number().positive().optional(),
}).superRefine((value, context) => {
  if (Boolean(value.cameraId) !== Boolean(value.binId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "cameraId and binId must be provided together" });
  const coordinates = [value.x1, value.y1, value.x2, value.y2];
  if (coordinates.some((item) => item !== undefined) && !coordinates.every((item) => item !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Provide all four ROI coordinates or none" });
});

export type StateClassificationResponse = z.infer<typeof stateClassificationResponseSchema>;
export type StateClassificationOptions = z.infer<typeof stateClassificationOptionsSchema>;

const boundingBoxSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

export const imageBinAnalysisResponseSchema = z.object({
  localizerVersion: z.string(),
  stateModelVersion: z.string(),
  decisionPolicy: z.string(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  detections: z.array(z.object({
    binIndex: z.number().int().positive(),
    trackingId: z.string().nullable().optional(),
    localizerConfidence: z.number().min(0).max(1),
    bbox: boundingBoxSchema,
    classificationRegion: boundingBoxSchema,
    state: z.enum(["normal", "full", "overflow", "unknown"]),
    stableState: z.enum(["normal", "full", "overflow", "unknown"]).nullable().optional(),
    stateConfidence: z.number().min(0).max(1),
    signals: z.object({
      binPresence: z.number().min(0).max(1),
      fullness: z.number().min(0).max(1),
      overflow: z.number().min(0).max(1),
    }),
    confirmed: z.boolean(),
    stale: z.boolean().default(false),
    confirmationFrames: z.number().int().nonnegative(),
    unknownReasons: z.array(z.string()),
    processingTimeMs: z.number().nonnegative(),
  })),
  reason: z.string().nullable().optional(),
  processingTimeMs: z.number().nonnegative(),
});

export const batchAnalysisOptionsSchema = z.object({
  localizerConfidence: z.coerce.number().min(0.01).max(0.99).default(0.80),
  maxBins: z.coerce.number().int().min(1).max(20).default(10),
  confirmationFrames: z.coerce.number().int().min(1).max(20).default(1),
});

export type ImageBinAnalysisResponse = z.infer<typeof imageBinAnalysisResponseSchema>;
export type BatchAnalysisOptions = z.infer<typeof batchAnalysisOptionsSchema>;

const pipelineBinSchema = z.object({
  binIndex: z.number().int().positive(),
  localizerConfidence: z.number().min(0).max(1),
  bbox: boundingBoxSchema,
  classificationRegion: boundingBoxSchema,
  state: z.enum(["normal", "full", "overflow", "unknown"]),
  stateConfidence: z.number().min(0).max(1),
  signals: z.object({
    binPresence: z.number().min(0).max(1),
    fullness: z.number().min(0).max(1),
    overflow: z.number().min(0).max(1),
  }).strict(),
  unknownReasons: z.array(z.string()),
  processingTimeMs: z.number().nonnegative(),
}).strict();

export const pipelineAnalysisResponseSchema = z.object({
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  focusRegion: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).default([]),
  peopleCount: z.number().int().nonnegative(),
  people: z.array(z.object({ confidence: z.number().min(0).max(1), bbox: boundingBoxSchema })),
  bins: z.array(pipelineBinSchema),
  floorHazards: z.array(z.object({
    className: z.enum(["floor_litter", "floor_spill"]),
    confidence: z.number().min(0).max(1),
    bbox: boundingBoxSchema,
    polygon: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
  })),
  modelVersions: z.object({
    floorHazard: z.string(),
    people: z.string(),
    binLocalizer: z.string(),
    binState: z.string(),
  }),
  processingTimeMs: z.number().nonnegative(),
}).strict();

export type PipelineAnalysisResponse = z.infer<typeof pipelineAnalysisResponseSchema>;
