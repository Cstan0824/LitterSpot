import {
  PRIORITY_ZONE_FACTOR_NAMES,
  priorityZonePolicySchema,
  priorityZoneReportInputSchema,
  priorityZoneReportSchema,
  type HourlyZoneAnalyticsBucket,
  type PriorityZoneFactorName,
  type PriorityZonePolicy,
  type PriorityZoneReport,
} from "../schemas/priorityZoneAnalytics.js";

export const DEFAULT_PRIORITY_ZONE_POLICY: PriorityZonePolicy = {
  version: "priority-zone-v1-provisional",
  provisional: true,
  granularity: "hour",
  normalization: "within_site_max_relative_over_sufficient_zones",
  factorDefinitions: {
    litterBurden: "litter_incident_count",
    visitorPressure: "average_people_per_successful_sample",
    overflowBurden: "overflow_incident_count",
    issuePersistence: "issue_persistence_hours",
  },
  weights: {
    litterBurden: 0.35,
    visitorPressure: 0.30,
    overflowBurden: 0.25,
    issuePersistence: 0.10,
  },
  bands: {
    highMinimum: 70,
    mediumMinimum: 40,
  },
  sufficiency: {
    minimumSuccessfulHourlyBuckets: 8,
    minimumLocalCalendarDays: 2,
    minimumSampleSuccessRatio: 0.8,
  },
};

type InsufficiencyReason =
  | "too_few_successful_hourly_buckets"
  | "too_few_local_calendar_days"
  | "sample_success_ratio_below_minimum";

type RawFactors = Record<PriorityZoneFactorName, number>;

type ZoneAggregate = {
  zoneId: string;
  zoneName: string;
  eligibleHourlyBucketCount: number;
  successfulHourlyBucketCount: number;
  successfulSampleCount: number;
  failedSampleCount: number;
  localCalendarDays: Set<string>;
  peopleCountSum: number;
  peakPeople: number;
  litterIncidents: number;
  overflowIncidents: number;
  issuePersistenceSeconds: number;
};

const localDateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function round(value: number, fractionDigits = 4) {
  const multiplier = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function localCalendarDate(instant: string, timeZone: string) {
  let formatter = localDateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    localDateFormatterCache.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant))
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function emptyAggregate(zoneId: string, zoneName: string): ZoneAggregate {
  return {
    zoneId,
    zoneName,
    eligibleHourlyBucketCount: 0,
    successfulHourlyBucketCount: 0,
    successfulSampleCount: 0,
    failedSampleCount: 0,
    localCalendarDays: new Set<string>(),
    peopleCountSum: 0,
    peakPeople: 0,
    litterIncidents: 0,
    overflowIncidents: 0,
    issuePersistenceSeconds: 0,
  };
}

function applyBucket(aggregate: ZoneAggregate, bucket: HourlyZoneAnalyticsBucket, timeZone: string) {
  aggregate.eligibleHourlyBucketCount += 1;
  aggregate.successfulSampleCount += bucket.successfulSampleCount;
  aggregate.failedSampleCount += bucket.failedSampleCount;
  aggregate.peopleCountSum += bucket.peopleCountSum;
  aggregate.peakPeople = Math.max(aggregate.peakPeople, bucket.peopleCountMax);
  aggregate.litterIncidents += bucket.litterIncidentCount;
  aggregate.overflowIncidents += bucket.overflowIncidentCount;
  aggregate.issuePersistenceSeconds += bucket.issuePersistenceSeconds;

  if (bucket.successfulSampleCount > 0) {
    aggregate.successfulHourlyBucketCount += 1;
    aggregate.localCalendarDays.add(localCalendarDate(bucket.bucketStart, timeZone));
  }
}

function successRatio(aggregate: ZoneAggregate) {
  const attemptedSamples = aggregate.successfulSampleCount + aggregate.failedSampleCount;
  return attemptedSamples === 0 ? 0 : aggregate.successfulSampleCount / attemptedSamples;
}

function insufficiencyReasons(aggregate: ZoneAggregate, policy: PriorityZonePolicy): InsufficiencyReason[] {
  const reasons: InsufficiencyReason[] = [];
  if (aggregate.successfulHourlyBucketCount < policy.sufficiency.minimumSuccessfulHourlyBuckets) {
    reasons.push("too_few_successful_hourly_buckets");
  }
  if (aggregate.localCalendarDays.size < policy.sufficiency.minimumLocalCalendarDays) {
    reasons.push("too_few_local_calendar_days");
  }
  if (successRatio(aggregate) < policy.sufficiency.minimumSampleSuccessRatio) {
    reasons.push("sample_success_ratio_below_minimum");
  }
  return reasons;
}

function rawFactors(aggregate: ZoneAggregate): RawFactors {
  return {
    litterBurden: aggregate.litterIncidents,
    visitorPressure: aggregate.successfulSampleCount === 0
      ? 0
      : aggregate.peopleCountSum / aggregate.successfulSampleCount,
    overflowBurden: aggregate.overflowIncidents,
    issuePersistence: aggregate.issuePersistenceSeconds / (60 * 60),
  };
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function insufficientReasonText(
  reason: InsufficiencyReason,
  aggregate: ZoneAggregate,
  policy: PriorityZonePolicy,
) {
  if (reason === "too_few_successful_hourly_buckets") {
    return `Insufficient data: ${aggregate.successfulHourlyBucketCount} successful hourly buckets; at least ${policy.sufficiency.minimumSuccessfulHourlyBuckets} are required.`;
  }
  if (reason === "too_few_local_calendar_days") {
    return `Insufficient data: successful buckets cover ${aggregate.localCalendarDays.size} local calendar days; at least ${policy.sufficiency.minimumLocalCalendarDays} are required.`;
  }
  return `Insufficient data: the sample success ratio is ${round(successRatio(aggregate) * 100, 2)}%; at least ${round(policy.sufficiency.minimumSampleSuccessRatio * 100, 2)}% is required.`;
}

function scoringReason(
  factor: PriorityZoneFactorName,
  aggregate: ZoneAggregate,
  normalized: number,
  contribution: number,
) {
  if (factor === "litterBurden") {
    return `Litter burden contributes ${round(contribution, 2)} points from ${aggregate.litterIncidents} deduplicated incidents (${round(normalized, 2)}/100 relative to the site maximum).`;
  }
  if (factor === "visitorPressure") {
    const average = aggregate.successfulSampleCount === 0 ? 0 : aggregate.peopleCountSum / aggregate.successfulSampleCount;
    return `Visitor pressure contributes ${round(contribution, 2)} points from an average of ${round(average, 2)} people per successful sample (${round(normalized, 2)}/100 relative to the site maximum).`;
  }
  if (factor === "overflowBurden") {
    return `Overflow burden contributes ${round(contribution, 2)} points from ${aggregate.overflowIncidents} deduplicated incidents (${round(normalized, 2)}/100 relative to the site maximum).`;
  }
  return `Issue persistence contributes ${round(contribution, 2)} points from ${round(aggregate.issuePersistenceSeconds / 3_600, 2)} hours (${round(normalized, 2)}/100 relative to the site maximum).`;
}

/**
 * Builds a deterministic report from pre-aggregated hourly rows. It does no I/O.
 * The interval is start-inclusive/end-exclusive, and local-day sufficiency uses
 * the site's explicit IANA time zone rather than the server's local time zone.
 */
export function buildPriorityZoneReport(
  rawInput: unknown,
  rawPolicy: unknown = DEFAULT_PRIORITY_ZONE_POLICY,
): PriorityZoneReport {
  const input = priorityZoneReportInputSchema.parse(rawInput);
  const policy = priorityZonePolicySchema.parse(rawPolicy);
  const periodStart = Date.parse(input.period.start);
  const periodEnd = Date.parse(input.period.end);
  const aggregates = new Map(
    input.zones.map((zone) => [zone.id, emptyAggregate(zone.id, zone.name)]),
  );
  const excludedBucketCounts = {
    test: 0,
    notAnalyticsEligible: 0,
    otherSite: 0,
    unknownZone: 0,
    outsidePeriod: 0,
  };
  let includedOperationalBucketCount = 0;

  for (const bucket of input.buckets) {
    // The precedence makes the mutually exclusive selection counts stable.
    if (bucket.isTest) {
      excludedBucketCounts.test += 1;
      continue;
    }
    if (!bucket.analyticsEligible) {
      excludedBucketCounts.notAnalyticsEligible += 1;
      continue;
    }
    if (bucket.siteId !== input.site.id) {
      excludedBucketCounts.otherSite += 1;
      continue;
    }
    const aggregate = aggregates.get(bucket.zoneId);
    if (!aggregate) {
      excludedBucketCounts.unknownZone += 1;
      continue;
    }
    const bucketStart = Date.parse(bucket.bucketStart);
    if (bucketStart < periodStart || bucketStart >= periodEnd) {
      excludedBucketCounts.outsidePeriod += 1;
      continue;
    }

    includedOperationalBucketCount += 1;
    applyBucket(aggregate, bucket, input.site.timeZone);
  }

  const prepared = [...aggregates.values()].map((aggregate) => {
    const coverageReasons = insufficiencyReasons(aggregate, policy);
    return {
      aggregate,
      raw: rawFactors(aggregate),
      coverageReasons,
      sufficient: coverageReasons.length === 0,
    };
  });
  const sufficient = prepared.filter((zone) => zone.sufficient);
  const maximums = Object.fromEntries(
    PRIORITY_ZONE_FACTOR_NAMES.map((factor) => [
      factor,
      Math.max(0, ...sufficient.map((zone) => zone.raw[factor])),
    ]),
  ) as RawFactors;

  const unranked = prepared.map(({ aggregate, raw, coverageReasons, sufficient: hasSufficientData }) => {
    const factorEntries = PRIORITY_ZONE_FACTOR_NAMES.map((factor) => {
      if (!hasSufficientData) {
        return [factor, {
          raw: round(raw[factor]),
          normalized: null,
          weight: policy.weights[factor],
          weightedContribution: null,
        }] as const;
      }
      const normalized = maximums[factor] === 0 ? 0 : raw[factor] / maximums[factor] * 100;
      return [factor, {
        raw: round(raw[factor]),
        normalized: round(normalized),
        weight: policy.weights[factor],
        weightedContribution: round(normalized * policy.weights[factor]),
      }] as const;
    });
    const factors = Object.fromEntries(factorEntries) as Record<PriorityZoneFactorName, {
      raw: number;
      normalized: number | null;
      weight: number;
      weightedContribution: number | null;
    }>;
    const totalScore = hasSufficientData
      ? round(PRIORITY_ZONE_FACTOR_NAMES.reduce(
        (sum, factor) => sum + (factors[factor].weightedContribution ?? 0),
        0,
      ))
      : null;
    const priorityBand = totalScore === null
      ? "insufficient_data" as const
      : totalScore >= policy.bands.highMinimum
        ? "high" as const
        : totalScore >= policy.bands.mediumMinimum
          ? "medium" as const
          : "low" as const;
    const ratio = successRatio(aggregate);
    const reasons = hasSufficientData
      ? [
        `${priorityBand[0].toUpperCase()}${priorityBand.slice(1)} priority with a provisional score of ${round(totalScore ?? 0, 2)}/100.`,
        ...PRIORITY_ZONE_FACTOR_NAMES.map((factor) => scoringReason(
          factor,
          aggregate,
          factors[factor].normalized ?? 0,
          factors[factor].weightedContribution ?? 0,
        )),
      ]
      : coverageReasons.map((reason) => insufficientReasonText(reason, aggregate, policy));

    return {
      zoneId: aggregate.zoneId,
      zoneName: aggregate.zoneName,
      rank: null as number | null,
      priorityBand,
      totalScore,
      factors,
      evidence: {
        litterIncidents: aggregate.litterIncidents,
        overflowIncidents: aggregate.overflowIncidents,
        averagePeoplePerSuccessfulSample: round(raw.visitorPressure),
        peakPeople: aggregate.peakPeople,
        issuePersistenceSeconds: round(aggregate.issuePersistenceSeconds),
      },
      coverage: {
        eligibleHourlyBucketCount: aggregate.eligibleHourlyBucketCount,
        successfulHourlyBucketCount: aggregate.successfulHourlyBucketCount,
        localCalendarDayCount: aggregate.localCalendarDays.size,
        successfulSampleCount: aggregate.successfulSampleCount,
        failedSampleCount: aggregate.failedSampleCount,
        sampleSuccessRatio: round(ratio),
        sufficient: hasSufficientData,
        insufficiencyReasons: coverageReasons,
      },
      reasons,
    };
  });

  const ranked = unranked
    .filter((zone) => zone.totalScore !== null)
    .sort((left, right) => (right.totalScore ?? 0) - (left.totalScore ?? 0) || compareIds(left.zoneId, right.zoneId))
    .map((zone, index) => ({ ...zone, rank: index + 1 }));
  const insufficient = unranked
    .filter((zone) => zone.totalScore === null)
    .sort((left, right) => compareIds(left.zoneId, right.zoneId));

  return priorityZoneReportSchema.parse({
    status: ranked.length > 0 ? "completed" : "insufficient_data",
    site: input.site,
    period: input.period,
    policy,
    selection: {
      inputBucketCount: input.buckets.length,
      includedOperationalBucketCount,
      excludedBucketCounts,
    },
    sufficientZoneCount: ranked.length,
    insufficientZoneCount: insufficient.length,
    zoneResults: [...ranked, ...insufficient],
  });
}
