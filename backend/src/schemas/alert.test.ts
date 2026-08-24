import { describe, expect, it } from "vitest";
import { alertChildListQuerySchema, alertListQuerySchema, flagListQuerySchema, issueObservationListQuerySchema } from "./alert.js";

describe("alert workflow query schemas", () => {
  it("defaults alert and flag listings to the current workflow", () => {
    expect(alertListQuerySchema.parse({})).toMatchObject({ workflow: "current", status: "all", limit: 25 });
    expect(flagListQuerySchema.parse({})).toMatchObject({ workflow: "current", limit: 25 });
  });

  it.each(["current", "legacy", "all"] as const)("accepts the %s workflow scope", (workflow) => {
    expect(alertListQuerySchema.parse({ workflow }).workflow).toBe(workflow);
    expect(flagListQuerySchema.parse({ workflow }).workflow).toBe(workflow);
  });

  it("preserves workflow scope alongside existing alert and flag filters", () => {
    expect(alertListQuerySchema.parse({
      workflow: "legacy",
      status: "resolved",
      issueType: "floor_litter",
      severity: "warning",
      zoneId: "zone-1",
      limit: "40",
    })).toEqual({
      workflow: "legacy",
      status: "resolved",
      issueType: "floor_litter",
      severity: "warning",
      zoneId: "zone-1",
      limit: 40,
    });
    expect(flagListQuerySchema.parse({
      workflow: "all",
      analysisRunId: "run-1",
      limit: "10",
    })).toEqual({ workflow: "all", analysisRunId: "run-1", limit: 10 });
  });

  it("rejects unsupported workflow scopes", () => {
    expect(alertListQuerySchema.safeParse({ workflow: "v1" }).success).toBe(false);
    expect(flagListQuerySchema.safeParse({ workflow: "v1" }).success).toBe(false);
  });

  it("accepts awaiting verification as an alert lifecycle state", () => {
    expect(alertListQuerySchema.parse({ status: "awaiting_verification" }).status).toBe("awaiting_verification");
  });

  it("accepts only bounded opaque pagination cursors", () => {
    expect(alertListQuerySchema.parse({ cursor: "YWJjMTIz" }).cursor).toBe("YWJjMTIz");
    expect(flagListQuerySchema.safeParse({ cursor: "bad+cursor" }).success).toBe(false);
    expect(issueObservationListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(alertChildListQuerySchema.parse({ limit: "10", cursor: "YWJjMTIz" })).toEqual({ limit: 10, cursor: "YWJjMTIz" });
  });
});
