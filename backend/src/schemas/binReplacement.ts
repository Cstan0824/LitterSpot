import { z } from "zod";

const idSchema = z.string().trim().min(1).max(128);
const instantSchema = z.string().datetime({ offset: true });

export const binReplacementQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().min(5).max(30).default(10),
  evaluatedAt: instantSchema.optional(),
  includeTestData: z.preprocess((value) => {
    if (value === undefined || value === "") return false;
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  }, z.boolean()).default(false),
}).strict();

export const binReplacementStateSchema = z.enum(["normal", "full", "overflow", "review", "unknown"]);

export const binReplacementPolicySchema = z.object({
  version: z.string().trim().min(1).max(128),
  provisional: z.literal(true),
  windowMinutes: z.number().int().min(5).max(30),
  minimumValidMinutes: z.number().int().positive(),
  unknownRatioLimit: z.number().finite().min(0).max(1),
  scoreThreshold: z.number().finite().min(0).max(100),
  minimumHighSignals: z.number().int().positive(),
  weights: z.object({
    binPressure: z.number().finite().min(0).max(1),
    litterPressure: z.number().finite().min(0).max(1),
    spillPressure: z.number().finite().min(0).max(1),
    humanPopularity: z.number().finite().min(0).max(1),
  }).strict(),
  thresholds: z.object({
    binPressure: z.number().finite().min(0).max(100),
    litterPressure: z.number().finite().min(0).max(100),
    spillPressure: z.number().finite().min(0).max(100),
    humanPopularity: z.number().finite().min(0).max(100),
  }).strict(),
  evaluationsToRaise: z.number().int().positive(),
  evaluationsToClear: z.number().int().positive(),
  hazardGapMinutes: z.number().int().nonnegative(),
  hazardMatchDistance: z.number().finite().nonnegative(),
  sampleIntervalSeconds: z.number().int().positive(),
}).strict().superRefine((policy, context) => {
  const total = Object.values(policy.weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-9) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["weights"], message: "Bin-replacement weights must total 1." });
  }
});

export const binReplacementSignalSchema = z.object({
  binPressure: z.number().finite().min(0).max(100),
  litterPressure: z.number().finite().min(0).max(100),
  spillPressure: z.number().finite().min(0).max(100),
  humanPopularity: z.number().finite().min(0).max(100),
}).strict();

export const binReplacementCoverageSchema = z.object({
  observedSamples: z.number().int().nonnegative(),
  validSamples: z.number().int().nonnegative(),
  requiredValidSamples: z.number().int().positive(),
  unknownMinutes: z.number().int().nonnegative(),
  unknownStateRatio: z.number().finite().min(0).max(1),
  coverageReady: z.boolean(),
}).strict();

export const binReplacementRecommendationSchema = z.object({
  zoneId: idSchema,
  evaluatedAt: instantSchema,
  windowStart: instantSchema,
  windowEnd: instantSchema,
  decision: z.enum(["replacement_recommended", "keep_current_bin", "insufficient_evidence"]),
  recommended: z.boolean(),
  provisional: z.literal(true),
  automaticAction: z.literal(false).default(false),
  policyVersion: z.string().trim().min(1).max(128),
  windowMinutes: z.number().int().min(5).max(30),
  sampleIntervalSeconds: z.number().int().positive(),
  coverage: binReplacementCoverageSchema,
  fullMinutes: z.number().int().nonnegative(),
  litterEpisodes: z.number().int().nonnegative(),
  spillEpisodes: z.number().int().nonnegative(),
  score: z.number().finite().min(0).max(100),
  scoreThreshold: z.number().finite().min(0).max(100),
  signals: binReplacementSignalSchema,
  highSignals: z.array(z.enum(["bin_pressure", "litter_pressure", "spill_pressure", "human_popularity"])),
  triggerReason: z.string().nullable(),
  raiseStreak: z.number().int().nonnegative(),
  clearStreak: z.number().int().nonnegative(),
}).strict();

export type BinReplacementQuery = z.infer<typeof binReplacementQuerySchema>;
export type BinReplacementPolicy = z.infer<typeof binReplacementPolicySchema>;
export type BinReplacementSignal = z.infer<typeof binReplacementSignalSchema>;
export type BinReplacementCoverage = z.infer<typeof binReplacementCoverageSchema>;
export type BinReplacementRecommendation = z.infer<typeof binReplacementRecommendationSchema>;
