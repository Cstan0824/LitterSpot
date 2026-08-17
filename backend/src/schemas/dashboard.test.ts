import { describe, expect, it } from "vitest";
import { dashboardQuerySchema } from "./dashboard.js";

describe("dashboard query schema", () => {
  it("requires a site and applies bounded defaults", () => {
    expect(dashboardQuerySchema.parse({ siteId: "site-1" })).toEqual({
      siteId: "site-1", alertLimit: 10, detectionLimit: 10, failedJobLimit: 10,
    });
    expect(() => dashboardQuerySchema.parse({})).toThrow();
  });

  it("coerces limits and rejects unknown or excessive values", () => {
    expect(dashboardQuerySchema.parse({ siteId: "site-1", alertLimit: "25" }).alertLimit).toBe(25);
    expect(() => dashboardQuerySchema.parse({ siteId: "site-1", detectionLimit: "51" })).toThrow();
    expect(() => dashboardQuerySchema.parse({ siteId: "site-1", extra: "unexpected" })).toThrow();
  });
});
