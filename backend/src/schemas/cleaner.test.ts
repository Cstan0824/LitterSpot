import { describe, expect, it } from "vitest";
import { createCleanerSchema, updateCleanerSchema } from "./cleaner.js";

describe("cleaner request schemas", () => {
  it("accepts the confirmed cleaner fields", () => {
    const result = createCleanerSchema.safeParse({
      staffCode: "CLN-001",
      fullName: "Aisyah Rahman",
      phone: "+60 12-345 6789",
      assignedZoneId: "lower-staircase",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a login-shaped cleaner record", () => {
    const result = createCleanerSchema.safeParse({
      email: "cleaner@example.com",
      password: "not-a-cleaner-field",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed staff IDs and phone numbers", () => {
    const result = createCleanerSchema.safeParse({
      staffCode: "USER-1",
      fullName: "Cleaner Name",
      phone: "123",
      assignedZoneId: "zone-1",
    });
    expect(result.success).toBe(false);
  });

  it("supports soft deactivation and rejects empty updates", () => {
    expect(updateCleanerSchema.safeParse({ status: "inactive" }).success).toBe(true);
    expect(updateCleanerSchema.safeParse({}).success).toBe(false);
  });
});
