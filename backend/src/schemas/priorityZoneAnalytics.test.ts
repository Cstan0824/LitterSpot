import { describe, expect, it } from "vitest";
import {
  hourlyZoneAnalyticsBucketSchema,
  priorityZonePolicySchema,
  priorityZoneReportInputSchema,
} from "./priorityZoneAnalytics.js";
import { DEFAULT_PRIORITY_ZONE_POLICY } from "../services/priorityZoneAnalytics.js";

function bucket(overrides: Record<string, unknown> = {}) {
  return {
    id: "bucket-1",
    siteId: "site-1",
    zoneId: "zone-1",
    bucketStart: "2026-08-01T00:00:00.000Z",
    bucketEnd: "2026-08-01T01:00:00.000Z",
    analyticsEligible: true,
    isTest: false,
    successfulSampleCount: 1,
    failedSampleCount: 0,
    peopleCountSum: 3,
    peopleCountMax: 3,
    litterIncidentCount: 1,
    overflowIncidentCount: 0,
    issuePersistenceSeconds: 0,
    ...overrides,
  };
}

function reportInput(overrides: Record<string, unknown> = {}) {
  return {
    site: { id: "site-1", name: "Batu Caves", timeZone: "Asia/Kuala_Lumpur" },
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-03T00:00:00.000Z" },
    zones: [{ id: "zone-1", name: "Main Stairs" }],
    buckets: [bucket()],
    ...overrides,
  };
}

describe("priority-zone analytics schemas", () => {
  it("accepts an explicit IANA time zone and a one-hour bucket", () => {
    expect(priorityZoneReportInputSchema.parse(reportInput()).site.timeZone).toBe("Asia/Kuala_Lumpur");
  });

  it("rejects an invalid time zone and an inverted report period", () => {
    const result = priorityZoneReportInputSchema.safeParse(reportInput({
      site: { id: "site-1", name: "Batu Caves", timeZone: "Malaysia/Not_A_Zone" },
      period: { start: "2026-08-03T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining([
        "site.timeZone",
        "period.end",
      ]));
    }
  });

  it("requires exactly one hour and internally consistent successful metrics", () => {
    expect(hourlyZoneAnalyticsBucketSchema.safeParse(bucket({
      bucketEnd: "2026-08-01T02:00:00.000Z",
    })).success).toBe(false);
    expect(hourlyZoneAnalyticsBucketSchema.safeParse(bucket({
      successfulSampleCount: 0,
      peopleCountSum: 1,
      peopleCountMax: 1,
    })).success).toBe(false);
    expect(hourlyZoneAnalyticsBucketSchema.safeParse(bucket({
      peopleCountSum: 2,
      peopleCountMax: 3,
    })).success).toBe(false);
  });

  it("rejects duplicate configured zones and duplicate hourly bucket keys", () => {
    const result = priorityZoneReportInputSchema.safeParse(reportInput({
      zones: [
        { id: "zone-1", name: "Main Stairs" },
        { id: "zone-1", name: "Duplicate" },
      ],
      buckets: [bucket(), bucket({ id: "different-document-id" })],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        "Configured zone IDs must be unique.",
        "Only one analytics bucket is allowed per site, zone, and hour start.",
      ]));
    }
  });

  it("requires weights to total one and ordered band thresholds", () => {
    expect(priorityZonePolicySchema.safeParse({
      ...DEFAULT_PRIORITY_ZONE_POLICY,
      weights: { ...DEFAULT_PRIORITY_ZONE_POLICY.weights, litterBurden: 0.34 },
    }).success).toBe(false);
    expect(priorityZonePolicySchema.safeParse({
      ...DEFAULT_PRIORITY_ZONE_POLICY,
      bands: { highMinimum: 40, mediumMinimum: 40 },
    }).success).toBe(false);
  });
});
