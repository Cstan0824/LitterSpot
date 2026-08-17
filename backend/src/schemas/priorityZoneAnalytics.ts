import { z } from "zod";

const idSchema = z.string().trim().min(1).max(128);
const isoInstantSchema = z.string().datetime({ offset: true });
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const nonnegativeFiniteSchema = z.number().finite().nonnegative();

export const PRIORITY_ZONE_FACTOR_NAMES = [
  "litterBurden",
  "visitorPressure",
  "overflowBurden",
  "issuePersistence",
] as const;

export const priorityZoneWeightsSchema = z.object({
  litterBurden: z.number().finite().min(0).max(1),
  visitorPressure: z.number().finite().min(0).max(1),
  overflowBurden: z.number().finite().min(0).max(1),
  issuePersistence: z.number().finite().min(0).max(1),
}).strict().superRefine((weights, context) => {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-9) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Priority-zone factor weights must total 1.",
    });
  }
});

export const priorityZonePolicySchema = z.object({
  version: z.string().trim().min(1).max(128),
  provisional: z.literal(true),
  granularity: z.literal("hour"),
  normalization: z.literal("within_site_max_relative_over_sufficient_zones"),
  factorDefinitions: z.object({
    litterBurden: z.literal("litter_incident_count"),
    visitorPressure: z.literal("average_people_per_successful_sample"),
    overflowBurden: z.literal("overflow_incident_count"),
    issuePersistence: z.literal("issue_persistence_hours"),
  }).strict(),
  weights: priorityZoneWeightsSchema,
  bands: z.object({
    highMinimum: z.number().finite().min(0).max(100),
    mediumMinimum: z.number().finite().min(0).max(100),
  }).strict(),
  sufficiency: z.object({
    minimumSuccessfulHourlyBuckets: z.number().int().positive(),
    minimumLocalCalendarDays: z.number().int().positive(),
    minimumSampleSuccessRatio: z.number().finite().min(0).max(1),
  }).strict(),
}).strict().superRefine((policy, context) => {
  if (policy.bands.highMinimum <= policy.bands.mediumMinimum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bands", "highMinimum"],
      message: "The high-priority threshold must be greater than the medium-priority threshold.",
    });
  }
});

export const priorityZoneInputSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(160),
}).strict();

export const hourlyZoneAnalyticsBucketSchema = z.object({
  id: idSchema,
  siteId: idSchema,
  zoneId: idSchema,
  bucketStart: isoInstantSchema,
  bucketEnd: isoInstantSchema,
  analyticsEligible: z.boolean(),
  isTest: z.boolean(),
  successfulSampleCount: nonnegativeIntegerSchema,
  failedSampleCount: nonnegativeIntegerSchema,
  peopleCountSum: nonnegativeIntegerSchema,
  peopleCountMax: nonnegativeIntegerSchema,
  litterIncidentCount: nonnegativeIntegerSchema,
  overflowIncidentCount: nonnegativeIntegerSchema,
  issuePersistenceSeconds: nonnegativeFiniteSchema,
}).strict().superRefine((bucket, context) => {
  const bucketStart = Date.parse(bucket.bucketStart);
  const bucketEnd = Date.parse(bucket.bucketEnd);
  if (bucketEnd - bucketStart !== 60 * 60 * 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bucketEnd"],
      message: "An hourly analytics bucket must span exactly one hour.",
    });
  }

  if (bucket.peopleCountMax > bucket.peopleCountSum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["peopleCountMax"],
      message: "peopleCountMax cannot exceed peopleCountSum.",
    });
  }

  if (bucket.successfulSampleCount === 0 && (
    bucket.peopleCountSum > 0
    || bucket.peopleCountMax > 0
    || bucket.litterIncidentCount > 0
    || bucket.overflowIncidentCount > 0
    || bucket.issuePersistenceSeconds > 0
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["successfulSampleCount"],
      message: "A bucket without successful samples cannot contain successful inference metrics.",
    });
  }
});

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const priorityZoneReportInputSchema = z.object({
  site: z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(160),
    timeZone: z.string().trim().min(1).max(128),
  }).strict(),
  period: z.object({
    start: isoInstantSchema,
    end: isoInstantSchema,
  }).strict(),
  zones: z.array(priorityZoneInputSchema).min(1).max(1_000),
  buckets: z.array(hourlyZoneAnalyticsBucketSchema).max(100_000),
}).strict().superRefine((input, context) => {
  if (!isValidTimeZone(input.site.timeZone)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["site", "timeZone"],
      message: "site.timeZone must be a valid IANA time-zone identifier.",
    });
  }

  if (Date.parse(input.period.end) <= Date.parse(input.period.start)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["period", "end"],
      message: "The report period end must be after its start.",
    });
  }

  const zoneIds = new Set<string>();
  for (const [index, zone] of input.zones.entries()) {
    if (zoneIds.has(zone.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["zones", index, "id"],
        message: "Configured zone IDs must be unique.",
      });
    }
    zoneIds.add(zone.id);
  }

  const hourlyKeys = new Set<string>();
  for (const [index, bucket] of input.buckets.entries()) {
    const key = `${bucket.siteId}\0${bucket.zoneId}\0${new Date(bucket.bucketStart).toISOString()}`;
    if (hourlyKeys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buckets", index, "bucketStart"],
        message: "Only one analytics bucket is allowed per site, zone, and hour start.",
      });
    }
    hourlyKeys.add(key);
  }
});

export const priorityZoneFactorResultSchema = z.object({
  raw: nonnegativeFiniteSchema,
  normalized: z.number().finite().min(0).max(100).nullable(),
  weight: z.number().finite().min(0).max(1),
  weightedContribution: z.number().finite().min(0).max(100).nullable(),
}).strict();

export const priorityZoneCoverageSchema = z.object({
  eligibleHourlyBucketCount: nonnegativeIntegerSchema,
  successfulHourlyBucketCount: nonnegativeIntegerSchema,
  localCalendarDayCount: nonnegativeIntegerSchema,
  successfulSampleCount: nonnegativeIntegerSchema,
  failedSampleCount: nonnegativeIntegerSchema,
  sampleSuccessRatio: z.number().finite().min(0).max(1),
  sufficient: z.boolean(),
  insufficiencyReasons: z.array(z.enum([
    "too_few_successful_hourly_buckets",
    "too_few_local_calendar_days",
    "sample_success_ratio_below_minimum",
  ])),
}).strict();

export const priorityZoneResultSchema = z.object({
  zoneId: idSchema,
  zoneName: z.string().min(1),
  rank: z.number().int().positive().nullable(),
  priorityBand: z.enum(["high", "medium", "low", "insufficient_data"]),
  totalScore: z.number().finite().min(0).max(100).nullable(),
  factors: z.object({
    litterBurden: priorityZoneFactorResultSchema,
    visitorPressure: priorityZoneFactorResultSchema,
    overflowBurden: priorityZoneFactorResultSchema,
    issuePersistence: priorityZoneFactorResultSchema,
  }).strict(),
  evidence: z.object({
    litterIncidents: nonnegativeIntegerSchema,
    overflowIncidents: nonnegativeIntegerSchema,
    averagePeoplePerSuccessfulSample: nonnegativeFiniteSchema,
    peakPeople: nonnegativeIntegerSchema,
    issuePersistenceSeconds: nonnegativeFiniteSchema,
  }).strict(),
  coverage: priorityZoneCoverageSchema,
  reasons: z.array(z.string().min(1)),
}).strict();

export const priorityZoneReportSchema = z.object({
  status: z.enum(["completed", "insufficient_data"]),
  site: z.object({
    id: idSchema,
    name: z.string().min(1),
    timeZone: z.string().min(1),
  }).strict(),
  period: z.object({ start: isoInstantSchema, end: isoInstantSchema }).strict(),
  policy: priorityZonePolicySchema,
  selection: z.object({
    inputBucketCount: nonnegativeIntegerSchema,
    includedOperationalBucketCount: nonnegativeIntegerSchema,
    excludedBucketCounts: z.object({
      test: nonnegativeIntegerSchema,
      notAnalyticsEligible: nonnegativeIntegerSchema,
      otherSite: nonnegativeIntegerSchema,
      unknownZone: nonnegativeIntegerSchema,
      outsidePeriod: nonnegativeIntegerSchema,
    }).strict(),
  }).strict(),
  sufficientZoneCount: nonnegativeIntegerSchema,
  insufficientZoneCount: nonnegativeIntegerSchema,
  zoneResults: z.array(priorityZoneResultSchema),
}).strict();

export type PriorityZonePolicy = z.infer<typeof priorityZonePolicySchema>;
export type PriorityZoneReportInput = z.infer<typeof priorityZoneReportInputSchema>;
export type HourlyZoneAnalyticsBucket = z.infer<typeof hourlyZoneAnalyticsBucketSchema>;
export type PriorityZoneReport = z.infer<typeof priorityZoneReportSchema>;
export type PriorityZoneFactorName = typeof PRIORITY_ZONE_FACTOR_NAMES[number];
