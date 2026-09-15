import { z } from "zod";

const boundingBoxSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

const pipelineBinSchema = z.object({
  binIndex: z.number().int().positive(),
  binId: z.string().trim().min(1).max(64).optional(),
  trackingId: z.string().nullable().optional(),
  localizerConfidence: z.number().min(0).max(1),
  candidateSource: z.enum(["specialist_profile", "profile", "localizer", "vlm"]).optional(),
  binPresenceScore: z.number().min(0).max(1).optional(),
  profileMatched: z.boolean().optional(),
  bbox: boundingBoxSchema,
  classificationRegion: boundingBoxSchema,
  state: z.enum(["normal", "full", "overflow", "review", "unknown"]),
  stateConfidence: z.number().min(0).max(1),
  signals: z.object({
    binPresence: z.number().min(0).max(1),
    fullness: z.number().min(0).max(1),
    overflow: z.number().min(0).max(1),
  }).strict(),
  unknownReasons: z.array(z.string()),
  evidence: z.object({
    topChangeRatio: z.number().min(0).max(1),
    outsideChangeRatio: z.number().min(0).max(1),
    exteriorEvidence: z.boolean(),
  }).optional(),
  confirmed: z.boolean().optional(),
  stale: z.boolean().optional(),
  confirmationFrames: z.number().int().nonnegative().optional(),
  processingTimeMs: z.number().nonnegative(),
}).strict();

const basePipelineAnalysisResponseSchema = z.object({
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
  analysisId: z.number().int().positive().optional(),
  imageName: z.string().optional(),
  cameraId: z.string().optional(),
  flags: z.array(z.unknown()).optional(),
  stages: z.array(z.unknown()).optional(),
  modelVersion: z.string().optional(),
  inferenceProvider: z.enum(["specialists", "hybrid", "legacy"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.analysisId !== undefined || value.flags !== undefined || value.cameraId !== undefined
    || value.stages !== undefined || value.modelVersion !== undefined || value.inferenceProvider !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Business/session fields are not valid for stateless frame inference." });
  }
  if (value.bins.some((bin) => bin.confirmed !== undefined || bin.stale !== undefined || bin.trackingId !== undefined
    || bin.candidateSource !== undefined || bin.binPresenceScore !== undefined || bin.profileMatched !== undefined
    || bin.confirmationFrames !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bins"], message: "Business/session bin fields are not valid for stateless frame inference." });
  }
});

const specialistPipelineBinSchema = pipelineBinSchema.extend({
  trackingId: z.string().nullable().optional(),
  candidateSource: z.enum(["specialist_profile", "profile", "localizer", "vlm"]),
  binPresenceScore: z.number().min(0).max(1),
  profileMatched: z.boolean(),
  confirmed: z.boolean().optional(),
  stale: z.boolean().optional(),
  confirmationFrames: z.number().int().nonnegative().optional(),
}).passthrough();

const specialistPipelineAnalysisResponseSchema = z.object({
  analysisId: z.number().int().positive(),
  imageName: z.string(),
  cameraId: z.string(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  focusRegion: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).default([]),
  peopleCount: z.number().int().nonnegative(),
  people: z.array(z.object({ confidence: z.number().min(0).max(1), bbox: boundingBoxSchema })),
  bins: z.array(specialistPipelineBinSchema),
  floorHazards: z.array(z.object({
    className: z.enum(["floor_litter", "floor_spill"]),
    confidence: z.number().min(0).max(1),
    bbox: boundingBoxSchema,
    polygon: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
  })),
  flags: z.array(z.unknown()),
  stages: z.array(z.unknown()),
  processingTimeMs: z.number().nonnegative(),
  modelVersion: z.string(),
  inferenceProvider: z.enum(["specialists", "hybrid", "legacy"]),
  modelVersions: z.object({
    floorHazard: z.string(),
    people: z.string(),
    binLocalizer: z.string(),
    binState: z.string(),
  }).default({ floorHazard: "unknown", people: "unknown", binLocalizer: "unknown", binState: "unknown" }),
}).passthrough();

export const pipelineAnalysisResponseSchema = z.union([
  basePipelineAnalysisResponseSchema,
  specialistPipelineAnalysisResponseSchema,
]);

export type PipelineAnalysisResponse = z.infer<typeof pipelineAnalysisResponseSchema>;

// Legacy placement contract retained for specialist replay fixtures. The
// production placement endpoint uses binReplacementRecommendationSchema; this
// export keeps older benchmark fixtures type-safe while the contracts migrate.
export const placementRecommendationSchema = z.object({
  cameraId: z.string().min(1),
  decision: z.enum(["replacement_recommended", "keep_current_bin", "insufficient_evidence"]),
  recommended: z.boolean(),
  provisional: z.literal(true),
  windowMinutes: z.number().int().positive(),
  sampleIntervalSeconds: z.number().int().positive(),
  observedSamples: z.number().int().nonnegative(),
  validSamples: z.number().int().nonnegative(),
  requiredValidSamples: z.number().int().positive(),
  coverageReady: z.boolean(),
  unknownMinutes: z.number().int().nonnegative(),
  unknownStateRatio: z.number().min(0).max(1),
  fullMinutes: z.number().int().nonnegative(),
  litterEpisodes: z.number().int().nonnegative(),
  spillEpisodes: z.number().int().nonnegative(),
  score: z.number().min(0).max(100),
  scoreThreshold: z.number().min(0).max(100),
  signals: z.object({
    binPressure: z.number().min(0).max(100),
    litterPressure: z.number().min(0).max(100),
    spillPressure: z.number().min(0).max(100),
    humanPopularity: z.number().min(0).max(100),
  }).strict(),
  highSignals: z.array(z.string()),
  triggerReason: z.string(),
  raiseStreak: z.number().int().nonnegative(),
  clearStreak: z.number().int().nonnegative(),
  nextEvaluationAt: z.string(),
  status: z.string(),
}).strict();
