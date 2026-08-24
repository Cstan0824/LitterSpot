import { describe, expect, it } from "vitest";
import { buildPriorityZoneReport, DEFAULT_PRIORITY_ZONE_POLICY } from "./priorityZoneAnalytics.js";

type BucketOverrides = Partial<{
  siteId: string;
  zoneId: string;
  analyticsEligible: boolean;
  isTest: boolean;
  successfulSampleCount: number;
  failedSampleCount: number;
  peopleCountSum: number;
  peopleCountMax: number;
  litterIncidentCount: number;
  overflowIncidentCount: number;
  issuePersistenceSeconds: number;
}>;

function bucket(id: string, start: string, overrides: BucketOverrides = {}) {
  const startMilliseconds = Date.parse(start);
  return {
    id,
    siteId: "site-1",
    zoneId: "zone-a",
    bucketStart: new Date(startMilliseconds).toISOString(),
    bucketEnd: new Date(startMilliseconds + 3_600_000).toISOString(),
    analyticsEligible: true,
    isTest: false,
    successfulSampleCount: 1,
    failedSampleCount: 0,
    peopleCountSum: 0,
    peopleCountMax: 0,
    litterIncidentCount: 0,
    overflowIncidentCount: 0,
    issuePersistenceSeconds: 0,
    ...overrides,
  };
}

const adequateStarts = [
  "2026-08-01T00:00:00.000Z",
  "2026-08-01T01:00:00.000Z",
  "2026-08-01T02:00:00.000Z",
  "2026-08-01T03:00:00.000Z",
  "2026-08-01T04:00:00.000Z",
  "2026-08-01T05:00:00.000Z",
  "2026-08-01T06:00:00.000Z",
  "2026-08-02T00:00:00.000Z",
];

function adequateBuckets(
  zoneId: string,
  metrics: Pick<BucketOverrides, "peopleCountSum" | "litterIncidentCount" | "overflowIncidentCount" | "issuePersistenceSeconds"> = {},
) {
  return adequateStarts.map((start, index) => bucket(`${zoneId}-${index}`, start, {
    zoneId,
    peopleCountSum: metrics.peopleCountSum ?? 0,
    peopleCountMax: metrics.peopleCountSum ?? 0,
    litterIncidentCount: index === 0 ? metrics.litterIncidentCount ?? 0 : 0,
    overflowIncidentCount: index === 0 ? metrics.overflowIncidentCount ?? 0 : 0,
    issuePersistenceSeconds: index === 0 ? metrics.issuePersistenceSeconds ?? 0 : 0,
  }));
}

function input(
  zones: Array<{ id: string; name: string }>,
  buckets: ReturnType<typeof bucket>[],
  timeZone = "Asia/Kuala_Lumpur",
) {
  return {
    site: { id: "site-1", name: "Batu Caves", timeZone },
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-04T00:00:00.000Z" },
    zones,
    buckets,
  };
}

describe("buildPriorityZoneReport", () => {
  it("uses the provisional four-factor weights, max-relative normalization, bands, and deterministic ranks", () => {
    const zones = [
      { id: "zone-a", name: "Main Stairs" },
      { id: "zone-b", name: "Food Court" },
      { id: "zone-c", name: "Entrance" },
    ];
    const report = buildPriorityZoneReport(input(zones, [
      ...adequateBuckets("zone-a", { peopleCountSum: 5, litterIncidentCount: 10, overflowIncidentCount: 2, issuePersistenceSeconds: 3_600 }),
      ...adequateBuckets("zone-b", { peopleCountSum: 10, litterIncidentCount: 5, overflowIncidentCount: 4, issuePersistenceSeconds: 7_200 }),
      ...adequateBuckets("zone-c"),
    ]));

    expect(report.status).toBe("completed");
    expect(report.policy).toEqual(DEFAULT_PRIORITY_ZONE_POLICY);
    expect(report.zoneResults.map((zone) => [zone.zoneId, zone.rank, zone.priorityBand, zone.totalScore])).toEqual([
      ["zone-b", 1, "high", 82.5],
      ["zone-a", 2, "medium", 67.5],
      ["zone-c", 3, "low", 0],
    ]);
    expect(report.zoneResults[1].factors).toEqual({
      litterBurden: { raw: 10, normalized: 100, weight: 0.35, weightedContribution: 35 },
      visitorPressure: { raw: 5, normalized: 50, weight: 0.3, weightedContribution: 15 },
      overflowBurden: { raw: 2, normalized: 50, weight: 0.25, weightedContribution: 12.5 },
      issuePersistence: { raw: 1, normalized: 50, weight: 0.1, weightedContribution: 5 },
    });
    expect(report.zoneResults[0].reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("High priority"),
      expect.stringContaining("deduplicated incidents"),
      expect.stringContaining("people per successful sample"),
    ]));
  });

  it("passes all sufficiency boundaries exactly", () => {
    const buckets = adequateBuckets("zone-a");
    buckets[0] = { ...buckets[0], failedSampleCount: 2 };
    const report = buildPriorityZoneReport(input([{ id: "zone-a", name: "Main Stairs" }], buckets));
    expect(report.zoneResults[0].coverage).toMatchObject({
      successfulHourlyBucketCount: 8,
      localCalendarDayCount: 2,
      successfulSampleCount: 8,
      failedSampleCount: 2,
      sampleSuccessRatio: 0.8,
      sufficient: true,
      insufficiencyReasons: [],
    });
  });

  it("returns insufficient_data with every failed sufficiency reason and no normalized score", () => {
    const report = buildPriorityZoneReport(input(
      [{ id: "zone-a", name: "Main Stairs" }],
      [bucket("only", "2026-08-01T00:00:00.000Z", { failedSampleCount: 1, litterIncidentCount: 2 })],
    ));
    const result = report.zoneResults[0];
    expect(report.status).toBe("insufficient_data");
    expect(result).toMatchObject({
      rank: null,
      priorityBand: "insufficient_data",
      totalScore: null,
      coverage: {
        sufficient: false,
        insufficiencyReasons: [
          "too_few_successful_hourly_buckets",
          "too_few_local_calendar_days",
          "sample_success_ratio_below_minimum",
        ],
      },
    });
    expect(result.factors.litterBurden).toEqual({
      raw: 2,
      normalized: null,
      weight: 0.35,
      weightedContribution: null,
    });
    expect(result.reasons).toHaveLength(3);
  });

  it("counts successful days in the site's IANA time zone, independent of server time", () => {
    const starts = [
      "2026-08-01T09:00:00.000Z",
      "2026-08-01T10:00:00.000Z",
      "2026-08-01T11:00:00.000Z",
      "2026-08-01T12:00:00.000Z",
      "2026-08-01T13:00:00.000Z",
      "2026-08-01T14:00:00.000Z",
      "2026-08-01T15:00:00.000Z",
      "2026-08-01T16:00:00.000Z",
    ];
    const buckets = starts.map((start, index) => bucket(`local-${index}`, start));
    const kualaLumpur = buildPriorityZoneReport(input(
      [{ id: "zone-a", name: "Main Stairs" }],
      buckets,
      "Asia/Kuala_Lumpur",
    ));
    const utc = buildPriorityZoneReport(input(
      [{ id: "zone-a", name: "Main Stairs" }],
      buckets,
      "UTC",
    ));
    expect(kualaLumpur.zoneResults[0].coverage.localCalendarDayCount).toBe(2);
    expect(kualaLumpur.zoneResults[0].coverage.sufficient).toBe(true);
    expect(utc.zoneResults[0].coverage.localCalendarDayCount).toBe(1);
    expect(utc.zoneResults[0].coverage.sufficient).toBe(false);
  });

  it("excludes test, ineligible, other-site, unknown-zone, and out-of-period rows with stable precedence", () => {
    const valid = adequateBuckets("zone-a");
    const excluded = [
      bucket("test", "2026-08-02T08:00:00.000Z", { isTest: true, litterIncidentCount: 99 }),
      bucket("ineligible", "2026-08-02T09:00:00.000Z", { analyticsEligible: false, litterIncidentCount: 99 }),
      bucket("other-site", "2026-08-02T10:00:00.000Z", { siteId: "site-2", litterIncidentCount: 99 }),
      bucket("unknown-zone", "2026-08-02T11:00:00.000Z", { zoneId: "zone-missing", litterIncidentCount: 99 }),
      bucket("outside", "2026-08-04T00:00:00.000Z", { litterIncidentCount: 99 }),
    ];
    const report = buildPriorityZoneReport(input([{ id: "zone-a", name: "Main Stairs" }], [...valid, ...excluded]));
    expect(report.selection).toEqual({
      inputBucketCount: 13,
      includedOperationalBucketCount: 8,
      excludedBucketCounts: {
        test: 1,
        notAnalyticsEligible: 1,
        otherSite: 1,
        unknownZone: 1,
        outsidePeriod: 1,
      },
    });
    expect(report.zoneResults[0].evidence.litterIncidents).toBe(0);
  });

  it("does not let an insufficient extreme zone distort sufficient-zone normalization", () => {
    const sufficient = adequateBuckets("zone-a", { litterIncidentCount: 10 });
    const insufficient = [bucket("extreme", "2026-08-01T08:00:00.000Z", {
      zoneId: "zone-z",
      litterIncidentCount: 1_000,
    })];
    const report = buildPriorityZoneReport(input([
      { id: "zone-a", name: "Main Stairs" },
      { id: "zone-z", name: "Sparse Camera Zone" },
    ], [...sufficient, ...insufficient]));
    expect(report.zoneResults[0].zoneId).toBe("zone-a");
    expect(report.zoneResults[0].factors.litterBurden.normalized).toBe(100);
    expect(report.zoneResults[1].factors.litterBurden).toMatchObject({ raw: 1_000, normalized: null });
  });

  it("applies and returns an explicitly versioned custom policy", () => {
    const policy = {
      ...DEFAULT_PRIORITY_ZONE_POLICY,
      version: "priority-zone-demo-policy",
      weights: {
        litterBurden: 1,
        visitorPressure: 0,
        overflowBurden: 0,
        issuePersistence: 0,
      },
      bands: { highMinimum: 90, mediumMinimum: 50 },
    };
    const report = buildPriorityZoneReport(input([
      { id: "zone-a", name: "Main Stairs" },
      { id: "zone-b", name: "Food Court" },
    ], [
      ...adequateBuckets("zone-a", { litterIncidentCount: 5 }),
      ...adequateBuckets("zone-b", { litterIncidentCount: 10 }),
    ]), policy);
    expect(report.policy).toEqual(policy);
    expect(report.zoneResults.map((zone) => [zone.zoneId, zone.totalScore, zone.priorityBand])).toEqual([
      ["zone-b", 100, "high"],
      ["zone-a", 50, "medium"],
    ]);
  });

  it("is independent of input zone and bucket ordering", () => {
    const zones = [
      { id: "zone-a", name: "Main Stairs" },
      { id: "zone-b", name: "Food Court" },
    ];
    const buckets = [
      ...adequateBuckets("zone-a", { litterIncidentCount: 2 }),
      ...adequateBuckets("zone-b", { litterIncidentCount: 2 }),
    ];
    const first = buildPriorityZoneReport(input(zones, buckets));
    const second = buildPriorityZoneReport(input([...zones].reverse(), [...buckets].reverse()));
    expect(second).toEqual(first);
    expect(first.zoneResults.map((result) => result.zoneId)).toEqual(["zone-a", "zone-b"]);
  });
});
