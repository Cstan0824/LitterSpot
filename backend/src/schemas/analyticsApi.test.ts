import { describe, expect, it } from "vitest";
import { generateAnalyticsReportSchema, listAnalyticsReportsSchema } from "./analyticsApi.js";

describe("analytics API schemas", () => {
  it("accepts a bounded report period and defaults report-list options", () => {
    expect(generateAnalyticsReportSchema.parse({
      siteId: "site-1",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T00:00:00.000Z",
    }).siteId).toBe("site-1");
    expect(listAnalyticsReportsSchema.parse({ siteId: "site-1" })).toMatchObject({ status: "all", limit: 20 });
  });

  it("rejects inverted, oversized, and duplicate-zone report requests", () => {
    expect(generateAnalyticsReportSchema.safeParse({
      siteId: "site-1",
      periodStart: "2026-08-02T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(generateAnalyticsReportSchema.safeParse({
      siteId: "site-1",
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(generateAnalyticsReportSchema.safeParse({
      siteId: "site-1",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-02T00:00:00.000Z",
      zoneIds: ["zone-1", "zone-1"],
    }).success).toBe(false);
  });
});

